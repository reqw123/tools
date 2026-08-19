"""OpenAI Chat Completions API 客戶端（也相容其他 OpenAI 相容端點，例如
Azure OpenAI 的相容模式、自架的 OpenAI-compatible 伺服器——只要能接受同樣
的 `/chat/completions` 格式，換個 base_url 就能用）。"""

import base64

from file_search_app.ai.base import AIProvider, AIProviderError, get_json, post_json

DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"
# 說明要求至少三句話，給模型足夠的輸出空間（Ollama 端沒有這個限制，靠模型
# 自己判斷何時停止）；太小會讓內容被硬截斷、達不到「至少三句話」的要求。
MAX_OUTPUT_TOKENS = 600


class OpenAIProvider(AIProvider):
    def __init__(self, api_key: str, model: str = DEFAULT_MODEL, base_url: str = DEFAULT_BASE_URL):
        self._api_key = (api_key or "").strip()
        self._model = (model or DEFAULT_MODEL).strip()
        self._base_url = (base_url or DEFAULT_BASE_URL).rstrip("/")

    def _headers(self) -> dict:
        if not self._api_key:
            raise AIProviderError("尚未設定 OpenAI API Key。")
        return {"Authorization": f"Bearer {self._api_key}"}

    def _chat_completion(self, messages) -> str:
        """text／image 兩種請求最後都是送同一個 /chat/completions 端點，差別
        只在 messages 裡 content 的形狀（純字串 vs 文字+圖片的清單），這裡
        統一處理送出、o1／o3／gpt-5 這類推理模型的參數相容性重試、跟回應
        解析，兩條路徑不用各自重寫一次。"""
        headers = self._headers()
        payload = {
            "model": self._model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": MAX_OUTPUT_TOKENS,
        }
        try:
            data = post_json(f"{self._base_url}/chat/completions", payload, headers=headers, timeout=90.0)
        except AIProviderError as e:
            # o1／o3／gpt-5 這類「推理模型」不接受 max_tokens（也不一定支援自訂
            # temperature），伺服器會回「Unsupported parameter: 'max_tokens' ...
            # Use 'max_completion_tokens' instead.」這種錯誤——測試連線（只是
            # 列模型清單）不會踩到這個問題，只有真的送出生成請求才會發現，使用
            # 者不該還要自己猜參數名稱，這裡偵測到這個特定錯誤就自動改參數重試
            # 一次；不是這個原因就照常把原始錯誤往上拋。
            message = str(e)
            if "max_tokens" in message and "max_completion_tokens" in message:
                retry_payload = {"model": self._model, "messages": messages, "max_completion_tokens": MAX_OUTPUT_TOKENS}
                data = post_json(f"{self._base_url}/chat/completions", retry_payload, headers=headers, timeout=90.0)
            else:
                raise
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise AIProviderError(f"回應格式不是預期的樣子：{data!r}"[:300]) from e
        return (content or "").strip()

    def generate_description(self, prompt: str) -> str:
        return self._chat_completion([{"role": "user", "content": prompt}])

    def generate_image_description(self, prompt: str, image_bytes: bytes, mime_type: str) -> str:
        b64 = base64.b64encode(image_bytes).decode("ascii")
        content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{b64}"}},
        ]
        return self._chat_completion([{"role": "user", "content": content}])

    def test_connection(self) -> None:
        # 用列出模型清單這個輕量端點驗證 API Key／base_url 是否正確，不用真的
        # 花一次生成的 token 額度。
        get_json(f"{self._base_url}/models", headers=self._headers())
