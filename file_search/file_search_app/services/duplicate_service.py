"""重複檔案偵測——串流計算 SHA-256（透過 CacheService 重新驗證）、依大小與
SHA-256 分組、跨索引集偵測、產生應保留及應移除的索引列。只刪索引紀錄，
不會刪除實體檔案（實際刪除動作委派回 IndexService，跟批次刪除共用同一套
「依來源檔案分組、精確依 row_index 刪除」邏輯）。"""

from collections import defaultdict

from file_search_app.models import DuplicateGroup
from file_search_app.repositories.cache_repository import HASH_ALGO


class DuplicateService:
    def __init__(self, index_repo, cache_repo, cache_service, index_service):
        self._index_repo = index_repo
        self._cache_repo = cache_repo
        self._cache_service = cache_service
        self._index_service = index_service

    def refresh_and_group(self, files, progress_cb=None):
        """按下「重複偵測」時的完整流程：先重新驗證全部索引項目的 SHA-256
        （避免新加入的檔案尚未建立快取，或內容變更後仍沿用舊結果漏判），
        再依大小＋SHA-256 分組。可在背景執行緒呼叫，不接觸 Tkinter。"""
        self._cache_service.update_cache_for_indexes(files, progress_cb=progress_cb)
        return self.group(files)

    def group(self, files):
        """假設快取已經是最新的，單純依 (size, sha256) 分組，回傳只含「真的有
        重複」（同組 2 筆以上）的 DuplicateGroup 清單。"""
        by_hash = defaultdict(list)
        for f in files:
            cache = self._cache_repo.load(f)
            for entry in self._index_repo.load_entries(f):
                cached = cache.get(entry.path, {})
                h = cached.get("hash")
                if h and cached.get("hash_algo") == HASH_ALGO:
                    key = (cached.get("size"), h)
                    by_hash[key].append(entry)
        groups = []
        for (size, sha256), entries in by_hash.items():
            if len(entries) > 1:
                groups.append(DuplicateGroup(size=size, sha256=sha256, entries=entries))
        return groups

    def remove_entries(self, entries) -> int:
        """entries 是使用者在每組裡選擇「不保留」的那些 IndexEntry；只移除索引
        紀錄，不動實際檔案。"""
        return self._index_service.delete_entries(entries)
