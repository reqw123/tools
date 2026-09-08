"""notes-web「⏰ 提醒設定」門檻（`indexes/.notes_settings.json`）的唯讀存取。

這份檔案跟 `.sticky_notes.json` 同一個資料夾，由 notes-web 的
`server/store.ts` 寫入，格式是 `{"dueSoonHours": <小時數>}`。桌面版目前
**只讀不寫**——使用者在 notes-web 那個對話框調整「到期前幾小時算快到期」，
桌面版的到期徽章／「只看快到期」篩選下次重畫時就跟著同一個值，兩邊不再
各用各的門檻。想讓桌面版也能改，再另外補寫入 + 設定 UI（見
`NotesSettingsRepository` 沒有 save_* 是刻意的）。

判讀規則刻意跟 notes-web 的 `getReminderSettings()` 對齊：接受任何有限
正數，範圍把關（1~720）交給寫入端（notes-web 的 `setReminderSettings`）。
"""

import math
from pathlib import Path

from file_search_app.config import (
    INDEXES_DIR, STICKY_DUE_SOON_HOURS_DEFAULT, STICKY_EMBED_MODEL_DEFAULT,
    STICKY_TRASH_MAX_COUNT_DEFAULT, STICKY_TRASH_RETENTION_DAYS_DEFAULT,
)
from file_search_app.repositories.json_store import read_json


def _non_negative_int(value, default: int) -> int:
    """有限、非負的整數就取（浮點也吃、無條件捨去）；否則回 default。0 是
    合法值（＝關掉那道門檻）。"""
    if (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(value)
        and value >= 0
    ):
        return int(value)
    return default

_SETTINGS_FILENAME = ".notes_settings.json"


class NotesSettingsRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.path = indexes_dir / _SETTINGS_FILENAME

    def load_due_soon_hours(self) -> float:
        """「到期前幾小時內算快到期」。檔案不存在／損毀／`dueSoonHours` 不是
        有限正數，都回傳預設值（`STICKY_DUE_SOON_HOURS_DEFAULT`），不拋
        例外——這是次要的顯示偏好，壞掉不該擋住便利貼本身。"""
        data = read_json(self.path, None)
        if isinstance(data, dict):
            value = data.get("dueSoonHours")
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                and value > 0
            ):
                return value
        return STICKY_DUE_SOON_HOURS_DEFAULT

    def load_embed_model(self) -> str:
        """便利貼語意搜尋用的 Ollama embedding 模型名稱。使用者在 notes-web
        「全域設定」調整，寫進同一份 `.notes_settings.json` 的 `embedModel`。
        沒設定／不是非空字串就回預設（`STICKY_EMBED_MODEL_DEFAULT`）。"""
        data = read_json(self.path, None)
        if isinstance(data, dict):
            value = data.get("embedModel")
            if isinstance(value, str) and value.strip():
                return value.strip()
        return STICKY_EMBED_MODEL_DEFAULT

    def load_trash_retention_days(self) -> int:
        """垃圾桶保留天數（deleted_at 超過這麼多天前的自動永久刪）。0＝不依
        時間清。設定檔沒有這個鍵就回預設。"""
        data = read_json(self.path, None)
        raw = data.get("trashRetentionDays") if isinstance(data, dict) else None
        return _non_negative_int(raw, STICKY_TRASH_RETENTION_DAYS_DEFAULT)

    def load_trash_max_count(self) -> int:
        """垃圾桶最多留幾則（超過從最舊的清起）。0＝不限筆數。"""
        data = read_json(self.path, None)
        raw = data.get("trashMaxCount") if isinstance(data, dict) else None
        return _non_negative_int(raw, STICKY_TRASH_MAX_COUNT_DEFAULT)
