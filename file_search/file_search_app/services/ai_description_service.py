"""用 AI（OpenAI／Ollama）批次為缺說明的檔案產生建議說明——跟
`description_service.py` 的差別：那個是把檔案內容開頭幾句話直接當建議
（純本地、瞬間完成、不需要任何設定）；這個是把擷取到的內容（文字檔送文字、
圖片送縮小過的圖檔給支援視覺的模型）送給 LLM，請它歸納成一段說明，需要先
在「AI 設定」設好 Provider 才能用，也可能因為網路／額度／模型問題而失敗。

兩者是互補的選項，不是取代關係：批次補說明審核視窗裡兩種建議都能用，AI
產生的仍然要人工看過、可編輯、可以不套用，跟一般批次補說明的審核流程一樣。

依 UI 的確認結果決定要不要送出（尤其 OpenAI 這種內容會離開本機的雲端
服務），本身完全不彈 messagebox、不知道 Tkinter，方便在背景執行緒安全呼叫。

圖片走 Provider 的 generate_image_description()（vision）；音訊／影片目前
沒有對應的轉錄能力，一律當作「沒有可摘要的內容」略過，不會嘗試呼叫 AI。
"""

from pathlib import Path

from file_search_app.ai.base import AIProviderError
from file_search_app.ai.ollama_provider import OllamaProvider
from file_search_app.ai.openai_provider import OpenAIProvider
from file_search_app.config import IMAGE_EXTS
from file_search_app.repositories.cache_repository import CACHE_TEXT_CHARS


class AIDescriptionService:
    def __init__(self, ai_settings_repo, preview_service):
        self._settings_repo = ai_settings_repo
        self._preview_service = preview_service

    # ── 設定狀態 ─────────────────────────────────────────────────────

    def is_configured(self):
        """回傳 (可用, 原因)——原因只在不可用時有意義，給 UI 直接顯示。"""
        settings = self._settings_repo.load()
        provider = settings.get("provider")
        if provider == "openai":
            if not settings.get("openai", {}).get("api_key", "").strip():
                return False, "尚未設定 OpenAI API Key"
        elif provider == "ollama":
            if not settings.get("ollama", {}).get("base_url", "").strip():
                return False, "尚未設定 Ollama 服務位址"
        else:
            return False, "尚未選擇 AI Provider"
        return True, ""

    def is_cloud_provider(self) -> bool:
        return self._settings_repo.load().get("provider") == "openai"

    def current_provider_label(self) -> str:
        provider = self._settings_repo.load().get("provider")
        return "OpenAI" if provider == "openai" else "Ollama（本機）"

    def build_provider(self, settings: dict = None):
        """依設定建立對應的 Provider 客戶端；settings 省略時讀取目前存檔的
        設定，傳入 settings 則用來測試「還沒儲存」的欄位值（AI 設定視窗的
        「測試連線」用這個）。設定不完整會拋出 AIProviderError。"""
        settings = settings if settings is not None else self._settings_repo.load()
        provider = settings.get("provider")
        if provider == "openai":
            cfg = settings.get("openai", {})
            return OpenAIProvider(
                api_key=cfg.get("api_key", ""), model=cfg.get("model", ""), base_url=cfg.get("base_url", ""),
            )
        if provider == "ollama":
            cfg = settings.get("ollama", {})
            return OllamaProvider(base_url=cfg.get("base_url", ""), model=cfg.get("model", ""))
        raise AIProviderError("尚未選擇 AI Provider")

    def test_connection(self, settings: dict = None) -> None:
        self.build_provider(settings).test_connection()

    # ── 產生建議 ─────────────────────────────────────────────────────

    _POINTS_TEXT = "①這份文件的主題／類型，②內容重點或關鍵資訊，③可能的用途或使用情境"
    _POINTS_IMAGE = "①圖片裡的主要內容／畫面（人物、場景、物件、文字等），②可能的用途或情境，③任何值得記住的細節"
    _COMMON_TAIL = (
        "；目的是讓人不用打開檔案，光看這段說明就能判斷這是不是自己要找的檔案。"
        "作為檔案搜尋工具的「說明」欄位使用；只回覆說明本文，不要加引號、"
        "不要加「說明：」之類的前綴，不要條列、不要分段標題，寫成連貫的一段文字。"
    )

    def build_prompt(self, entry, text: str) -> str:
        category = entry.category.strip() or "未分類"
        return (
            "你是一個檔案索引小助手。以下是這份文件擷取到的部分內容，"
            f"請用繁體中文寫一段**至少三句話**的說明（不要只寫一句話），具體描述：{self._POINTS_TEXT}"
            f"{self._COMMON_TAIL}\n\n"
            f"檔名：{entry.name}\n分類：{category}\n內容節錄：\n{text}"
        )

    def build_image_prompt(self, entry) -> str:
        category = entry.category.strip() or "未分類"
        return (
            "你是一個檔案索引小助手。這是一張圖片，"
            f"請用繁體中文寫一段**至少三句話**的說明（不要只寫一句話），具體描述：{self._POINTS_IMAGE}"
            f"{self._COMMON_TAIL}\n\n"
            f"檔名：{entry.name}\n分類：{category}"
        )

    def _extract_text_for(self, entry, cache: dict) -> str:
        """圖片走另一條路徑（見 generate_suggestions），這裡只處理文字類。"""
        p = Path(entry.path)
        if not p.exists():
            return ""
        cached = cache.get(entry.path, {}).get("text", "")
        if cached:
            return cached
        try:
            return self._preview_service.extract_preview_text(p, max_chars=CACHE_TEXT_CHARS) or ""
        except Exception:
            return ""

    def _generate_one(self, provider, entry, cache: dict):
        """回傳 (suggestion_or_None, error_or_None)，給 generate_suggestions()
        迴圈裡每一筆共用。"""
        p = Path(entry.path)
        if not p.exists():
            return None, None
        if p.suffix.lower() in IMAGE_EXTS:
            image = self._preview_service.prepare_image_for_ai(p)
            if image is None:
                return None, None  # 沒裝 Pillow、或讀圖失敗，沒有內容可以送
            image_bytes, mime_type = image
            try:
                prompt = self.build_image_prompt(entry)
                suggestion = provider.generate_image_description(prompt, image_bytes, mime_type)
            except AIProviderError as exc:
                return None, str(exc)
        else:
            text = self._extract_text_for(entry, cache)
            if not text:
                return None, None
            try:
                prompt = self.build_prompt(entry, text)
                suggestion = provider.generate_description(prompt)
            except AIProviderError as exc:
                return None, str(exc)
        return (suggestion, None) if suggestion else (None, "AI 回應是空的")

    def generate_suggestions(self, entries, cache: dict, progress_cb=None, cancel_check=None):
        """entries: list[IndexEntry]。回傳 (results, cancelled)：

        results 是 [(IndexEntry, suggestion, error), ...]，跟 entries 一一對應：
          suggestion 有值、error 是 None  → 產生成功
          suggestion 是 None、error 是 None → 這筆沒有可摘要的內容（略過，
            不算失敗，不會覆蓋掉原本的建議；圖片沒裝 Pillow、音訊／影片目前
            沒有轉錄能力，都會落在這一類）
          suggestion 是 None、error 有值   → 呼叫 AI 失敗（原本的建議不受影響）

        可在背景執行緒安全呼叫，不接觸任何 Tkinter 物件。
        """
        try:
            provider = self.build_provider()
        except AIProviderError as exc:
            return [(entry, None, str(exc)) for entry in entries], False

        results = []
        for done, entry in enumerate(entries, start=1):
            if cancel_check and cancel_check():
                return results, True
            suggestion, error = self._generate_one(provider, entry, cache)
            results.append((entry, suggestion, error))
            if progress_cb:
                progress_cb(done, entry.name)
        return results, False
