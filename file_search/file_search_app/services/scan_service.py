"""資料夾掃描——遞迴與副檔名篩選、軟／硬上限、找出未收錄檔案，回傳 ScanResult。

實際掃描過程中「超過軟上限要不要繼續」這種需要跳出對話框詢問使用者、
一邊掃一邊更新進度條的部分，是 UI 層（ui/widgets/scan_widgets.py）的事——
這裡只提供可以被一小批一小批消費的檔案迭代器與純函式，UI 層自己控制節奏，
最後把結果組成 ScanResult 交回來。"""

from pathlib import Path

from file_search_app.config import (
    EXT_CATEGORIES, OTHER_CATEGORY_LABEL, SCAN_HARD_LIMIT, SCAN_SOFT_LIMIT, WATCH_SCAN_CAP,
)
from file_search_app.services.import_service import path_key


class ScanService:
    # 掃描進度視窗（scan_widgets.run_scan_with_progress）讀這兩個當軟／硬上限。
    soft_limit = SCAN_SOFT_LIMIT
    hard_limit = SCAN_HARD_LIMIT
    watch_scan_cap = WATCH_SCAN_CAP
    # 未收錄徽章的背景掃描只數這些副檔名——有分類的那些（文件/圖片/媒體/壓縮），
    # 排除 exe/log/暫存那類不會拿去索引的雜訊，count 才有意義、掃得也快。
    watched_extensions = frozenset(e for _l, _i, exts, _c in EXT_CATEGORIES for e in exts)

    @staticmethod
    def iter_scan_files(folder: Path, recursive: bool, extensions):
        """逐一 yield folder 底下符合條件的檔案（產生器版，不先收集成清單）——給
        需要邊掃邊更新進度、邊掃邊檢查數量門檻的呼叫端用。extensions 是一組小寫
        副檔名（含開頭的點，例如 {'.docx', '.pdf'}），空集合代表不篩選、收錄
        所有檔案。"""
        paths = folder.rglob("*") if recursive else folder.glob("*")
        for p in paths:
            if not p.is_file():
                continue
            if extensions and p.suffix.lower() not in extensions:
                continue
            yield p

    @classmethod
    def iter_jobs(cls, jobs):
        """依序串接多組 (folder, recursive, extensions) 掃描條件成單一迭代器，
        給進度視窗一小批一小批消費。"""
        for folder, recursive, extensions in jobs:
            yield from cls.iter_scan_files(folder, recursive, extensions)

    @staticmethod
    def categorize_counts(files):
        """回傳 [(label, icon, count), ...]，依 EXT_CATEGORIES 定義的順序列出九個
        類別各自的數量，最後多一項「其他」給不屬於任何類別的檔案。"""
        counts = {label: 0 for label, _icon, _exts, _color in EXT_CATEGORIES}
        other = 0
        for p in files:
            ext = Path(p).suffix.lower()
            for label, _icon, exts, _color in EXT_CATEGORIES:
                if ext in exts:
                    counts[label] += 1
                    break
            else:
                other += 1
        result = [(label, icon, counts[label]) for label, icon, _exts, _color in EXT_CATEGORIES]
        result.append((OTHER_CATEGORY_LABEL, "📁", other))
        return result

    @classmethod
    def count_unindexed(cls, folders, existing_keys):
        """背景掃 `folders`（遞迴）數出還沒被任何索引集收錄的可索引檔案數，給
        主視窗的「未收錄徽章」用。`existing_keys` 必須是 `path_key()` 正規化過
        的集合（呼叫端負責）。掃到 `watch_scan_cap` 就停、`truncated=True`。
        純函式、只碰檔案系統，可以安全地丟背景執行緒。

        回傳 `{"count", "scanned", "folder_count", "truncated"}`。"""
        count = 0
        scanned = 0
        truncated = False
        valid = [Path(f) for f in folders if Path(f).is_dir()]
        for folder in valid:
            for p in cls.iter_scan_files(folder, recursive=True, extensions=cls.watched_extensions):
                scanned += 1
                if scanned > cls.watch_scan_cap:
                    truncated = True
                    break
                if path_key(p) not in existing_keys:
                    count += 1
            if truncated:
                break
        return {
            "count": count, "scanned": scanned,
            "folder_count": len(valid), "truncated": truncated,
        }

    @staticmethod
    def find_unindexed(found_files, existing_keys):
        """從掃描結果裡篩出還沒被任何索引集收錄的檔案。`existing_keys` 必須是
        用 import_service.path_key() 正規化過的集合（呼叫端負責），這裡也用
        同一個 key 比對——不然 Windows 上大小寫／斜線不同的同一個檔案會被
        當成「未收錄」重複列出。"""
        return [p for p in found_files if path_key(p) not in existing_keys]
