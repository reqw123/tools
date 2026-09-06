"""重複檔案偵測——依檔案大小＋SHA-256 分組、跨索引集偵測，產生應保留及應
移除的索引列。只刪索引紀錄，不會刪除實體檔案（實際刪除動作委派回
IndexService，跟批次刪除共用同一套「依來源檔案分組、精確依 row_index 刪除」
邏輯）。

按下「重複偵測」時要先重新驗證全部項目的 SHA-256（避免漏判新加入或內容
變更過的檔案）——那一步由 UI 層透過 CacheService 跑（它要一併顯示進度視窗），
這裡的 group() 假設快取已經是最新的。"""

from collections import defaultdict

from file_search_app.models import DuplicateGroup
from file_search_app.repositories.cache_repository import HASH_ALGO


class DuplicateService:
    def __init__(self, index_repo, cache_repo, index_service):
        self._index_repo = index_repo
        self._cache_repo = cache_repo
        self._index_service = index_service

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
