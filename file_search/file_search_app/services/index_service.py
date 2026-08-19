"""索引集建立、刪除、項目管理——搭配 IndexRepository（Markdown 讀寫）、
CacheRepository（刪索引集時一併清快取）、MetadataRepository（加入時間），
組成 UI 實際會呼叫的「一個動作」。"""

from collections import defaultdict
from pathlib import Path

from file_search_app.config import ALL_INDEXES_LABEL
from file_search_app.models import IndexEntry


class IndexService:
    def __init__(self, index_repo, cache_repo, metadata_repo):
        self._index_repo = index_repo
        self._cache_repo = cache_repo
        self._metadata_repo = metadata_repo

    # ── 索引集 ───────────────────────────────────────────────────────

    def list_index_files(self):
        return self._index_repo.list_index_files()

    def ensure_default_index(self) -> None:
        self._index_repo.ensure_default_index()

    def validate_name(self, raw: str):
        return self._index_repo.validate_name(raw)

    def create_index(self, filename: str) -> Path:
        return self._index_repo.create_index_file(filename)

    def delete_index(self, md_path: Path) -> None:
        """刪除一份索引集及其附屬資料（內容快取、加入時間紀錄），但絕不碰索引
        指向的實體檔案。"""
        self._index_repo.delete_index_file(md_path)
        self._cache_repo.delete(md_path)
        self._metadata_repo.remove_index(md_path.name)

    def entry_count(self, md_path: Path) -> int:
        return len(self._index_repo.load_entries(md_path))

    def resolve_scope_files(self, current_index_path):
        """目前檢視範圍牽涉到的索引檔案清單——單一索引模式就是那一份，「全部
        索引」聚合模式就是全部 .md 檔案，供「清除失效項目」「批次刪除」這種
        原本針對單一檔案、現在要能在聚合檢視下也對全部檔案生效的操作共用。"""
        if current_index_path is not None:
            return [current_index_path]
        return self._index_repo.list_index_files()

    def all_entries_in(self, files):
        """回傳這些檔案裡的全部資料列，跨檔案簡單串接（不計算 serial／
        added_at，純粹給「這個路徑是否已經被收錄過」這類判斷用，例如「找出
        未收錄檔案」要比對全部索引集聯集時，不受目前畫面上選了哪一份索引集
        影響）。"""
        result = []
        for f in files:
            result.extend(self._index_repo.load_entries(f))
        return result

    # ── 載入目前檢視範圍的完整清單 ───────────────────────────────────

    def load_all_entries(self, current_index_path):
        """回傳 (entries, cache, status_text)。

        entries 依目前選擇（單一索引集，或「全部索引」聚合模式）組成，每筆都
        記得自己實際來自哪一份索引檔案（IndexEntry.source_index）、在該檔案裡
        的 0-based 資料列序號（row_index，單筆編輯／刪除都靠它精確定位，不會
        因為同一路徑在同一份索引重複出現而牽連到其他列），以及顯示用流水號
        （serial：每份索引集從 1 開始；聚合模式下依合併順序連續編號，往後不管
        怎麼搜尋／篩選都不會重新指定）。

        cache 是牽涉到的索引檔案各自內容快取的合併結果，供全文檢索使用。
        """
        added_times = self._metadata_repo.load_added_times()
        if current_index_path is None:
            files = self._index_repo.list_index_files()
            entries = []
            serial = 1
            for f in files:
                for entry in self._index_repo.load_entries(f):
                    entry.serial = serial
                    entry.added_at = self._metadata_repo.get_added_at(added_times, f, entry.path)
                    entries.append(entry)
                    serial += 1
            status = f"📑 全部索引（跨 {len(files)} 份檔案，共 {len(entries)} 筆）"
        else:
            files = [current_index_path]
            entries = []
            for serial, entry in enumerate(self._index_repo.load_entries(current_index_path), start=1):
                entry.serial = serial
                entry.added_at = self._metadata_repo.get_added_at(added_times, current_index_path, entry.path)
                entries.append(entry)
            status = f"📑 {current_index_path.name}（{len(entries)} 筆）"

        cache = {}
        for f in files:
            cache.update(self._cache_repo.load(f))
        return entries, cache, status

    # ── 單筆新增／編輯／刪除 ─────────────────────────────────────────

    def add_entry(self, md_path: Path, path_str: str, category: str, desc: str) -> None:
        self._index_repo.append_row(md_path, path_str, category, desc)
        try:
            self._metadata_repo.record_added_time(md_path, path_str)
        except OSError:
            pass  # 時間附加資料寫入失敗不應回滾已成功加入的索引列

    def update_entry(self, entry: IndexEntry, category: str, desc: str) -> bool:
        """精確更新指定那一列（用 row_index 定位），路徑本身不變。"""
        return self._index_repo.update_row_by_occurrence(entry.source_index, entry.row_index, category, desc)

    def delete_entry(self, entry: IndexEntry) -> bool:
        removed, new_text = self._index_repo.remove_rows_by_occurrences(entry.source_index, {entry.row_index})
        if not removed:
            return False
        self._index_repo.write_text(entry.source_index, new_text)
        return True

    def delete_entries(self, entries) -> int:
        """批次刪除——依每筆實際的來源索引檔案分組，各自只寫一次；用 row_index
        （而不是路徑）分組，同一路徑在同一份索引重複出現時，只會刪掉真正被
        指定的那幾列，不會連帶刪掉沒被指定的相同路徑列。"""
        by_origin = defaultdict(set)
        for entry in entries:
            by_origin[entry.source_index].add(entry.row_index)
        total_removed = 0
        for origin, row_indexes in by_origin.items():
            removed, new_text = self._index_repo.remove_rows_by_occurrences(origin, row_indexes)
            if removed:
                self._index_repo.write_text(origin, new_text)
                total_removed += removed
        return total_removed

    # ── 清除失效項目 ─────────────────────────────────────────────────

    def preview_cleanup(self, files):
        """算出每份檔案裡「路徑已經找不到檔案」的資料列要移除幾筆、移除後的新
        內容——只計算，不寫入，讓 UI 可以先把總筆數顯示給使用者確認過，再呼叫
        apply_cleanup() 真正套用。回傳 [(md_path, removed_count, new_text), ...]，
        只包含真的有東西要移除的檔案。"""
        pending = []
        for f in files:
            removed, new_text = self._index_repo.remove_missing_rows(f)
            if removed:
                pending.append((f, removed, new_text))
        return pending

    def apply_cleanup(self, pending) -> int:
        total = 0
        for md_path, removed, new_text in pending:
            self._index_repo.write_text(md_path, new_text)
            total += removed
        return total

    # ── 補充說明／重複偵測共用的批次列更新 ─────────────────────────────

    def update_entries(self, updates) -> int:
        """updates: [(IndexEntry, category, desc), ...]；回傳實際更新了幾筆。"""
        total = 0
        for entry, category, desc in updates:
            if self.update_entry(entry, category, desc):
                total += 1
        return total

    def is_aggregate_choice(self, choice: str) -> bool:
        return choice == ALL_INDEXES_LABEL
