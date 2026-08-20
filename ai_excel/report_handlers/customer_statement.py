# -*- coding: utf-8 -*-
"""
report_handlers/customer_statement.py
========================================
客戶對帳表（第一階段完整實作 —— 需求 #44 #45 #46）。

實際觀察到的真實版型（來自多家公司樣本檔）大致如下：

    A1: 客戶名稱     C1: <客戶名稱，可能拆成多格>
    A2: 對帳日期     B2: 115.6.26~7.24
    A3: 貨單日期  B3: 貨單名稱  C3: 數量  D3: 單價  E3: 退貨 元  F3: 合計  G3: 總計金額
    A4: 115.6.26  B4: 紅盤     C4: 7   D4: 660          F4: =C4*D4
                  B5: 手工麵線  C5: 25  D5: 410          F5: =C5*D5
                  B6: 機器麵線  C6: 63  D6: 250          F6: =C6*D6   G6: =F4+F5+F6
    A7: 115.7.1   B7: 機器麵線  C7: 10  D7: 250          F7: =C7*D7   G7: =F7
    ...
    F21: 總共8張                                          G21: =G6+G7+G9+...(每組小計)

觀察重點：
  - 日期欄空白 = 沿用同一組的日期（同一張貨單/同一天可能有多個品項）。
  - 每組（同一天）的最後一列才有『總計金額』欄的公式，加總該組所有『合計』。
  - 表格最下方有『總共 N 張』文字 + 加總所有分組小計的總計公式。
  - 右側常有一個獨立的『參考價格表』(reference_table Region)。
  - 不同公司欄位順序可能不同（例如有的用『合計/包』+『金額』而不是
    『數量』+『單價』直接相乘），因此『合計』公式一律用
    structure_analyzer 從既有公式『現學現用』的樣式（template），
    不要寫死 quantity*unit_price。
"""

from __future__ import annotations

import calendar
import difflib
import re
from typing import Optional

from excel_manager import ExcelManager, SheetGrid
from region_detector import Region
from structure_analyzer import (
    StructureInfo, find_column, extract_reference_table_prices, analyze_region,
)
from value_normalizer import normalize_date, format_date_like, looks_like_date
from operation_planner import OperationPlan
from report_handlers.base import (
    ReportHandler, HandlerError, MultipleCandidatesError, HandlerResult,
    CellChange, OperationStep, append_operation_log, ProgressCallback,
)
import settings as S


def _values_equal(a, b) -> bool:
    """比較 Excel 現有值跟圖片辨識出來的值是不是『同一個數字』，
    容忍 int/float/字串型別不一致（例如 250 vs 250.0 vs "250"）。"""
    if a is None and b is None:
        return True
    try:
        return float(a) == float(b)
    except (TypeError, ValueError):
        return str(a).strip() == str(b).strip()


# ======================================================================
# 客戶名稱 / Region 對應（同一 Sheet 可能有多個客戶對帳表 Region —— 需求 #46）
# ======================================================================


def extract_region_customer_name(region: Region, grid: SheetGrid, header_row: int) -> str:
    """從 title 列讀出這個 Region 屬於哪一位客戶。"""
    tokens = []
    for r in range(region.top, header_row):
        for c in range(region.left, region.right + 1):
            cell = grid.get(r, c)
            if cell is None or cell.is_empty or not isinstance(cell.value, str):
                continue
            text = cell.value.strip()
            if text in ("客戶名稱", "客戶", "對帳日期", "貨單日期"):
                continue
            if "~" in text or "對帳" in text:
                continue
            tokens.append(text)
    name = "".join(t.replace(" ", "") for t in tokens)
    return name


def list_known_dates(structure: StructureInfo, grid: SheetGrid) -> list[str]:
    """列出這個 Region 已出現過的貨單日期（依出現順序去重），
    供「半人工輸入」下拉選單使用。找不到日期欄就回傳空 list。"""
    date_col = find_column(structure.headers, "date")
    if date_col is None:
        return []
    seen, out = set(), []
    for r in range(structure.data_start_row, structure.data_end_row + 1):
        cell = grid.get(r, date_col)
        if cell and not cell.is_empty:
            text = str(cell.value).strip()
            if text not in seen:
                seen.add(text)
                out.append(text)
    return out


def list_known_items(structure: StructureInfo, grid: SheetGrid) -> list[str]:
    """列出這個 Region 已出現過的品項名稱（依出現次數由多到少去重），
    供「半人工輸入」下拉選單使用。找不到品項欄就回傳空 list。"""
    item_col = find_column(structure.headers, "item")
    if item_col is None:
        return []
    counts: dict[str, int] = {}
    order: list[str] = []
    for r in range(structure.data_start_row, structure.data_end_row + 1):
        cell = grid.get(r, item_col)
        if cell and not cell.is_empty:
            text = str(cell.value).strip()
            if text not in counts:
                order.append(text)
            counts[text] = counts.get(text, 0) + 1
    return sorted(order, key=lambda t: -counts[t])


def resolve_customer_region(candidates: list[tuple[Region, SheetGrid, StructureInfo]],
                             customer_name: str):
    """在多個 customer_statement Region 中，找出符合 customer_name 的那一個。

    candidates: [(region, grid, structure), ...]
    回傳 (region, grid, structure)；找不到或有歧義時丟 HandlerError。
    """
    if not customer_name:
        if len(candidates) == 1:
            return candidates[0]
        raise HandlerError("這張 Sheet 有多個客戶對帳表，請明確指出客戶名稱。")

    target = customer_name.replace(" ", "")
    exact = []
    fuzzy_scored = []
    for region, grid, structure in candidates:
        name = extract_region_customer_name(region, grid, structure.header_row)
        if name == target:
            exact.append((region, grid, structure))
            continue
        ratio = difflib.SequenceMatcher(None, name, target).ratio()
        if target in name or name in target:
            ratio = max(ratio, 0.9)
        fuzzy_scored.append((ratio, region, grid, structure, name))

    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        names = [extract_region_customer_name(r, g, s.header_row) for r, g, s in exact]
        raise MultipleCandidatesError(
            [{"customer": n} for n in names],
            f"找到多個名稱完全相同的客戶對帳表：{names}，請提供更多資訊（例如 Sheet 名稱）。",
        )

    fuzzy_scored.sort(key=lambda x: x[0], reverse=True)
    if fuzzy_scored and fuzzy_scored[0][0] >= 0.6:
        if len(fuzzy_scored) >= 2 and fuzzy_scored[1][0] >= fuzzy_scored[0][0] - 0.05:
            names = [f[4] for f in fuzzy_scored[:3]]
            raise MultipleCandidatesError(
                [{"customer": n} for n in names],
                f"客戶名稱『{customer_name}』無法唯一比對，可能是：{names}，請提供更明確的名稱。",
            )
        ratio, region, grid, structure, name = fuzzy_scored[0]
        return region, grid, structure

    raise HandlerError(f"找不到符合客戶『{customer_name}』的對帳表。")


# ======================================================================
# Handler 本體
# ======================================================================


class CustomerStatementHandler(ReportHandler):
    report_type = S.REPORT_CUSTOMER_STATEMENT

    def __init__(self, excel: ExcelManager, grid: SheetGrid, region: Region,
                 structure: StructureInfo):
        super().__init__(excel, grid, region, structure)
        self.date_col = find_column(structure.headers, "date")
        self.item_col = find_column(structure.headers, "item")
        self.qty_col = find_column(structure.headers, "quantity")
        self.price_col = find_column(structure.headers, "unit_price")
        self.return_col = find_column(structure.headers, "return_quantity")
        # 「合計」這個詞有些公司同時用在『輸入用的份數欄』與『真正的金額公式欄』
        # (例如：合計 包 vs 金額)，兩者都可能被別名表命中，因此優先挑選『真的有
        # 公式』的那一欄，而不是單純取第一個比對到的欄位。
        self.subtotal_col = self._find_column_prefer_formula("subtotal", structure)
        self.total_col = find_column(structure.headers, "total")

        missing = [name for name, col in [
            ("日期", self.date_col), ("貨品名稱", self.item_col),
            ("數量", self.qty_col), ("單價", self.price_col),
            ("合計", self.subtotal_col),
        ] if col is None]
        if missing:
            raise HandlerError(f"客戶對帳表缺少必要欄位：{'、'.join(missing)}，無法自動處理。")

    def _find_column_prefer_formula(self, canonical: str, structure: StructureInfo) -> Optional[int]:
        from structure_analyzer import quick_canonical_guess
        matches = [h.column for h in structure.headers if quick_canonical_guess(h.name) == canonical]
        if not matches:
            return None
        with_formula = [c for c in matches if c in structure.formula_patterns]
        return with_formula[0] if with_formula else matches[0]

    # ------------------------------------------------------------
    # parse / validate
    # ------------------------------------------------------------

    # update 類動作可以修改的欄位（canonical key -> 這張表實際的欄號 attribute）
    _UPDATABLE_FIELDS = ("quantity", "unit_price", "return_quantity", "item")

    # 這些欄位『看起來』是資料，但其實是公式自動算出來的（合計＝數量×單價、
    # 總計金額＝該組合計加總），故意不放進 _UPDATABLE_FIELDS，讓使用者改
    # 數量/單價之後這裡自動跟著變，而不是被手動寫入的固定數字卡住。
    _READONLY_COMPUTED_FIELDS = {
        "subtotal": "合計（＝數量×單價，公式自動算出來的）",
        "total": "總計金額（＝這組所有『合計』加總，公式自動算出來的）",
    }

    def parse(self, plan: OperationPlan) -> dict:
        where = dict(plan.where) if plan.where else {}
        data = dict(plan.data) if plan.data else {}

        # date/item 是用來『定位』既有資料的那一筆：新格式（update_field）放在
        # where，舊格式／規則式解析（update_quantity、update_return、
        # append_order）沿用原本習慣放在 data，兩邊都要相容。
        date = where.get("date") or data.get("date")
        item = where.get("item") or data.get("item")

        parsed = {
            "action": plan.action,
            "customer": plan.customer,
            "date": date,
            "item": item,
        }

        if plan.action == "append_order":
            parsed["quantity"] = data.get("quantity")
        elif plan.action == "update_quantity":
            parsed["changes"] = {"quantity": data.get("quantity")}
        elif plan.action == "update_return":
            parsed["changes"] = {"return_quantity": data.get("return_quantity")}
        elif plan.action == "update_field":
            parsed["changes"] = {k: data[k] for k in self._UPDATABLE_FIELDS if k in data}
            parsed["readonly_requested"] = [k for k in self._READONLY_COMPUTED_FIELDS if k in data]
        elif plan.action == "rename_item":
            parsed["old_item"] = data.get("old_item")
            parsed["new_item"] = data.get("new_item")
            # 批次改名的範圍限定（可省略 = 整張表）：date_from/date_to 或 month。
            parsed["date_from"] = where.get("date_from")
            parsed["date_to"] = where.get("date_to")
            parsed["month"] = where.get("month")
        elif plan.action == "reconcile_from_image":
            parsed["image_rows"] = data.get("entries") or []
        elif plan.action == "import_from_image":
            parsed["entries"] = data.get("entries") or []

        return parsed

    def validate(self, parsed: dict):
        action = parsed.get("action")
        if action not in ("append_order", "update_quantity", "update_return",
                           "update_field", "rename_item", "reconcile_from_image",
                           "import_from_image"):
            raise HandlerError(f"客戶對帳表不支援這個操作：{action}")

        if action == "reconcile_from_image":
            if not parsed.get("image_rows"):
                raise HandlerError(
                    "圖片裡沒有辨識出任何可比對的資料列（至少要看得出日期跟品項），"
                    "請確認圖片夠清楚，或改用文字指令描述要修改的內容。"
                )
            return

        if action == "import_from_image":
            if not parsed.get("date"):
                raise HandlerError("看不出估價單上的日期，無法匯入。")
            if not parsed.get("entries"):
                raise HandlerError(
                    "估價單裡沒有辨識出任何可用的品項（至少要看得出品名跟數量），"
                    "請確認圖片夠清楚，或改用文字指令描述要新增的內容。"
                )
            return

        if action == "rename_item":
            old_item = parsed.get("old_item")
            new_item = parsed.get("new_item")
            if not old_item or not str(old_item).strip():
                raise HandlerError("缺少要被改名的原品項名稱。")
            if not new_item or not str(new_item).strip():
                raise HandlerError("缺少要改成的新品項名稱。")
            if str(old_item).strip() == str(new_item).strip():
                raise HandlerError("新舊品項名稱相同，不需要修改。")
            return

        # 優先攔下『想改公式欄位』這種情況，給明確、可行動的錯誤訊息，
        # 而不是讓它悄悄被濾掉、之後被籠統的『缺少日期/貨品名稱』蓋過去。
        readonly_requested = parsed.get("readonly_requested") or []
        if readonly_requested:
            labels = "、".join(f"『{self._READONLY_COMPUTED_FIELDS[k]}』" for k in readonly_requested)
            raise HandlerError(
                f"{labels}不能直接指定新數字，因為它是公式自動算出來的。"
                f"如果要讓這個數字變成別的值，請改這組資料裡實際的數量或單價，"
                f"總計會自動跟著重新計算。"
            )

        if not parsed.get("date"):
            raise HandlerError("缺少日期，無法定位資料。")
        if not parsed.get("item"):
            raise HandlerError("缺少貨品名稱，無法定位資料。")

        if action == "append_order":
            qty = parsed.get("quantity")
            if not isinstance(qty, int) or qty <= 0:
                raise HandlerError("新增訂單需要提供正整數數量。")
            return

        changes = parsed.get("changes") or {}
        if not changes:
            raise HandlerError("沒有提供任何要修改的欄位內容。")

        if "quantity" in changes:
            qty = changes["quantity"]
            if not isinstance(qty, int) or qty <= 0:
                raise HandlerError("修改數量需要提供正整數數量。")
        if "return_quantity" in changes:
            rq = changes["return_quantity"]
            if not isinstance(rq, int) or rq < 0:
                raise HandlerError("修改退貨需要提供合理的退貨數量。")
            if self.return_col is None:
                raise HandlerError("這張對帳表沒有『退貨』欄位，無法修改退貨數量。")
        if "unit_price" in changes:
            up = changes["unit_price"]
            if not isinstance(up, (int, float)) or isinstance(up, bool) or up < 0:
                raise HandlerError("修改單價需要提供合理的數字。")
        if "item" in changes:
            new_item = changes["item"]
            if not isinstance(new_item, str) or not new_item.strip():
                raise HandlerError("修改品項名稱需要提供有效的新名稱。")

    # ------------------------------------------------------------
    # 日期分組
    # ------------------------------------------------------------

    def _date_groups(self, grid: Optional[SheetGrid] = None) -> list[dict]:
        grid = grid or self.grid
        groups = []
        cur = None
        for r in range(self.structure.data_start_row, self.structure.data_end_row + 1):
            date_cell = grid.get(r, self.date_col)
            item_cell = grid.get(r, self.item_col)
            has_item = item_cell is not None and not item_cell.is_empty
            if date_cell is not None and not date_cell.is_empty:
                if cur is not None:
                    groups.append(cur)
                cur = {"date_text": str(date_cell.value), "start_row": r, "end_row": r, "rows": [r] if has_item else []}
            elif cur is not None:
                cur["end_row"] = r
                if has_item:
                    cur["rows"].append(r)
        if cur is not None:
            groups.append(cur)
        return groups

    def sample_date_text(self) -> str:
        for r in range(self.structure.data_start_row, self.structure.data_end_row + 1):
            cell = self.grid.get(r, self.date_col)
            if cell and not cell.is_empty:
                return str(cell.value)
        return ""

    # ------------------------------------------------------------
    # find_insert_position
    # ------------------------------------------------------------

    def _infer_year_hint(self) -> Optional[int]:
        """使用者常常只講『月/日』（例如 7/24）沒講年份，這裡從這個對帳表既有
        的日期（例如 115.6.26）反推目前是民國幾年 / 西元幾年，這樣才補得出
        完整日期，而不是讓『7/24』因為缺年份、對不上任何一組資料而失敗。"""
        sample = self.sample_date_text()
        iso = normalize_date(sample)
        if isinstance(iso, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", iso):
            return int(iso[:4])
        return None

    def _normalize_user_date(self, date_text) -> Optional[str]:
        return normalize_date(date_text, year_hint=self._infer_year_hint())

    def find_insert_position(self, parsed: dict) -> dict:
        action = parsed["action"]

        if action == "rename_item":
            return self._find_rename_positions(parsed)

        if action == "reconcile_from_image":
            return self._find_reconcile_matches(parsed)

        target_date_norm = self._normalize_user_date(parsed["date"])
        sheet_style_date = format_date_like(target_date_norm, self.sample_date_text()) \
            if target_date_norm else parsed["date"]

        groups = self._date_groups()

        if action in ("update_quantity", "update_return", "update_field"):
            return self._find_update_position(parsed, groups, sheet_style_date)

        # append_order --------------------------------------------------
        matched_group = self._match_group_by_date(groups, target_date_norm, sheet_style_date)

        if matched_group is not None:
            return {
                "mode": "append_to_group",
                "insert_row": matched_group["end_row"],
                "group_start_row": matched_group["start_row"],
                "sheet_style_date": sheet_style_date,
            }

        # 全新的一組日期 -> 插在總計列之前（沒有總計列就插在資料區最後一列之後）
        insert_row = self.structure.total_row or (self.structure.data_end_row + 1)
        return {
            "mode": "new_group",
            "insert_row": insert_row,
            "sheet_style_date": sheet_style_date,
        }

    def _match_group_by_date(self, groups, target_date_norm, sheet_style_date) -> Optional[dict]:
        for g in groups:
            g_norm = normalize_date(g["date_text"])
            if target_date_norm and g_norm == target_date_norm:
                return g
            if str(g["date_text"]).strip() == str(sheet_style_date).strip():
                return g
        return None

    def _find_update_position(self, parsed: dict, groups: list[dict], sheet_style_date: str) -> dict:
        target_date_norm = self._normalize_user_date(parsed["date"])
        item_target = parsed["item"].strip()

        candidates = []
        for g in groups:
            g_norm = normalize_date(g["date_text"])
            if target_date_norm and g_norm != target_date_norm and str(g["date_text"]).strip() != sheet_style_date.strip():
                continue
            for r in g["rows"]:
                item_cell = self.grid.get(r, self.item_col)
                if item_cell and not item_cell.is_empty:
                    item_text = str(item_cell.value).strip()
                    if item_text == item_target or item_target in item_text or item_text in item_target:
                        candidates.append({"row": r, "date": g["date_text"], "item": item_text})

        if not candidates:
            raise HandlerError(
                f"找不到 {parsed['date']} 的『{parsed['item']}』資料，請確認日期與品項名稱。"
            )
        if len(candidates) > 1:
            raise MultipleCandidatesError(
                candidates,
                f"找到 {len(candidates)} 筆符合『{parsed['date']} {parsed['item']}』的資料，"
                f"為避免誤改，請提供更明確條件（例如：正確的日期）。",
            )

        return {"mode": "update", "row": candidates[0]["row"]}

    def _find_rename_positions(self, parsed: dict) -> dict:
        """批次改名：掃描資料列，找出品項名稱『完全等於』old_item 的所有列，
        可用 date_from/date_to 或 month 限定範圍（都不給就是整張表）。

        故意用精確比對（不像 _find_update_position 那樣容許子字串模糊比對），
        避免「麵線」這種詞同時命中「手工麵線」「機器麵線」導致誤改。
        """
        old_item = str(parsed["old_item"]).strip()
        date_from_norm, date_to_norm = self._resolve_rename_scope(parsed)

        rows = []
        for g in self._date_groups():
            if date_from_norm or date_to_norm:
                g_norm = self._normalize_user_date(g["date_text"])
                if not (isinstance(g_norm, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", g_norm)):
                    continue  # 看不懂這組的日期，範圍限定時保守跳過，不猜
                if date_from_norm and g_norm < date_from_norm:
                    continue
                if date_to_norm and g_norm > date_to_norm:
                    continue
            for r in g["rows"]:
                item_cell = self.grid.get(r, self.item_col)
                if item_cell and not item_cell.is_empty and str(item_cell.value).strip() == old_item:
                    rows.append(r)

        if not rows:
            raise HandlerError(
                f"{self._describe_rename_scope(parsed, date_from_norm, date_to_norm)}"
                f"找不到品項『{old_item}』，無法改名。"
            )

        return {"mode": "rename", "rows": rows}

    def _resolve_rename_scope(self, parsed: dict) -> tuple[Optional[str], Optional[str]]:
        """把 parsed 裡的 month 或 date_from/date_to 轉成可直接比較的 ISO 日期
        區間（含頭尾）；看不懂或缺年度資訊時直接報錯，不猜測範圍。"""
        month = parsed.get("month")
        date_from, date_to = parsed.get("date_from"), parsed.get("date_to")

        if month:
            try:
                month = int(month)
            except (TypeError, ValueError):
                raise HandlerError(f"月份格式錯誤：{month!r}")
            if not (1 <= month <= 12):
                raise HandlerError(f"月份必須介於 1~12，收到：{month}")
            year = self._infer_year_hint()
            if year is None:
                raise HandlerError("無法判斷這張表的年度，請改用完整日期範圍指定（例如 7/1~7/31）。")
            last_day = calendar.monthrange(year, month)[1]
            return f"{year:04d}-{month:02d}-01", f"{year:04d}-{month:02d}-{last_day:02d}"

        if not date_from and not date_to:
            return None, None

        date_from_norm = self._normalize_user_date(date_from) if date_from else None
        date_to_norm = self._normalize_user_date(date_to) if date_to else None

        if date_from and not (isinstance(date_from_norm, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", date_from_norm)):
            raise HandlerError(f"看不懂的起始日期：{date_from}")
        if date_to and not (isinstance(date_to_norm, str) and re.match(r"^\d{4}-\d{2}-\d{2}$", date_to_norm)):
            raise HandlerError(f"看不懂的結束日期：{date_to}")

        return date_from_norm, date_to_norm

    def _describe_rename_scope(self, parsed: dict, date_from_norm: Optional[str],
                                date_to_norm: Optional[str]) -> str:
        if parsed.get("month"):
            return f"{parsed['month']} 月內"
        if date_from_norm and date_to_norm:
            return f"{parsed.get('date_from')}~{parsed.get('date_to')} 範圍內"
        if date_from_norm:
            return f"{parsed.get('date_from')} 之後"
        if date_to_norm:
            return f"{parsed.get('date_to')} 之前"
        return "這張對帳表裡"

    # ------------------------------------------------------------
    # 對帳（從圖片辨識出來的整批列 vs. Excel 既有資料）
    # ------------------------------------------------------------

    def _find_reconcile_matches(self, parsed: dict) -> dict:
        """把圖片辨識出來的每一列，用『日期＋品項』去對應到 Excel 既有的列。

        用精確比對（不模糊），日期正規化之後分組；如果同一天、同一個品項
        名稱在圖片跟 Excel 裡都不只一筆（少見但可能發生），依各自出現的
        先後順序一對一配對——這只是決定『拿哪一列來比對』，實際會不會產生
        變更、變更的內容是什麼，使用者在套用前都看得到，配對錯了也只是
        顯示錯的差異，不會沒經過確認就寫入。
        """
        excel_index: dict[tuple, list[int]] = {}
        for g in self._date_groups():
            d_norm = self._normalize_user_date(g["date_text"]) or str(g["date_text"]).strip()
            for r in g["rows"]:
                item_cell = self.grid.get(r, self.item_col)
                if not item_cell or item_cell.is_empty:
                    continue
                key = (d_norm, str(item_cell.value).strip())
                excel_index.setdefault(key, []).append(r)

        image_index: dict[tuple, list[dict]] = {}
        key_order: list[tuple] = []
        for row in parsed["image_rows"]:
            d_norm = self._normalize_user_date(row.get("date")) or str(row.get("date") or "").strip()
            item = str(row.get("item") or "").strip()
            if not d_norm or not item:
                continue
            key = (d_norm, item)
            if key not in image_index:
                key_order.append(key)
            image_index.setdefault(key, []).append(row)

        matches: list[tuple[int, dict]] = []
        unmatched_image: list[dict] = []
        for key in key_order:
            excel_rows = excel_index.get(key, [])
            img_rows = image_index[key]
            if not excel_rows:
                unmatched_image.extend(img_rows)
                continue
            for excel_row, img_row in zip(excel_rows, img_rows):
                matches.append((excel_row, img_row))
            if len(img_rows) > len(excel_rows):
                unmatched_image.extend(img_rows[len(excel_rows):])

        if not matches:
            raise HandlerError(
                "圖片裡的資料在這張對帳表裡完全比對不到任何一列（日期＋品項都對不上），"
                "請確認是不是同一位客戶／同一段期間的對帳表。"
            )

        return {"mode": "reconcile", "matches": matches, "unmatched_image": unmatched_image}

    # ------------------------------------------------------------
    # 單價查詢
    # ------------------------------------------------------------

    def lookup_unit_price(self, item_name: str, all_regions: Optional[list[Region]] = None):
        price, _source = self.lookup_unit_price_with_source(item_name, all_regions)
        return price

    def lookup_unit_price_with_source(self, item_name: str, all_regions: Optional[list[Region]] = None):
        """跟 lookup_unit_price 一樣查單價，但額外回傳『這個數字是怎麼來的』
        說明文字，給④半人工輸入分頁顯示，讓使用者一眼判斷自動帶出的單價
        可不可信，不用自己盯著一個數字猜。"""
        # 1) 參考價格表
        if self.structure.reference_region_id and all_regions:
            ref_region = next((r for r in all_regions if r.region_id == self.structure.reference_region_id), None)
            if ref_region:
                prices = extract_reference_table_prices(ref_region, self.grid)
                if item_name in prices:
                    return prices[item_name], "依參考價格表"
                close = difflib.get_close_matches(item_name, list(prices.keys()), n=1, cutoff=0.6)
                if close:
                    return prices[close[0]], f"依參考價格表（近似『{close[0]}』）"

        # 2) 表格內同品項最近一次使用的單價（由後往前找）
        for r in range(self.structure.data_end_row, self.structure.data_start_row - 1, -1):
            item_cell = self.grid.get(r, self.item_col)
            if item_cell and not item_cell.is_empty and str(item_cell.value).strip() == item_name:
                price_cell = self.grid.get(r, self.price_col)
                if price_cell and isinstance(price_cell.value, (int, float)):
                    date_label = self._row_date_label(r)
                    return price_cell.value, f"依這張表 {date_label} 的歷史單價"

        return None, "查無資料，請手動輸入"

    # ------------------------------------------------------------
    # build_operation_plan
    # ------------------------------------------------------------

    def build_operation_plan(self, parsed: dict, position: dict,
                              all_regions: Optional[list[Region]] = None) -> list[OperationStep]:
        action = parsed["action"]

        if action in ("update_quantity", "update_return", "update_field"):
            return self._plan_update_fields(position["row"], parsed["changes"])

        if action == "rename_item":
            return self._plan_rename(position["rows"], parsed["old_item"], parsed["new_item"], parsed)

        if action == "reconcile_from_image":
            return self._plan_reconcile(position["matches"], position["unmatched_image"])

        if action == "import_from_image":
            return self._plan_import(parsed, position, all_regions)

        # append_order
        item = parsed["item"]
        qty = parsed["quantity"]
        unit_price = self.lookup_unit_price(item, all_regions)
        if unit_price is None:
            raise HandlerError(
                f"找不到『{item}』的單價（參考價格表與歷史資料都沒有），"
                f"請先在 Excel 補上這個品項的單價資訊。"
            )

        description = f"在 {parsed.get('customer') or ''} {position.get('sheet_style_date','')} 新增 {item} {qty} 件"
        return [self._build_append_step(
            item, qty, unit_price, position["insert_row"],
            is_new_group=(position["mode"] == "new_group"),
            sheet_style_date=position.get("sheet_style_date"), description=description,
        )]

    def _build_append_step(self, item: str, qty: int, unit_price, insert_row: int,
                            is_new_group: bool, sheet_style_date: Optional[str],
                            description: str, return_quantity: int = 0) -> OperationStep:
        """建立『在 insert_row 插入一列新資料』的單一 OperationStep，
        append_order（單筆新增）跟 import_from_image（估價單匯入多筆）共用。
        """
        step = OperationStep(description=description, region_id=self.region.region_id,
                              insert_row_at=insert_row)

        changes = [
            CellChange(sheet=self.region.sheet_name, row=insert_row, column=self.item_col,
                       field_label="貨品名稱", old_value=None, new_value=item, is_new_row=True),
            CellChange(sheet=self.region.sheet_name, row=insert_row, column=self.qty_col,
                       field_label="數量", old_value=None, new_value=qty, is_new_row=True),
            CellChange(sheet=self.region.sheet_name, row=insert_row, column=self.price_col,
                       field_label="單價", old_value=None, new_value=unit_price, is_new_row=True),
        ]

        if is_new_group:
            changes.append(CellChange(
                sheet=self.region.sheet_name, row=insert_row, column=self.date_col,
                field_label="日期", old_value=None, new_value=sheet_style_date, is_new_row=True,
            ))

        if self.return_col:
            changes.append(CellChange(
                sheet=self.region.sheet_name, row=insert_row, column=self.return_col,
                field_label="退貨", old_value=None, new_value=return_quantity, is_new_row=True,
            ))

        subtotal_formula = self._build_subtotal_formula(insert_row)
        changes.append(CellChange(
            sheet=self.region.sheet_name, row=insert_row, column=self.subtotal_col,
            field_label="合計", old_value=None, new_formula=subtotal_formula, is_new_row=True,
        ))

        step.changes = changes
        return step

    def _plan_import(self, parsed: dict, position: dict,
                      all_regions: Optional[list[Region]] = None) -> list[OperationStep]:
        """估價單匯入：同一天好幾個品項，依序插入同一組。第一筆用
        find_insert_position 算出來的 mode（新的一天要順便寫日期，
        既有那天就不用）；第二筆以後一定是接在第一筆後面（append_to_group），
        insert_row 每筆 +1（Excel 原生 Insert 會把下面全部往下推一列，
        所以下一筆理所當然的插入點就是上一筆插入的那個位置 +1）。
        """
        insert_row = position["insert_row"]
        is_new_group = position["mode"] == "new_group"
        sheet_style_date = position.get("sheet_style_date")
        customer = parsed.get("customer") or ""

        steps = []
        skipped = []
        for idx, entry in enumerate(parsed["entries"]):
            item = entry.get("item")
            qty = entry.get("quantity")
            if not item or not isinstance(qty, int) or qty <= 0:
                skipped.append(entry)
                continue
            unit_price = entry.get("unit_price")
            if unit_price is None:
                unit_price = self.lookup_unit_price(item, all_regions)
            if unit_price is None:
                skipped.append(entry)
                continue
            return_quantity = entry.get("return_quantity") or 0

            row = insert_row + len(steps)
            description = f"在 {customer} {sheet_style_date} 新增 {item} {qty} 件（估價單匯入 第 {idx + 1} 筆）"
            steps.append(self._build_append_step(
                item, qty, unit_price, row,
                is_new_group=(is_new_group and not steps),  # 只有這組第一筆新插的列才寫日期
                sheet_style_date=sheet_style_date, description=description,
                return_quantity=return_quantity,
            ))

        if not steps:
            raise HandlerError("估價單裡沒有任何一筆資料同時具備品項、正整數數量、且能查到單價，無法匯入。")

        if skipped:
            names = "、".join(str(e.get("item") or "(無品名)") for e in skipped[:5])
            more = "…" if len(skipped) > 5 else ""
            steps[-1].description += (
                f"\n⚠ 另外估價單裡有 {len(skipped)} 筆資料缺少品項/數量，或查不到單價，未匯入：{names}{more}"
            )

        return steps

    def _plan_update_fields(self, row: int, changes: dict) -> list[OperationStep]:
        """一次修改同一列裡任意數量的欄位（數量/單價/退貨/品項名稱皆可）。

        『合計』欄本身是公式（例如 =C{row}*D{row}），數量或單價一旦寫入新值，
        Excel 開啟時會自動重算，不需要在這裡額外處理。
        """
        field_col_label = {
            "quantity": (self.qty_col, "數量"),
            "unit_price": (self.price_col, "單價"),
            "return_quantity": (self.return_col, "退貨"),
            "item": (self.item_col, "貨品名稱"),
        }

        cell_changes = []
        descriptions = []
        for key, new_value in changes.items():
            col, label = field_col_label.get(key, (None, None))
            if col is None:
                raise HandlerError(f"這張對帳表沒有對應『{key}』的欄位，無法修改。")
            cell = self.grid.get(row, col)
            old_value = cell.value if cell else None
            old_formula = cell.formula if cell else None
            cell_changes.append(CellChange(
                sheet=self.region.sheet_name, row=row, column=col, field_label=label,
                old_value=old_value, new_value=new_value, old_formula=old_formula,
            ))
            descriptions.append(f"{label}：{old_value} -> {new_value}")

        if not cell_changes:
            raise HandlerError("沒有任何可辨識的欄位可以修改。")

        step = OperationStep(
            description=f"修改第 {row} 列的" + "、".join(descriptions),
            region_id=self.region.region_id,
            changes=cell_changes,
        )
        return [step]

    def _plan_rename(self, rows: list[int], old_item: str, new_item: str,
                      parsed: Optional[dict] = None) -> list[OperationStep]:
        """批次把多列的品項名稱從 old_item 改成 new_item（只改文字，不影響
        數量/單價/合計公式，因此不需要重建任何彙總公式）。"""
        changes = []
        for r in rows:
            cell = self.grid.get(r, self.item_col)
            old_value = cell.value if cell else None
            changes.append(CellChange(
                sheet=self.region.sheet_name, row=r, column=self.item_col,
                field_label="貨品名稱", old_value=old_value, new_value=new_item,
            ))

        scope = ""
        if parsed and parsed.get("month"):
            scope = f"（限 {parsed['month']} 月）"
        elif parsed and (parsed.get("date_from") or parsed.get("date_to")):
            scope = f"（限 {parsed.get('date_from') or ''}~{parsed.get('date_to') or ''}）"

        step = OperationStep(
            description=f"批次改名{scope}：把 {len(rows)} 筆『{old_item}』改成『{new_item}』",
            region_id=self.region.region_id,
            changes=changes,
        )
        return [step]

    def _plan_reconcile(self, matches: list[tuple[int, dict]],
                         unmatched_image: list[dict]) -> list[OperationStep]:
        """圖片對帳：只針對『數值真的跟 Excel 不一樣』的欄位產生變更，
        數字本來就一致的列完全不動、也不會出現在計畫裡。"""
        field_col_label = {
            "quantity": (self.qty_col, "數量"),
            "unit_price": (self.price_col, "單價"),
            "return_quantity": (self.return_col, "退貨"),
        }

        steps = []
        for row, img_row in matches:
            cell_changes = []
            descriptions = []
            for key, (col, label) in field_col_label.items():
                if col is None or key not in img_row:
                    continue
                new_value = img_row[key]
                cell = self.grid.get(row, col)
                old_value = cell.value if cell else None
                if _values_equal(old_value, new_value):
                    continue
                cell_changes.append(CellChange(
                    sheet=self.region.sheet_name, row=row, column=col, field_label=label,
                    old_value=old_value, new_value=new_value,
                    old_formula=cell.formula if cell else None,
                ))
                descriptions.append(f"{label}：{old_value} -> {new_value}")

            if not cell_changes:
                continue

            date_label = self._row_date_label(row)
            item_cell = self.grid.get(row, self.item_col)
            item_label = item_cell.value if item_cell else ""
            steps.append(OperationStep(
                description=f"對帳修正 {date_label} {item_label}（第 {row} 列）：" + "、".join(descriptions),
                region_id=self.region.region_id,
                changes=cell_changes,
            ))

        if not steps:
            note = f"（另外圖片裡有 {len(unmatched_image)} 筆資料在表裡找不到對應的列，未處理）" \
                if unmatched_image else ""
            raise HandlerError(f"比對完成，Excel 跟圖片內容一致，沒有需要修正的地方。{note}")

        if unmatched_image:
            sample = "、".join(f"{r.get('date')} {r.get('item')}" for r in unmatched_image[:5])
            more = "…" if len(unmatched_image) > 5 else ""
            steps[0].description += (
                f"\n⚠ 另外圖片裡有 {len(unmatched_image)} 筆資料，在這張表裡找不到對應的列，"
                f"未處理：{sample}{more}"
            )

        return steps

    def _row_date_label(self, row: int) -> str:
        """往上找最近的一個非空白日期（同組後續列的日期是繼承來的）。"""
        for r in range(row, self.structure.data_start_row - 1, -1):
            cell = self.grid.get(r, self.date_col)
            if cell and not cell.is_empty:
                return str(cell.value)
        return ""

    def _build_subtotal_formula(self, row: int) -> str:
        pattern = self.structure.formula_patterns.get(self.subtotal_col)
        if pattern:
            return pattern.template.format(
                **{c: c for c in pattern.ref_columns}, row=row
            )
        # 沒有既有公式可以參考 -> 用最常見的『數量 * 單價』
        qty_letter = self._col_letter(self.qty_col)
        price_letter = self._col_letter(self.price_col)
        return f"={qty_letter}{row}*{price_letter}{row}"

    # ------------------------------------------------------------
    # execute
    # ------------------------------------------------------------

    def execute(self, steps: list[OperationStep],
                progress_callback: Optional[ProgressCallback] = None) -> HandlerResult:
        total = sum(len(step.changes) for step in steps) or 1
        done = 0

        def _report(label: str):
            nonlocal done
            done += 1
            if progress_callback:
                progress_callback(done, total, label)

        try:
            for step in steps:
                if step.insert_row_at:
                    self.excel.insert_row(step.insert_row_at, sheet_name=self.region.sheet_name)
                    # 從上一列複製格式到新插入的列
                    ref_row = max(step.insert_row_at - 1, self.structure.data_start_row)
                    self.excel.copy_row_format(
                        ref_row, step.insert_row_at, self.region.left, self.region.right,
                        sheet_name=self.region.sheet_name,
                    )

                for change in step.changes:
                    if change.new_formula is not None:
                        self.excel.write_formula(change.row, change.column, change.new_formula,
                                                  sheet_name=self.region.sheet_name)
                    else:
                        self.excel.write_value(change.row, change.column, change.new_value,
                                                sheet_name=self.region.sheet_name)
                    _report(f"第 {change.row} 列 {change.field_label or ''}".strip())

                if step.insert_row_at:
                    self._fix_group_and_grand_total(step.insert_row_at)

            # 『合計』『總計金額』都是公式欄位，不是我們直接寫入的——但如果使用者
            # 的 Excel 是手動重算模式，寫完數量/單價後這些公式不會馬上反映新值。
            # 強制重算一次，確保寫入完成當下，公式欄位看到的就是最新結果。
            self.excel.calculate()

            append_operation_log({
                "report_type": self.report_type,
                "region_id": self.region.region_id,
                "steps": [s.to_dict() for s in steps],
            })

            return HandlerResult(True, "已寫入 Excel。", steps=steps)
        except Exception as e:  # noqa: BLE001 - 需求 #50
            return HandlerResult(False, f"寫入失敗：{e}", steps=steps)

    def _fix_group_and_grand_total(self, insert_row_at: int):
        """插入列之後，重建『該分組的小計』與（必要時）『總表總計』公式。

        採用『重新掃描目前 Excel 實際狀態』的方式重建，而不是對舊公式字串做
        文字手術，確保正確性不依賴 Excel COM 是否有自動調整參照。
        """
        # 重新計算資料區間（因為插入列，原本的 total_row 若在插入點之後會+1）
        old_total_row = self.structure.total_row
        new_total_row = (old_total_row + 1) if (old_total_row and old_total_row >= insert_row_at) else old_total_row
        new_data_end = (new_total_row - 1) if new_total_row else (self.structure.data_end_row + 1)

        # 把這次的位移結果存回 self.structure，讓『同一次 execute() 裡』
        # 接下來還要再插入的其他列（例如估價單一次匯入好幾筆）看到的是
        # 插入『之後』的正確位置，而不是每次都拿最初那份過期的位置去算。
        self.structure.total_row = new_total_row
        self.structure.data_end_row = new_data_end

        fresh_grid = self.excel.read_sheet_grid(self.region.sheet_name)
        groups = self._scan_row_groups(fresh_grid, new_data_end)

        target_group = None
        for g in groups:
            if g["start"] <= insert_row_at <= g["end"]:
                target_group = g
                break
        if target_group is None:
            for g in groups:
                if insert_row_at in g["rows"] or insert_row_at == g["end"]:
                    target_group = g
                    break

        if target_group is not None:
            self._rebuild_group_subtotal(fresh_grid, target_group)
        self._rebuild_grand_total(groups)

    # ------------------------------------------------------------
    # 分組小計／總表總計 重建（新增、刪除兩條路徑共用）
    # ------------------------------------------------------------

    def _scan_row_groups(self, grid: SheetGrid, data_end_row: int) -> list[dict]:
        """由 data_start_row 掃到 data_end_row，依『日期欄是否空白』切分組，
        回傳 [{"start","end","rows":[有品項的列號,...]}, ...]。"""
        groups = []
        cur = None
        for r in range(self.structure.data_start_row, data_end_row + 1):
            date_cell = grid.get(r, self.date_col)
            item_cell = grid.get(r, self.item_col)
            has_item = item_cell is not None and not item_cell.is_empty
            if date_cell is not None and not date_cell.is_empty:
                if cur is not None:
                    groups.append(cur)
                cur = {"start": r, "end": r, "rows": [r] if has_item else []}
            elif cur is not None:
                cur["end"] = r
                if has_item:
                    cur["rows"].append(r)
        if cur is not None:
            groups.append(cur)
        return groups

    def _rebuild_group_subtotal(self, grid: SheetGrid, group: dict):
        """重寫一組的『總計金額』公式（＝這組所有『合計』加總，落在該組最後
        一列），並清掉這組裡其他列殘留的舊公式（例如本來只有一列、現在多了
        新列，總計金額落點跟著換到新的最後一列）。"""
        if not group["rows"]:
            return
        subtotal_letter = self._col_letter(self.subtotal_col)
        formula = "=" + "+".join(f"{subtotal_letter}{r}" for r in group["rows"])
        group_total_row = group["rows"][-1]
        self.excel.write_formula(group_total_row, self.total_col, formula,
                                  sheet_name=self.region.sheet_name)
        for r in group["rows"][:-1]:
            cell = grid.get(r, self.total_col)
            if cell and cell.is_formula and r != group_total_row:
                self.excel.clear_cell_content_only(r, self.total_col, sheet_name=self.region.sheet_name)

    def _rebuild_grand_total(self, groups: list[dict]):
        """重寫總表總計公式（＝每一組『總計金額』加總）。一律重寫、不做
        『已經正確就跳過』的判斷——重寫一次成本很低，正確性優先（尤其是
        刪除情境下，舊公式很可能引用到剛被刪掉的列，不能只靠字串比對
        判斷『看起來還對』）。"""
        if not self.structure.total_row:
            return
        group_rows_with_value = [g["rows"][-1] for g in groups if g["rows"]]
        if not group_rows_with_value:
            return
        total_letter = self._col_letter(self.total_col)
        new_formula = "=" + "+".join(f"{total_letter}{r}" for r in group_rows_with_value)
        self.excel.write_formula(self.structure.total_row, self.total_col, new_formula,
                                  sheet_name=self.region.sheet_name)

    # ------------------------------------------------------------
    # verify
    # ------------------------------------------------------------

    def verify(self, steps: list[OperationStep]) -> HandlerResult:
        fresh_grid = self.excel.read_sheet_grid(self.region.sheet_name)
        problems = []

        for step in steps:
            for change in step.changes:
                row = change.row
                if step.insert_row_at:
                    pass  # row 已經是插入後的實際列號
                cell = fresh_grid.get(row, change.column)
                actual_value = cell.value if cell else None
                actual_formula = cell.formula if cell else None

                if change.new_formula is not None:
                    if not actual_formula or not str(actual_formula).lstrip("=") == str(change.new_formula).lstrip("="):
                        problems.append(
                            f"第 {row} 列 {change.field_label or change.column} 公式與預期不符："
                            f"預期 {change.new_formula}，實際 {actual_formula}"
                        )
                else:
                    if actual_value != change.new_value and str(actual_value) != str(change.new_value):
                        problems.append(
                            f"第 {row} 列 {change.field_label or change.column} 內容與預期不符："
                            f"預期 {change.new_value}，實際 {actual_value}"
                        )

        if problems:
            return HandlerResult(False, "驗證發現落差，請人工檢查。", steps=steps,
                                  verify_ok=False, verify_details="\n".join(problems))
        return HandlerResult(True, "驗證通過，資料已正確寫入。", steps=steps,
                              verify_ok=True, verify_details="所有欄位皆與預期相符。")

    # ------------------------------------------------------------
    # 整張表預覽 / 刪除（④半人工輸入分頁專用，人工直接觸發，不經過
    # OperationPlan／AI 那條管線，settings.ALLOWED_ACTIONS 沒有、也不會有
    # 對應的刪除 action）
    # ------------------------------------------------------------

    @staticmethod
    def _cell_value(grid: SheetGrid, row: int, col: Optional[int]):
        if col is None:
            return None
        cell = grid.get(row, col)
        return cell.value if (cell and not cell.is_empty) else None

    def list_rows_for_preview(self) -> list[dict]:
        """列出這張對帳表目前所有『有品項』的資料列（跳過間隔列/總計列），
        給④半人工輸入分頁的『整張表預覽』顯示用。日期欄回傳推算後的值
        （同一組後面幾列不會是空白），合計/總計金額回傳公式的計算後數值。"""
        rows = []
        for r in range(self.structure.data_start_row, self.structure.data_end_row + 1):
            item_cell = self.grid.get(r, self.item_col)
            if not item_cell or item_cell.is_empty:
                continue
            rows.append({
                "row": r,
                "date": self._row_date_label(r),
                "item": str(item_cell.value).strip(),
                "quantity": self._cell_value(self.grid, r, self.qty_col),
                "unit_price": self._cell_value(self.grid, r, self.price_col),
                "return_quantity": self._cell_value(self.grid, r, self.return_col),
                "subtotal": self._cell_value(self.grid, r, self.subtotal_col),
                "total": self._cell_value(self.grid, r, self.total_col),
            })
        return rows

    def _repromote_date_if_needed(self, row: int, date_text):
        """如果剛被刪掉的那一列原本是它那一組的日期列（第一列），且刪完
        這組還有剩其他資料列，日期要『補』回新的第一列（現在跟被刪掉的
        列同一個列號，因為下面的列已經往上遞補），否則這組後面幾列會
        因為空白日期繼承斷掉而變成孤兒資料。"""
        fresh_grid = self.excel.read_sheet_grid(self.region.sheet_name)
        item_cell = fresh_grid.get(row, self.item_col)
        if not item_cell or item_cell.is_empty:
            return  # 這組被整組刪光了，沒有東西可以補
        new_date_cell = fresh_grid.get(row, self.date_col)
        if new_date_cell and not new_date_cell.is_empty:
            return  # 這一列本來就有自己的日期（是下一組的開頭），不用動
        self.excel.write_value(row, self.date_col, date_text, sheet_name=self.region.sheet_name)

    def _rebuild_all_group_and_grand_totals(self):
        """整張表重新掃描，重寫每一組的小計公式跟總表總計公式（不是只修
        被刪的那一組）。刪除比新增更容易讓 Excel 原生的公式參照調整出
        問題（例如被刪的列剛好是某組總計金額公式的落點），所以刪除後選擇
        『全部重建』，正確性優先於少寫幾次 Excel。"""
        fresh_grid = self.excel.read_sheet_grid(self.region.sheet_name)
        groups = self._scan_row_groups(fresh_grid, self.structure.data_end_row)
        for g in groups:
            self._rebuild_group_subtotal(fresh_grid, g)
        self._rebuild_grand_total(groups)

    def delete_rows(self, rows: list[int], progress_callback: Optional[ProgressCallback] = None) -> HandlerResult:
        """真的從 Excel 永久刪除這幾列資料。呼叫端（GUI）必須已經完成人工
        二次確認——這裡不再問一次，只負責『確認過了就照做』。

        多選一律由列號大到小依序刪，避免前面尚未處理的列號被已刪除的列
        打亂；每刪一列之前先記下舊值，寫進 operation_log.json 留痕
        （不是自動 undo，但至少查得到刪了什麼）。
        """
        ordered = sorted(set(rows), reverse=True)
        if not ordered:
            return HandlerResult(False, "沒有指定要刪除的資料列。")

        deleted_records = []
        done = 0
        try:
            for row in ordered:
                fresh_grid = self.excel.read_sheet_grid(self.region.sheet_name)
                deleted_records.append({
                    "row": row,
                    "date": self._row_date_label(row),
                    "item": self._cell_value(fresh_grid, row, self.item_col),
                    "quantity": self._cell_value(fresh_grid, row, self.qty_col),
                    "unit_price": self._cell_value(fresh_grid, row, self.price_col),
                    "return_quantity": self._cell_value(fresh_grid, row, self.return_col),
                })
                date_cell = fresh_grid.get(row, self.date_col)
                date_text = date_cell.value if (date_cell and not date_cell.is_empty) else None

                self.excel.delete_row(row, sheet_name=self.region.sheet_name)

                if date_text:
                    self._repromote_date_if_needed(row, date_text)

                if self.structure.total_row and self.structure.total_row > row:
                    self.structure.total_row -= 1
                self.structure.data_end_row -= 1

                done += 1
                if progress_callback:
                    progress_callback(done, len(ordered), f"刪除第 {row} 列")

            self._rebuild_all_group_and_grand_totals()
            self.excel.calculate()

            append_operation_log({
                "report_type": self.report_type,
                "region_id": self.region.region_id,
                "action": "delete_rows",
                "deleted": deleted_records,
            })

            items_desc = "、".join(str(d["item"]) for d in deleted_records)
            return HandlerResult(True, f"已刪除 {len(ordered)} 筆資料：{items_desc}")
        except Exception as e:  # noqa: BLE001 - 需求 #50
            return HandlerResult(False, f"刪除失敗：{e}")
