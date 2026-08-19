# -*- coding: utf-8 -*-
"""
region_detector.py
====================
掃描一張工作表的 UsedRange，自動切出『多個獨立資料區塊』(Region)，
並對每個 Region 做粗略分類（table / reference_table / notice / unknown），
同時對 table 類型的 Region 做初步的列角色標記
（title / header / data / total）。

明確不假設：
  - Header 一定在第 1 列。
  - 一個 Sheet 只包含一張表。
  - 空白 = 沒有資料（合併儲存格會被展開處理）。

演算法：
  1. 以『非空白儲存格』建立 occupancy mask。
  2. 用 4-方向 flood fill 找出連通區塊（blank row / blank col 會自然把
     不同報表分開，符合『同一 Sheet 橫向或縱向存在多張報表』的需求）。
  3. 對每個連通區塊做外接矩形 (bounding box)。
  4. 針對每個區塊，粗略判斷 kind 與（若為 table）列角色。

真正精細的欄位辨識、資料起訖列、公式樣式等交給 structure_analyzer.py。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Optional

from excel_manager import SheetGrid, CellInfo
from value_normalizer import normalize_header_text, looks_numeric, looks_like_date
from settings import CANONICAL_FIELD_ALIASES

TOTAL_KEYWORDS = ["總計", "合計金額", "總共", "總金額", "總額", "小計", "total", "grand total"]
NOTICE_KEYWORDS = [
    "公告", "漲價", "調漲", "調整", "敬啟", "啟者", "茲因", "承蒙", "感謝",
    "由衷", "敬請", "見諒", "售價", "調漲售價",
]

_FLAT_ALIASES = {
    normalize_header_text(a)
    for aliases in CANONICAL_FIELD_ALIASES.values()
    for a in aliases
}


@dataclass
class Region:
    region_id: str
    sheet_name: str
    top: int
    left: int
    bottom: int
    right: int
    kind: str = "unknown"          # table / reference_table / notice / unknown
    row_roles: dict = field(default_factory=dict)   # row -> "title"/"header"/"data"/"total"
    header_row: Optional[int] = None
    notes: list = field(default_factory=list)

    @property
    def n_rows(self) -> int:
        return self.bottom - self.top + 1

    @property
    def n_cols(self) -> int:
        return self.right - self.left + 1

    def to_dict(self) -> dict:
        return {
            "region_id": self.region_id,
            "sheet_name": self.sheet_name,
            "top": self.top, "left": self.left,
            "bottom": self.bottom, "right": self.right,
            "kind": self.kind,
            "header_row": self.header_row,
        }


# ======================================================================
# 主入口
# ======================================================================


def detect_regions(grid: SheetGrid) -> list[Region]:
    occupied = _occupied_cells(grid)
    if not occupied:
        return []

    components = _connected_components(occupied)

    regions: list[Region] = []
    for idx, comp in enumerate(components, start=1):
        rows = [r for r, c in comp]
        cols = [c for r, c in comp]
        top, bottom = min(rows), max(rows)
        left, right = min(cols), max(cols)

        # 併入與此 bounding box 相交的合併儲存格範圍，避免切斷合併儲存格
        top, left, bottom, right = _expand_for_merges(
            grid, top, left, bottom, right
        )

        region = Region(
            region_id=f"{grid.sheet_name}!R{idx}",
            sheet_name=grid.sheet_name,
            top=top, left=left, bottom=bottom, right=right,
        )

        _classify_region(region, grid)
        regions.append(region)

    # 依左上角位置排序（由上到下、由左到右），方便 UI 顯示
    regions.sort(key=lambda r: (r.top, r.left))
    for i, r in enumerate(regions, start=1):
        r.region_id = f"{grid.sheet_name}!R{i}"

    return regions


# ======================================================================
# Step 1: occupancy
# ======================================================================


def _occupied_cells(grid: SheetGrid) -> set[tuple[int, int]]:
    occ = set()
    for (r, c), cell in grid.cells.items():
        if cell.is_merged and cell.merge_anchor != (r, c):
            anchor = grid.cells.get(cell.merge_anchor)
            if anchor is not None and not anchor.is_empty:
                occ.add((r, c))
            continue
        if not cell.is_empty:
            occ.add((r, c))
    return occ


# ======================================================================
# Step 2: connected components (4-connectivity)
# ======================================================================


def _connected_components(occupied: set[tuple[int, int]]) -> list[set]:
    remaining = set(occupied)
    components = []

    while remaining:
        start = next(iter(remaining))
        stack = [start]
        comp = set()
        while stack:
            cell = stack.pop()
            if cell in comp:
                continue
            comp.add(cell)
            remaining.discard(cell)
            r, c = cell
            for nr, nc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1)):
                if (nr, nc) in remaining:
                    stack.append((nr, nc))
        components.append(comp)

    return components


def _expand_for_merges(grid: SheetGrid, top, left, bottom, right):
    for (r1, c1, r2, c2) in grid.merged_ranges:
        # 若合併範圍與目前 bounding box 相交，就把 bounding box 擴大涵蓋它
        if r1 <= bottom and r2 >= top and c1 <= right and c2 >= left:
            top = min(top, r1)
            left = min(left, c1)
            bottom = max(bottom, r2)
            right = max(right, c2)
    return top, left, bottom, right


# ======================================================================
# Step 3/4: 分類
# ======================================================================


def _classify_region(region: Region, grid: SheetGrid):
    if _looks_like_notice(region, grid):
        region.kind = "notice"
        return

    header_row, header_score = _find_header_row(region, grid)

    if header_row is not None and header_score > 0 and region.n_cols >= 3:
        region.kind = "table"
        region.header_row = header_row
        region.row_roles = _classify_rows(region, grid, header_row)
        return

    if _looks_like_reference_table(region, grid):
        region.kind = "reference_table"
        return

    region.kind = "unknown"


def _row_texts(grid: SheetGrid, row: int, left: int, right: int) -> list[str]:
    out = []
    for c in range(left, right + 1):
        cell = grid.get(row, c)
        if cell is None or cell.is_empty:
            continue
        out.append(str(cell.value).strip())
    return out


def _looks_like_notice(region: Region, grid: SheetGrid) -> bool:
    texts = []
    for r in range(region.top, region.bottom + 1):
        texts.extend(_row_texts(grid, r, region.left, region.right))
    if not texts:
        return False

    joined = "".join(texts)
    keyword_hit = any(k in joined for k in NOTICE_KEYWORDS)

    short_tokens = sum(1 for t in texts if len(t.replace(" ", "")) <= 2)
    short_ratio = short_tokens / len(texts)

    has_formula = any(
        (grid.get(r, c) and grid.get(r, c).is_formula)
        for r in range(region.top, region.bottom + 1)
        for c in range(region.left, region.right + 1)
    )

    numeric_cols = _numeric_column_ratio(region, grid)

    if has_formula or numeric_cols > 0.4:
        return False

    return keyword_hit or (short_ratio > 0.55 and region.n_cols >= 6)


def _numeric_column_ratio(region: Region, grid: SheetGrid) -> float:
    numeric_cells = 0
    total_cells = 0
    for r in range(region.top, region.bottom + 1):
        for c in range(region.left, region.right + 1):
            cell = grid.get(r, c)
            if cell is None or cell.is_empty:
                continue
            total_cells += 1
            if isinstance(cell.value, (int, float)) or looks_numeric(cell.value):
                numeric_cells += 1
    return numeric_cells / total_cells if total_cells else 0.0


def _find_header_row(region: Region, grid: SheetGrid, max_scan: int = 15):
    best_row, best_score = None, -1.0
    scan_bottom = min(region.bottom, region.top + max_scan)

    for r in range(region.top, scan_bottom + 1):
        texts = _row_texts(grid, r, region.left, region.right)
        if len(texts) < 2:
            continue

        text_count = sum(1 for t in texts if not looks_numeric(t))
        unique_count = len(set(texts))
        alias_hits = sum(
            1 for t in texts if normalize_header_text(t) in _FLAT_ALIASES
        )

        # 檢查下一列是否有『看起來像資料』的內容（數量更多、含數字/日期）
        next_row_has_data = False
        if r + 1 <= region.bottom:
            next_texts = _row_texts(grid, r + 1, region.left, region.right)
            numeric_in_next = sum(1 for t in next_texts if looks_numeric(t) or looks_like_date(t))
            next_row_has_data = numeric_in_next >= 1

        score = len(texts) * 1.5 + text_count + unique_count * 0.5 + alias_hits * 6
        if next_row_has_data:
            score += 4
        if len(texts) <= 1:
            score -= 10

        if score > best_score:
            best_score = score
            best_row = r

    return best_row, best_score


def _classify_rows(region: Region, grid: SheetGrid, header_row: int) -> dict:
    roles = {}
    for r in range(region.top, header_row):
        roles[r] = "title"
    roles[header_row] = "header"

    total_row = _find_total_row(region, grid, header_row)

    for r in range(header_row + 1, region.bottom + 1):
        if r == total_row:
            roles[r] = "total"
        else:
            roles[r] = "data"

    return roles


def _find_total_row(region: Region, grid: SheetGrid, header_row: int) -> Optional[int]:
    total_re = re.compile("|".join(re.escape(k) for k in TOTAL_KEYWORDS), re.IGNORECASE)

    candidates = []
    for r in range(header_row + 1, region.bottom + 1):
        texts = _row_texts(grid, r, region.left, region.right)
        joined = " ".join(texts)
        if total_re.search(joined):
            candidates.append(r)
            continue
        # 公式含多個 '+' 且引用非鄰近列，視為彙總列
        for c in range(region.left, region.right + 1):
            cell = grid.get(r, c)
            if cell and cell.is_formula and isinstance(cell.formula, str):
                plus_count = cell.formula.count("+")
                if plus_count >= 3:
                    candidates.append(r)
                    break

    if not candidates:
        return None
    # 通常總計列在區塊最下方
    return max(candidates)


def _looks_like_reference_table(region: Region, grid: SheetGrid) -> bool:
    if region.n_cols > 4 or region.n_rows < 2:
        return False

    # 找出「文字欄 + 數字欄」相鄰的樣式
    col_kind = {}
    for c in range(region.left, region.right + 1):
        text_n, num_n, total_n = 0, 0, 0
        for r in range(region.top, region.bottom + 1):
            cell = grid.get(r, c)
            if cell is None or cell.is_empty:
                continue
            total_n += 1
            if isinstance(cell.value, (int, float)) or looks_numeric(cell.value):
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
            return True

    return False
