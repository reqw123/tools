# -*- coding: utf-8 -*-
"""
operation_planner.py
======================
把『使用者自然語言／圖片需求』轉成結構化 Operation Plan。

流程（需求 #33 #40）：
  1. 先嘗試 deterministic 規則解析（正則），大多數常見指令
     （幫我在 XX 7/24 加上 YY 20 件）不需要動用 LLM。
  2. 規則解析失敗，或使用者附上圖片，才呼叫 LLM。
  3. 不論來源為何，都要經過 validate_plan() 的白名單與型別檢查。

安全限制（需求 #18 #31 #32 #41）：
  - LLM 絕對不能指定任何 Excel Cell Address / Row / Column / Sheet 名稱，
    這裡會直接把這些欄位從 LLM 回傳結果中剔除。
  - action 必須落在白名單 settings.ALLOWED_ACTIONS 內，否則整個計畫視為無效。
  - 真正決定寫哪個 Region / 哪一列 / 哪一欄，全部交給 Report Handler。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Optional

import settings as S
from value_normalizer import normalize_date, normalize_text
from ai_manager import AIManager

# LLM 絕對不可以回傳、且即使回傳了也一律忽略的欄位
FORBIDDEN_KEYS = {
    "cell", "cells", "row", "rows", "column", "columns", "col", "cols",
    "address", "range", "sheet", "sheet_name", "formula", "vba", "macro",
}


class PlanValidationError(ValueError):
    pass


@dataclass
class OperationPlan:
    report_type: str
    action: str
    customer: Optional[str] = None
    data: dict = field(default_factory=dict)
    where: dict = field(default_factory=dict)
    explanation: str = ""
    source: str = "deterministic"  # deterministic / llm

    def to_preview_dict(self) -> dict:
        return {
            "report_type": self.report_type,
            "action": self.action,
            "customer": self.customer,
            "data": self.data,
            "where": self.where,
            "explanation": self.explanation,
            "source": self.source,
        }


# ======================================================================
# Deterministic 規則解析
# ======================================================================

_QTY_UNIT = r"(?:件|個|箱|包|條|盒|份)?"
_DATE_CORE = r"\d{1,3}[/.\-]\d{1,2}(?:[/.\-]\d{1,4})?\.?"
_DATE_PATTERN = f"({_DATE_CORE})"

# 「在 <客戶> <日期> <動詞> <品項> <數量> [件]」
# 動詞可以是『新增類』（加上/新增/加/補上 -> append_order）
# 或『修改類』（改為/改成/改到 -> update_quantity，例如：
#   幫我在谷樺 7/24 改為機器麵線 777 件）
# 注意：alternation 要把長字串放前面（例如「加上」要在「加」前面），
# 否則 regex 會先貪婪匹配到短字串，導致品項名稱多吃掉一個字。
_ACTION_WORDS_APPEND = ("加上", "新增", "補上", "加")
_ACTION_WORDS_UPDATE_QTY = ("改為", "改成", "改到")

_IN_DATE_ACTION_RE = re.compile(
    rf"(?:幫我)?在\s*(?P<customer>[^\s\d]{{1,10}}?)\s*"
    rf"{_DATE_PATTERN}\s*"
    rf"(?P<action_word>加上|新增|補上|改為|改成|改到|加)\s*"
    rf"(?P<item>[^\s\d,，。]{{1,12}}?)\s*"
    rf"(?P<qty>\d+)\s*{_QTY_UNIT}"
)

_UPDATE_QTY_RE = re.compile(
    rf"(?:把|將)\s*(?P<customer>[^\s\d]{{1,10}}?)\s*"
    rf"{_DATE_PATTERN}\s*(?P<item>[^\s\d,，。]{{1,12}}?)\s*"
    rf"(?:的)?數量\s*(?:改成|改為|修改為|更新為|改)\s*(?P<qty>\d+)"
)

_UPDATE_RETURN_RE = re.compile(
    rf"(?:把|將)\s*(?P<customer>[^\s\d]{{1,10}}?)\s*"
    rf"{_DATE_PATTERN}\s*(?P<item>[^\s\d,，。]{{1,12}}?)\s*"
    rf"(?:的)?退貨\s*(?:改成|改為|修改為|更新為|改)\s*(?P<qty>\d+)"
)

# 批次改名：「把 <客戶>? <範圍>? 全部/所有 <品項> 改成/改回/改為 <新品項>」
# <客戶> 可省略；<範圍> 可以是「A~B」日期區間或「N月」，也可以省略（=整張表）。
# 依「範圍越明確、regex 越先嘗試」的順序排列，避免被較寬鬆的規則搶先吃掉。
_RENAME_CUSTOMER = r"(?P<customer>[^\s\d,，。]{0,10}?)"
_RENAME_OLD_NEW = r"(?:都)?改(?:回|成|為)\s*(?P<new_item>[^\s\d,，。]{1,12})"

_RENAME_RANGE_RE = re.compile(
    rf"(?:把|將)\s*{_RENAME_CUSTOMER}\s*"
    rf"(?P<date_from>{_DATE_CORE})\s*[~～\-]\s*(?P<date_to>{_DATE_CORE})\s*(?:的)?\s*"
    rf"(?:全部|所有)?\s*(?P<old_item>[^\s\d,，。]{{1,12}}?)\s*{_RENAME_OLD_NEW}"
)

_RENAME_MONTH_RE = re.compile(
    rf"(?:把|將)\s*{_RENAME_CUSTOMER}\s*"
    rf"(?P<month>\d{{1,2}})\s*月\s*(?:的)?\s*"
    rf"(?:全部|所有)?\s*(?P<old_item>[^\s\d,，。]{{1,12}}?)\s*{_RENAME_OLD_NEW}"
)

# 單一天 + 明確講『全部/所有』：「把<客戶>? <日期>的全部/所有<品項>改成<新品項>」，
# 一樣是批次（那一天可能不只一筆同名資料，全部都要改），只是範圍縮小到那一天。
_RENAME_SINGLE_DAY_ALL_RE = re.compile(
    rf"(?:把|將)\s*{_RENAME_CUSTOMER}\s*"
    rf"(?P<date>{_DATE_CORE})\s*(?:的)?\s*"
    rf"(?:全部|所有)\s*(?P<old_item>[^\s\d,，。~～\-]{{1,12}}?)\s*{_RENAME_OLD_NEW}"
)

# 沒有指定範圍：「把所有/全部 <品項> 改成/改回/改為 <新品項>」，明確帶有
# 『全部/所有』字樣才觸發，避免跟單筆修改的句型混淆。
_RENAME_ALL_RE = re.compile(
    rf"(?:把|將)\s*{_RENAME_CUSTOMER}\s*"
    rf"(?:全部|所有)\s*(?P<old_item>[^\s\d,，。]{{1,12}}?)\s*{_RENAME_OLD_NEW}"
)

# 單一天、沒有『全部/所有』：這是『改某一天那一筆資料的名稱』，屬於單筆修改
# （跟 update_quantity/update_return 同一個定位邏輯），交給 update_field 處理——
# 命中該天多筆同名資料時會被 MultipleCandidatesError 擋下，不會誤改。
_RENAME_ONE_RE = re.compile(
    rf"(?:把|將)\s*{_RENAME_CUSTOMER}\s*"
    rf"(?P<date>{_DATE_CORE})\s*(?:的)?\s*"
    rf"(?P<old_item>[^\s\d,，。~～\-]{{1,12}}?)\s*{_RENAME_OLD_NEW}"
)


def try_deterministic_parse(text: str) -> Optional[OperationPlan]:
    text = (text or "").strip()
    if not text:
        return None

    m = _RENAME_RANGE_RE.search(text)
    if m:
        customer, old_item, new_item = m.group("customer") or None, m.group("old_item"), m.group("new_item")
        date_from, date_to = m.group("date_from"), m.group("date_to")
        return OperationPlan(
            report_type=S.REPORT_CUSTOMER_STATEMENT,
            action="rename_item",
            customer=customer,
            data={"old_item": old_item, "new_item": new_item},
            where={"date_from": date_from, "date_to": date_to},
            explanation=f"把{customer or ''} {date_from}~{date_to} 的『{old_item}』改成『{new_item}』",
            source="deterministic",
        )

    m = _RENAME_MONTH_RE.search(text)
    if m:
        customer, old_item, new_item = m.group("customer") or None, m.group("old_item"), m.group("new_item")
        month = int(m.group("month"))
        return OperationPlan(
            report_type=S.REPORT_CUSTOMER_STATEMENT,
            action="rename_item",
            customer=customer,
            data={"old_item": old_item, "new_item": new_item},
            where={"month": month},
            explanation=f"把{customer or ''} {month} 月的『{old_item}』改成『{new_item}』",
            source="deterministic",
        )

    m = _RENAME_SINGLE_DAY_ALL_RE.search(text)
    if m:
        customer, old_item, new_item = m.group("customer") or None, m.group("old_item"), m.group("new_item")
        date = m.group("date")
        return OperationPlan(
            report_type=S.REPORT_CUSTOMER_STATEMENT,
            action="rename_item",
            customer=customer,
            data={"old_item": old_item, "new_item": new_item},
            where={"date_from": date, "date_to": date},
            explanation=f"把{customer or ''} {date} 全部『{old_item}』改成『{new_item}』",
            source="deterministic",
        )

    m = _RENAME_ALL_RE.search(text)
    if m:
        customer, old_item, new_item = m.group("customer") or None, m.group("old_item"), m.group("new_item")
        return OperationPlan(
            report_type=S.REPORT_CUSTOMER_STATEMENT,
            action="rename_item",
            customer=customer,
            data={"old_item": old_item, "new_item": new_item},
            explanation=f"把{customer or ''}全部『{old_item}』改成『{new_item}』",
            source="deterministic",
        )

    m = _RENAME_ONE_RE.search(text)
    if m:
        customer, old_item, new_item = m.group("customer") or None, m.group("old_item"), m.group("new_item")
        date = m.group("date")
        return OperationPlan(
            report_type=S.REPORT_CUSTOMER_STATEMENT,
            action="update_field",
            customer=customer,
            where={"date": date, "item": old_item},
            data={"item": new_item},
            explanation=f"把{customer or ''} {date} 的『{old_item}』改名為『{new_item}』",
            source="deterministic",
        )

    m = _UPDATE_RETURN_RE.search(text)
    if m:
        return OperationPlan(
            report_type=S.REPORT_CUSTOMER_STATEMENT,
            action="update_return",
            customer=m.group("customer"),
            data={"date": m.group(2), "item": m.group("item"),
                  "return_quantity": int(m.group("qty"))},
            explanation=f"將 {m.group('customer')} {m.group(2)} {m.group('item')} 的退貨改為 {m.group('qty')}",
            source="deterministic",
        )

    m = _UPDATE_QTY_RE.search(text)
    if m:
        return OperationPlan(
            report_type=S.REPORT_CUSTOMER_STATEMENT,
            action="update_quantity",
            customer=m.group("customer"),
            data={"date": m.group(2), "item": m.group("item"),
                  "quantity": int(m.group("qty"))},
            explanation=f"將 {m.group('customer')} {m.group(2)} {m.group('item')} 的數量改為 {m.group('qty')}",
            source="deterministic",
        )

    m = _IN_DATE_ACTION_RE.search(text)
    if m:
        action_word = m.group("action_word")
        customer, date_text, item, qty = m.group("customer"), m.group(2), m.group("item"), int(m.group("qty"))
        if action_word in _ACTION_WORDS_UPDATE_QTY:
            return OperationPlan(
                report_type=S.REPORT_CUSTOMER_STATEMENT,
                action="update_quantity",
                customer=customer,
                data={"date": date_text, "item": item, "quantity": qty},
                explanation=f"將 {customer} {date_text} {item} 的數量改為 {qty}",
                source="deterministic",
            )
        return OperationPlan(
            report_type=S.REPORT_CUSTOMER_STATEMENT,
            action="append_order",
            customer=customer,
            data={"date": date_text, "item": item, "quantity": qty},
            explanation=f"在 {customer} {date_text} 新增 {item} {qty} 件",
            source="deterministic",
        )

    return None


# 使用者常會用逗號/分號/換行把好幾筆各自獨立的指令寫在同一段話裡
# （例如「在谷樺 7/24 改為機器麵線 777 件,在谷樺 7/20 改為機器麵線 666」）。
# 用來拆段落的字元本身不會出現在任何一個規則式欄位（品項/數量/日期）裡，
# 所以直接切開很安全；『.』不放進來，因為日期像「115.7.20.」結尾會用到。
_MULTI_INSTRUCTION_SPLIT_RE = re.compile(r"[,，;；\n]+")


def try_deterministic_parse_multi(text: str) -> Optional[list[OperationPlan]]:
    """嘗試把一段文字拆成多筆各自獨立的指令，全部都能被規則式解析器辨識
    才會回傳（>=2 筆）；只要有任何一段解析不出來，就整個放棄回傳 None，
    交回呼叫端用原始整段文字走原本『單一指令』流程（含 AI），不會用
    『猜一半』的拆解結果誤導使用者少做了什麼。

    刻意不把 append_order（新增列）放進批次：插入列會讓同一個 Region
    後面的列號整個往下移，如果同一批裡還有其他指令是照『分析當下』的列號
    去定位資料，插入之後那些列號就全部錯位了。批次目前只保證『每一筆都是
    針對既有列的修改／改名』這種不會讓列號移動的操作。
    """
    text = (text or "").strip()
    if not text:
        return None

    segments = [s.strip() for s in _MULTI_INSTRUCTION_SPLIT_RE.split(text) if s.strip()]
    if len(segments) < 2:
        return None

    plans = []
    for seg in segments:
        plan = try_deterministic_parse(seg)
        if plan is None:
            return None
        plans.append(plan)

    if any(p.action == "append_order" for p in plans):
        return None

    return plans


# ======================================================================
# LLM 解析（規則解析失敗，或有圖片時）
# ======================================================================


def build_llm_system_prompt(context: dict) -> str:
    return f"""你是企業 Excel 操作需求解析器。

目前偵測到的報表類型：{context.get('report_type')}
目前欄位（Header）：{json.dumps(context.get('headers', []), ensure_ascii=False)}
Schema Mapping（Excel欄位 -> 標準欄位）：{json.dumps(context.get('mapping', {}), ensure_ascii=False)}
可用的客戶／區塊清單：{json.dumps(context.get('known_customers', []), ensure_ascii=False)}

請把使用者需求轉成以下 JSON 格式之一：

新增一筆訂單／貨品：
{{
  "action": "append_order",
  "customer": "客戶名稱",
  "data": {{ "date": "7/24", "item": "機器麵線", "quantity": 20 }},
  "explanation": "..."
}}

修改既有一筆資料（可以同時修改多個欄位，例如同時改數量+單價，
或把品項名稱改成別的名稱）：
{{
  "action": "update_field",
  "customer": "客戶名稱",
  "where": {{ "date": "7/24", "item": "機器麵線" }},
  "data": {{ "quantity": 20, "unit_price": 777 }},
  "explanation": "..."
}}

  - where 一定要包含 date 和 item，用來定位「現有」的哪一筆資料要被修改
    （item 填 Excel 上目前的名稱，不是要改成的新名稱）。
  - data 只放使用者真的要求修改的欄位，不要自己猜或多加：
      quantity        數量
      unit_price      單價
      return_quantity 退貨數量
      item            把品項名稱改成新的名稱（例如把「機器麵線」改回「機器麵條」）
  - 絕對不可以把「合計」「總計金額」這種欄位放進 data：它們是公式自動算出來的
    （合計＝數量×單價，總計金額＝該組合計加總），使用者若要求把總計/合計改成
    某個數字，代表他真正想改的是背後的數量或單價，請改用 quantity/unit_price；
    如果看不出來使用者想改哪個數量或單價，就回傳 "action": "analyze" 並在
    explanation 說明「總計/合計是公式，需要改數量或單價才能連動」，不要硬猜。

把某個品項名稱『全部』改成另一個名稱（會影響這張表裡所有符合這個名稱的資料列，
不只改一筆，只有使用者明確講『全部』『所有』這種批次語氣時才用這個 action）。
可以用 where 限定範圍，不寫 where 就是整張表都套用：
{{
  "action": "rename_item",
  "customer": "客戶名稱",
  "data": {{ "old_item": "機器麵線", "new_item": "機器麵條" }},
  "where": {{ "date_from": "7/1", "date_to": "7/31" }},
  "explanation": "..."
}}

  - where 若要限定日期範圍，用 date_from + date_to；若要限定某個月份，
    改用 {{ "month": 7 }}（兩者擇一，不確定範圍就整個省略 where）。

使用者附上一張『整張表格／單據』的圖片，意思是『圖片上的資料才是對的，
Excel 現在的資料可能有落差，請幫我把 Excel 對齊圖片內容』（這是整批對帳，
不是只改一筆）——把圖片裡看得到的每一列都列出來：
{{
  "action": "reconcile_from_image",
  "customer": "客戶名稱",
  "data": {{
    "entries": [
      {{ "date": "115.6.26", "item": "紅盤", "quantity": 9, "unit_price": 720, "return_quantity": 0 }},
      {{ "date": "115.7.1", "item": "機器麵線", "quantity": 12, "unit_price": 260 }}
    ]
  }},
  "explanation": "..."
}}

  - entries 裡每一筆都要有 date 跟 item（用來定位對應到 Excel 的哪一列），
    quantity/unit_price/return_quantity 看得清楚才填，看不清楚就整個省略
    那個欄位（不要用猜的），實際差異由程式比對，不用你自己判斷有沒有改變。
  - 把圖片上『每一列』都列出來，不要只挑幾筆你覺得重要的；也不要自己延伸、
    推算圖片上沒有的資料列。

使用者附上一張『估價單／單據』照片，圖片上的日期在 Excel 裡完全還沒有
（不是要修正既有資料，是要把這張單子上的品項當成新資料，全部加進去）：
{{
  "action": "import_from_image",
  "customer": "客戶名稱",
  "data": {{
    "date": "115.5.6",
    "entries": [
      {{ "item": "紅盤", "quantity": 2, "unit_price": 640 }},
      {{ "item": "手工麵線", "quantity": 19, "unit_price": 240 }}
    ]
  }},
  "explanation": "..."
}}

  - date 是這張單據上『唯一的一個』日期（單據通常只在最上面寫一次日期，
    底下每一列品項都是同一天），entries 裡不要重複放 date。
  - entries 把單據上『每一列』都列出來；看不清楚的手寫字不要用猜的，
    這一列的 unit_price 看不清楚可以省略（程式會自動查歷史單價），但
    item 跟 quantity 看不出來就整列跳過，不要編造。
  - 手寫字跡本來就可能辨識不準，這是正常的，看到潦草、模糊、被劃掉的
    內容就照實際能看到的填，不確定的欄位寧可留空，不要輸出你沒把握的猜測值。

只是想看/分析，不要修改任何東西：
{{ "action": "analyze", "explanation": "..." }}

絕對規則：
  - 絕對不可以輸出任何 Excel Cell 位置、Row、Column、Sheet 名稱、公式或 VBA。
  - 不確定的圖片內容或文字內容，不要用猜的，寧可留空。
  - 只能使用上面列出的 action。
  - 只輸出 JSON，不要有其他文字。
"""


def parse_operation(user_text: str, ai_manager: AIManager, context: dict,
                     image_paths: Optional[list[str]] = None) -> OperationPlan:
    image_paths = image_paths or []

    if not image_paths:
        plan = try_deterministic_parse(user_text)
        if plan is not None:
            return plan

    system_prompt = build_llm_system_prompt(context)
    if image_paths:
        raw = ai_manager.image_json(system_prompt, user_text, image_paths)
    else:
        raw = ai_manager.text_json(system_prompt, user_text)

    return validate_plan(raw, context, source="llm")


# ======================================================================
# 驗證 / 清洗
# ======================================================================


def _coerce_dict_field(value) -> dict:
    """把 AI 回傳的 data / where 欄位盡量『救』成 dict，而不是直接判錯。

    LLM 偶爾會不照我們要求的格式回傳（例如把 data 包成陣列、或整個變成
    一句話字串），與其直接丟一個看不出原因的「格式錯誤」擋住整個流程，
    不如盡量容錯解析；真的解析不出具體欄位時，交給後面 Handler 的
    validate() 用『缺少日期』『缺少貨品名稱』這種明確訊息告訴使用者
    到底少了什麼（比「data 欄位格式錯誤」更能讓人知道下一步要做什麼）。
    """
    if value is None:
        return {}
    if isinstance(value, dict):
        return value
    if isinstance(value, list):
        # 常見誤用：AI 把 data 包成陣列，取裡面第一個 dict
        for item in value:
            if isinstance(item, dict):
                return item
        return {}
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return {}
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
        # 真的解析不出結構化欄位：保留原始文字，讓使用者/後續驗證看得到
        # AI 到底回了什麼，而不是靜靜消失或整個報錯中斷。
        return {"_raw_ai_text": text}
    return {}


def validate_plan(raw: dict, context: dict, source: str = "llm") -> OperationPlan:
    if not isinstance(raw, dict):
        raise PlanValidationError("AI 回傳的內容不是有效的 JSON 物件。")

    # 剔除任何試圖指定 Excel 座標的欄位（需求 #18 #41）
    cleaned = {k: v for k, v in raw.items() if k.lower() not in FORBIDDEN_KEYS}

    action = cleaned.get("action")
    if action not in S.ALLOWED_ACTIONS:
        raise PlanValidationError(f"不允許的操作類型：{action!r}")

    raw_data = cleaned.get("data")
    if action in ("reconcile_from_image", "import_from_image") and isinstance(raw_data, list):
        # 常見誤用：AI 把整批列直接當成 data 陣列，而不是包在 data.entries 裡。
        raw_data = {"entries": raw_data}
    data = _coerce_dict_field(raw_data)
    data = {k: v for k, v in data.items() if k.lower() not in FORBIDDEN_KEYS}

    where = _coerce_dict_field(cleaned.get("where"))
    where = {k: v for k, v in where.items() if k.lower() not in FORBIDDEN_KEYS}

    # 基本型別正規化（不擅自修改看不懂的值 —— value_normalizer 已內建此原則）
    # date / item 可能出現在 data（舊格式、或 append_order）或 where
    # （update_field 用來定位既有資料的那一筆），兩邊都要正規化。
    for bucket in (data, where):
        for date_key in ("date", "date_from", "date_to"):
            if date_key in bucket:
                norm = normalize_date(bucket[date_key])
                bucket[date_key] = norm if norm is not None else bucket[date_key]
        if "item" in bucket:
            bucket["item"] = normalize_text(bucket["item"])

    if "month" in where:
        try:
            month = int(where["month"])
        except (TypeError, ValueError):
            raise PlanValidationError(f"month 必須是數字，收到：{where['month']!r}")
        if not (1 <= month <= 12):
            raise PlanValidationError(f"month 必須介於 1~12，收到：{month}")
        where["month"] = month

    if "quantity" in data:
        data["quantity"] = _coerce_positive_int(data["quantity"], "quantity")
    if "return_quantity" in data:
        data["return_quantity"] = _coerce_positive_int(data["return_quantity"], "return_quantity", allow_zero=True)
    if "unit_price" in data:
        data["unit_price"] = _coerce_positive_number(data["unit_price"], "unit_price")
    if "old_item" in data:
        data["old_item"] = normalize_text(data["old_item"])
    if "new_item" in data:
        data["new_item"] = normalize_text(data["new_item"])
    if action == "reconcile_from_image":
        data["entries"] = _normalize_reconcile_rows(data.get("entries"))
    if action == "import_from_image":
        data["entries"] = _normalize_import_entries(data.get("entries"))

    report_type = cleaned.get("report_type") or context.get("report_type") or S.REPORT_UNKNOWN

    return OperationPlan(
        report_type=report_type,
        action=action,
        customer=normalize_text(cleaned.get("customer")),
        data=data,
        where=where,
        explanation=str(cleaned.get("explanation", "")).strip(),
        source=source,
    )


def _normalize_reconcile_rows(rows) -> list[dict]:
    """把圖片辨識出來的整批列做寬鬆正規化：單一欄位看不懂就跳過那個欄位，
    不要讓一列裡某個奇怪值拖垮整批（圖片辨識本來就不會 100% 精準）。
    沒有 date 或沒有 item 的列無法拿去跟 Excel 比對，直接丟掉。
    """
    if not isinstance(rows, list):
        return []

    result = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        norm: dict = {}

        if "date" in row and row["date"] is not None:
            d = normalize_date(row["date"])
            norm["date"] = d if d is not None else row["date"]
        if "item" in row and row["item"] is not None:
            item = normalize_text(row["item"])
            if item:
                norm["item"] = item

        for key, coerce in (
            ("quantity", lambda v: _coerce_positive_int(v, "quantity", allow_zero=True)),
            ("unit_price", lambda v: _coerce_positive_number(v, "unit_price")),
            ("return_quantity", lambda v: _coerce_positive_int(v, "return_quantity", allow_zero=True)),
        ):
            if key in row and row[key] is not None:
                try:
                    norm[key] = coerce(row[key])
                except PlanValidationError:
                    pass  # 這欄看不懂就跳過，不影響這一列其他欄位或其他列

        if norm.get("date") and norm.get("item"):
            result.append(norm)

    return result


def _normalize_import_entries(entries) -> list[dict]:
    """估價單匯入：每一筆只有 item/quantity/unit_price（日期是整張單據
    共用同一個，放在 data.date，不在每一筆裡），quantity 是必要欄位
    （新增資料一定要有數量），unit_price 可以省略交給程式查歷史單價。
    """
    if not isinstance(entries, list):
        return []

    result = []
    for row in entries:
        if not isinstance(row, dict):
            continue
        norm: dict = {}

        if "item" in row and row["item"] is not None:
            item = normalize_text(row["item"])
            if item:
                norm["item"] = item

        if "quantity" in row and row["quantity"] is not None:
            try:
                norm["quantity"] = _coerce_positive_int(row["quantity"], "quantity")
            except PlanValidationError:
                continue  # 數量看不懂，這一筆整個沒有意義，跳過

        if "unit_price" in row and row["unit_price"] is not None:
            try:
                norm["unit_price"] = _coerce_positive_number(row["unit_price"], "unit_price")
            except PlanValidationError:
                pass

        if "return_quantity" in row and row["return_quantity"] is not None:
            try:
                norm["return_quantity"] = _coerce_positive_int(row["return_quantity"], "return_quantity", allow_zero=True)
            except PlanValidationError:
                pass

        if norm.get("item") and norm.get("quantity"):
            result.append(norm)

    return result


def _coerce_positive_number(value, field_name: str) -> float | int:
    try:
        num = float(value)
    except (TypeError, ValueError):
        raise PlanValidationError(f"{field_name} 必須是數字，收到：{value!r}")
    if num < 0:
        raise PlanValidationError(f"{field_name} 必須是正數，收到：{value!r}")
    return int(num) if num.is_integer() else num


def _coerce_positive_int(value, field_name: str, allow_zero: bool = False) -> int:
    try:
        num = int(round(float(value)))
    except (TypeError, ValueError):
        raise PlanValidationError(f"{field_name} 必須是數字，收到：{value!r}")
    if num < 0 or (num == 0 and not allow_zero):
        raise PlanValidationError(f"{field_name} 必須是正整數，收到：{value!r}")
    return num
