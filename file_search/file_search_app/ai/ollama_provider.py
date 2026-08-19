"""Ollama 本機服務客戶端——預設打 http://localhost:11434，不需要 API Key，
內容不會離開這台機器。"""

import base64

from file_search_app.ai.base import AIProvider, AIProviderError, get_json, post_json

DEFAULT_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "llama3.1"


class OllamaProvider(AIProvider):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, model: str = DEFAULT_MODEL):
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")
        self._model = (model or DEFAULT_MODEL).strip()

    def _generate(self, payload: dict, timeout: float) -> str:
        data = post_json(f"{self._base_url}/api/generate", payload, timeout=timeout)
        if "error" in data:
            raise AIProviderError(str(data["error"]))
        response = data.get("response")
        if response is None:
            raise AIProviderError(f"回應格式不是預期的樣子：{data!r}"[:300])
        return response.strip()

    def generate_description(self, prompt: str) -> str:
        return self._generate({"model": self._model, "prompt": prompt, "stream": False}, timeout=120.0)

    def generate_image_description(self, prompt: str, image_bytes: bytes, mime_type: str) -> str:
        # Ollama 的 /api/generate 支援 images 這個欄位（base64 字串陣列），
        # 不需要 data URL 前綴、也不用帶 mime_type——只有裝了支援視覺的模型
        # （例如 llava、bakllava、moondream）才看得懂圖片，選了純文字模型
        # 會被伺服器拒絕，錯誤訊息會照常往上拋。本機推理視覺模型通常比文字
        # 模型慢很多，逾時時間拉長一點。
        b64 = base64.b64encode(image_bytes).decode("ascii")
        payload = {"model": self._model, "prompt": prompt, "images": [b64], "stream": False}
        return self._generate(payload, timeout=240.0)

    def test_connection(self) -> None:
        # /api/tags 列出本機已下載的模型，用來確認服務有沒有在跑、位址對不對。
        get_json(f"{self._base_url}/api/tags")
