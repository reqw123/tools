"""AI 服務設定（要用 OpenAI 還是 Ollama、API Key、模型名稱、位址）的讀寫。

非敏感設定（provider、model、base_url、ollama 設定）跟 `.added_times.json`／
`known_folders.txt` 一樣存在 `indexes/` 底下、檔名前面加點——這個工具本來就把
「非使用者手動維護的表格資料，但要跨次執行保留」的輔助狀態都放在同一個地方，
這份資料夾本身就是設計成「可以整包搬到別台電腦、同步到雲端硬碟、跟別人共用」
的可攜資料。

2026-08-19，明碼 API Key 曾經直接跟著存在 `indexes/.ai_settings.json` 裡——這個
檔案在同一個資料夾，只要整份 `indexes/` 被同步到雲端或分享出去，Key 就跟著外
流。API Key 挪到 Windows 的 `%LOCALAPPDATA%`（沒有就退回 `~/.cache`）底下獨立
一個檔案：這個位置本質上就是「這台機器本機的快取/暫存資料」，不屬於使用者文
件、預設不會被 OneDrive 之類的雲端同步工具帶走，也不會被複製到別的地方，性質
上跟「密碼不要跟資料庫放在同一個備份裡」是同一個道理。`load()`/`save()` 對外
的 dict 形狀完全沒變（呼叫端仍然是 `settings["openai"]["api_key"]`），只有實際
落地成兩個檔案這件事對呼叫端透明。

第一次讀取時如果在舊的 `.ai_settings.json` 裡發現殘留的 api_key（既有使用者從
舊版升級上來），會自動搬到新的本機快取檔案、並把舊檔案裡的明碼清空重寫，做一
次性遷移，不需要使用者自己手動處理。
"""

import json
import os
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.repositories.atomic_io import atomic_write_text

DEFAULT_SETTINGS = {
    "provider": "openai",
    "openai": {"api_key": "", "model": "gpt-4o-mini", "base_url": "https://api.openai.com/v1"},
    "ollama": {"base_url": "http://localhost:11434", "model": "llama3.1"},
}


def _default_secrets_dir() -> Path:
    """`%LOCALAPPDATA%`（Windows 本機、非漫遊、不會被 OneDrive Known Folder Move
    帶走的快取路徑）——沒有這個環境變數（非 Windows 環境）才退回 `~/.cache`，
    同樣是作業系統慣例上「本機快取，不隨帳號漫遊/同步」的位置。"""
    local_app_data = os.environ.get("LOCALAPPDATA")
    base = Path(local_app_data) if local_app_data else (Path.home() / ".cache")
    return base / "file_search"


class AISettingsRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR, secrets_dir: Path = None):
        self.path = indexes_dir / ".ai_settings.json"
        self._indexes_dir = indexes_dir
        self._secrets_dir = secrets_dir if secrets_dir is not None else _default_secrets_dir()
        self._secrets_path = self._secrets_dir / "ai_secrets.json"

    def load(self) -> dict:
        """讀取設定；檔案不存在、損毀或結構不對都回傳一份預設值的複本，不拋
        例外——AI 設定是可選功能，設定檔有問題不該讓其餘功能連帶壞掉。"""
        settings = json.loads(json.dumps(DEFAULT_SETTINGS))  # 深複製，避免呼叫端改到共用的預設值
        legacy_key_to_migrate = None

        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = None
            if isinstance(data, dict):
                if data.get("provider") in ("openai", "ollama"):
                    settings["provider"] = data["provider"]
                for key in ("openai", "ollama"):
                    section = data.get(key)
                    if isinstance(section, dict):
                        for field, value in section.items():
                            if field in settings[key] and isinstance(value, str):
                                settings[key][field] = value
                # 舊版殘留的明碼 key（來自遷移前寫下的檔案）——搬走後不再信任
                # 這裡的值，一律以本機快取檔案的內容為準。
                legacy_key = data.get("openai", {}).get("api_key") if isinstance(data.get("openai"), dict) else None
                if isinstance(legacy_key, str) and legacy_key.strip():
                    legacy_key_to_migrate = legacy_key.strip()

        settings["openai"]["api_key"] = self._load_secret_api_key()

        if legacy_key_to_migrate:
            self._save_secret_api_key(legacy_key_to_migrate)
            settings["openai"]["api_key"] = legacy_key_to_migrate
            # 把舊檔案裡的明碼清掉重寫，之後這個檔案就不會再帶著 Key 到處跑了。
            self._save_non_secret_settings(settings)

        return settings

    def save(self, settings: dict) -> None:
        api_key = settings.get("openai", {}).get("api_key", "")
        self._save_secret_api_key(api_key)
        self._save_non_secret_settings(settings)

    def _save_non_secret_settings(self, settings: dict) -> None:
        self._indexes_dir.mkdir(parents=True, exist_ok=True)
        on_disk = json.loads(json.dumps(settings))  # 深複製，不動到呼叫端手上的 dict
        on_disk["openai"]["api_key"] = ""  # 明碼永遠不落地到這個可攜檔案
        atomic_write_text(self.path, json.dumps(on_disk, ensure_ascii=False, indent=1))

    def _load_secret_api_key(self) -> str:
        if not self._secrets_path.exists():
            return ""
        try:
            data = json.loads(self._secrets_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return ""
        if not isinstance(data, dict):
            return ""
        value = data.get("openai_api_key", "")
        return value if isinstance(value, str) else ""

    def _save_secret_api_key(self, api_key: str) -> None:
        self._secrets_dir.mkdir(parents=True, exist_ok=True)
        atomic_write_text(self._secrets_path, json.dumps({"openai_api_key": api_key}, ensure_ascii=False, indent=1))
