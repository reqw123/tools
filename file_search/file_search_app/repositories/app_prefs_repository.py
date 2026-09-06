"""雜項介面偏好設定的讀寫——跟 `.ai_settings.json`／`.sticky_notes.json` 同一套
慣例，存在 `indexes/` 底下、檔名前加點的全域 JSON（不綁定任何一份索引集）。

目前只放「影片方向鍵跳轉秒數」一項；之後有其他「單一數值／開關」型的介面
偏好（不值得為它各開一個檔）都可以塞進這裡的巢狀結構。內容不含機密，不需要
比照 AI API Key 搬到本機快取目錄。
"""

from pathlib import Path

from file_search_app.config import (
    HELP_FONT_DELTA_MAX, HELP_FONT_DELTA_MIN, INDEXES_DIR,
    MEDIA_SEEK_SECONDS_DEFAULT, MEDIA_SEEK_SECONDS_MAX, MEDIA_SEEK_SECONDS_MIN,
)
from file_search_app.repositories.json_store import read_json, write_json


class AppPrefsRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.path = indexes_dir / ".app_prefs.json"

    def load_seek_seconds(self) -> int:
        """影片左右鍵一次跳轉幾秒。檔案不存在／損毀／值超出範圍都回傳預設值，
        不拋例外——這是可有可無的偏好，壞掉不該影響主視窗。"""
        value = self._section("media").get("seek_seconds")
        if not isinstance(value, int) or isinstance(value, bool):
            return MEDIA_SEEK_SECONDS_DEFAULT
        return max(MEDIA_SEEK_SECONDS_MIN, min(MEDIA_SEEK_SECONDS_MAX, value))

    def save_seek_seconds(self, seconds: int) -> None:
        seconds = max(MEDIA_SEEK_SECONDS_MIN, min(MEDIA_SEEK_SECONDS_MAX, int(seconds)))
        data = self._read()
        if not isinstance(data.get("media"), dict):
            data["media"] = {}
        data["media"]["seek_seconds"] = seconds
        write_json(self.path, data)

    def load_help_font_delta(self) -> int:
        """功能介紹面板的字級增減量。檔案不存在／損毀／值超出範圍都回傳 0
        （＝預設字級），不拋例外——可有可無的偏好，壞掉不該影響主視窗。"""
        value = self._section("help").get("font_delta")
        if not isinstance(value, int) or isinstance(value, bool):
            return 0
        return max(HELP_FONT_DELTA_MIN, min(HELP_FONT_DELTA_MAX, value))

    def save_help_font_delta(self, delta: int) -> None:
        delta = max(HELP_FONT_DELTA_MIN, min(HELP_FONT_DELTA_MAX, int(delta)))
        data = self._read()
        if not isinstance(data.get("help"), dict):
            data["help"] = {}
        data["help"]["font_delta"] = delta
        write_json(self.path, data)

    def _read(self) -> dict:
        data = read_json(self.path, {})
        return data if isinstance(data, dict) else {}

    def _section(self, name: str) -> dict:
        """取出某一組設定的子 dict。手動改壞的檔案裡這個 key 可能對到字串／
        數字／null 而不是 dict——一律當成空的，不要讓呼叫端對非 dict 呼叫
        .get() 時炸在 MainWindow.__init__ 讓整個程式開不起來。"""
        section = self._read().get(name)
        return section if isinstance(section, dict) else {}
