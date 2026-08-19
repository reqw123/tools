# -*- coding: utf-8 -*-
"""report_handlers/product_price.py -- 商品價格表（第一版：唯讀 / AI 分析）。

注意：客戶對帳表所使用的『參考價格表』是由
structure_analyzer.extract_reference_table_prices() 直接讀取，
不經過這個 Handler；這個 Handler 是給『獨立成一張報表』的商品價格表使用。
"""

from report_handlers.generic import GenericReadOnlyHandler
import settings as S


class ProductPriceHandler(GenericReadOnlyHandler):
    report_type = S.REPORT_PRODUCT_PRICE
