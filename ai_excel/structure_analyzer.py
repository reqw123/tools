# -*- coding: utf-8 -*-
"""
structure_analyzer.py
=======================
針對一個已由 region_detector 找到的『table』Region，做更精細的結構分析：

  - 實際欄位名稱 (headers) 與所在欄
  - 資料起訖列
  - 總計列
  - 哪些欄是公式欄，公式樣式（pattern）是什麼
  - 是否有鄰近的「參考價格表」Region
  - 區塊內合併儲存格
  - 空白儲存格是否代表『沿用上一筆』（只有日期 / 客戶名稱等白名單欄位才會，
    不可一律 forward fill —— 需求 #7 #6）
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from excel_manager import SheetGrid
from region_detector import Region
from value_normalizer import normalize_header_text, looks_like_date
from settings import CANONICAL_FIELD_ALIASES

# 空白繼承白名單：只有這些 canonical 欄位允許 forward fill
BLANK_INHERIT_WHITELIST = {"date", "customer_name"}

_CELL_REF_RE = re.compile(r"\$?([A-Z]{1,3})\$?(\d+)")


@dataclass
class HeaderInfo:
    name: str
    column: int
    canonical: Optional[str] = None  # 由 schema_mapper 填入，這裡先留空


@dataclass
class FormulaPattern:
    column: int
    sample_row: int
    sample_formula: str
    template: str  # 例如 "={C}{row}*{D}{row}"，row 會在寫入時被實際列號取代
    ref_columns: list = field(default_factory=list)  # 參照到的欄（同列）


@dataclass
class StructureInfo:
    region: Region
    headers: list[HeaderInfo]
    header_row: int
    data_start_row: int
    data_end_row: int
    total_row: Optional[int]
    formula_patterns: dict  # column -> FormulaPattern
    blank_inheritance: dict  # column -> canonical field name (若允許繼承)
    merged_cells: list
    reference_region_id: Optional[str] = None

    def header_by_canonical_hint(self, name_contains: str) -> Optional[HeaderInfo]:
        for h in self.headers:
            if name_contains in h.name:
                return h
        return None

    def column_of(self, header_name: str) -> Optional[int]:
        for h in self.headers:
            if h.name == header_name:
                return h.column
        return None


def analyze_region(region: Region, grid: SheetGrid,
                    all_regions: Optional[list[Region]] = None) -> StructureInfo:
    if region.kind != "table" or region.header_row is None:
        raise ValueError(f"Region {region.region_id} 不是可分析的 table 區塊。")

    header_row = region.header_row
    headers = _extract_headers(region, grid, header_row)

    total_row = None
    for r, role in region.row_roles.items():
        if role == "total":
            total_row = r

    data_start = header_row + 1
    data_end = (total_row - 1) if total_row else region.bottom
    if data_end < data_start:
        data_end = data_start - 1  # 空表

    formula_patterns = _detect_formula_patterns(region, grid, headers, data_start, data_end)
    blank_inheritance = _detect_blank_inheritance(headers)
    merged = [
        (r1, c1, r2, c2)
        for (r1, c1, r2, c2) in grid.merged_ranges
        if r1 >= region.top and r2 <= region.bottom and c1 >= region.left and c2 <= region.right
    ]

    ref_region_id = None
    if all_regions:
        ref_region_id = _find_reference_region(region, all_regions)

    return StructureInfo(
        region=region, headers=headers, header_row=header_row,
        data_start_row=data_start, data_end_row=data_end, total_row=total_row,
        formula_patterns=formula_patterns, blank_inheritance=blank_inheritance,
        merged_cells=merged, reference_region_id=ref_region_id,
    )


def _extract_headers(region: Region, grid: SheetGrid, header_row: int) -> list[HeaderInfo]:
    headers = []
    for c in range(region.left, region.right + 1):
        cell = grid.get(header_row, c)
        if cell is None or cell.is_empty:
            continue
        headers.append(HeaderInfo(name=str(cell.value).strip(), column=c))
    return headers


def _col_letter(col: int) -> str:
    letters = ""
    while col > 0:
        col, rem = divmod(col - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _detect_formula_patterns(region: Region, grid: SheetGrid, headers: list[HeaderInfo],
                              data_start: int, data_end: int) -> dict:
    patterns = {}
    for h in headers:
        col = h.column
        for r in range(data_start, data_end + 1):
            cell = grid.get(r, col)
            if cell and cell.is_formula:
                template, ref_cols = _build_same_row_template(cell.formula, r)
                if template:
                    patterns[col] = FormulaPattern(
                        column=col, sample_row=r, sample_formula=cell.formula,
                        template=template, ref_columns=ref_cols,
                    )
                break
    return patterns


def _build_same_row_template(formula: str, row: int):
    """把公式中『同一列』的儲存格參照換成 {COL}{row} 樣板。

    例如 row=4 的 "=C4*D4" -> template "={C}{row}*{D}{row}"，ref_columns=["C","D"]
    若公式引用了其他列（例如彙總公式），回傳 (None, [])，
    交由報表 Handler 自行以動態掃描方式重建（詳見 CustomerStatementHandler）。
    """
    ref_cols = []
    other_row_ref = False

    def _sub(m):
        nonlocal other_row_ref
        col_letters, row_digits = m.group(1), int(m.group(2))
        if row_digits != row:
            other_row_ref = True
            return m.group(0)
        ref_cols.append(col_letters)
        return "{" + col_letters + "}{row}"

    template = _CELL_REF_RE.sub(_sub, formula)
    if other_row_ref:
        return None, []
    return template, ref_cols


def _detect_blank_inheritance(headers: list[HeaderInfo]) -> dict:
    result = {}
    for h in headers:
        canonical = _quick_canonical_guess(h.name)
        if canonical in BLANK_INHERIT_WHITELIST:
            result[h.column] = canonical
    return result


def quick_canonical_guess(header_name: str) -> Optional[str]:
    norm = normalize_header_text(header_name)
    for canonical, aliases in CANONICAL_FIELD_ALIASES.items():
        for alias in aliases:
            if normalize_header_text(alias) == norm:
                return canonical
    return None


# 向後相容別名
_quick_canonical_guess = quick_canonical_guess


def find_column(headers: list[HeaderInfo], canonical: str) -> Optional[int]:
    """依 canonical 欄位名稱找出對應的實際欄號。"""
    for h in headers:
        if quick_canonical_guess(h.name) == canonical:
            return h.column
    return None


def _find_reference_region(region: Region, all_regions: list[Region]) -> Optional[str]:
    candidates = [
        r for r in all_regions
        if r.kind == "reference_table" and r.sheet_name == region.sheet_name
    ]
    if not candidates:
        return None

    def distance(r: Region) -> float:
        # 優先挑選在同一列範圍附近、且在右側的參考表
        vertical_overlap = not (r.bottom < region.top or r.top > region.bottom)
        horizontal_gap = max(0, r.left - region.right)
        vertical_gap = 0 if vertical_overlap else min(abs(r.top - region.bottom), abs(region.top - r.bottom))
        score = horizontal_gap + vertical_gap * 2
        if not vertical_overlap:
            score += 50
        return score

    best = min(candidates, key=distance)
    return best.region_id


def extract_reference_table_prices(region: Region, grid: SheetGrid) -> dict:
    """把一個 reference_table Region 讀成 {品名: 單價} 字典。"""
    prices = {}
    col_kind = {}
    for c in range(region.left, region.right + 1):
        text_n, num_n, total_n = 0, 0, 0
        for r in range(region.top, region.bottom + 1):
            cell = grid.get(r, c)
            if cell is None or cell.is_empty:
                continue
            total_n += 1
            if isinstance(cell.value, (int, float)):
                num_n += 1
            else:
                text_n += 1
        if total_n == 0:
            continue
        col_kind[c] = "numeric" if num_n / total_n >= 0.6 else "text"

    cols_sorted = sorted(col_kind)
    for i in range(len(cols_sorted) - 1):
        c1, c2 = cols_sorted[i], cols_sorted[i + 1]
        if c2 - c1 == 1 and col_kind[c1] == "text" and col_kind[c2] == "numeric":
            for r in range(region.top, region.bottom + 1):
                name_cell = grid.get(r, c1)
                price_cell = grid.get(r, c2)
                if name_cell and price_cell and not name_cell.is_empty and not price_cell.is_empty:
                    name = str(name_cell.value).strip()
                    if isinstance(price_cell.value, (int, float)):
                        prices[name] = price_cell.value
            break

    return prices
