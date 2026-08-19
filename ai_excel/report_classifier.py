# -*- coding: utf-8 -*-
"""
report_classifier.py
======================
根據 Region 的 kind、Header 內容與少量樣本資料，判斷報表類型。

第一階段規則式判斷（deterministic），足夠明確才回傳高信心結果；
規則無法判斷時回傳 REPORT_UNKNOWN，交由 UI 顯示原始結構、
使用者可再要求 AI 分析（但不會自動猜測寫死）。
"""

from __future__ import annotations

from dataclasses import dataclass

from excel_manager import SheetGrid
from region_detector import Region
from structure_analyzer import StructureInfo, analyze_region
from value_normalizer import normalize_header_text, looks_like_date
import settings as S


@dataclass
class ClassificationResult:
    report_type: str
    confidence: float
    matched_keywords: list


def _norm_set(headers) -> set:
    return {normalize_header_text(h.name) for h in headers}


def classify_region(region: Region, grid: SheetGrid) -> ClassificationResult:
    if region.kind == "notice":
        return ClassificationResult(S.REPORT_NOTICE, 0.85, ["notice_block"])

    if region.kind == "reference_table":
        return ClassificationResult(S.REPORT_PRODUCT_PRICE, 0.6, ["reference_table"])

    if region.kind != "table" or region.header_row is None:
        return ClassificationResult(S.REPORT_UNKNOWN, 0.0, [])

    structure = analyze_region(region, grid)
    return classify_structure(structure, grid)


def classify_structure(structure: StructureInfo, grid: SheetGrid) -> ClassificationResult:
    header_norms = _norm_set(structure.headers)
    header_text = " ".join(h.name for h in structure.headers)
    hits = []

    def has_any(*keywords) -> bool:
        found = [k for k in keywords if any(k in h for h in header_norms) or k in header_text]
        hits.extend(found)
        return bool(found)

    has_date = has_any("日期")
    has_item = has_any("貨單名稱", "貨品名稱", "品名", "商品", "品項")
    has_qty = has_any("數量")
    has_price = has_any("單價", "價格")
    has_return = has_any("退貨")
    has_subtotal = has_any("合計", "小計", "金額")
    has_total = has_any("總計", "總額", "總金額")
    has_customer_col = has_any("客戶")
    has_emp_id = has_any("工號", "員工編號", "職員編號")
    has_emp_name = has_any("姓名")
    has_dept = has_any("單位", "部門")
    has_salary = has_any("薪資", "月薪")
    has_address = has_any("地址")
    has_phone = has_any("電話")
    has_check = has_any("支票", "票號")
    has_due = has_any("到期日")
    has_month = has_any("月份")

    # -------------------------------------------------
    # 商品日期矩陣：Header 列本身塞滿「看起來像日期」的值
    # -------------------------------------------------
    date_like_headers = sum(1 for h in structure.headers if looks_like_date(h.name))
    if date_like_headers >= 3 and has_item:
        return ClassificationResult(S.REPORT_PRODUCT_DATE_MATRIX, 0.75, ["date_matrix_header"])

    # -------------------------------------------------
    # 客戶對帳表：日期 + 品項 + 數量 + 單價 + 合計 + 總計，且區塊上方
    # 通常有『客戶名稱』標題（非欄位，而是 title 列的 label:value）
    # -------------------------------------------------
    title_has_customer_label = _title_mentions(structure, grid, ["客戶名稱", "客戶", "對帳"])
    if has_date and has_item and has_qty and has_price and (has_subtotal or has_total):
        conf = 0.65
        if title_has_customer_label:
            conf += 0.2
        if has_return:
            conf += 0.05
        if has_total:
            conf += 0.05
        return ClassificationResult(S.REPORT_CUSTOMER_STATEMENT, min(conf, 0.98), hits)

    # -------------------------------------------------
    # 多客戶結算表：客戶欄位在資料列中重複出現多個不同客戶名稱
    # （對帳表的客戶名稱是標題，不是欄位；這裡客戶是「欄」）
    # -------------------------------------------------
    if has_customer_col and (has_subtotal or has_total or has_price):
        distinct_customers = _count_distinct_in_column(structure, grid, "客戶")
        if distinct_customers >= 2:
            return ClassificationResult(S.REPORT_MULTI_CUSTOMER_SETTLEMENT, 0.75, hits)

    # -------------------------------------------------
    # 人員名冊
    # -------------------------------------------------
    if (has_emp_id or has_emp_name) and (has_dept or has_salary):
        return ClassificationResult(S.REPORT_EMPLOYEE_ROSTER, 0.8, hits)

    # -------------------------------------------------
    # 地址標籤
    # -------------------------------------------------
    if has_address and (has_emp_name or has_phone) and not (has_qty and has_price):
        return ClassificationResult(S.REPORT_ADDRESS_LABEL, 0.7, hits)

    # -------------------------------------------------
    # 支票／月份表
    # -------------------------------------------------
    if has_check or (has_month and has_due):
        return ClassificationResult(S.REPORT_CHECK_SCHEDULE, 0.7, hits)

    # -------------------------------------------------
    # 商品價格表（一般表格版，非 reference_table 小區塊）
    # -------------------------------------------------
    if has_item and has_price and not has_qty and not has_date:
        return ClassificationResult(S.REPORT_PRODUCT_PRICE, 0.6, hits)

    return ClassificationResult(S.REPORT_UNKNOWN, 0.0, hits)


def _title_mentions(structure: StructureInfo, grid: SheetGrid, keywords: list[str]) -> bool:
    region = structure.region
    for r in range(region.top, structure.header_row):
        for c in range(region.left, region.right + 1):
            cell = grid.get(r, c)
            if cell and not cell.is_empty and isinstance(cell.value, str):
                if any(k in cell.value for k in keywords):
                    return True
    return False


def _count_distinct_in_column(structure: StructureInfo, grid: SheetGrid, header_contains: str) -> int:
    col = None
    for h in structure.headers:
        if header_contains in h.name:
            col = h.column
            break
    if col is None:
        return 0
    values = set()
    for r in range(structure.data_start_row, structure.data_end_row + 1):
        cell = grid.get(r, col)
        if cell and not cell.is_empty:
            values.add(str(cell.value).strip())
    return len(values)
