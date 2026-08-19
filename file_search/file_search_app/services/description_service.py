"""批次補充說明——找出說明是空的項目，用內容擷取邏輯產生建議文字。實際套用
（寫回索引）委派給 IndexService，這裡只負責「產生建議」這件事，可在背景
執行緒安全呼叫（不接觸 Tkinter；取消用呼叫端傳入的 cancel_check() 判斷，
不直接依賴 threading.Event 型別，方便測試）。"""

from pathlib import Path

from file_search_app.config import IMAGE_EXTS
from file_search_app.services.preview_service import PreviewService


class DescriptionService:
    def __init__(self, preview_service: PreviewService, index_service):
        self._preview_service = preview_service
        self._index_service = index_service

    def find_blank_entries(self, entries):
        return [e for e in entries if not e.description.strip()]

    def build_suggestion(self, entry, cache: dict):
        """回傳這筆項目的建議說明文字；檔案目前找不到就回傳 None（呼叫端應該
        跳過這筆，沒有內容可以建議）。圖片類型不擷取文字（沒有意義），回傳
        空字串讓使用者自己填。"""
        p = Path(entry.path)
        if not p.exists():
            return None
        if self._preview_service.has_pil and p.suffix.lower() in IMAGE_EXTS:
            return ""
        cached = cache.get(entry.path, {}).get("text", "")
        try:
            text = cached[:1200] if cached else (self._preview_service.extract_preview_text(p, max_chars=1200) or "")
        except Exception:
            text = ""
        return "\n".join(line.strip() for line in text.splitlines() if line.strip())

    def generate_suggestions(self, blanks, cache: dict, progress_cb=None, cancel_check=None):
        """blanks 是 find_blank_entries() 找出的項目清單；逐一產生建議說明。
        cancel_check() 回傳 True 時提前中止。progress_cb(done, filename) 可選，
        用來回報進度。回傳 (suggestions, cancelled)，suggestions 是
        [(IndexEntry, suggestion_text), ...]，只包含檔案目前還存在的項目。"""
        suggestions = []
        for done, entry in enumerate(blanks, start=1):
            if cancel_check and cancel_check():
                return suggestions, True
            suggestion = self.build_suggestion(entry, cache)
            if suggestion is not None:
                suggestions.append((entry, suggestion))
            if progress_cb:
                progress_cb(done, entry.name)
        return suggestions, False

    def apply_updates(self, updates) -> int:
        """updates: [(IndexEntry, desc), ...]——分類沿用該筆原本的分類，批次補
        說明只補說明欄，不動分類。回傳實際更新了幾筆。"""
        return self._index_service.update_entries(
            [(entry, entry.category, desc) for entry, desc in updates]
        )
