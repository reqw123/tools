# -*- coding: utf-8 -*-
"""
report_handlers/base.py
=========================
所有 Report Handler 的共同介面與共用工具。

每個 Handler 必須實作（需求 #20）：
    parse -> validate -> find_insert_position -> build_operation_plan
    -> execute -> verify

安全限制（需求 #32 #42）：
    - Handler 是『唯一』真正會呼叫 ExcelManager 寫入 Excel 的地方。
    - 絕不允許刪除資料、清空 Range、執行 VBA、修改未知公式 / 未知 Sheet。
    - 寫入前一律保留 old_value / old_formula，供 Undo 使用（需求 #35 #36）。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field, asdict
from typing import Callable, Optional

# 寫入進度回呼：execute() 每完成一格/一步就呼叫一次，(已完成數, 總數, 目前動作描述)。
# 呼叫端（GUI）可以用來更新進度條；不需要進度顯示時傳 None 即可。
ProgressCallback = Callable[[int, int, str], None]

from excel_manager import ExcelManager, SheetGrid
from region_detector import Region
from structure_analyzer import StructureInfo
from operation_planner import OperationPlan
import settings as S


class HandlerError(RuntimeError):
    """一般性、可以直接顯示給使用者看的錯誤（不會讓 GUI 崩潰）。"""


class MultipleCandidatesError(HandlerError):
    """需求 #34：Update 命中多筆資料時，禁止直接修改，要求使用者給更明確條件。"""

    def __init__(self, candidates: list[dict], message: str = ""):
        self.candidates = candidates
        msg = message or f"找到 {len(candidates)} 筆符合的資料，為避免誤改，請提供更明確的條件。"
        super().__init__(msg)


@dataclass
class CellChange:
    """單一儲存格層級的修改紀錄（需求 #35）。"""
    sheet: str
    row: int
    column: int
    field_label: str = ""
    old_value: object = None
    new_value: object = None
    old_formula: object = None
    new_formula: object = None
    is_new_row: bool = False

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class OperationStep:
    """描述一次完整操作（可能牽涉多個 CellChange，例如新增一列 + 更新彙總公式）。"""
    description: str
    region_id: str
    changes: list[CellChange] = field(default_factory=list)
    insert_row_at: Optional[int] = None  # 若此步驟需要先插入整列

    def to_dict(self) -> dict:
        return {
            "description": self.description,
            "region_id": self.region_id,
            "insert_row_at": self.insert_row_at,
            "changes": [c.to_dict() for c in self.changes],
        }


@dataclass
class HandlerResult:
    success: bool
    message: str
    steps: list[OperationStep] = field(default_factory=list)
    verify_ok: Optional[bool] = None
    verify_details: str = ""


def append_operation_log(entry: dict):
    """把操作紀錄（含 Undo 所需的 old/new 值）附加到 operation_log.json。"""
    try:
        if S.OPERATION_LOG_FILE.exists():
            data = json.loads(S.OPERATION_LOG_FILE.read_text(encoding="utf-8"))
        else:
            data = []
        entry["timestamp"] = time.strftime("%Y-%m-%d %H:%M:%S")
        data.append(entry)
        S.OPERATION_LOG_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
        )
    except Exception:
        # 記錄失敗不可影響主流程（需求 #50）
        pass


class ReportHandler:
    report_type: str = S.REPORT_UNKNOWN

    def __init__(self, excel: ExcelManager, grid: SheetGrid, region: Region,
                 structure: Optional[StructureInfo] = None):
        self.excel = excel
        self.grid = grid
        self.region = region
        self.structure = structure

    # ------------------------------------------------------------
    # 標準介面（子類別覆寫）
    # ------------------------------------------------------------

    def parse(self, plan: OperationPlan) -> dict:
        """把 OperationPlan 轉成這個 Handler 內部可用的結構。"""
        return {"action": plan.action, "customer": plan.customer, "data": dict(plan.data),
                "where": dict(plan.where)}

    def validate(self, parsed: dict):
        """檢查資料是否合理；不合理直接丟 HandlerError，訊息要清楚。"""
        raise NotImplementedError

    def find_insert_position(self, parsed: dict) -> dict:
        """決定要寫哪個 Region / 哪一列 / 哪一欄。可能丟出 MultipleCandidatesError。"""
        raise NotImplementedError

    def build_operation_plan(self, parsed: dict, position: dict) -> list[OperationStep]:
        """建立『預覽用』的操作步驟清單，尚未真正寫入 Excel。"""
        raise NotImplementedError

    def execute(self, steps: list[OperationStep],
                progress_callback: Optional[ProgressCallback] = None) -> HandlerResult:
        """真正寫入 Excel。progress_callback 選填，每寫完一格會被呼叫一次
        (done, total, label)，用來讓 GUI 顯示寫入進度。"""
        raise NotImplementedError

    def verify(self, steps: list[OperationStep]) -> HandlerResult:
        """寫入後重新讀取，確認結果與預期相符。"""
        raise NotImplementedError

    # ------------------------------------------------------------
    # 共用工具
    # ------------------------------------------------------------

    def _col_letter(self, col: int) -> str:
        letters = ""
        while col > 0:
            col, rem = divmod(col - 1, 26)
            letters = chr(65 + rem) + letters
        return letters
