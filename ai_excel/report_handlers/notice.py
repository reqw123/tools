# -*- coding: utf-8 -*-
"""report_handlers/notice.py -- 漲價／價格公告（唯讀 / AI 分析）。"""

from report_handlers.generic import GenericReadOnlyHandler
import settings as S


class NoticeHandler(GenericReadOnlyHandler):
    report_type = S.REPORT_NOTICE
