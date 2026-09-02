"""雜項介面偏好設定的讀寫——跟 `.ai_settings.json`／`.sticky_notes.json` 同一套
慣例，存在 `indexes/` 底下、檔名前加點的全域 JSON（不綁定任何一份索引集）。

目前只放「影片方向鍵跳轉秒數」一項；之後有其他「單一數值／開關」型的介面
偏好（不值得為它各開一個檔）都可以塞進這裡的巢狀結構。內容不含機密，不需要
比照 AI API Key 搬到本機快取目錄。
"""

import json
from pathlib import Path

from file_search_app.config import (
    HELP_FONT_DELTA_MAX, HELP_FONT_DELTA_MIN, INDEXES_DIR,
    MEDIA_SEEK_SECONDS_DEFAULT, MEDIA_SEEK_SECONDS_MAX, MEDIA_SEEK_SECONDS_MIN,
)
from file_search_app.repositories.atomic_io import atomic_write_text


class AppPrefsRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.path = indexes_dir / ".app_prefs.json"

    def load_seek_seconds(self) -> int:
        """影片左右鍵一次跳轉幾秒。檔案不存在／損毀／值超出範圍都回傳預設值，
        不拋例外——這是可有可無的偏好，壞掉不該影響主視窗。"""
        raw = self._read().get("media", {})
        value = raw.get("seek_seconds")
        if not isinstance(value, int) or isinstance(value, bool):
            return MEDIA_SEEK_SECONDS_DEFAULT
        return max(MEDIA_SEEK_SECONDS_MIN, min(MEDIA_SEEK_SECONDS_MAX, value))

    def save_seek_seconds(self, seconds: int) -> None:
        seconds = max(MEDIA_SEEK_SECONDS_MIN, min(MEDIA_SEEK_SECONDS_MAX, int(seconds)))
        data = self._read()
        data.setdefault("media", {})["seek_seconds"] = seconds
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(self.path, json.dumps(data, ensure_ascii=False, indent=1))

    def load_help_font_delta(self) -> int:
        """功能介紹面板的字級增減量。檔案不存在／損毀／值超出範圍都回傳 0
        （＝預設字級），不拋例外——可有可無的偏好，壞掉不該影響主視窗。"""
        value = self._read().get("help", {}).get("font_delta")
        if not isinstance(value, int) or isinstance(value, bool):
            return 0
        return max(HELP_FONT_DELTA_MIN, min(HELP_FONT_DELTA_MAX, value))

    def save_help_font_delta(self, delta: int) -> None:
        delta = max(HELP_FONT_DELTA_MIN, min(HELP_FONT_DELTA_MAX, int(delta)))
        data = self._read()
        data.setdefault("help", {})["font_delta"] = delta
        self.path.parent.mkdir(parents=True, exist_ok=True)
        atomic_write_text(self.path, json.dumps(data, ensure_ascii=False, indent=1))

    def _read(self) -> dict:
        if not self.path.exists():
            return {}
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}
