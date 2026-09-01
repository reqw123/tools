"""用 AI（OpenAI／Ollama）批次為缺說明的檔案產生建議說明——跟
`description_service.py` 的差別：那個是把檔案內容開頭幾句話直接當建議
（純本地、瞬間完成、不需要任何設定）；這個是把擷取到的內容（文字檔送文字、
圖片送縮小過的圖檔給支援視覺的模型）送給 LLM，請它歸納成一段說明，需要先
在「AI 設定」設好 Provider 才能用，也可能因為網路／額度／模型問題而失敗。

兩者是互補的選項，不是取代關係：批次補說明審核視窗裡兩種建議都能用，AI
產生的仍然要人工看過、可編輯、可以不套用，跟一般批次補說明的審核流程一樣。

依 UI 的確認結果決定要不要送出（尤其 OpenAI 這種內容會離開本機的雲端
服務），本身完全不彈 messagebox、不知道 Tkinter，方便在背景執行緒安全呼叫。

圖片走 Provider 的 generate_image_description()（vision）；音訊／影片走
TranscriptionService（本機 faster-whisper）先轉成文字，再走跟一般文件相同的
文字摘要流程——轉錄只聽得到「說了什麼」，純音樂／環境音／沒有旁白的畫面
（螢幕錄影之類）轉出來會是空的，一樣當作「沒有可摘要的內容」略過。轉錄本身
比讀文件慢很多（本機跑語音辨識，且每個檔案都要重新載入一次模型），呼叫端
（AISelectDialog）會在勾選畫面先標示這幾筆「需要轉錄、較慢」，不會讓使用者
毫無心理準備地卡在同一筆。

用量／花費是使用者完全看不到的東西，這裡也負責這部分的輔助資訊（跟便利貼
「AI 搜尋」共用同一份）：`estimate_prompt_size()` 給呼叫端顯示送出前的粗略
大小；`record_call()` 在每一次真的呼叫 Provider（不管成功失敗）時累加一次
持久化的計數器，`get_call_count()` 給呼叫端顯示「目前累計呼叫過幾次」。
"""

from pathlib import Path

from file_search_app.ai.base import AIProviderError
from file_search_app.ai.ollama_provider import OllamaProvider
from file_search_app.ai.openai_provider import OpenAIProvider
from file_search_app.config import IMAGE_EXTS, MEDIA_EXTS
from file_search_app.repositories.cache_repository import CACHE_TEXT_CHARS


class AIDescriptionService:
    def __init__(self, ai_settings_repo, preview_service, transcription_service, usage_repo):
        self._settings_repo = ai_settings_repo
        self._preview_service = preview_service
        self._transcription_service = transcription_service
        self._usage_repo = usage_repo

    # ── 用量／花費輔助資訊 ───────────────────────────────────────────

    def get_call_count(self) -> int:
        return self._usage_repo.load_call_count()

    def record_call(self, by: int = 1) -> int:
        """每次真的呼叫 Provider（不管成功或失敗，失敗的請求很多服務一樣會
        計費或消耗額度）就呼叫一次；`by` 給一次呼叫端就知道要處理好幾筆的
        情況（例如批次補說明一次選了 N 筆，但這裡呼叫端還是逐筆各呼叫一次
        比較準確，`by` 參數保留給真的需要一次跳過好幾筆記帳的情境）。"""
        return self._usage_repo.increment_call_count(by)

    @staticmethod
    def estimate_prompt_size(prompt: str) -> str:
        """粗略估計要送出的內容大小——刻意不假裝算得出精確的 token 數：
        不同 Provider／模型的 tokenizer 不一樣（OpenAI 各模型之間都不完全
        相同，Ollama 又是另外一套本機模型的算法），裝一個真正的 tokenizer
        沒辦法通用又增加相依套件，這裡改用「字元數」當作老實、可跨 Provider
        比較的粗略代理指標，清楚標成「約」而不是精確數字，避免使用者誤以為
        是真的計費依據。"""
        chars = len(prompt)
        return f"約 {chars:,} 字元（粗略估計，非精確 token 數，實際費用/額度以 Provider 帳單為準）"

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

    def current_target_summary(self) -> dict:
        """目前 AI 設定會把內容送去哪裡——給「選檔案問 AI」的確認視窗把
        Provider／模型／是否離開本機講清楚用。"""
        settings = self._settings_repo.load()
        provider = settings.get("provider")
        if provider == "openai":
            cfg = settings.get("openai", {})
            return {
                "provider": "openai",
                "label": "OpenAI（雲端服務）",
                "model": cfg.get("model", "") or "(未指定模型)",
                "endpoint": cfg.get("base_url", "") or "https://api.openai.com/v1",
                "leaves_machine": True,
            }
        cfg = settings.get("ollama", {})
        return {
            "provider": "ollama",
            "label": "Ollama（本機）",
            "model": cfg.get("model", "") or "(未指定模型)",
            "endpoint": cfg.get("base_url", "") or "http://localhost:11434",
            "leaves_machine": False,
        }

    def target_confirm_title(self) -> str:
        """AI 送出前確認視窗的標題——不管本機還是雲端，都在標題就講明是哪個
        Provider（先前只有 OpenAI 會這樣，Ollama 是通用標題）。"""
        t = self.current_target_summary()
        return f"確認送出到 {'OpenAI' if t['provider'] == 'openai' else 'Ollama（本機）'}"

    def target_disclosure_lines(self) -> str:
        """AI 送出前確認視窗共用的「去向」段落——Provider、模型、位址、內容
        會不會離開這台電腦，本機與雲端都寫清楚，措辭一致。"""
        t = self.current_target_summary()
        lines = [f"送往：{t['label']}", f"模型：{t['model']}", f"位址：{t['endpoint']}"]
        if t["leaves_machine"]:
            lines.append("⚠️ 這是雲端服務，內容會離開這台電腦，且每次呼叫可能計費。")
        else:
            lines.append("這是本機服務，內容不會離開這台電腦。")
        return "\n".join(lines)

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

    def _transcribe_for(self, entry, p: Path) -> str:
        """音訊／影片專用：沒有現成快取文字時，呼叫本機 faster-whisper 轉錄一次
        （比讀文件慢很多，見檔案開頭的說明）。沒裝 faster-whisper、轉錄失敗、
        或轉出來是空的（純音樂、沒有旁白）都回傳空字串，呼叫端當作「沒有可
        摘要的內容」處理，不當成呼叫失敗。"""
        if not self._transcription_service.available:
            return ""
        text, _error, _cancelled = self._transcription_service.transcribe(p)
        return text or ""

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
                self.record_call()
                suggestion = provider.generate_image_description(prompt, image_bytes, mime_type)
            except AIProviderError as exc:
                return None, str(exc)
        else:
            text = self._extract_text_for(entry, cache)
            if not text and p.suffix.lower() in MEDIA_EXTS:
                text = self._transcribe_for(entry, p)
            if not text:
                return None, None
            try:
                prompt = self.build_prompt(entry, text)
                self.record_call()
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

    # ── 單檔即席分析（純檢視，不寫回任何索引） ───────────────────────

    def analyze_file(self, path):
        """把使用者自選的單一檔案送給目前設定的 Provider，直接回傳模型的原始
        回覆內容，不做任何寫入。給主視窗「選檔案問 AI」這個純檢視功能用。

        回傳 (answer_or_None, error_or_None, info)：
          info 一定有值（就算失敗也有），至少含 target（current_target_summary
          的內容）與 kind（"image" / "text" / "media-transcribed" / None）、
          sent_desc（送出內容量的白話描述字串）。

        可在背景執行緒安全呼叫（不碰任何 Tkinter）。
        """
        from file_search_app.models import IndexEntry  # 延後匯入避免頂層循環

        p = Path(path)
        info = {"target": self.current_target_summary(), "kind": None, "sent_desc": ""}
        if not p.exists():
            return None, "檔案不存在或已被移動", info

        try:
            provider = self.build_provider()
        except AIProviderError as exc:
            return None, str(exc), info

        entry = IndexEntry(path=str(p), category="", description="", source_index=p, row_index=0)
        suffix = p.suffix.lower()

        if suffix in IMAGE_EXTS:
            image = self._preview_service.prepare_image_for_ai(p)
            if image is None:
                return None, "無法讀取這張圖片（可能未安裝 Pillow，或圖片格式不支援）", info
            image_bytes, mime_type = image
            info["kind"] = "image"
            info["sent_desc"] = f"1 張縮圖（約 {len(image_bytes):,} bytes，{mime_type}），由視覺模型分析"
            try:
                self.record_call()
                answer = provider.generate_image_description(self.build_image_prompt(entry), image_bytes, mime_type)
            except AIProviderError as exc:
                return None, str(exc), info
        else:
            try:
                text = self._preview_service.extract_preview_text(p, max_chars=CACHE_TEXT_CHARS) or ""
            except Exception:
                text = ""
            if not text and suffix in MEDIA_EXTS:
                info["kind"] = "media-transcribed"
                text = self._transcribe_for(entry, p)
            if not text:
                return None, "這個檔案沒有可以送給 AI 的文字內容（可能是二進位檔、空檔，或缺少對應的解析套件）", info
            info["kind"] = info["kind"] or "text"
            prompt = self.build_prompt(entry, text)
            info["sent_desc"] = f"擷取到的文字約 {len(text):,} 字元（連同提示詞共約 {len(prompt):,} 字元）"
            try:
                self.record_call()
                answer = provider.generate_description(prompt)
            except AIProviderError as exc:
                return None, str(exc), info

        answer = (answer or "").strip()
        return (answer or None), (None if answer else "AI 回應是空的"), info
