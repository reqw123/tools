"""內容快取的更新邏輯——決定「什麼時候要重算」，串接 IndexRepository（要更新
哪些路徑）、CacheRepository（雜湊計算與快取存取）、PreviewService（擷取文字）。

由「更新內容快取」按鈕與「重複偵測」共用：兩者都需要先確保每個索引項目的
SHA-256／擷取文字是最新的，差別只在後續要拿這份快取做全文搜尋還是分組比對。

這裡的方法可以安全地在背景執行緒呼叫——不接觸任何 Tkinter 物件，
progress_cb 只會收到單純的數字／字串，UI 端自己決定怎麼把這些數字送回
主執行緒（通常是丟進 queue.Queue，再由主執行緒的 after() 輪詢取出更新畫面）。
"""

from pathlib import Path

from file_search_app.repositories.cache_repository import HASH_ALGO, CACHE_TEXT_CHARS
from file_search_app.services.preview_service import PreviewService


class CacheService:
    def __init__(self, index_repo, cache_repo, preview_service: PreviewService):
        self._index_repo = index_repo
        self._cache_repo = cache_repo
        self._preview_service = preview_service

    def refresh_entry(self, path_str: str, cache: dict) -> bool:
        """每次手動更新都重新驗證 SHA-256；必要時同步更新文字快取。回傳這一筆
        是否真的有變動（沒變動就不用整份快取重寫）。"""
        p = Path(path_str)
        if not p.exists():
            if path_str in cache:
                del cache[path_str]
                return True
            return False
        try:
            stat = p.stat()
        except OSError:
            return False
        old = cache.get(path_str)
        new_hash = self._cache_repo.compute_file_hash(p)
        unchanged = (
            old
            and old.get("hash_algo") == HASH_ALGO
            and old.get("hash") == new_hash
            and old.get("mtime") == stat.st_mtime
            and old.get("size") == stat.st_size
        )
        if unchanged:
            return False
        entry = {
            "mtime": stat.st_mtime, "size": stat.st_size,
            "hash": new_hash, "hash_algo": HASH_ALGO, "text": "",
        }
        # extract_preview_text() 自己會判斷這個副檔名／內容值不值得當文字讀
        # （已知二進位格式直接跳過、其餘用內容偵測），這裡不用再靠副檔名白
        # 名單先篩一次——「所有檔案類型」都有機會被收進全文搜尋的快取裡。
        try:
            entry["text"] = self._preview_service.extract_preview_text(p, max_chars=CACHE_TEXT_CHARS) or ""
        except Exception:
            entry["text"] = ""
        cache[path_str] = entry
        return True

    def update_cache_for_index(self, md_path: Path, progress_cb=None) -> dict:
        """更新一份索引檔案對應的內容快取，回傳更新後的完整 cache 字典（也會寫回
        磁碟）。progress_cb(done, total) 可選，用來回報進度。"""
        entries = self._index_repo.load_entries(md_path)
        cache = self._cache_repo.load(md_path)
        total = len(entries)
        processed_paths = set()
        for i, entry in enumerate(entries):
            # 同一路徑可能在索引中重複出現；一次更新只需實際讀檔／計算 SHA-256 一次。
            if entry.path not in processed_paths:
                self.refresh_entry(entry.path, cache)
                processed_paths.add(entry.path)
            if progress_cb:
                progress_cb(i + 1, total)
        # 順便清掉已經不在索引裡的舊快取項目，避免快取檔案無限長大
        valid_paths = {e.path for e in entries}
        for stale in [p for p in cache if p not in valid_paths]:
            del cache[stale]
        self._cache_repo.save(md_path, cache)
        return cache

    def update_cache_for_indexes(self, files, progress_cb=None) -> None:
        """依序更新多份索引檔案的快取，progress_cb(overall, grand_total, fname, done, total)
        回報跨檔案的整體進度——跟 update_cache_for_index() 的差別是這個會算好
        「目前這份檔案之前已經處理過幾筆」的偏移量，讓進度條可以顯示總進度。"""
        totals = {f: len(self._index_repo.load_entries(f)) for f in files}
        grand_total = sum(totals.values())
        completed_before = 0
        for f in files:
            def cb(done, total, fname=f.name, offset=completed_before):
                if progress_cb:
                    progress_cb(offset + done, grand_total, fname, done, total)
            self.update_cache_for_index(f, progress_cb=cb)
            completed_before += totals[f]
