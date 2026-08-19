# -*- coding: utf-8 -*-
"""
report_handlers package
=========================
Handler 註冊表 + 工廠函式（需求 #19）。
"""

from __future__ import annotations

from excel_manager import ExcelManager, SheetGrid
from region_detector import Region
from structure_analyzer import StructureInfo
import settings as S

from report_handlers.base import ReportHandler, HandlerError, MultipleCandidatesError, HandlerResult
from report_handlers.customer_statement import CustomerStatementHandler
from report_handlers.multi_customer_settlement import MultiCustomerSettlementHandler
from report_handlers.employee_roster import EmployeeRosterHandler
from report_handlers.address_label import AddressLabelHandler
from report_handlers.check_schedule import CheckScheduleHandler
from report_handlers.product_price import ProductPriceHandler
from report_handlers.product_date_matrix import ProductDateMatrixHandler
from report_handlers.notice import NoticeHandler
from report_handlers.unknown import UnknownReportHandler

HANDLER_REGISTRY = {
    S.REPORT_CUSTOMER_STATEMENT: CustomerStatementHandler,
    S.REPORT_MULTI_CUSTOMER_SETTLEMENT: MultiCustomerSettlementHandler,
    S.REPORT_EMPLOYEE_ROSTER: EmployeeRosterHandler,
    S.REPORT_ADDRESS_LABEL: AddressLabelHandler,
    S.REPORT_CHECK_SCHEDULE: CheckScheduleHandler,
    S.REPORT_PRODUCT_PRICE: ProductPriceHandler,
    S.REPORT_PRODUCT_DATE_MATRIX: ProductDateMatrixHandler,
    S.REPORT_NOTICE: NoticeHandler,
    S.REPORT_UNKNOWN: UnknownReportHandler,
}


def get_handler(report_type: str, excel: ExcelManager, grid: SheetGrid,
                 region: Region, structure: StructureInfo | None) -> ReportHandler:
    cls = HANDLER_REGISTRY.get(report_type, UnknownReportHandler)
    try:
        return cls(excel, grid, region, structure)
    except HandlerError:
        raise
    except Exception as e:  # noqa: BLE001 - 需求 #37：不可因單一未知格式崩潰
        raise HandlerError(f"初始化 {report_type} 處理器失敗：{e}") from e
