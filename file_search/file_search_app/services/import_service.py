"""手動選檔與拖曳共用的驗證流程、路徑正規化，以及資料夾批次匯入。"""

import os
import re
from pathlib import Path


def path_key(path) -> str:
    """把一個路徑（字串或 Path）正規化成「是不是同一個檔案」的比對 key：
    轉絕對路徑 + `os.path.normcase`（Windows 上把大小寫、`/` 與 `\\` 都統一）。

    所有「這個路徑收錄過了沒」的判斷都要用同一個 key——拖曳／「新增檔案」、
    「匯入資料夾」、「找出未收錄檔案」原本各自用不同寫法（有的 `str(Path)`、
    有的 `p.resolve()`、有的完全不正規化），同一個檔案用不同方式指到就可能
    判不出重複，或反過來把明明不同大小寫的同一檔當成兩筆。

    刻意用 `abspath` 而不是 `resolve()`：`resolve()` 會實際去檔案系統解開
    symlink、每個檔案都要 stat 一次，索引一大就慢；symlink 兩路徑指向同一
    檔案是罕見邊角，不值得為它讓每次拖檔都卡。"""
    return os.path.normcase(os.path.abspath(os.fspath(path)))


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
        """把目前索引清單的路徑轉成統一的比對 key（見 path_key），給
        normalize_candidates() 判斷「是不是已經收錄過」用。"""
        return {path_key(e.path) for e in entries}

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
            abspath = os.path.abspath(str(p))
            key = path_key(abspath)
            if key in existing_keys or key in seen:
                duplicates += 1
                continue
            seen.add(key)
            accepted.append(abspath)
        return accepted, missing, folders, duplicates

    def import_folder(self, md_path: Path, files, category: str) -> int:
        """批次匯入資料夾掃描結果——整批套用同一個分類，說明欄留空。索引 .md
        與加入時間紀錄各只寫一次（見 IndexService.add_entries）。回傳新增筆數。"""
        return self._index_service.add_entries(md_path, [str(p) for p in files], category, "")
