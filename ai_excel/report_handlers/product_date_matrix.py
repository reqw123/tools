# -*- coding: utf-8 -*-
"""report_handlers/product_date_matrix.py -- 商品日期矩陣（第一版：唯讀 / AI 分析）。"""

from report_handlers.generic import GenericReadOnlyHandler
import settings as S


class ProductDateMatrixHandler(GenericReadOnlyHandler):
    report_type = S.REPORT_PRODUCT_DATE_MATRIX
