# -*- coding: utf-8 -*-
"""
value_normalizer.py
====================
金額 / 日期 / 文字正規化。

原則（需求 #12）：
  - 只處理「看得懂」的格式，轉成標準值。
  - 看不懂就『原封不動』回傳，絕不亂猜、不擅自修改。
"""

from __future__ import annotations

import re
from datetime import datetime, date
from typing import Optional, Union

ROC_OFFSET = 1911


# ====================================================================
# 金額
# ====================================================================

_MONEY_CLEAN_RE = re.compile(r"[,\s]")
_MONEY_K_RE = re.compile(r"^(-?\d+(?:\.\d+)?)\s*[kK]$")
_MONEY_NUM_RE = re.compile(r"^-?\d+(?:\.\d+)?$")


def normalize_money(value) -> Union[int, float, None, object]:
    """
    支援： 52,000 / NT$52,000 / 52000元 / 52K / $52000
    看不懂 -> 原始值原封不動回傳。
    """
    if value is None:
        return None

    if isinstance(value, (int, float)):
        return value

    text = str(value).strip()
    if not text:
        return None

    original = text

    text = _MONEY_CLEAN_RE.sub("", text)
    for token in ("NT$", "NTD", "NT", "$", "元", "新台幣"):
        text = text.replace(token, "")
    text = text.strip()

    m = _MONEY_K_RE.match(text)
    if m:
        return float(m.group(1)) * 1000

    if _MONEY_NUM_RE.match(text):
        num = float(text)
        return int(num) if num.is_integer() else num

    # 看不懂：原封不動回傳
    return original


# ====================================================================
# 日期
# ====================================================================

_ROC_LONG_RE = re.compile(
    r"民國\s*(\d{2,3})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?"
)
# 115/08/19、115-08-19、115.08.19、115.7.24（民國，年 < 200）
_NUMERIC_DATE_RE = re.compile(
    r"^(\d{2,4})[./\-](\d{1,2})[./\-](\d{1,2})\.?$"
)
# 只有『月/日』沒有年份：7/24、7-24、7.24（使用者口語常常省略年份）
_MONTH_DAY_RE = re.compile(r"^(\d{1,2})[./\-](\d{1,2})\.?$")


def _to_iso(y: int, m: int, d: int) -> Optional[str]:
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def normalize_date(value, year_hint: Optional[int] = None) -> Union[str, None, object]:
    """
    回傳統一格式 (ISO, yyyy-mm-dd) 的字串；看不懂則原封不動回傳。

    year_hint：使用者常常只講『月/日』（例如「7/24」）不講年份，這種情況下
    單靠這個值本身『看不懂』完整日期，必須有外部上下文（例如該客戶對帳表
    既有的日期，通常同一期間會是同一個年度）才能補齊年份；呼叫端知道這個
    上下文時可以傳入 year_hint（西元年），這裡才會把「7/24」補成完整日期。
    沒有 year_hint 時，「7/24」這種缺年份的輸入一律原封不動回傳，不會亂猜。
    """
    if value is None:
        return None

    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    text = str(value).strip()
    if not text:
        return None

    original = text

    m = _ROC_LONG_RE.match(text)
    if m:
        y = int(m.group(1)) + ROC_OFFSET
        result = _to_iso(y, int(m.group(2)), int(m.group(3)))
        return result if result else original

    m = _NUMERIC_DATE_RE.match(text)
    if m:
        y = int(m.group(1))
        mth = int(m.group(2))
        d = int(m.group(3))
        if y < 1000:
            y += ROC_OFFSET
        result = _to_iso(y, mth, d)
        return result if result else original

    for fmt in ("%Y/%m/%d", "%Y-%m-%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(text, fmt).date().isoformat()
        except ValueError:
            pass

    m = _MONTH_DAY_RE.match(text)
    if m and year_hint:
        result = _to_iso(int(year_hint), int(m.group(1)), int(m.group(2)))
        if result:
            return result

    return original


def format_date_like(iso_date: str, sample_text: str) -> str:
    """
    把 ISO 日期 (yyyy-mm-dd) 依照『既有欄位樣式』重新格式化。
    例如既有欄位是 "115.6.26" -> 民國年.月.日（無補零）。
    看不出既有樣式時，直接回傳 ISO 字串。

    這是為了滿足需求 #16：使用者輸入的日期，寫回 Excel 時要符合
    該報表既有的日期表示法（例如 115.7.24）。
    """
    try:
        y, m, d = (int(p) for p in iso_date.split("-"))
    except Exception:
        return iso_date

    sample_text = (sample_text or "").strip()

    # 既有樣式含 "." 分隔，且看起來像民國年 (2~3位數字開頭)
    if re.match(r"^\d{2,3}\.\d{1,2}\.\d{1,2}\.?$", sample_text):
        roc_y = y - ROC_OFFSET if y > 1000 else y
        suffix = "." if sample_text.endswith(".") else ""
        return f"{roc_y}.{m}.{d}{suffix}"

    if re.match(r"^\d{2,3}/\d{1,2}/\d{1,2}$", sample_text):
        roc_y = y - ROC_OFFSET if y > 1000 else y
        return f"{roc_y}/{m}/{d}"

    if re.match(r"^\d{4}/\d{1,2}/\d{1,2}$", sample_text):
        return f"{y}/{m}/{d}"

    if re.match(r"^\d{4}-\d{1,2}-\d{1,2}$", sample_text):
        return f"{y:04d}-{m:02d}-{d:02d}"

    # 沒有樣本可以參考 -> 預設用民國年.月.日 (這是本工具最常見的樣式)
    roc_y = y - ROC_OFFSET if y > 1000 else y
    return f"{roc_y}.{m}.{d}"


# ====================================================================
# 文字
# ====================================================================


def normalize_text(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value.strip()
    return value


# ====================================================================
# Header 文字正規化（用於比對，不用於顯示／寫入）
# ====================================================================

_WS_RE = re.compile(r"\s+")


def normalize_header_text(value) -> str:
    if value is None:
        return ""
    text = str(value).strip().lower()
    text = text.replace("\n", " ").replace("\r", " ")
    text = _WS_RE.sub(" ", text)
    text = text.replace("：", ":").replace("（", "(").replace("）", ")")
    return text.strip()


def looks_numeric(value) -> bool:
    if value is None:
        return False
    if isinstance(value, (int, float)):
        return True
    text = str(value).strip()
    if not text:
        return False
    text = _MONEY_CLEAN_RE.sub("", text)
    for token in ("NT$", "$", "元", "件", "%"):
        text = text.replace(token, "")
    try:
        float(text)
        return True
    except ValueError:
        return False


def looks_like_date(value) -> bool:
    if value is None:
        return False
    if isinstance(value, (datetime, date)):
        return True
    text = str(value).strip()
    if not text:
        return False
    if _ROC_LONG_RE.match(text):
        return True
    if _NUMERIC_DATE_RE.match(text):
        return True
    return False
