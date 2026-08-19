# -*- coding: utf-8 -*-
"""report_handlers/unknown.py -- 未知格式（需求 #38 #39：不可崩潰，允許檢視/AI分析）。"""

from report_handlers.generic import GenericReadOnlyHandler
import settings as S


class UnknownReportHandler(GenericReadOnlyHandler):
    report_type = S.REPORT_UNKNOWN
