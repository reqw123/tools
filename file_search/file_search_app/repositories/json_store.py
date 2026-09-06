"""JSON 讀寫的共用樣板——`indexes/` 底下每個 `.xxx.json` 的 Repository 都用
這兩個，不各自重寫「檔案不存在／損毀就回預設值」跟「mkdir ＋ 原子寫入」。

形狀驗證（最外層是不是 dict、每個 value 是什麼型別）**留給呼叫端**——每個
檔案期望的結構不一樣，這裡只負責「拿到 parse 過的東西，或拿到預設值」。
"""

import json
from pathlib import Path

from file_search_app.repositories.atomic_io import atomic_write_text


def read_json(path: Path, default):
    """回傳 parse 後的內容；檔案不存在、不是合法 JSON、或讀取失敗都回傳
    `default`（原樣回傳、不複製——呼叫端如果會就地修改，自己負責 copy）。"""
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def write_json(path: Path, obj) -> None:
    """建好上層資料夾後原子寫入，格式統一 `ensure_ascii=False, indent=1`。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_text(path, json.dumps(obj, ensure_ascii=False, indent=1))
