# -*- coding: utf-8 -*-
"""
item_catalog.py
=================
「品名清單」的本機儲存（給④半人工輸入分頁的貨單名稱下拉選單管理用）。

跟 template_manager.py 的模板檔、settings.py 的 user_settings.json 同一套
模式：純本機快取，使用者可自行刪除重建，不是 Excel 本身的資料，這裡
完全不碰任何 Excel 操作。
"""

from __future__ import annotations

import json
from pathlib import Path

from value_normalizer import normalize_header_text, normalize_text
import settings as S

CATALOG_FILE: Path = S.SCRIPT_DIR / "item_catalog.json"


def load_items() -> list[str]:
    if not CATALOG_FILE.exists():
        return []
    try:
        data = json.loads(CATALOG_FILE.read_text(encoding="utf-8"))
        items = data.get("items", [])
        return dedupe_items([i for i in items if isinstance(i, str)])
    except Exception:
        return []


def save_items(items: list[str]) -> None:
    try:
        CATALOG_FILE.write_text(
            json.dumps({"items": dedupe_items(items)}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception:
        pass


def dedupe_items(items: list[str]) -> list[str]:
    """依『同一套規則』去重：用 normalize_header_text（trim / 全形轉半形 /
    大小寫 / 空白收斂）當比對 key，保留第一次出現的 normalize_text（單純
    trim）當顯示文字，不擅自改寫使用者原本的寫法。"""
    seen: set[str] = set()
    result: list[str] = []
    for raw in items:
        text = normalize_text(raw)
        if not text:
            continue
        key = normalize_header_text(text)
        if key in seen:
            continue
        seen.add(key)
        result.append(text)
    return result


def merge_items(existing: list[str], new_items: list[str]) -> list[str]:
    """把 new_items 併入 existing，套用同一套去重規則（掃描/手動新增共用）。"""
    return dedupe_items(list(existing) + list(new_items))
