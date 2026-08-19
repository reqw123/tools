# -*- coding: utf-8 -*-
"""report_handlers/check_schedule.py -- 支票／月份表（第一版：唯讀 / AI 分析）。"""

from report_handlers.generic import GenericReadOnlyHandler
import settings as S


class CheckScheduleHandler(GenericReadOnlyHandler):
    report_type = S.REPORT_CHECK_SCHEDULE
