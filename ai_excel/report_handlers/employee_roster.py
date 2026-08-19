# -*- coding: utf-8 -*-
"""report_handlers/employee_roster.py -- 人員名冊。"""

from report_handlers.generic import GenericAppendRowHandler
import settings as S


class EmployeeRosterHandler(GenericAppendRowHandler):
    report_type = S.REPORT_EMPLOYEE_ROSTER
    required_canonical_keys = ["employee_name"]
    match_canonical_keys = ["employee_id", "employee_name"]
