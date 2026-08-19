"""手動選檔與拖曳共用的驗證流程、路徑正規化，以及資料夾批次匯入。"""

import os
import re
from pathlib import Path


class ImportService:
    def __init__(self, index_service):
        self._index_service = index_service

    @staticmethod
    def parse_dnd_paths(data: str):
        """tkinterdnd2 的 event.data：多個路徑用空白分隔，路徑本身含空白時會用
        大括號 {} 包起來，例如 '{C:/a b/c.txt} C:/d.txt'。"""
        paths = []
        for m in re.finditer(r"\{([^}]*)\}|(\S+)", data):
            p = m.group(1) if m.group(1) is not None else m.group(2)
            if p:
                paths.append(p)
        return paths

    @staticmethod
    def existing_path_keys(entries):
        """把目前索引清單的路徑轉成統一的比對 key（絕對路徑＋大小寫正規化），
        給 normalize_candidates() 判斷「是不是已經收錄過」用。"""
        return {
            os.path.normcase(os.path.abspath(str(Path(e.path))))
            for e in entries
        }

    def normalize_candidates(self, raw_paths, existing_keys):
        """拖曳／「新增檔案...」共用的唯一驗證流程：排除不存在、不是檔案（資料夾）、
        重複選取、已收錄過的路徑。回傳 (accepted, missing, folders, duplicates)：
        accepted 是可以真的拿去新增的完整路徑字串清單，其餘三個是被排除的筆數。"""
        accepted = []
        seen = set()
        missing = 0
        folders = 0
        duplicates = 0
        for raw in raw_paths:
            p = Path(raw).expanduser()
            if not p.exists():
                missing += 1
                continue
            if not p.is_file():
                folders += 1
                continue
            resolved = str(p.resolve())
            key = os.path.normcase(os.path.abspath(resolved))
            if key in existing_keys or key in seen:
                duplicates += 1
                continue
            seen.add(key)
            accepted.append(resolved)
        return accepted, missing, folders, duplicates

    def import_folder(self, md_path: Path, files, category: str) -> int:
        """批次匯入資料夾掃描結果——整批套用同一個分類，說明欄留空。回傳新增筆數。"""
        for p in files:
            self._index_service.add_entry(md_path, str(p), category, "")
        return len(files)
