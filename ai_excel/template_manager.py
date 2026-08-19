# -*- coding: utf-8 -*-
"""
template_manager.py
=====================
以 JSON 檔案儲存『公司／報表版型』模板，並在再次遇到相似報表時自動比對套用。

每個模板檔對應一個 JSON，內容包含（需求 #10）：
  company_name, report_type, sheet_name, region_signature,
  header_row, headers, canonical_mapping, formula_rules,
  blank_inheritance_rules, summary_rules

比對（需求 #11）綜合考慮：
  Sheet 名稱 / Header 相似度 / Header 數量 / Header 順序 /
  Region 位置 / 關鍵欄位 / 公式模式
"""

from __future__ import annotations

import difflib
import json
import re
import time
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from settings import TEMPLATES_DIR
from value_normalizer import normalize_header_text

_SAFE_NAME_RE = re.compile(r"[^\w一-鿿\-]+")


def _safe_filename(company_name: str, report_type: str) -> str:
    base = f"{company_name}_{report_type}"
    base = _SAFE_NAME_RE.sub("_", base).strip("_")
    return base or f"template_{int(time.time())}"


@dataclass
class Template:
    company_name: str
    report_type: str
    sheet_name: str
    header_row: int
    headers: list                    # [header名稱, ...]（依原始欄位順序）
    canonical_mapping: dict          # {canonical: header名稱}
    region_signature: dict = None    # {top,left,bottom,right,n_rows,n_cols}
    formula_rules: dict = None       # {header名稱: 公式樣板字串}
    blank_inheritance_rules: dict = None  # {header名稱: canonical}
    summary_rules: dict = None       # 客戶對帳表：total_row / grand_total 相關線索
    key_columns: list = None         # 用來辨識此模板的關鍵欄位（canonical）
    updated_at: str = ""

    def to_json(self) -> dict:
        return asdict(self)

    @staticmethod
    def from_json(data: dict) -> "Template":
        return Template(
            company_name=data.get("company_name", ""),
            report_type=data.get("report_type", ""),
            sheet_name=data.get("sheet_name", ""),
            header_row=data.get("header_row", 1),
            headers=data.get("headers", []),
            canonical_mapping=data.get("canonical_mapping", {}),
            region_signature=data.get("region_signature") or {},
            formula_rules=data.get("formula_rules") or {},
            blank_inheritance_rules=data.get("blank_inheritance_rules") or {},
            summary_rules=data.get("summary_rules") or {},
            key_columns=data.get("key_columns") or [],
            updated_at=data.get("updated_at", ""),
        )


class TemplateManager:
    def __init__(self, templates_dir: Path = TEMPLATES_DIR):
        self.dir = Path(templates_dir)
        self.dir.mkdir(exist_ok=True, parents=True)

    # ------------------------------------------------------------
    def list_templates(self) -> list[Template]:
        result = []
        for f in sorted(self.dir.glob("*.json")):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                result.append(Template.from_json(data))
            except Exception:
                continue
        return result

    def save_template(self, tpl: Template) -> Path:
        tpl.updated_at = time.strftime("%Y-%m-%d %H:%M:%S")
        path = self.dir / f"{_safe_filename(tpl.company_name, tpl.report_type)}.json"
        path.write_text(json.dumps(tpl.to_json(), ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def delete_template(self, company_name: str, report_type: str) -> bool:
        path = self.dir / f"{_safe_filename(company_name, report_type)}.json"
        if path.exists():
            path.unlink()
            return True
        return False

    # ------------------------------------------------------------
    # 模板比對
    # ------------------------------------------------------------

    def find_best_match(self, sheet_name: str, headers: list[str],
                         region_signature: Optional[dict] = None,
                         report_type: Optional[str] = None) -> tuple[Optional[Template], float]:
        best, best_score = None, 0.0
        for tpl in self.list_templates():
            if report_type and tpl.report_type != report_type:
                continue
            score = self._score(tpl, sheet_name, headers, region_signature)
            if score > best_score:
                best, best_score = tpl, score
        return best, best_score

    def _score(self, tpl: Template, sheet_name: str, headers: list[str],
               region_signature: Optional[dict]) -> float:
        score = 0.0

        cur_norm = [normalize_header_text(h) for h in headers if normalize_header_text(h)]
        tpl_norm = [normalize_header_text(h) for h in tpl.headers if normalize_header_text(h)]

        if not cur_norm or not tpl_norm:
            return 0.0

        # Header 相似度（Jaccard）
        cur_set, tpl_set = set(cur_norm), set(tpl_norm)
        jaccard = len(cur_set & tpl_set) / len(cur_set | tpl_set) if (cur_set | tpl_set) else 0
        score += jaccard * 0.45

        # Header 數量
        count_ratio = 1 - (abs(len(cur_norm) - len(tpl_norm)) / max(len(cur_norm), len(tpl_norm)))
        score += max(count_ratio, 0) * 0.15

        # Header 順序（用 SequenceMatcher 比對序列相似度）
        order_ratio = difflib.SequenceMatcher(None, cur_norm, tpl_norm).ratio()
        score += order_ratio * 0.15

        # Sheet 名稱
        if sheet_name and tpl.sheet_name and sheet_name == tpl.sheet_name:
            score += 0.1

        # 關鍵欄位（canonical）是否都存在
        if tpl.key_columns:
            mapped_canonicals = set(tpl.canonical_mapping.keys())
            key_hit = len(set(tpl.key_columns) & mapped_canonicals) / len(tpl.key_columns)
            score += key_hit * 0.1

        # Region 位置（大致落在相近的欄數範圍）
        if region_signature and tpl.region_signature:
            cur_cols = region_signature.get("n_cols", 0)
            tpl_cols = tpl.region_signature.get("n_cols", 0)
            if cur_cols and tpl_cols:
                diff = abs(cur_cols - tpl_cols) / max(cur_cols, tpl_cols)
                score += max(1 - diff, 0) * 0.05

        return min(score, 1.0)
