"""AI 呼叫次數的輕量統計——「AI 批次說明」跟便利貼「AI 搜尋」共用同一顆計數
器，讓使用者至少能感知「這個 app 到目前為止總共呼叫過幾次 AI」，即使不知道
確切花費（不同 Provider／模型計費方式不一樣，這裡也沒有串接任何帳單 API）。

獨立成自己的檔案，不是塞進 `.ai_settings.json`——那個檔案的 `save()` 是
整個 dict 覆寫（見該檔案的說明），使用者存 AI 設定（換 Provider／改模型）時
會用新的 settings dict 整個蓋過去，混進去的話計數器會在使用者存設定的當下
被意外清空，跟「持續累計」的用途互相矛盾。"""

import json
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.repositories.atomic_io import atomic_write_text


class AIUsageRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.path = indexes_dir / ".ai_usage.json"

    def load_call_count(self) -> int:
        """檔案不存在、損毀或內容不對都回傳 0，不拋例外——這只是輔助用的
        使用量提示，不該讓這個功能本身的問題連帶擋住其他 AI 功能。"""
        if not self.path.exists():
            return 0
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return 0
        count = data.get("ai_call_count") if isinstance(data, dict) else None
        return count if isinstance(count, int) and count >= 0 else 0

    def increment_call_count(self, by: int = 1) -> int:
        """回傳累加後的新值，方便呼叫端直接顯示。"""
        new_count = self.load_call_count() + max(1, by)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(self.path, json.dumps({"ai_call_count": new_count}, ensure_ascii=False, indent=1))
        return new_count
