import os
import re
import json
import base64
import mimetypes
import queue
import threading
import tkinter as tk

from datetime import datetime
from pathlib import Path
from tkinter import ttk, messagebox, filedialog
from tkinter.scrolledtext import ScrolledText

import pythoncom
import win32com.client

from openai import OpenAI
import ollama


# ============================================================
# 基本設定
# ============================================================

APP_TITLE = "AI Excel 多公司報表智慧助手"

SCRIPT_DIR = Path(__file__).resolve().parent

TEMPLATE_FILE = SCRIPT_DIR / "company_templates.json"

DEFAULT_PROVIDER = "Ollama"

DEFAULT_OLLAMA_MODEL = "qwen2.5:7b"
DEFAULT_OPENAI_MODEL = "gpt-5"

DEFAULT_OLLAMA_HOST = "http://localhost:11434"

MAX_HEADER_SCAN_ROWS = 20
SAMPLE_DATA_ROWS = 8

XL_UP = -4162
XL_TO_LEFT = -4159


# ============================================================
# UI 配色
# ============================================================

FONT_FAMILY = "Microsoft JhengHei"

COLOR_BG = "#eef2f6"
COLOR_PANEL = "#ffffff"

COLOR_HEADER_BG = "#2c3e50"
COLOR_HEADER_FG = "#ffffff"
COLOR_HEADER_SUB = "#b7c4cf"

COLOR_SUCCESS = "#1a7a1a"
COLOR_WARNING = "#b36b00"
COLOR_ERROR = "#c0392b"
COLOR_INFO = "#2563eb"

BTN_GREEN = "#16a34a"
BTN_GREEN_ACTIVE = "#128038"

BTN_BLUE = "#2563eb"
BTN_BLUE_ACTIVE = "#1d4ed8"

BTN_PURPLE = "#7c3aed"
BTN_PURPLE_ACTIVE = "#6423c9"

BTN_GRAY = "#475569"
BTN_GRAY_ACTIVE = "#334155"

BTN_ORANGE = "#ea580c"
BTN_ORANGE_ACTIVE = "#c2470a"

BTN_RED = "#dc2626"
BTN_RED_ACTIVE = "#b91c1c"

BTN_TEAL = "#0d9488"
BTN_TEAL_ACTIVE = "#0b7a6f"


# ============================================================
# 標準 Schema
# ============================================================
#
# 左邊是我們系統自己的「統一欄位名稱」
#
# 不同公司：
#
# 員工姓名 / 姓名 / Name / Employee Name
#
# 最後都轉：
#
# employee_name
#
# ============================================================

FIELD_ALIASES = {

    "employee_id": [
        "員工編號",
        "員工代號",
        "工號",
        "人員編號",
        "職員編號",
        "employee id",
        "employee no",
        "employee number",
        "emp id",
        "emp no",
        "id",
    ],

    "employee_name": [
        "姓名",
        "員工姓名",
        "員工名稱",
        "人員姓名",
        "職員姓名",
        "name",
        "employee name",
        "staff name",
    ],

    "department": [
        "部門",
        "單位",
        "組別",
        "部門名稱",
        "department",
        "dept",
        "division",
        "unit",
    ],

    "job_title": [
        "職稱",
        "職位",
        "職務",
        "title",
        "job title",
        "position",
    ],

    "salary": [
        "薪資",
        "薪水",
        "月薪",
        "本薪",
        "薪酬",
        "應付薪資",
        "實領薪資",
        "實領",
        "salary",
        "monthly salary",
        "pay",
        "wage",
    ],

    "hire_date": [
        "到職日",
        "入職日期",
        "報到日",
        "到職日期",
        "任職起始",
        "hire date",
        "start date",
        "join date",
        "joining date",
    ],

    "date": [
        "日期",
        "交易日期",
        "消費日期",
        "發票日期",
        "date",
        "transaction date",
    ],

    "company": [
        "公司",
        "公司名稱",
        "企業名稱",
        "company",
        "company name",
    ],

    "store": [
        "店家",
        "商店",
        "商家",
        "店名",
        "廠商",
        "vendor",
        "merchant",
        "store",
    ],

    "item": [
        "品項",
        "商品",
        "產品",
        "項目",
        "項次",
        "item",
        "product",
        "description",
    ],

    "amount": [
        "金額",
        "總額",
        "合計",
        "付款金額",
        "應付金額",
        "amount",
        "total",
        "price",
    ],

    "quantity": [
        "數量",
        "件數",
        "qty",
        "quantity",
    ],

    "unit_price": [
        "單價",
        "價格",
        "unit price",
        "price",
    ],

    "status": [
        "狀態",
        "目前狀態",
        "status",
        "state",
    ],

    "remark": [
        "備註",
        "說明",
        "註記",
        "remark",
        "remarks",
        "note",
        "notes",
        "memo",
    ],

    "order_id": [
        "訂單編號",
        "訂單號碼",
        "訂單號",
        "order id",
        "order no",
        "order number",
    ],

    "invoice_id": [
        "發票號碼",
        "發票編號",
        "invoice id",
        "invoice no",
        "invoice number",
    ],

    "phone": [
        "電話",
        "手機",
        "聯絡電話",
        "phone",
        "mobile",
        "telephone",
    ],

    "email": [
        "電子郵件",
        "信箱",
        "email",
        "e-mail",
    ],

    "address": [
        "地址",
        "公司地址",
        "住址",
        "address",
    ],
}


# ============================================================
# 標準 Schema 中文名稱
# ============================================================

CANONICAL_LABELS = {
    "employee_id": "員工編號",
    "employee_name": "姓名",
    "department": "部門",
    "job_title": "職稱",
    "salary": "薪資",
    "hire_date": "到職日期",
    "date": "日期",
    "company": "公司",
    "store": "店家",
    "item": "品項",
    "amount": "金額",
    "quantity": "數量",
    "unit_price": "單價",
    "status": "狀態",
    "remark": "備註",
    "order_id": "訂單編號",
    "invoice_id": "發票號碼",
    "phone": "電話",
    "email": "Email",
    "address": "地址",
}


# ============================================================
# Button
# ============================================================

def styled_button(
    parent,
    text,
    command,
    bg,
    active_bg,
    width=None,
):

    return tk.Button(
        parent,
        text=text,
        command=command,
        bg=bg,
        fg="white",
        activebackground=active_bg,
        activeforeground="white",
        relief="flat",
        cursor="hand2",
        font=(FONT_FAMILY, 11, "bold"),
        padx=12,
        pady=7,
        width=width,
    )


# ============================================================
# 字串正規化
# ============================================================

def normalize_header_text(value):

    if value is None:
        return ""

    text = str(value).strip().lower()

    text = text.replace("\n", " ")
    text = text.replace("\r", " ")

    text = re.sub(r"\s+", " ", text)

    # 全形冒號等
    text = text.replace("：", ":")
    text = text.replace("（", "(")
    text = text.replace("）", ")")

    return text.strip()


# ============================================================
# JSON
# ============================================================

def extract_json(text):

    if not text:
        raise ValueError("模型沒有回傳任何資料。")

    text = text.strip()

    text = re.sub(
        r"^```(?:json)?\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )

    text = re.sub(
        r"\s*```$",
        "",
        text,
    )

    try:

        result = json.loads(text)

        if not isinstance(result, dict):
            raise ValueError(
                "模型回傳的 JSON 不是 object。"
            )

        return result

    except json.JSONDecodeError:
        pass

    start = text.find("{")
    end = text.rfind("}")

    if start >= 0 and end > start:

        candidate = text[start:end + 1]

        try:

            result = json.loads(candidate)

            if not isinstance(result, dict):
                raise ValueError(
                    "模型回傳的 JSON 不是 object。"
                )

            return result

        except json.JSONDecodeError:
            pass

    raise ValueError(
        "模型沒有回傳合法 JSON。\n\n"
        + text
    )


# ============================================================
# 圖片
# ============================================================

def image_to_data_url(path):

    path = Path(path)

    if not path.exists():
        raise FileNotFoundError(path)

    mime, _ = mimetypes.guess_type(str(path))

    supported = {
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    }

    if mime not in supported:

        raise ValueError(
            f"不支援圖片格式：{path.name}"
        )

    with open(path, "rb") as f:

        encoded = base64.b64encode(
            f.read()
        ).decode("utf-8")

    return f"data:{mime};base64,{encoded}"


# ============================================================
# Template Manager
# ============================================================

class CompanyTemplateManager:

    def __init__(self, path=TEMPLATE_FILE):

        self.path = Path(path)

        self.data = self._load()

    def _load(self):

        if not self.path.exists():
            return {
                "templates": []
            }

        try:

            content = json.loads(
                self.path.read_text(
                    encoding="utf-8"
                )
            )

            if not isinstance(content, dict):
                raise ValueError()

            content.setdefault(
                "templates",
                []
            )

            return content

        except Exception:

            return {
                "templates": []
            }

    def save(self):

        self.path.write_text(
            json.dumps(
                self.data,
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

    def list_templates(self):

        return self.data.get(
            "templates",
            []
        )

    def add_or_update_template(
        self,
        company_name,
        sheet_name,
        header_row,
        mapping,
        headers,
    ):

        company_name = company_name.strip()

        if not company_name:

            raise ValueError(
                "公司名稱不可為空。"
            )

        existing = None

        for template in self.list_templates():

            if (
                template.get("company_name")
                == company_name
            ):

                existing = template
                break

        new_data = {
            "company_name": company_name,
            "sheet_name": sheet_name,
            "header_row": header_row,
            "mapping": mapping,
            "headers": headers,
            "updated_at": datetime.now().isoformat(
                timespec="seconds"
            ),
        }

        if existing is None:

            self.data["templates"].append(
                new_data
            )

        else:

            existing.clear()
            existing.update(
                new_data
            )

        self.save()

    def delete_template(self, company_name):

        templates = self.list_templates()

        self.data["templates"] = [
            t
            for t in templates
            if t.get("company_name")
            != company_name
        ]

        self.save()

    # --------------------------------------------------------
    # 自動比對 Template
    # --------------------------------------------------------

    def find_best_template(
        self,
        headers,
        sheet_name=None,
    ):

        if not headers:
            return None, 0.0

        current = {
            normalize_header_text(h)
            for h in headers
            if normalize_header_text(h)
        }

        if not current:
            return None, 0.0

        best = None
        best_score = 0.0

        for template in self.list_templates():

            old_headers = template.get(
                "headers",
                []
            )

            known = {
                normalize_header_text(h)
                for h in old_headers
                if normalize_header_text(h)
            }

            if not known:
                continue

            intersection = len(
                current & known
            )

            union = len(
                current | known
            )

            score = (
                intersection / union
                if union
                else 0
            )

            # sheet 名稱一樣加少量權重
            if (
                sheet_name
                and template.get("sheet_name")
                == sheet_name
            ):

                score += 0.08

            if score > best_score:

                best_score = score
                best = template

        return best, min(
            best_score,
            1.0
        )


# ============================================================
# Mapping Engine
# ============================================================

class SchemaMapper:

    @staticmethod
    def auto_map(headers):

        result = {}

        normalized_headers = {
            h: normalize_header_text(h)
            for h in headers
        }

        for canonical, aliases in FIELD_ALIASES.items():

            normalized_aliases = {
                normalize_header_text(alias)
                for alias in aliases
            }

            # canonical 自己也加入
            normalized_aliases.add(
                canonical.lower()
            )

            for original, normalized in normalized_headers.items():

                if normalized in normalized_aliases:

                    result[canonical] = original
                    break

        return result

    @staticmethod
    def mapping_score(mapping):

        if not mapping:
            return 0

        return len(mapping)

    @staticmethod
    def reverse_mapping(mapping):

        return {
            excel_header: canonical
            for canonical, excel_header
            in mapping.items()
        }


# ============================================================
# 資料 Normalizer
# ============================================================

class ValueNormalizer:

    @staticmethod
    def normalize_money(value):

        if value is None:
            return None

        if isinstance(
            value,
            (int, float)
        ):
            return value

        text = str(value).strip()

        if not text:
            return None

        text = text.replace(",", "")
        text = text.replace("NT$", "")
        text = text.replace("NTD", "")
        text = text.replace("$", "")
        text = text.replace("元", "")
        text = text.strip()

        # 52K
        m = re.fullmatch(
            r"(-?\d+(?:\.\d+)?)\s*[kK]",
            text,
        )

        if m:

            return float(
                m.group(1)
            ) * 1000

        try:

            number = float(text)

            if number.is_integer():
                return int(number)

            return number

        except ValueError:

            return value

    @staticmethod
    def normalize_date(value):

        if value is None:
            return None

        if isinstance(
            value,
            datetime
        ):

            return value.strftime(
                "%Y-%m-%d"
            )

        text = str(value).strip()

        if not text:
            return None

        # 民國
        m = re.match(
            r"民國\s*(\d{2,3})\s*年\s*"
            r"(\d{1,2})\s*月\s*"
            r"(\d{1,2})\s*日",
            text,
        )

        if m:

            y = int(m.group(1)) + 1911
            mth = int(m.group(2))
            d = int(m.group(3))

            return f"{y:04d}-{mth:02d}-{d:02d}"

        # 民國 115/08/19
        m = re.fullmatch(
            r"(\d{2,3})[/-]"
            r"(\d{1,2})[/-]"
            r"(\d{1,2})",
            text,
        )

        if m:

            y = int(m.group(1))

            if y < 1911:
                y += 1911

            return (
                f"{y:04d}-"
                f"{int(m.group(2)):02d}-"
                f"{int(m.group(3)):02d}"
            )

        formats = [
            "%Y/%m/%d",
            "%Y-%m-%d",
            "%Y.%m.%d",
            "%d/%m/%Y",
        ]

        for fmt in formats:

            try:

                dt = datetime.strptime(
                    text,
                    fmt,
                )

                return dt.strftime(
                    "%Y-%m-%d"
                )

            except ValueError:
                pass

        return value

    @classmethod
    def normalize_canonical_data(
        cls,
        data,
    ):

        output = {}

        for key, value in data.items():

            if key in {
                "salary",
                "amount",
                "unit_price",
            }:

                value = cls.normalize_money(
                    value
                )

            elif key in {
                "date",
                "hire_date",
            }:

                value = cls.normalize_date(
                    value
                )

            elif isinstance(
                value,
                str,
            ):

                value = value.strip()

            output[key] = value

        return output


# ============================================================
# Excel Manager
# ============================================================

class ExcelManager:

    def __init__(self):

        self.excel = None
        self.workbook = None
        self.sheet = None

    # --------------------------------------------------------
    # Connect
    # --------------------------------------------------------

    def connect(self):

        try:

            self.excel = (
                win32com.client
                .GetActiveObject(
                    "Excel.Application"
                )
            )

        except Exception as e:

            raise RuntimeError(
                "找不到正在執行的 Excel。\n\n"
                "請先開啟 Microsoft Excel。"
            ) from e

        self.workbook = (
            self.excel.ActiveWorkbook
        )

        if self.workbook is None:

            raise RuntimeError(
                "Excel 已開啟，但沒有活頁簿。"
            )

        self.sheet = (
            self.excel.ActiveSheet
        )

        if self.sheet is None:

            raise RuntimeError(
                "沒有目前工作表。"
            )

    # --------------------------------------------------------
    # Info
    # --------------------------------------------------------

    def get_info(self):

        self.connect()

        return {
            "workbook": self.workbook.Name,
            "sheet": self.sheet.Name,
            "path": self.workbook.FullName,
        }

    # --------------------------------------------------------
    # Header Row 自動偵測
    # --------------------------------------------------------

    def detect_header_row(
        self,
        max_rows=MAX_HEADER_SCAN_ROWS,
    ):

        self.connect()

        best_row = 1
        best_score = -1

        max_col_scan = min(
            self.sheet.UsedRange.Columns.Count
            + self.sheet.UsedRange.Column
            + 10,
            80,
        )

        for row in range(
            1,
            max_rows + 1,
        ):

            values = []

            for col in range(
                1,
                max_col_scan + 1,
            ):

                value = self.sheet.Cells(
                    row,
                    col,
                ).Value

                if value is not None:

                    text = str(value).strip()

                    if text:
                        values.append(text)

            if not values:
                continue

            text_count = sum(
                1
                for v in values
                if not _looks_numeric(v)
            )

            unique_count = len(
                set(values)
            )

            alias_hits = 0

            flattened_aliases = {
                normalize_header_text(a)
                for aliases
                in FIELD_ALIASES.values()
                for a in aliases
            }

            for value in values:

                if (
                    normalize_header_text(value)
                    in flattened_aliases
                ):

                    alias_hits += 1

            # 欄位數越多、文字越多、跟已知 alias 越像
            # 越可能是 header
            score = (
                len(values) * 2
                + text_count
                + unique_count * 0.5
                + alias_hits * 5
            )

            # 避免「公司名稱」這種只有一格的列
            if len(values) <= 1:
                score -= 10

            if score > best_score:

                best_score = score
                best_row = row

        return best_row

    # --------------------------------------------------------
    # Header
    # --------------------------------------------------------

    def get_headers(
        self,
        header_row,
    ):

        self.connect()

        last_col = self.sheet.Cells(
            header_row,
            self.sheet.Columns.Count,
        ).End(XL_TO_LEFT).Column

        headers = []

        for col in range(
            1,
            last_col + 1,
        ):

            value = self.sheet.Cells(
                header_row,
                col,
            ).Value

            if value is None:
                continue

            name = str(value).strip()

            if not name:
                continue

            headers.append({
                "name": name,
                "column": col,
            })

        return headers

    # --------------------------------------------------------
    # Header map
    # --------------------------------------------------------

    def get_header_map(
        self,
        header_row,
    ):

        return {
            h["name"]: h["column"]
            for h
            in self.get_headers(
                header_row
            )
        }

    # --------------------------------------------------------
    # Last row
    # --------------------------------------------------------

    def get_last_data_row(
        self,
        header_row,
    ):

        headers = self.get_headers(
            header_row
        )

        if not headers:
            return header_row

        rows = []

        for header in headers:

            col = header["column"]

            row = self.sheet.Cells(
                self.sheet.Rows.Count,
                col,
            ).End(XL_UP).Row

            rows.append(row)

        return max(
            max(rows),
            header_row,
        )

    # --------------------------------------------------------
    # Next empty row
    # --------------------------------------------------------

    def get_next_empty_row(
        self,
        header_row,
    ):

        return (
            self.get_last_data_row(
                header_row
            )
            + 1
        )

    # --------------------------------------------------------
    # Sample
    # --------------------------------------------------------

    def get_sample_data(
        self,
        header_row,
        limit=SAMPLE_DATA_ROWS,
    ):

        headers = self.get_headers(
            header_row
        )

        last_row = self.get_last_data_row(
            header_row
        )

        sample = []

        for row in range(
            header_row + 1,
            min(
                last_row,
                header_row + limit,
            ) + 1,
        ):

            item = {}

            for header in headers:

                value = self.sheet.Cells(
                    row,
                    header["column"],
                ).Value

                item[
                    header["name"]
                ] = value

            sample.append(item)

        return sample

    # --------------------------------------------------------
    # Insert
    # --------------------------------------------------------

    def insert_excel_data(
        self,
        header_row,
        data,
    ):

        self.connect()

        header_map = self.get_header_map(
            header_row
        )

        unknown = [
            key
            for key in data
            if key not in header_map
        ]

        if unknown:

            raise RuntimeError(
                "以下 Excel 欄位不存在：\n"
                + "\n".join(unknown)
            )

        row = self.get_next_empty_row(
            header_row
        )

        for key, value in data.items():

            self.sheet.Cells(
                row,
                header_map[key],
            ).Value = value

        return row

    # --------------------------------------------------------
    # Insert Many
    # --------------------------------------------------------

    def insert_many(
        self,
        header_row,
        rows,
    ):

        start = self.get_next_empty_row(
            header_row
        )

        result_rows = []

        for data in rows:

            row = self.insert_excel_data(
                header_row,
                data,
            )

            result_rows.append(row)

        return result_rows

    # --------------------------------------------------------
    # Find rows
    # --------------------------------------------------------

    def find_rows(
        self,
        header_row,
        where,
    ):

        header_map = self.get_header_map(
            header_row
        )

        for key in where:

            if key not in header_map:

                raise RuntimeError(
                    f"找不到欄位：{key}"
                )

        last_row = self.get_last_data_row(
            header_row
        )

        matches = []

        for row in range(
            header_row + 1,
            last_row + 1,
        ):

            ok = True

            for key, expected in where.items():

                actual = self.sheet.Cells(
                    row,
                    header_map[key],
                ).Value

                if (
                    str(actual or "").strip()
                    != str(expected or "").strip()
                ):

                    ok = False
                    break

            if ok:
                matches.append(row)

        return matches

    # --------------------------------------------------------
    # Update
    # --------------------------------------------------------

    def update_excel_data(
        self,
        header_row,
        where,
        data,
    ):

        matches = self.find_rows(
            header_row,
            where,
        )

        if not matches:

            raise RuntimeError(
                "找不到符合條件的資料。"
            )

        if len(matches) > 1:

            raise RuntimeError(
                f"找到 {len(matches)} 筆資料。\n\n"
                "為避免誤修改，請提供更明確條件。"
            )

        row = matches[0]

        header_map = self.get_header_map(
            header_row
        )

        for key, value in data.items():

            if key not in header_map:

                raise RuntimeError(
                    f"找不到欄位：{key}"
                )

            self.sheet.Cells(
                row,
                header_map[key],
            ).Value = value

        return row

    def save(self):

        self.connect()

        self.workbook.Save()


# ============================================================
# Helper
# ============================================================

def _looks_numeric(value):

    try:

        float(
            str(value)
            .replace(",", "")
            .replace("$", "")
        )

        return True

    except Exception:

        return False


# ============================================================
# AI Manager
# ============================================================

class AIManager:

    def __init__(
        self,
        provider,
        model,
        api_key=None,
        ollama_host=DEFAULT_OLLAMA_HOST,
    ):

        self.provider = provider
        self.model = model

        if provider == "openai":

            if api_key:

                self.client = OpenAI(
                    api_key=api_key
                )

            else:

                self.client = OpenAI()

        elif provider == "ollama":

            self.client = ollama.Client(
                host=ollama_host
            )

        else:

            raise RuntimeError(
                "未知 AI provider"
            )

    # ========================================================
    # Schema Mapping
    # ========================================================

    def map_schema(
        self,
        headers,
        sample_data,
    ):

        prompt = f"""
你是一個企業 Excel Schema Mapping 系統。

目前 Excel 欄位：

{json.dumps(
    headers,
    ensure_ascii=False
)}

部分資料：

{json.dumps(
    sample_data,
    ensure_ascii=False,
    default=str,
    indent=2
)}

以下是系統標準 Schema：

{json.dumps(
    CANONICAL_LABELS,
    ensure_ascii=False,
    indent=2
)}

請判斷 Excel 欄位與標準 Schema 的語意對應。

只能使用確定的對應。

不知道就不要猜。

輸出：

{{
    "mapping": {{
        "employee_name": "Excel真實欄位名稱",
        "salary": "Excel真實欄位名稱"
    }},
    "confidence": {{
        "employee_name": 0.98,
        "salary": 0.92
    }},
    "explanation": "中文說明"
}}

mapping 的 key 只能使用標準 Schema key。

mapping 的 value 必須完全等於 Excel 現有欄位名稱。

只輸出合法 JSON。
"""

        return self._text_json_request(
            prompt
        )

    # ========================================================
    # 自然語言 / 圖片 → Canonical data
    # ========================================================

    def parse_operation(
        self,
        user_command,
        mapping,
        headers,
        sample_data,
        image_paths=None,
    ):

        image_paths = image_paths or []

        available_canonical = list(
            mapping.keys()
        )

        prompt = f"""
你是一個企業 Excel 資料操作解析器。

目前 Excel 真實欄位：

{json.dumps(
    headers,
    ensure_ascii=False
)}

目前已建立的 Schema Mapping：

{json.dumps(
    mapping,
    ensure_ascii=False,
    indent=2
)}

可以使用的標準欄位：

{json.dumps(
    available_canonical,
    ensure_ascii=False
)}

標準欄位中文意義：

{json.dumps(
    CANONICAL_LABELS,
    ensure_ascii=False,
    indent=2
)}

Excel 部分資料：

{json.dumps(
    sample_data,
    ensure_ascii=False,
    default=str,
    indent=2
)}

請將使用者需求轉成標準 Schema。

允許：

1. insert

{{
    "action": "insert",
    "data": {{
        "employee_name": "王小明",
        "salary": 52000
    }},
    "explanation": "..."
}}

2. insert_many

{{
    "action": "insert_many",
    "rows": [
        {{
            "employee_name": "王小明"
        }}
    ],
    "explanation": "..."
}}

3. update

{{
    "action": "update",
    "where": {{
        "employee_id": "A001"
    }},
    "data": {{
        "salary": 52000
    }},
    "explanation": "..."
}}

重要規則：

- data / rows / where 的 key 必須使用標準 Schema key。
- 只能使用 mapping 已存在的標準欄位。
- 不可以自己創造欄位。
- 不確定的圖片內容不要猜。
- 數字要使用 number。
- 不刪資料。
- 不執行 VBA。
- 不建立公式。
- update where 必須盡量唯一。
- 只輸出 JSON。
"""

        if (
            self.provider == "openai"
            and image_paths
        ):

            return self._openai_image_json(
                prompt,
                user_command,
                image_paths,
            )

        if image_paths:

            raise RuntimeError(
                "目前 Ollama qwen2.5 設定不處理圖片，"
                "請切換 OpenAI。"
            )

        full_prompt = (
            prompt
            + "\n\n使用者需求：\n"
            + user_command
        )

        return self._text_json_request(
            full_prompt
        )

    # ========================================================
    # Text JSON
    # ========================================================

    def _text_json_request(
        self,
        prompt,
    ):

        if self.provider == "openai":

            response = (
                self.client.responses.create(
                    model=self.model,
                    input=prompt,
                )
            )

            return extract_json(
                response.output_text
            )

        response = self.client.chat(

            model=self.model,

            messages=[
                {
                    "role": "user",
                    "content": prompt,
                }
            ],

            format="json",

            options={
                "temperature": 0.1
            },
        )

        try:

            text = response.message.content

        except Exception:

            text = response[
                "message"
            ][
                "content"
            ]

        return extract_json(text)

    # ========================================================
    # OpenAI Image
    # ========================================================

    def _openai_image_json(
        self,
        system_prompt,
        command,
        image_paths,
    ):

        content = [
            {
                "type": "input_text",
                "text": command,
            }
        ]

        for image_path in image_paths:

            content.append({
                "type": "input_image",
                "image_url":
                    image_to_data_url(
                        image_path
                    ),
                "detail": "high",
            })

        response = (
            self.client.responses.create(
                model=self.model,
                input=[
                    {
                        "role": "system",
                        "content": [
                            {
                                "type":
                                    "input_text",
                                "text":
                                    system_prompt,
                            }
                        ],
                    },
                    {
                        "role": "user",
                        "content": content,
                    },
                ],
            )
        )

        return extract_json(
            response.output_text
        )


# ============================================================
# Mapping → Excel 真實欄位
# ============================================================

def canonical_to_excel_data(
    canonical_data,
    mapping,
):

    canonical_data = (
        ValueNormalizer
        .normalize_canonical_data(
            canonical_data
        )
    )

    excel_data = {}

    for canonical, value in canonical_data.items():

        excel_header = mapping.get(
            canonical
        )

        if excel_header:

            excel_data[
                excel_header
            ] = value

    return excel_data


# ============================================================
# GUI
# ============================================================

class ExcelAIApp(tk.Tk):

    def __init__(self):

        super().__init__()

        self.title(APP_TITLE)

        self.geometry(
            "1350x900"
        )

        self.minsize(
            1100,
            750
        )

        self.configure(
            bg=COLOR_BG
        )

        self.excel = ExcelManager()

        self.templates = (
            CompanyTemplateManager()
        )

        self.header_row = 1

        self.headers = []

        self.current_mapping = {}

        self.current_template = None

        self.pending_action = None

        self.selected_images = []

        self._queue = queue.Queue()

        self._busy = False

        self._build_ui()

        self.after(
            100,
            self._poll_queue,
        )

        self.after(
            300,
            self.detect_excel_structure,
        )

    # ========================================================
    # Build
    # ========================================================

    def _build_ui(self):

        self._build_header()
        self._build_model_panel()
        self._build_excel_panel()
        self._build_mapping_panel()
        self._build_command_panel()
        self._build_preview_panel()
        self._build_bottom()

    # ========================================================
    # Header
    # ========================================================

    def _build_header(self):

        frame = tk.Frame(
            self,
            bg=COLOR_HEADER_BG,
        )

        frame.pack(
            fill="x"
        )

        tk.Label(
            frame,
            text="🤖 AI Excel 多公司報表智慧助手",
            bg=COLOR_HEADER_BG,
            fg=COLOR_HEADER_FG,
            font=(
                FONT_FAMILY,
                22,
                "bold",
            ),
        ).pack(
            anchor="w",
            padx=18,
            pady=(14, 2),
        )

        tk.Label(
            frame,
            text=(
                "自動 Header 偵測 / Schema Mapping / "
                "公司模板 / OpenAI 圖片 / Ollama / Excel COM"
            ),
            bg=COLOR_HEADER_BG,
            fg=COLOR_HEADER_SUB,
            font=(
                FONT_FAMILY,
                11,
            ),
        ).pack(
            anchor="w",
            padx=18,
            pady=(0, 14),
        )

    # ========================================================
    # Model
    # ========================================================

    def _build_model_panel(self):

        frame = tk.LabelFrame(
            self,
            text="AI 模型",
            bg=COLOR_PANEL,
            font=(
                FONT_FAMILY,
                12,
                "bold",
            ),
        )

        frame.pack(
            fill="x",
            padx=12,
            pady=(10, 5),
        )

        tk.Label(
            frame,
            text="後端",
            bg=COLOR_PANEL,
        ).grid(
            row=0,
            column=0,
            padx=5,
            pady=5,
        )

        self.provider_var = tk.StringVar(
            value=DEFAULT_PROVIDER
        )

        provider = ttk.Combobox(
            frame,
            textvariable=self.provider_var,
            values=[
                "Ollama",
                "OpenAI",
            ],
            state="readonly",
            width=14,
        )

        provider.grid(
            row=0,
            column=1,
            padx=5,
        )

        provider.bind(
            "<<ComboboxSelected>>",
            self._provider_changed,
        )

        tk.Label(
            frame,
            text="模型",
            bg=COLOR_PANEL,
        ).grid(
            row=0,
            column=2,
            padx=(20, 5),
        )

        self.model_var = tk.StringVar(
            value=DEFAULT_OLLAMA_MODEL
        )

        self.model_combo = ttk.Combobox(
            frame,
            textvariable=self.model_var,
            width=25,
        )

        self.model_combo.grid(
            row=0,
            column=3,
            padx=5,
        )

        tk.Label(
            frame,
            text="OpenAI API Key",
            bg=COLOR_PANEL,
        ).grid(
            row=1,
            column=0,
            padx=5,
            pady=5,
        )

        self.api_var = tk.StringVar(
            value=os.getenv(
                "OPENAI_API_KEY",
                ""
            )
        )

        self.api_entry = ttk.Entry(
            frame,
            textvariable=self.api_var,
            show="*",
            width=45,
        )

        self.api_entry.grid(
            row=1,
            column=1,
            columnspan=3,
            padx=5,
            sticky="we",
        )

        tk.Label(
            frame,
            text="Ollama",
            bg=COLOR_PANEL,
        ).grid(
            row=2,
            column=0,
            padx=5,
            pady=5,
        )

        self.ollama_var = tk.StringVar(
            value=DEFAULT_OLLAMA_HOST
        )

        self.ollama_entry = ttk.Entry(
            frame,
            textvariable=self.ollama_var,
            width=45,
        )

        self.ollama_entry.grid(
            row=2,
            column=1,
            columnspan=3,
            padx=5,
            sticky="we",
        )

        frame.columnconfigure(
            3,
            weight=1,
        )

        self._provider_changed()

    # ========================================================
    # Excel
    # ========================================================

    def _build_excel_panel(self):

        frame = tk.LabelFrame(
            self,
            text="Excel 結構",
            bg=COLOR_PANEL,
            font=(
                FONT_FAMILY,
                12,
                "bold",
            ),
        )

        frame.pack(
            fill="x",
            padx=12,
            pady=5,
        )

        self.excel_info_var = tk.StringVar(
            value="尚未連接 Excel"
        )

        tk.Label(
            frame,
            textvariable=self.excel_info_var,
            bg=COLOR_PANEL,
            justify="left",
            anchor="w",
            font=(
                FONT_FAMILY,
                11,
            ),
        ).pack(
            side="left",
            fill="x",
            expand=True,
            padx=10,
            pady=8,
        )

        styled_button(
            frame,
            "🔍 重新偵測",
            self.detect_excel_structure,
            BTN_BLUE,
            BTN_BLUE_ACTIVE,
        ).pack(
            side="right",
            padx=8,
            pady=8,
        )

    # ========================================================
    # Mapping
    # ========================================================

    def _build_mapping_panel(self):

        frame = tk.LabelFrame(
            self,
            text="Schema Mapping / 公司模板",
            bg=COLOR_PANEL,
            font=(
                FONT_FAMILY,
                12,
                "bold",
            ),
        )

        frame.pack(
            fill="x",
            padx=12,
            pady=5,
        )

        top = tk.Frame(
            frame,
            bg=COLOR_PANEL,
        )

        top.pack(
            fill="x",
            padx=8,
            pady=5,
        )

        tk.Label(
            top,
            text="公司名稱",
            bg=COLOR_PANEL,
        ).pack(
            side="left",
        )

        self.company_var = tk.StringVar()

        ttk.Entry(
            top,
            textvariable=self.company_var,
            width=25,
        ).pack(
            side="left",
            padx=6,
        )

        styled_button(
            top,
            "🤖 AI Mapping",
            self.ai_mapping,
            BTN_PURPLE,
            BTN_PURPLE_ACTIVE,
        ).pack(
            side="left",
            padx=5,
        )

        styled_button(
            top,
            "💾 儲存公司模板",
            self.save_template,
            BTN_TEAL,
            BTN_TEAL_ACTIVE,
        ).pack(
            side="left",
            padx=5,
        )

        styled_button(
            top,
            "🗂 模板管理",
            self.open_template_manager,
            BTN_GRAY,
            BTN_GRAY_ACTIVE,
        ).pack(
            side="left",
            padx=5,
        )

        self.mapping_var = tk.StringVar(
            value="尚未建立 Mapping"
        )

        tk.Label(
            frame,
            textvariable=self.mapping_var,
            bg=COLOR_PANEL,
            justify="left",
            anchor="w",
            font=(
                FONT_FAMILY,
                10,
            ),
            wraplength=1250,
        ).pack(
            fill="x",
            padx=10,
            pady=(2, 8),
        )

    # ========================================================
    # Command
    # ========================================================

    def _build_command_panel(self):

        frame = tk.LabelFrame(
            self,
            text="自然語言 / 圖片",
            bg=COLOR_PANEL,
            font=(
                FONT_FAMILY,
                12,
                "bold",
            ),
        )

        frame.pack(
            fill="x",
            padx=12,
            pady=5,
        )

        self.command_text = ScrolledText(
            frame,
            height=5,
            font=(
                FONT_FAMILY,
                12,
            ),
        )

        self.command_text.pack(
            fill="x",
            padx=10,
            pady=(8, 5),
        )

        self.command_text.insert(
            "1.0",
            "例如：把這張報表中的資料新增到目前 Excel"
        )

        row = tk.Frame(
            frame,
            bg=COLOR_PANEL,
        )

        row.pack(
            fill="x",
            padx=10,
            pady=(3, 8),
        )

        styled_button(
            row,
            "🖼 選擇圖片",
            self.select_images,
            BTN_PURPLE,
            BTN_PURPLE_ACTIVE,
        ).pack(
            side="left",
        )

        styled_button(
            row,
            "清除圖片",
            self.clear_images,
            BTN_GRAY,
            BTN_GRAY_ACTIVE,
        ).pack(
            side="left",
            padx=6,
        )

        self.image_var = tk.StringVar(
            value="沒有圖片"
        )

        tk.Label(
            row,
            textvariable=self.image_var,
            bg=COLOR_PANEL,
        ).pack(
            side="left",
            padx=10,
        )

        styled_button(
            row,
            "🤖 AI 解析需求",
            self.analyze_operation,
            BTN_GREEN,
            BTN_GREEN_ACTIVE,
        ).pack(
            side="right",
        )

    # ========================================================
    # Preview
    # ========================================================

    def _build_preview_panel(self):

        frame = tk.LabelFrame(
            self,
            text="AI 操作預覽",
            bg=COLOR_PANEL,
            font=(
                FONT_FAMILY,
                12,
                "bold",
            ),
        )

        frame.pack(
            fill="both",
            expand=True,
            padx=12,
            pady=5,
        )

        self.preview = ScrolledText(
            frame,
            font=(
                "Consolas",
                11,
            ),
        )

        self.preview.pack(
            fill="both",
            expand=True,
            padx=8,
            pady=8,
        )

    # ========================================================
    # Bottom
    # ========================================================

    def _build_bottom(self):

        frame = tk.Frame(
            self,
            bg=COLOR_BG,
        )

        frame.pack(
            fill="x",
            padx=12,
            pady=10,
        )

        self.execute_btn = styled_button(
            frame,
            "✅ 確認寫入 Excel",
            self.execute_action,
            BTN_ORANGE,
            BTN_ORANGE_ACTIVE,
        )

        self.execute_btn.pack(
            side="left",
        )

        self.execute_btn.config(
            state="disabled"
        )

        styled_button(
            frame,
            "💾 儲存 Excel",
            self.save_excel,
            BTN_BLUE,
            BTN_BLUE_ACTIVE,
        ).pack(
            side="left",
            padx=8,
        )

        self.status_var = tk.StringVar(
            value="準備完成"
        )

        self.status_label = tk.Label(
            frame,
            textvariable=self.status_var,
            bg=COLOR_BG,
            font=(
                FONT_FAMILY,
                11,
                "bold",
            ),
        )

        self.status_label.pack(
            side="right",
        )

    # ========================================================
    # Provider
    # ========================================================

    def _provider_changed(
        self,
        _event=None,
    ):

        if (
            self.provider_var.get()
            == "Ollama"
        ):

            self.model_combo.config(
                values=[
                    "qwen2.5:3b",
                    "qwen2.5:7b",
                ],
                state="readonly",
            )

            if not self.model_var.get().startswith(
                "qwen"
            ):

                self.model_var.set(
                    DEFAULT_OLLAMA_MODEL
                )

            self.api_entry.config(
                state="disabled"
            )

            self.ollama_entry.config(
                state="normal"
            )

        else:

            self.model_combo.config(
                values=[
                    "gpt-5",
                    "gpt-5-mini",
                ],
                state="normal",
            )

            if self.model_var.get().startswith(
                "qwen"
            ):

                self.model_var.set(
                    DEFAULT_OPENAI_MODEL
                )

            self.api_entry.config(
                state="normal"
            )

            self.ollama_entry.config(
                state="disabled"
            )

    # ========================================================
    # Excel Structure
    # ========================================================

    def detect_excel_structure(self):

        try:

            info = self.excel.get_info()

            self.header_row = (
                self.excel.detect_header_row()
            )

            header_objects = (
                self.excel.get_headers(
                    self.header_row
                )
            )

            self.headers = [
                h["name"]
                for h
                in header_objects
            ]

            auto_mapping = (
                SchemaMapper.auto_map(
                    self.headers
                )
            )

            template, score = (
                self.templates.find_best_template(
                    self.headers,
                    info["sheet"],
                )
            )

            if (
                template is not None
                and score >= 0.65
            ):

                self.current_template = template

                self.current_mapping = dict(
                    template.get(
                        "mapping",
                        {}
                    )
                )

                self.company_var.set(
                    template.get(
                        "company_name",
                        ""
                    )
                )

                template_text = (
                    f"\n模板："
                    f"{template.get('company_name')}"
                    f" / 匹配度 {score:.0%}"
                )

            else:

                self.current_template = None

                self.current_mapping = (
                    auto_mapping
                )

                template_text = (
                    "\n模板：未找到高可信度模板"
                )

            self.excel_info_var.set(
                f"活頁簿：{info['workbook']}\n"
                f"工作表：{info['sheet']}\n"
                f"偵測 Header Row：{self.header_row}\n"
                f"Excel 欄位：{', '.join(self.headers)}"
                f"{template_text}"
            )

            self._update_mapping_display()

            self._status(
                "Excel 結構偵測完成",
                "success",
            )

        except Exception as e:

            messagebox.showerror(
                "Excel",
                str(e),
            )

            self._status(
                "Excel 偵測失敗",
                "error",
            )

    # ========================================================
    # Mapping display
    # ========================================================

    def _update_mapping_display(self):

        if not self.current_mapping:

            self.mapping_var.set(
                "目前沒有任何欄位 Mapping。"
            )

            return

        parts = []

        for canonical, excel in (
            self.current_mapping.items()
        ):

            label = CANONICAL_LABELS.get(
                canonical,
                canonical,
            )

            parts.append(
                f"{label} [{canonical}] → {excel}"
            )

        self.mapping_var.set(
            " | ".join(parts)
        )

    # ========================================================
    # AI Manager instance
    # ========================================================

    def _make_ai_manager(self):

        provider = (
            "openai"
            if self.provider_var.get()
            == "OpenAI"
            else "ollama"
        )

        return AIManager(

            provider=provider,

            model=self.model_var.get().strip(),

            api_key=self.api_var.get().strip(),

            ollama_host=(
                self.ollama_var.get().strip()
                or DEFAULT_OLLAMA_HOST
            ),
        )

    # ========================================================
    # AI Mapping
    # ========================================================

    def ai_mapping(self):

        if self._busy:
            return

        if not self.headers:

            messagebox.showwarning(
                "Mapping",
                "請先偵測 Excel。"
            )

            return

        try:

            sample = (
                self.excel.get_sample_data(
                    self.header_row
                )
            )

        except Exception as e:

            messagebox.showerror(
                "Excel",
                str(e),
            )

            return

        self._busy = True

        self._status(
            "AI 正在分析欄位 Mapping..."
        )

        thread = threading.Thread(
            target=self._mapping_worker,
            args=(sample,),
            daemon=True,
        )

        thread.start()

    def _mapping_worker(
        self,
        sample,
    ):

        try:

            ai = self._make_ai_manager()

            result = ai.map_schema(
                self.headers,
                sample,
            )

            self._queue.put({
                "type": "mapping",
                "result": result,
            })

        except Exception as e:

            self._queue.put({
                "type": "error",
                "message": str(e),
            })

    # ========================================================
    # Mapping result
    # ========================================================

    def _handle_mapping(
        self,
        result,
    ):

        mapping = result.get(
            "mapping",
            {}
        )

        if not isinstance(
            mapping,
            dict,
        ):

            raise RuntimeError(
                "AI Mapping 格式錯誤。"
            )

        clean = {}

        for canonical, excel in mapping.items():

            if canonical not in FIELD_ALIASES:
                continue

            if excel not in self.headers:
                continue

            clean[
                canonical
            ] = excel

        # AI 結果與規則結果合併
        auto = SchemaMapper.auto_map(
            self.headers
        )

        auto.update(clean)

        self.current_mapping = auto

        self._update_mapping_display()

        self.preview.delete(
            "1.0",
            "end",
        )

        self.preview.insert(
            "end",
            json.dumps(
                result,
                ensure_ascii=False,
                indent=2,
            ),
        )

        self._status(
            "AI Mapping 完成",
            "success",
        )

    # ========================================================
    # Save Template
    # ========================================================

    def save_template(self):

        company = (
            self.company_var.get()
            .strip()
        )

        if not company:

            messagebox.showwarning(
                "公司模板",
                "請先輸入公司名稱。"
            )

            return

        if not self.current_mapping:

            messagebox.showwarning(
                "公司模板",
                "目前沒有 Mapping。"
            )

            return

        try:

            info = self.excel.get_info()

            self.templates.add_or_update_template(

                company_name=company,

                sheet_name=info["sheet"],

                header_row=self.header_row,

                mapping=self.current_mapping,

                headers=self.headers,
            )

            self._status(
                "公司模板已儲存",
                "success",
            )

            messagebox.showinfo(
                "公司模板",
                f"已儲存：{company}"
            )

        except Exception as e:

            messagebox.showerror(
                "公司模板",
                str(e),
            )

    # ========================================================
    # Template Manager
    # ========================================================

    def open_template_manager(self):

        dlg = tk.Toplevel(self)

        dlg.title(
            "公司模板管理"
        )

        dlg.geometry(
            "650x450"
        )

        listbox = tk.Listbox(
            dlg,
            font=(
                FONT_FAMILY,
                11,
            ),
        )

        listbox.pack(
            fill="both",
            expand=True,
            padx=10,
            pady=10,
        )

        templates = (
            self.templates.list_templates()
        )

        for t in templates:

            listbox.insert(
                "end",
                (
                    f"{t.get('company_name')} | "
                    f"Sheet={t.get('sheet_name')} | "
                    f"Header={t.get('header_row')}"
                ),
            )

        def apply_selected():

            selection = (
                listbox.curselection()
            )

            if not selection:
                return

            template = templates[
                selection[0]
            ]

            self.current_template = template

            self.current_mapping = dict(
                template.get(
                    "mapping",
                    {}
                )
            )

            self.company_var.set(
                template.get(
                    "company_name",
                    ""
                )
            )

            saved_row = template.get(
                "header_row"
            )

            if isinstance(
                saved_row,
                int,
            ):

                self.header_row = saved_row

            self._update_mapping_display()

            dlg.destroy()

        def delete_selected():

            selection = (
                listbox.curselection()
            )

            if not selection:
                return

            template = templates[
                selection[0]
            ]

            company = template.get(
                "company_name"
            )

            if not messagebox.askyesno(
                "刪除模板",
                f"確定刪除 {company}？",
                parent=dlg,
            ):
                return

            self.templates.delete_template(
                company
            )

            dlg.destroy()

        buttons = tk.Frame(dlg)

        buttons.pack(
            fill="x",
            padx=10,
            pady=10,
        )

        tk.Button(
            buttons,
            text="套用",
            command=apply_selected,
        ).pack(
            side="left",
        )

        tk.Button(
            buttons,
            text="刪除",
            command=delete_selected,
        ).pack(
            side="left",
            padx=8,
        )

    # ========================================================
    # Images
    # ========================================================

    def select_images(self):

        paths = filedialog.askopenfilenames(
            title="選擇圖片",
            filetypes=[
                (
                    "圖片",
                    "*.jpg *.jpeg *.png *.webp *.gif"
                ),
                (
                    "全部",
                    "*.*"
                ),
            ],
        )

        if not paths:
            return

        self.selected_images = list(
            paths
        )

        self.image_var.set(
            f"已選擇 {len(paths)} 張圖片"
        )

    def clear_images(self):

        self.selected_images = []

        self.image_var.set(
            "沒有圖片"
        )

    # ========================================================
    # Analyze Operation
    # ========================================================

    def analyze_operation(self):

        if self._busy:
            return

        if not self.current_mapping:

            messagebox.showwarning(
                "AI",
                "目前沒有 Schema Mapping。\n\n"
                "請先執行 AI Mapping。"
            )

            return

        command = (
            self.command_text.get(
                "1.0",
                "end",
            ).strip()
        )

        if not command:

            if self.selected_images:

                command = (
                    "請分析圖片，將可以明確辨識、"
                    "並且能對應目前 Excel Schema "
                    "的資料新增到 Excel。"
                )

            else:

                messagebox.showwarning(
                    "AI",
                    "請輸入需求。"
                )

                return

        try:

            sample = (
                self.excel.get_sample_data(
                    self.header_row
                )
            )

        except Exception as e:

            messagebox.showerror(
                "Excel",
                str(e),
            )

            return

        self._busy = True

        self.execute_btn.config(
            state="disabled"
        )

        self.pending_action = None

        self._status(
            "AI 正在解析操作..."
        )

        thread = threading.Thread(
            target=self._operation_worker,
            args=(
                command,
                sample,
                list(
                    self.selected_images
                ),
            ),
            daemon=True,
        )

        thread.start()

    def _operation_worker(
        self,
        command,
        sample,
        images,
    ):

        try:

            ai = self._make_ai_manager()

            result = ai.parse_operation(

                user_command=command,

                mapping=self.current_mapping,

                headers=self.headers,

                sample_data=sample,

                image_paths=images,
            )

            self._queue.put({
                "type": "operation",
                "result": result,
            })

        except Exception as e:

            self._queue.put({
                "type": "error",
                "message": str(e),
            })

    # ========================================================
    # Operation Result
    # ========================================================

    def _handle_operation(
        self,
        result,
    ):

        action = result.get(
            "action"
        )

        if action not in {
            "insert",
            "insert_many",
            "update",
        }:

            raise RuntimeError(
                f"禁止 action：{action}"
            )

        # ------------------------------------
        # Canonical → Excel
        # ------------------------------------

        converted = {
            "action": action,
            "explanation":
                result.get(
                    "explanation",
                    "",
                ),
        }

        if action == "insert":

            canonical = result.get(
                "data",
                {},
            )

            converted["data"] = (
                canonical_to_excel_data(
                    canonical,
                    self.current_mapping,
                )
            )

        elif action == "insert_many":

            rows = result.get(
                "rows",
                [],
            )

            converted["rows"] = [
                canonical_to_excel_data(
                    row,
                    self.current_mapping,
                )
                for row in rows
            ]

        elif action == "update":

            converted["where"] = (
                canonical_to_excel_data(
                    result.get(
                        "where",
                        {},
                    ),
                    self.current_mapping,
                )
            )

            converted["data"] = (
                canonical_to_excel_data(
                    result.get(
                        "data",
                        {},
                    ),
                    self.current_mapping,
                )
            )

        self.pending_action = converted

        self.preview.delete(
            "1.0",
            "end",
        )

        self.preview.insert(
            "end",
            "【AI 標準 Schema】\n\n"
            + json.dumps(
                result,
                ensure_ascii=False,
                indent=2,
            )
            + "\n\n"
            + "【轉換成目前 Excel 欄位】\n\n"
            + json.dumps(
                converted,
                ensure_ascii=False,
                indent=2,
            )
        )

        self.execute_btn.config(
            state="normal"
        )

        self._status(
            "AI 解析完成，等待確認",
            "success",
        )

    # ========================================================
    # Execute
    # ========================================================

    def execute_action(self):

        if not self.pending_action:
            return

        action = self.pending_action[
            "action"
        ]

        explanation = (
            self.pending_action.get(
                "explanation",
                "",
            )
        )

        if not messagebox.askyesno(
            "確認修改 Excel",
            (
                f"{explanation}\n\n"
                "這一步會真正修改目前 Excel。\n\n"
                "確定繼續？"
            ),
        ):

            return

        try:

            if action == "insert":

                row = (
                    self.excel.insert_excel_data(
                        self.header_row,
                        self.pending_action[
                            "data"
                        ],
                    )
                )

                msg = (
                    f"已新增到第 {row} 列"
                )

            elif action == "insert_many":

                rows = (
                    self.excel.insert_many(
                        self.header_row,
                        self.pending_action[
                            "rows"
                        ],
                    )
                )

                msg = (
                    f"已新增 {len(rows)} 筆資料"
                )

            else:

                row = (
                    self.excel.update_excel_data(
                        self.header_row,
                        self.pending_action[
                            "where"
                        ],
                        self.pending_action[
                            "data"
                        ],
                    )
                )

                msg = (
                    f"已修改第 {row} 列"
                )

            self.pending_action = None

            self.execute_btn.config(
                state="disabled"
            )

            self._status(
                "Excel 操作完成",
                "success",
            )

            messagebox.showinfo(
                "完成",
                msg,
            )

        except Exception as e:

            messagebox.showerror(
                "Excel",
                str(e),
            )

            self._status(
                "Excel 操作失敗",
                "error",
            )

    # ========================================================
    # Queue
    # ========================================================

    def _poll_queue(self):

        try:

            while True:

                item = (
                    self._queue.get_nowait()
                )

                self._busy = False

                if item["type"] == "mapping":

                    self._handle_mapping(
                        item["result"]
                    )

                elif item["type"] == "operation":

                    self._handle_operation(
                        item["result"]
                    )

                elif item["type"] == "error":

                    messagebox.showerror(
                        "錯誤",
                        item["message"],
                    )

                    self._status(
                        "執行失敗",
                        "error",
                    )

        except queue.Empty:
            pass

        self.after(
            100,
            self._poll_queue,
        )

    # ========================================================
    # Save Excel
    # ========================================================

    def save_excel(self):

        try:

            self.excel.save()

            self._status(
                "Excel 已儲存",
                "success",
            )

            messagebox.showinfo(
                "Excel",
                "Excel 已儲存。"
            )

        except Exception as e:

            messagebox.showerror(
                "Excel",
                str(e),
            )

    # ========================================================
    # Status
    # ========================================================

    def _status(
        self,
        text,
        level=None,
    ):

        self.status_var.set(text)

        if level == "success":

            color = COLOR_SUCCESS

        elif level == "error":

            color = COLOR_ERROR

        elif level == "warning":

            color = COLOR_WARNING

        else:

            color = "#5d7285"

        self.status_label.config(
            fg=color
        )


# ============================================================
# Main
# ============================================================

def main():

    pythoncom.CoInitialize()

    try:

        app = ExcelAIApp()

        app.mainloop()

    finally:

        pythoncom.CoUninitialize()


if __name__ == "__main__":
    main()