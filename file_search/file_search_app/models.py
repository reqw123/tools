"""資料模型 —— 不依賴 Tkinter，純粹描述資料形狀。"""

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Optional


@dataclass
class IndexEntry:
    """索引裡的一列資料，對應 Markdown 表格的一列。

    `path` 刻意維持成寫在索引檔案裡的原始字串，不透過 `Path()` 正規化——
    內容快取／加入時間紀錄都是拿這個原始字串當 key 比對，正規化後分隔符號
    或大小寫一旦改變，就會查不到對應的快取或時間紀錄。需要 `Path` 操作
    （判斷是否存在、取檔名、取上層資料夾）時用 `path_obj`。

    `row_index` 是這一列在 `source_index` 檔案裡的 0-based 資料列序號（只算
    可解析的資料列），精確編輯／刪除都靠它定位，不受同一路徑重複出現影響。

    `serial` 是顯示用的流水號：每份索引集從 1 開始，「全部索引」聚合模式下
    依合併順序連續編號；由 IndexService 在載入整份清單時一次指定，搜尋／
    篩選只決定要不要顯示，不會重新指定。
    """

    path: str
    category: str
    description: str
    source_index: Path
    row_index: int
    serial: int = 0
    added_at: Optional[datetime] = None

    @property
    def path_obj(self) -> Path:
        return Path(self.path)

    @property
    def name(self) -> str:
        return self.path_obj.name

    @property
    def exists(self) -> bool:
        return self.path_obj.exists()


@dataclass
class DuplicateGroup:
    """依檔案大小＋SHA-256 分組出的一組內容完全相同的索引項目。"""

    size: Optional[int]
    sha256: str
    entries: list  # list[IndexEntry]


@dataclass
class ScanResult:
    """一次資料夾掃描（含軟／硬上限判斷）的結果。"""

    files: list  # list[Path]，依路徑排序、跨 jobs 去重過
    write_blocked: bool  # True 代表這次結果不能拿去寫入索引（超過安全筆數，或掃描不完整）
    stopped_early: bool  # True 代表使用者主動中止（取消，或詢問時選「否」），files 不是完整結果
    hit_hard_limit: bool  # True 代表是撞到硬上限才停下來的


def format_added_at(added_at: Optional[datetime]) -> str:
    """把 IndexEntry.added_at 格式化成清單／搜尋要用的顯示字串；沒有紀錄回傳「—」。"""
    if added_at is None:
        return "—"
    return f"{added_at.month}/{added_at.day} {added_at:%H:%M}"
