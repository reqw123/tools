# -*- coding: utf-8 -*-
"""
settings.py
============
全域設定、常數、Canonical Schema 別名表。

這個檔案不含任何業務邏輯，只放：
  - 路徑設定
  - AI Provider / Model 預設值
  - Canonical 欄位別名表（規則式 mapping 的第一層）
  - 一些共用常數
"""

from __future__ import annotations

import json
from pathlib import Path

# ------------------------------------------------------------------
# 路徑
# ------------------------------------------------------------------

APP_TITLE = "AI Excel 多公司報表智慧助手"

SCRIPT_DIR = Path(__file__).resolve().parent

TEMPLATES_DIR = SCRIPT_DIR / "templates"
TEMPLATES_DIR.mkdir(exist_ok=True)

SETTINGS_FILE = SCRIPT_DIR / "user_settings.json"

OPERATION_LOG_FILE = SCRIPT_DIR / "operation_log.json"

# ------------------------------------------------------------------
# AI Provider 預設值
# ------------------------------------------------------------------

PROVIDER_OPENAI = "openai"
PROVIDER_OLLAMA = "ollama"

DEFAULT_PROVIDER = PROVIDER_OLLAMA

DEFAULT_OLLAMA_HOST = "http://localhost:11434"

# Ollama 第一版僅支援下列文字模型（不可假裝有圖片能力）
OLLAMA_MODELS = [
    "qwen2.5:3b",
    "qwen2.5:7b",
]
DEFAULT_OLLAMA_MODEL = "qwen2.5:7b"

# OpenAI 模型（文字 + 圖片皆可）。使用者可自行輸入其他型號。
OPENAI_MODELS = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
]
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"

SUPPORTED_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}

# ------------------------------------------------------------------
# 報表類型
# ------------------------------------------------------------------

REPORT_CUSTOMER_STATEMENT = "customer_statement"
REPORT_MULTI_CUSTOMER_SETTLEMENT = "multi_customer_settlement"
REPORT_EMPLOYEE_ROSTER = "employee_roster"
REPORT_ADDRESS_LABEL = "address_label"
REPORT_CHECK_SCHEDULE = "check_schedule"
REPORT_PRODUCT_PRICE = "product_price"
REPORT_PRODUCT_DATE_MATRIX = "product_date_matrix"
REPORT_NOTICE = "notice"
REPORT_UNKNOWN = "unknown"

ALL_REPORT_TYPES = [
    REPORT_CUSTOMER_STATEMENT,
    REPORT_MULTI_CUSTOMER_SETTLEMENT,
    REPORT_EMPLOYEE_ROSTER,
    REPORT_ADDRESS_LABEL,
    REPORT_CHECK_SCHEDULE,
    REPORT_PRODUCT_PRICE,
    REPORT_PRODUCT_DATE_MATRIX,
    REPORT_NOTICE,
    REPORT_UNKNOWN,
]

REPORT_TYPE_LABELS = {
    REPORT_CUSTOMER_STATEMENT: "客戶對帳表",
    REPORT_MULTI_CUSTOMER_SETTLEMENT: "多客戶結算表",
    REPORT_EMPLOYEE_ROSTER: "人員名冊",
    REPORT_ADDRESS_LABEL: "地址標籤",
    REPORT_CHECK_SCHEDULE: "支票／月份表",
    REPORT_PRODUCT_PRICE: "商品價格表",
    REPORT_PRODUCT_DATE_MATRIX: "商品日期矩陣",
    REPORT_NOTICE: "漲價／價格公告",
    REPORT_UNKNOWN: "未知格式",
}

# ------------------------------------------------------------------
# Canonical Schema 別名表
# ------------------------------------------------------------------
# key   = 系統統一欄位（canonical field）
# value = 各公司可能使用的欄位名稱（會先正規化：trim / 全形轉半形 / 移除空白)
# ------------------------------------------------------------------

CANONICAL_FIELD_ALIASES: dict[str, list[str]] = {
    "employee_id": [
        "工號", "員工編號", "員工代號", "人員編號", "職員編號", "員編",
        "employee id", "emp id", "emp no", "employee no",
    ],
    "employee_name": [
        "姓名", "員工姓名", "員工名稱", "人員姓名", "職員姓名",
        "name", "employee name",
    ],
    "department": [
        "單位", "部門", "部門名稱", "組別", "科室",
        "dept", "department",
    ],
    "job_title": [
        "職稱", "職位", "職務", "title", "position",
    ],
    "salary": [
        "月薪", "薪資", "薪水", "本薪", "應付薪資", "實領薪資",
        "salary", "wage", "pay",
    ],
    "hire_date": [
        "到職日", "到職日期", "入職日期", "報到日",
        "hire date", "start date",
    ],
    "date": [
        "日期", "貨單日期", "交易日期", "出貨日期", "消費日期", "發票日期",
        "date",
    ],
    "customer_name": [
        "客戶", "客戶名稱", "客戶名", "客戶簡稱", "客戶簡", "customer",
    ],
    "item": [
        "貨單名稱", "貨品名稱", "品項", "商品", "商品名稱", "品名",
        "item", "product",
    ],
    "quantity": [
        "數量", "件數", "qty", "quantity",
    ],
    "unit_price": [
        "單價", "價格", "unit price", "price",
    ],
    "return_quantity": [
        "退貨", "退貨數量", "退貨 元", "退回", "return",
    ],
    "subtotal": [
        "合計", "小計", "合計 包", "金額", "subtotal",
    ],
    "total": [
        "總計", "總額", "總計金額", "合計金額", "總金額",
        "total", "grand total",
    ],
    "address": [
        "地址", "收件地址", "公司地址", "住址", "address",
    ],
    "phone": [
        "電話", "聯絡電話", "手機", "tel", "phone",
    ],
    "check_number": [
        "支票號碼", "票號", "check no",
    ],
    "due_date": [
        "到期日", "支票到期日", "due date",
    ],
    "amount": [
        "金額", "票面金額", "amount",
    ],
    "month": [
        "月份", "month",
    ],
    "remark": [
        "備註", "說明", "註記", "remark", "note",
    ],
}

CANONICAL_LABELS_ZH: dict[str, str] = {
    "employee_id": "員工編號",
    "employee_name": "姓名",
    "department": "部門",
    "job_title": "職稱",
    "salary": "薪資",
    "hire_date": "到職日期",
    "date": "日期",
    "customer_name": "客戶名稱",
    "item": "貨品名稱",
    "quantity": "數量",
    "unit_price": "單價",
    "return_quantity": "退貨",
    "subtotal": "合計",
    "total": "總計",
    "address": "地址",
    "phone": "電話",
    "check_number": "支票號碼",
    "due_date": "到期日",
    "amount": "金額",
    "month": "月份",
    "remark": "備註",
}

# ------------------------------------------------------------------
# 允許 LLM 回傳的操作（白名單）── 不允許刪除 / 清空
# ------------------------------------------------------------------

ALLOWED_ACTIONS = {
    "append_order",       # 客戶對帳表：新增一筆訂單/貨品
    "update_quantity",    # 修改數量
    "update_return",      # 修改退貨數量
    "add_customer",       # 多客戶結算表：新增一列客戶
    "add_employee",       # 人員名冊新增
    "update_field",       # 通用：更新一或多個欄位（需先命中唯一列，見 update_field）
    "rename_item",        # 客戶對帳表：把某個品項名稱『全部』改成另一個名稱（會影響多筆資料）
    "reconcile_from_image",  # 客戶對帳表：讀圖片裡整張表格，跟 Excel 逐列比對後修正落差
    "import_from_image",  # 客戶對帳表：讀估價單/單據圖片，把上面的品項當成新資料匯入
    "analyze",            # 只分析、不寫入
}

# ------------------------------------------------------------------
# 使用者設定（provider / model / api key 等）的簡易存取
# ------------------------------------------------------------------


def load_user_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_user_settings(data: dict) -> None:
    try:
        SETTINGS_FILE.write_text(
            json.dumps(data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass
