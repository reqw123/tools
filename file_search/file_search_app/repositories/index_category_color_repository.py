"""索引項目「分類」的自訂顏色（`indexes/.index_category_colors.json`）。

跟 files-web 的 `category-colors` 路由共用同一份檔案、同格式
（`{"<分類>": "#rrggbb", ...}`），比照便利貼的 `.sticky_tag_colors.json`：
獨立小檔案，是顯示偏好、不是索引資料本身，壞掉互不牽連（讀不到就整包當
沒有，分類色點退回名稱雜湊配色）。

桌面版目前**只讀**（`IndexTree` 的色點優先用自訂色，沒有才 `hash_hsl_hex`）；
挑色 UI 在 files-web。要在桌面也能改，再補 `set_color` 的呼叫端 + UI。
"""

import re
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.repositories.json_store import read_json, write_json

_FILENAME = ".index_category_colors.json"
# 只認 #rrggbb（跟 files-web 的 HEX_COLOR_RE 同一條規則）——檔案是跟 files-web
# 共用、也可能被手動編輯的，格式不對的值直接當沒設定。
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class IndexCategoryColorRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.path = indexes_dir / _FILENAME

    def load(self) -> dict:
        """分類→自訂顏色（hex）對照表；沒自訂過的分類不會在這裡，交由呼叫端
        退回雜湊配色。檔案不存在／壞掉都回空字典，不拋例外。"""
        data = read_json(self.path, None)
        if isinstance(data, dict):
            return {
                k: v for k, v in data.items()
                if isinstance(k, str) and isinstance(v, str) and _HEX_COLOR_RE.match(v)
            }
        return {}

    def save(self, colors: dict) -> None:
        write_json(self.path, colors)

    def set_color(self, category: str, color: str) -> dict:
        category = (category or "").strip()
        if not category or not _HEX_COLOR_RE.match(color or ""):
            return self.load()
        colors = self.load()
        colors[category] = color
        self.save(colors)
        return colors

    def clear_color(self, category: str) -> dict:
        category = (category or "").strip()
        colors = self.load()
        if category in colors:
            del colors[category]
            self.save(colors)
        return colors
