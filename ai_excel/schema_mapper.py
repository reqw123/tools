# -*- coding: utf-8 -*-
"""
schema_mapper.py
==================
把『各公司真實欄位名稱』對應到『Canonical Schema』。

優先順序（需求 #9 #40）：
  1. 已知欄位別名表（settings.CANONICAL_FIELD_ALIASES）－完全比對
  2. 已儲存的公司模板（template_manager）－依模板的 header -> canonical 紀錄
  3. 都無法確定 -> 交給 LLM，但 LLM 結果只是『預覽』，必須使用者確認才套用
"""

from __future__ import annotations

import difflib
from dataclasses import dataclass

from structure_analyzer import HeaderInfo
from value_normalizer import normalize_header_text
from settings import CANONICAL_FIELD_ALIASES, CANONICAL_LABELS_ZH

_ALIAS_LOOKUP: dict[str, str] = {}
for _canonical, _aliases in CANONICAL_FIELD_ALIASES.items():
    _ALIAS_LOOKUP[normalize_header_text(_canonical)] = _canonical
    for _a in _aliases:
        _ALIAS_LOOKUP[normalize_header_text(_a)] = _canonical


@dataclass
class MappingResult:
    mapping: dict            # column(int) -> canonical(str)
    header_to_canonical: dict  # header_name(str) -> canonical(str)
    unresolved: list         # list[HeaderInfo] 沒有把握對應到任何 canonical 欄位
    source: dict             # header_name -> "alias" / "template" / "llm"


def auto_map(headers: list[HeaderInfo], template: dict | None = None) -> MappingResult:
    mapping: dict[int, str] = {}
    header_to_canonical: dict[str, str] = {}
    source: dict[str, str] = {}
    unresolved: list[HeaderInfo] = []

    template_mapping = {}
    if template:
        # 模板存的是 {canonical: header_name}，反轉成 header_name(normalize) -> canonical
        for canonical, header_name in (template.get("canonical_mapping") or {}).items():
            template_mapping[normalize_header_text(header_name)] = canonical

    for h in headers:
        norm = normalize_header_text(h.name)

        canonical = _ALIAS_LOOKUP.get(norm)
        if canonical:
            mapping[h.column] = canonical
            header_to_canonical[h.name] = canonical
            source[h.name] = "alias"
            continue

        canonical = template_mapping.get(norm)
        if canonical:
            mapping[h.column] = canonical
            header_to_canonical[h.name] = canonical
            source[h.name] = "template"
            continue

        # 模糊比對模板（header 順序 / 用字略有差異）
        if template_mapping:
            close = difflib.get_close_matches(norm, list(template_mapping.keys()), n=1, cutoff=0.75)
            if close:
                canonical = template_mapping[close[0]]
                mapping[h.column] = canonical
                header_to_canonical[h.name] = canonical
                source[h.name] = "template_fuzzy"
                continue

        unresolved.append(h)

    return MappingResult(mapping, header_to_canonical, unresolved, source)


def build_llm_mapping_prompt(headers: list[HeaderInfo], sample_rows: list[dict]) -> str:
    import json
    header_names = [h.name for h in headers]
    return f"""你是企業 Excel Schema Mapping 系統。

Excel 目前的欄位名稱：
{json.dumps(header_names, ensure_ascii=False)}

部分資料範例：
{json.dumps(sample_rows, ensure_ascii=False, default=str, indent=2)}

可用的標準欄位（canonical schema）：
{json.dumps(CANONICAL_LABELS_ZH, ensure_ascii=False, indent=2)}

請只針對『你有把握』的欄位提出對應，不確定的欄位不要出現在結果中。

只能輸出以下格式的 JSON，不要有任何其他文字：
{{
  "mapping": {{ "<Excel欄位名稱>": "<canonical欄位key>" }},
  "confidence": {{ "<Excel欄位名稱>": 0.0~1.0 }}
}}
"""


def parse_llm_mapping_result(result: dict, headers: list[HeaderInfo]) -> dict:
    """驗證 LLM 回傳結果，只保留合法的 header 名稱與合法的 canonical key。

    回傳『預覽用』的 dict：{header_name: canonical}，尚未套用到任何地方。
    呼叫端（GUI）必須先顯示這個預覽，使用者確認後才能真正合併進 mapping。
    """
    valid_headers = {h.name for h in headers}
    raw_mapping = result.get("mapping", {}) if isinstance(result, dict) else {}
    if not isinstance(raw_mapping, dict):
        return {}

    preview = {}
    for header_name, canonical in raw_mapping.items():
        if header_name not in valid_headers:
            continue
        if canonical not in CANONICAL_FIELD_ALIASES:
            continue
        preview[header_name] = canonical
    return preview


def merge_confirmed_mapping(auto_result: MappingResult, headers: list[HeaderInfo],
                             confirmed_preview: dict) -> MappingResult:
    """使用者確認 LLM 預覽後，合併進最終 mapping（不覆蓋規則式已確定的欄位）。"""
    mapping = dict(auto_result.mapping)
    header_to_canonical = dict(auto_result.header_to_canonical)
    source = dict(auto_result.source)
    name_to_col = {h.name: h.column for h in headers}

    for header_name, canonical in confirmed_preview.items():
        if header_name in header_to_canonical:
            continue  # 規則式/模板已經有結果，不覆蓋
        col = name_to_col.get(header_name)
        if col is None:
            continue
        mapping[col] = canonical
        header_to_canonical[header_name] = canonical
        source[header_name] = "llm"

    unresolved = [h for h in headers if h.name not in header_to_canonical]
    return MappingResult(mapping, header_to_canonical, unresolved, source)
