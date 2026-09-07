"""搜尋、分類、資料夾篩選——輸入是 IndexService.load_all_entries() 已經組好
流水號的完整清單，這裡只負責「這筆要不要顯示」，不會重新指定流水號，維持
「搜尋或篩選後保留原序號」的行為。"""

import re
from pathlib import Path

from file_search_app.models import format_added_at

# 命中內文時，關鍵字前後各帶這麼多字當上下文（清單那一格塞不下太多，夠讓
# 使用者一眼看出「喔是內文提到」就好，完整內容去右邊預覽面板看）。
_SNIPPET_RADIUS = 42
# 關鍵字太短（1 個字）給內文摘要意義不大、又到處都是，跳過。
_MIN_SNIPPET_QUERY_LEN = 2


class SearchService:
    def distinct_categories(self, entries):
        """既有分類（去除空白、去重、排序），給新增／編輯／匯入對話框的分類
        下拉選單當候選值用。"""
        return sorted({e.category.strip() for e in entries if e.category.strip()})

    def build_category_options(self, entries):
        """搜尋列分類下拉選單的完整選項：「全部」＋既有分類＋（有需要才加）「未分類」。
        分類欄留空的項目歸類成「未分類」——只有真的存在空分類的項目時才出現這個
        選項，避免清單裡多一個永遠篩不出東西的選項。"""
        categories = self.distinct_categories(entries)
        has_uncategorized = any(not e.category.strip() for e in entries)
        return ["全部"] + categories + (["未分類"] if has_uncategorized else [])

    def build_folder_options(self, entries):
        folders = sorted({str(Path(e.path).parent) for e in entries})
        return ["全部"] + folders

    @staticmethod
    def _metadata_haystack(entry):
        """一筆索引項目「不含檔案內文」的可搜尋文字——序號／檔名／分類／說明／
        完整路徑／加入時間，全轉小寫。內文快取另外接。"""
        name = Path(entry.path).name
        added_display = format_added_at(entry.added_at)
        return (
            f"{entry.serial}\n{name}\n{entry.category}\n{entry.description}\n"
            f"{entry.path}\n{added_display}"
        ).lower()

    def filter_entries(self, entries, query, category, folder, cache):
        """依分類／資料夾／關鍵字篩選，回傳保留下來的 IndexEntry 清單（原有的
        serial／row_index 都不變）。查詢比對序號／檔名／分類／說明／完整路徑／
        加入時間／快取內容（更新過內容快取的檔案才有），全部轉小寫比對。"""
        typed = query.strip().lower()
        results = []
        for entry in entries:
            cat_stripped = entry.category.strip()
            if category == "未分類":
                if cat_stripped:
                    continue
            elif category != "全部" and cat_stripped != category:
                continue
            if folder != "全部" and str(Path(entry.path).parent) != folder:
                continue
            haystack = self._metadata_haystack(entry)
            cached_text = cache.get(entry.path, {}).get("text")
            if cached_text:
                haystack += "\n" + cached_text.lower()
            if typed and typed not in haystack:
                continue
            results.append(entry)
        return results

    def content_match_snippets(self, entries, query, cache):
        """給 filter_entries() 篩完的清單再跑一次，找出「是因為檔案*內文*
        才被留下來」的項目，回傳 `{entry.path: 帶上下文的片段}`。

        只挑「metadata（檔名／分類／說明／路徑…）本身沒命中、但內文快取有」
        的——那種光看清單一格格欄位看不出「為什麼這筆會出現」，補一段內文
        片段最有幫助；檔名就直接命中的不用多此一舉。"""
        typed = query.strip()
        if len(typed) < _MIN_SNIPPET_QUERY_LEN:
            return {}
        low = typed.lower()
        out = {}
        for entry in entries:
            if low in self._metadata_haystack(entry):
                continue  # 是靠 metadata 命中的，不用內文片段
            cached_text = cache.get(entry.path, {}).get("text")
            if not cached_text:
                continue
            snippet = self._make_snippet(cached_text, typed)
            if snippet:
                out[entry.path] = snippet
        return out

    @staticmethod
    def _make_snippet(text, query):
        """`text` 裡第一個 `query`（不分大小寫）前後各帶 `_SNIPPET_RADIUS` 字，
        換行／連續空白摺成單一空格，頭尾不是原文邊界就補「…」。找不到回 ""。"""
        idx = text.lower().find(query.lower())
        if idx < 0:
            return ""
        start = max(0, idx - _SNIPPET_RADIUS)
        end = min(len(text), idx + len(query) + _SNIPPET_RADIUS)
        chunk = re.sub(r"\s+", " ", text[start:end]).strip()
        return f"{'…' if start > 0 else ''}{chunk}{'…' if end < len(text) else ''}"
