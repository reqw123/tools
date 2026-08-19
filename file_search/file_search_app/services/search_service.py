"""搜尋、分類、資料夾篩選——輸入是 IndexService.load_all_entries() 已經組好
流水號的完整清單，這裡只負責「這筆要不要顯示」，不會重新指定流水號，維持
「搜尋或篩選後保留原序號」的行為。"""

from pathlib import Path

from file_search_app.models import format_added_at


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
            name = Path(entry.path).name
            added_display = format_added_at(entry.added_at)
            haystack = f"{entry.serial}\n{name}\n{entry.category}\n{entry.description}\n{entry.path}\n{added_display}".lower()
            cached_text = cache.get(entry.path, {}).get("text")
            if cached_text:
                haystack += "\n" + cached_text.lower()
            if typed and typed not in haystack:
                continue
            results.append(entry)
        return results
