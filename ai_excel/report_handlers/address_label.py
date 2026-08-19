# -*- coding: utf-8 -*-
"""report_handlers/address_label.py -- 地址標籤（第一版：唯讀 / AI 分析）。"""

from report_handlers.generic import GenericReadOnlyHandler
import settings as S


class AddressLabelHandler(GenericReadOnlyHandler):
    report_type = S.REPORT_ADDRESS_LABEL
