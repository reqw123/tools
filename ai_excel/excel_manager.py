# -*- coding: utf-8 -*-
"""
excel_manager.py
=================
唯一直接碰觸 Excel COM 的模組（透過 pywin32）。

設計原則：
  - 只負責『讀 / 寫 Excel』的底層操作，不含任何報表語意判斷。
  - 所有 row / col 皆為 1-based，與 Excel 原生座標一致。
  - 讀取盡量用 Range 一次性批次讀取（.Value / .Formula / .NumberFormat），
    避免逐格 COM 呼叫造成效能問題。
  - 寫入盡量限縮在需要修改的儲存格（需求 #47 #48：最小化修改範圍）。
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
from typing import Optional

import win32com.client
from win32com.client import constants as xlc

# Excel 常數（避免依賴 makepy / gen_py 是否產生過，直接寫死數值）
XL_UP = -4162
XL_TO_LEFT = -4159
XL_TO_RIGHT = -4161
XL_DOWN = -4121
XL_SHIFT_DOWN = -4121
XL_SHIFT_TO_LEFT = -4159
XL_PASTE_FORMATS = -4122
XL_PASTE_ALL = -4104
XL_INSERT_SHIFT_DOWN = -4121


def _to_2d(data, n_rows: int, n_cols: int) -> list:
    """把 COM 回傳的 Value / Formula / NumberFormat 正規化成標準 2D list。

    pywin32 對『單一儲存格』回傳純量；對『多格範圍』理論上回傳巢狀
    tuple-of-tuples。但 NumberFormat 有一個容易踩到的例外：只要整個範圍
    的數字格式『完全一致』（例如整張表都是 General），COM 會直接回傳
    『單一字串純量』，而不是陣列——即使範圍有幾百格。

    如果只把純量包成 [[data]]，後面用 [r_idx][c_idx] 去索引就會對『字串
    本身』做字元索引，一旦 r_idx/c_idx 超過字串長度就會噴出
    "string index out of range"（這正是先前版本連不到 Excel 的原因）。
    正確做法是把這個純量『廣播』到整個 n_rows x n_cols 範圍。
    """
    if not isinstance(data, tuple):
        return [[data] * n_cols for _ in range(n_rows)]
    if len(data) == 0:
        return [[None] * n_cols for _ in range(n_rows)]
    if isinstance(data[0], tuple):
        return [list(row) for row in data]
    # 扁平 tuple：依實際列數/欄數判斷要當成單列還是單欄
    if n_cols == 1 and n_rows != 1:
        return [[v] for v in data]
    return [list(data)]


@dataclass
class CellInfo:
    row: int
    col: int
    value: object
    formula: object
    number_format: str = ""
    is_merged: bool = False
    merge_anchor: Optional[tuple] = None  # (row, col) 合併儲存格左上角

    @property
    def is_formula(self) -> bool:
        return isinstance(self.formula, str) and self.formula.startswith("=")

    @property
    def is_empty(self) -> bool:
        return self.value is None or (
            isinstance(self.value, str) and self.value.strip() == ""
        )


@dataclass
class SheetGrid:
    """一次性讀取整張 UsedRange 的快取結果。"""
    sheet_name: str
    top: int
    left: int
    bottom: int
    right: int
    cells: dict = field(default_factory=dict)  # (row,col) -> CellInfo
    merged_ranges: list = field(default_factory=list)  # [(r1,c1,r2,c2), ...]

    def get(self, row: int, col: int) -> Optional[CellInfo]:
        return self.cells.get((row, col))

    def value_at(self, row: int, col: int):
        c = self.get(row, col)
        return c.value if c else None


class ExcelConnectionError(RuntimeError):
    pass


class ExcelManager:
    """連接『目前已開啟』的 Excel Application（不會另外啟動新的 Excel）。"""

    def __init__(self):
        self.excel = None
        self.workbook = None
        self._active_sheet_name: Optional[str] = None

    # ----------------------------------------------------------------
    # 連線
    # ----------------------------------------------------------------

    def connect(self):
        try:
            self.excel = win32com.client.GetActiveObject("Excel.Application")
        except Exception as e:
            raise ExcelConnectionError(
                "找不到正在執行的 Excel，請先開啟 Microsoft Excel 並開啟報表檔案。"
            ) from e

        self.workbook = self.excel.ActiveWorkbook
        if self.workbook is None:
            raise ExcelConnectionError("Excel 已開啟，但目前沒有任何活頁簿 (Workbook)。")

        if self._active_sheet_name is None:
            self._active_sheet_name = self.excel.ActiveSheet.Name

        return self

    def _sheet_obj(self, sheet_name: Optional[str] = None):
        self.connect()
        name = sheet_name or self._active_sheet_name or self.excel.ActiveSheet.Name
        try:
            return self.workbook.Sheets(name)
        except Exception as e:
            raise ExcelConnectionError(f"找不到工作表：{name}") from e

    def set_active_sheet(self, sheet_name: str):
        self._sheet_obj(sheet_name)  # 驗證存在
        self._active_sheet_name = sheet_name

    # ----------------------------------------------------------------
    # 活頁簿 / 工作表資訊
    # ----------------------------------------------------------------

    def get_workbook_info(self) -> dict:
        self.connect()
        return {
            "name": self.workbook.Name,
            "full_path": self.workbook.FullName,
            "active_sheet": self.excel.ActiveSheet.Name,
            "sheet_count": self.workbook.Sheets.Count,
        }

    def list_sheets(self) -> list[str]:
        self.connect()
        return [s.Name for s in self.workbook.Sheets]

    def get_active_sheet_name(self) -> str:
        self.connect()
        return self._active_sheet_name or self.excel.ActiveSheet.Name

    # ----------------------------------------------------------------
    # 讀取整張工作表（UsedRange）
    # ----------------------------------------------------------------

    def read_sheet_grid(self, sheet_name: Optional[str] = None) -> SheetGrid:
        sheet = self._sheet_obj(sheet_name)
        used = sheet.UsedRange

        top = used.Row
        left = used.Column
        n_rows = used.Rows.Count
        n_cols = used.Columns.Count
        bottom = top + n_rows - 1
        right = left + n_cols - 1

        values = _to_2d(used.Value, n_rows, n_cols)
        formulas = _to_2d(used.Formula, n_rows, n_cols)
        number_formats = _to_2d(used.NumberFormat, n_rows, n_cols)

        grid = SheetGrid(
            sheet_name=sheet.Name, top=top, left=left, bottom=bottom, right=right
        )

        for r_idx in range(n_rows):
            value_row = values[r_idx] if r_idx < len(values) else []
            formula_row = formulas[r_idx] if r_idx < len(formulas) else []
            format_row = number_formats[r_idx] if r_idx < len(number_formats) else []
            for c_idx in range(n_cols):
                row = top + r_idx
                col = left + c_idx
                # 邊界防護：即使 COM 回傳的形狀跟預期的 n_rows x n_cols 對不上
                # （已知會發生在某些純量廣播的情況），也不要整個崩潰，
                # 缺漏的儲存格就當作沒有內容跳過（需求 #37 #50）。
                val = value_row[c_idx] if c_idx < len(value_row) else None
                fml = formula_row[c_idx] if c_idx < len(formula_row) else None
                nf = format_row[c_idx] if c_idx < len(format_row) else ""
                if val is None and (fml is None or fml == ""):
                    continue
                grid.cells[(row, col)] = CellInfo(
                    row=row, col=col, value=val, formula=fml,
                    number_format=nf if isinstance(nf, str) else "",
                )

        merged = self._read_merged_ranges(sheet, top, left, bottom, right)
        grid.merged_ranges = merged
        for (r1, c1, r2, c2) in merged:
            anchor_val = grid.cells.get((r1, c1))
            anchor_value = anchor_val.value if anchor_val else None
            for r in range(r1, r2 + 1):
                for c in range(c1, c2 + 1):
                    existing = grid.cells.get((r, c))
                    if existing is None:
                        grid.cells[(r, c)] = CellInfo(
                            row=r, col=c, value=anchor_value if (r, c) == (r1, c1) else None,
                            formula=None, is_merged=True, merge_anchor=(r1, c1),
                        )
                    else:
                        existing.is_merged = True
                        existing.merge_anchor = (r1, c1)

        return grid

    def _read_merged_ranges(self, sheet, top, left, bottom, right) -> list:
        """掃描 UsedRange 內所有合併儲存格區域（去重）。"""
        seen = set()
        result = []
        try:
            used = sheet.Range(
                sheet.Cells(top, left), sheet.Cells(bottom, right)
            )
            # MergeCells 需逐格檢查較慢，改用 Areas 搭配 EntireColumn 掃描太貴。
            # 折衷做法：逐格檢查 MergeArea，但只在真的偵測到 MergeCells=True 時才展開。
            for r in range(top, bottom + 1):
                for c in range(left, right + 1):
                    cell = sheet.Cells(r, c)
                    try:
                        if not cell.MergeCells:
                            continue
                    except Exception:
                        continue
                    area = cell.MergeArea
                    key = (area.Row, area.Column, area.Row + area.Rows.Count - 1,
                           area.Column + area.Columns.Count - 1)
                    if key not in seen:
                        seen.add(key)
                        result.append(key)
        except Exception:
            pass
        return result

    # ----------------------------------------------------------------
    # 寫入（最小化修改）
    # ----------------------------------------------------------------

    def write_value(self, row: int, col: int, value, sheet_name: Optional[str] = None):
        sheet = self._sheet_obj(sheet_name)
        sheet.Cells(row, col).Value = value

    def write_formula(self, row: int, col: int, formula: str, sheet_name: Optional[str] = None):
        sheet = self._sheet_obj(sheet_name)
        sheet.Cells(row, col).Formula = formula

    def read_cell(self, row: int, col: int, sheet_name: Optional[str] = None) -> CellInfo:
        sheet = self._sheet_obj(sheet_name)
        cell = sheet.Cells(row, col)
        return CellInfo(
            row=row, col=col, value=cell.Value, formula=cell.Formula,
            number_format=cell.NumberFormat if isinstance(cell.NumberFormat, str) else "",
            is_merged=bool(cell.MergeCells),
        )

    def clear_cell_content_only(self, row: int, col: int, sheet_name: Optional[str] = None):
        """僅允許 Report Handler 在明確、單一目標下清除單一儲存格內容（不清格式）。"""
        sheet = self._sheet_obj(sheet_name)
        sheet.Cells(row, col).ClearContents()

    # ----------------------------------------------------------------
    # 插入整列（用來新增資料列，讓 Excel 自動調整其他公式參照）
    # ----------------------------------------------------------------

    def insert_row(self, row: int, sheet_name: Optional[str] = None):
        """在指定 row 位置插入一列（原本該列與其後都會被往下推一列）。

        使用 Excel 原生 Insert，Excel 會自動調整全表所有相對參照的公式
        （包含跨欄的加總公式），因此我們只需要處理『新資料本身』與
        『需要重新彙總的公式』，不必手動搬動其他儲存格。
        """
        sheet = self._sheet_obj(sheet_name)
        sheet.Rows(row).Insert(Shift=XL_SHIFT_DOWN)

    def copy_row_format(self, src_row: int, dst_row: int, col_start: int, col_end: int,
                         sheet_name: Optional[str] = None):
        """把 src_row 的格式（字型/框線/數字格式/底色等）複製到 dst_row。"""
        sheet = self._sheet_obj(sheet_name)
        src = sheet.Range(sheet.Cells(src_row, col_start), sheet.Cells(src_row, col_end))
        dst = sheet.Range(sheet.Cells(dst_row, col_start), sheet.Cells(dst_row, col_end))
        src.Copy()
        dst.PasteSpecial(Paste=XL_PASTE_FORMATS)
        with contextlib.suppress(Exception):
            self.excel.CutCopyMode = False

    # ----------------------------------------------------------------
    # 儲存
    # ----------------------------------------------------------------

    def save(self):
        self.connect()
        self.workbook.Save()

    def calculate(self):
        with contextlib.suppress(Exception):
            self.excel.Calculate()
