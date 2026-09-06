"""加入時間、常用資料夾清單——都是獨立於 Markdown 表格之外的附屬資料。

加入時間另存 JSON，不改動既有 Markdown 三欄表格格式。key 先用索引檔名，
再用完整路徑；舊項目沒有紀錄時顯示「—」（由 models.format_added_at 處理）。
常用資料夾清單存純文字（`.known_folders.txt`），每行一個路徑，給「找出未收錄
檔案」的資料夾管理用。
"""

from datetime import datetime
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.repositories.atomic_io import atomic_write_text
from file_search_app.repositories.json_store import read_json, write_json


class MetadataRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.indexes_dir = indexes_dir
        self.added_times_path = indexes_dir / ".added_times.json"
        self.known_folders_path = indexes_dir / ".known_folders.txt"
        # 舊版存的是沒有點前綴的 known_folders.txt（跟其他 app 資料檔的隱藏
        # 慣例不一致）。有舊檔又還沒有新檔就搬過去一次，之後不再理會。
        legacy = indexes_dir / "known_folders.txt"
        if legacy.exists() and not self.known_folders_path.exists():
            try:
                self.known_folders_path.write_text(
                    legacy.read_text(encoding="utf-8"), encoding="utf-8"
                )
                legacy.unlink()
            except OSError:
                self.known_folders_path = legacy  # 搬不動就繼續用舊的，不擋功能

    # ── 加入時間 ─────────────────────────────────────────────────────

    def load_added_times(self) -> dict:
        data = read_json(self.added_times_path, None)
        if not isinstance(data, dict):
            return {}
        # 外層之外，每份索引檔對應的值也必須是 dict（正常是 {路徑: 時間字串}），
        # 結構不對的項目直接捨棄，避免呼叫端對非 dict 值呼叫 .get() 時未接住例外。
        return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, dict)}

    def record_added_time(self, md_path: Path, path_str: str) -> None:
        self.record_added_times(md_path, [path_str])

    def record_added_times(self, md_path: Path, path_strs) -> None:
        """一次記錄多筆的加入時間（同一個時間戳）——整份 .added_times.json
        只讀一次、只寫一次，不是每筆各自 read+write（資料夾匯入上千筆時很有感）。"""
        path_strs = list(path_strs)
        if not path_strs:
            return
        data = self.load_added_times()
        bucket = data.setdefault(md_path.name, {})
        stamp = datetime.now().isoformat(timespec="minutes")
        for path_str in path_strs:
            bucket[path_str] = stamp
        write_json(self.added_times_path, data)

    def get_added_at(self, added_times: dict, md_path: Path, path_str: str):
        """從 load_added_times() 讀回的 dict 裡取出這一筆的加入時間，解析成
        datetime；沒有紀錄或格式壞掉都回傳 None。"""
        raw = added_times.get(md_path.name, {}).get(path_str)
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw)
        except (TypeError, ValueError):
            return None

    def remove_index(self, md_path_name: str) -> None:
        """刪除索引集時一併清掉它在加入時間紀錄裡的那一份，不留孤兒資料。"""
        data = self.load_added_times()
        if md_path_name in data:
            del data[md_path_name]
            write_json(self.added_times_path, data)

    # ── 常用資料夾清單 ───────────────────────────────────────────────

    def load_known_folders(self):
        if not self.known_folders_path.exists():
            return []
        lines = [ln.strip() for ln in self.known_folders_path.read_text(encoding="utf-8").splitlines()]
        return [ln for ln in lines if ln]

    def save_known_folders(self, folders) -> None:
        self.indexes_dir.mkdir(parents=True, exist_ok=True)
        text = "".join(f"{f}\n" for f in folders)
        atomic_write_text(self.known_folders_path, text)
