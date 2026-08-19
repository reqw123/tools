# -*- coding: utf-8 -*-
"""
report_handlers/generic.py
=============================
提供兩個共用的基底 Handler，讓其餘報表類型不必各自重寫一整套邏輯：

  GenericAppendRowHandler  - 在表格最後一列（總計列之前）新增一列資料，
                              並視情況延伸 SUM 總計公式。用於人員名冊 /
                              多客戶結算表這種『沒有客戶對帳表那種複雜
                              分組小計』的單純表格。

  GenericReadOnlyHandler   - 用於還沒有完整寫入邏輯的報表類型
                              （地址標籤／支票月份表／商品價格表／
                              商品日期矩陣／公告／未知格式）。
                              仍然實作完整的六個標準介面（需求 #20），
                              但只允許 action="analyze"，其餘動作會
                              回傳清楚的錯誤訊息，不會讓程式崩潰
                              （需求 #37 #39 #50）。
"""

from __future__ import annotations

import re
from typing import Optional

from excel_manager import ExcelManager, SheetGrid
from region_detector import Region
from structure_analyzer import StructureInfo, find_column, quick_canonical_guess
from operation_planner import OperationPlan
from report_handlers.base import (
    ReportHandler, HandlerError, MultipleCandidatesError, HandlerResult,
    CellChange, OperationStep, append_operation_log, ProgressCallback,
)

_SUM_RE = re.compile(r"^=SUM\(([A-Z]+)(\d+):([A-Z]+)(\d+)\)$", re.IGNORECASE)


class GenericAppendRowHandler(ReportHandler):
    """在表格最後一列新增一筆資料（不含分組小計邏輯）。"""

    match_canonical_keys: list[str] = []  # 用來比對 update 的 canonical 欄位（依優先順序）
    required_canonical_keys: list[str] = []

    def parse(self, plan: OperationPlan) -> dict:
        return {"action": plan.action, "data": dict(plan.data), "where": dict(plan.where)}

    def validate(self, parsed: dict):
        if parsed["action"] not in ("append_order", "add_customer", "add_employee", "update_field"):
            raise HandlerError(f"這個報表類型不支援操作：{parsed['action']}")
        if parsed["action"] != "update_field":
            missing = [k for k in self.required_canonical_keys if not parsed["data"].get(k)]
            if missing:
                raise HandlerError(f"缺少必要欄位：{missing}")

    def find_insert_position(self, parsed: dict) -> dict:
        if parsed["action"] == "update_field":
            return self._find_update_row(parsed)

        insert_row = self.structure.total_row or (self.structure.data_end_row + 1)
        return {"mode": "append", "insert_row": insert_row}

    def _find_update_row(self, parsed: dict) -> dict:
        where = parsed.get("where") or {}
        if not where:
            raise HandlerError("修改資料需要提供比對條件（例如姓名或編號）。")

        candidates = []
        for r in range(self.structure.data_start_row, self.structure.data_end_row + 1):
            ok = True
            for canonical, expected in where.items():
                col = find_column(self.structure.headers, canonical)
                if col is None:
                    ok = False
                    break
                cell = self.grid.get(r, col)
                actual = str(cell.value).strip() if cell and not cell.is_empty else ""
                if actual != str(expected).strip():
                    ok = False
                    break
            if ok:
                candidates.append(r)

        if not candidates:
            raise HandlerError(f"找不到符合條件的資料：{where}")
        if len(candidates) > 1:
            raise MultipleCandidatesError(
                [{"row": r} for r in candidates],
                f"找到 {len(candidates)} 筆符合條件的資料，請提供更明確的條件。",
            )
        return {"mode": "update", "row": candidates[0]}

    def build_operation_plan(self, parsed: dict, position: dict,
                              all_regions: Optional[list[Region]] = None) -> list[OperationStep]:
        if position["mode"] == "update":
            row = position["row"]
            changes = []
            for canonical, value in parsed["data"].items():
                col = find_column(self.structure.headers, canonical)
                if col is None:
                    continue
                cell = self.grid.get(row, col)
                changes.append(CellChange(
                    sheet=self.region.sheet_name, row=row, column=col,
                    field_label=canonical, old_value=cell.value if cell else None,
                    new_value=value,
                ))
            if not changes:
                raise HandlerError("沒有任何可辨識的欄位可以修改。")
            step = OperationStep(description=f"修改第 {row} 列資料", region_id=self.region.region_id, changes=changes)
            return [step]

        insert_row = position["insert_row"]
        step = OperationStep(description="新增一列資料", region_id=self.region.region_id,
                              insert_row_at=insert_row)
        changes = []
        for h in self.structure.headers:
            canonical = quick_canonical_guess(h.name)
            if canonical and canonical in parsed["data"]:
                changes.append(CellChange(
                    sheet=self.region.sheet_name, row=insert_row, column=h.column,
                    field_label=h.name, new_value=parsed["data"][canonical], is_new_row=True,
                ))
        if not changes:
            raise HandlerError("沒有任何欄位可以寫入（Schema Mapping 可能不完整）。")
        step.changes = changes
        return [step]

    def execute(self, steps: list[OperationStep],
                progress_callback: Optional[ProgressCallback] = None) -> HandlerResult:
        total = sum(len(step.changes) for step in steps) or 1
        done = 0
        try:
            for step in steps:
                if step.insert_row_at:
                    self.excel.insert_row(step.insert_row_at, sheet_name=self.region.sheet_name)
                    ref_row = max(step.insert_row_at - 1, self.structure.data_start_row)
                    self.excel.copy_row_format(ref_row, step.insert_row_at, self.region.left,
                                                self.region.right, sheet_name=self.region.sheet_name)
                for change in step.changes:
                    self.excel.write_value(change.row, change.column, change.new_value,
                                            sheet_name=self.region.sheet_name)
                    done += 1
                    if progress_callback:
                        progress_callback(done, total, f"第 {change.row} 列 {change.field_label or ''}".strip())
                if step.insert_row_at:
                    self._extend_sum_formulas(step.insert_row_at)
            self.excel.calculate()  # 確保 SUM 公式欄位在寫入完成當下就反映最新值
            append_operation_log({
                "report_type": self.report_type, "region_id": self.region.region_id,
                "steps": [s.to_dict() for s in steps],
            })
            return HandlerResult(True, "已寫入 Excel。", steps=steps)
        except Exception as e:  # noqa: BLE001
            return HandlerResult(False, f"寫入失敗：{e}", steps=steps)

    def _extend_sum_formulas(self, insert_row_at: int):
        if not self.structure.total_row:
            return
        new_total_row = self.structure.total_row + 1 if self.structure.total_row >= insert_row_at \
            else self.structure.total_row
        fresh_grid = self.excel.read_sheet_grid(self.region.sheet_name)
        for c in range(self.region.left, self.region.right + 1):
            cell = fresh_grid.get(new_total_row, c)
            if not cell or not cell.is_formula:
                continue
            m = _SUM_RE.match(str(cell.formula).strip())
            if not m:
                continue
            col1, r1, col2, r2 = m.group(1), int(m.group(2)), m.group(3), int(m.group(4))
            if r2 < insert_row_at <= new_total_row - 1:
                new_formula = f"=SUM({col1}{r1}:{col2}{insert_row_at})"
                self.excel.write_formula(new_total_row, c, new_formula, sheet_name=self.region.sheet_name)

    def verify(self, steps: list[OperationStep]) -> HandlerResult:
        fresh_grid = self.excel.read_sheet_grid(self.region.sheet_name)
        problems = []
        for step in steps:
            for change in step.changes:
                cell = fresh_grid.get(change.row, change.column)
                actual = cell.value if cell else None
                if change.new_value is not None and str(actual) != str(change.new_value):
                    problems.append(f"第 {change.row} 列 {change.field_label} 預期 {change.new_value}，實際 {actual}")
        if problems:
            return HandlerResult(False, "驗證發現落差。", steps=steps, verify_ok=False,
                                  verify_details="\n".join(problems))
        return HandlerResult(True, "驗證通過。", steps=steps, verify_ok=True,
                              verify_details="所有欄位皆與預期相符。")


class GenericReadOnlyHandler(ReportHandler):
    """尚未完整實作寫入邏輯的報表類型：只支援檢視 / AI 分析，不寫入 Excel。"""

    def parse(self, plan: OperationPlan) -> dict:
        return {"action": plan.action, "data": dict(plan.data), "explanation": plan.explanation}

    def validate(self, parsed: dict):
        if parsed["action"] != "analyze":
            raise HandlerError(
                f"『{self.report_type}』這類報表目前僅支援檢視與 AI 分析，尚未支援自動寫入 "
                f"（action={parsed['action']}）。如需寫入，請先手動確認結構後再擴充對應 Handler。"
            )

    def find_insert_position(self, parsed: dict) -> dict:
        return {"mode": "analyze"}

    def build_operation_plan(self, parsed: dict, position: dict,
                              all_regions: Optional[list[Region]] = None) -> list[OperationStep]:
        return []

    def execute(self, steps: list[OperationStep],
                progress_callback: Optional[ProgressCallback] = None) -> HandlerResult:
        return HandlerResult(True, "此報表類型目前為唯讀模式，沒有任何 Excel 內容被修改。", steps=[])

    def verify(self, steps: list[OperationStep]) -> HandlerResult:
        return HandlerResult(True, "唯讀模式，無需驗證。", steps=[], verify_ok=True)
