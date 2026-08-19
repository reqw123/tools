# -*- coding: utf-8 -*-
"""report_handlers/multi_customer_settlement.py -- 多客戶結算表。"""

from report_handlers.generic import GenericAppendRowHandler
import settings as S


class MultiCustomerSettlementHandler(GenericAppendRowHandler):
    report_type = S.REPORT_MULTI_CUSTOMER_SETTLEMENT
    required_canonical_keys = ["customer_name"]
    match_canonical_keys = ["customer_name"]
