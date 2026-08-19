"""AI Provider 共用介面與 HTTP 小工具。"""

import json
import urllib.error
import urllib.request


class AIProviderError(Exception):
    """呼叫 AI Provider 失敗（連線問題、逾時、伺服器回傳錯誤、回應格式看不懂
    等）統一包成這個例外，呼叫端只需要接這一種，不用分別處理
    urllib/json 各自的例外型別。"""


class AIProvider:
    """OpenAI／Ollama 都實作這個介面，DescriptionService 才能用同一套邏輯
    呼叫，不用另外 if/else 判斷是哪一種 Provider。"""

    def generate_description(self, prompt: str) -> str:
        """送出 prompt，回傳模型產生的文字（已去除頭尾空白）。失敗一律拋出
        AIProviderError。"""
        raise NotImplementedError

    def generate_image_description(self, prompt: str, image_bytes: bytes, mime_type: str) -> str:
        """跟 generate_description() 一樣，差別是額外送一張圖片（呼叫端已經
        先縮小、轉成 JPEG，這裡不用再處理圖片本身）。模型不支援看圖（例如
        選了純文字模型）會直接讓伺服器回錯，一樣包成 AIProviderError 往上拋，
        不在這裡預先攔——沒辦法可靠地知道使用者填的模型名稱支不支援視覺，
        讓伺服器的錯誤訊息說明比較準確。"""
        raise NotImplementedError

    def test_connection(self) -> None:
        """驗證目前設定是否真的能連上、能用；失敗拋出 AIProviderError，
        成功就直接 return，不用回傳值。"""
        raise NotImplementedError


def post_json(url: str, payload: dict, headers: dict = None, timeout: float = 60.0) -> dict:
    """POST 一段 JSON、回傳解析後的 JSON 回應；任何失敗（連線失敗、逾時、
    HTTP 錯誤狀態、回應不是合法 JSON）都轉成 AIProviderError，讓呼叫端
    不用分別接好幾種例外型別。"""
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise AIProviderError(f"伺服器回傳錯誤（HTTP {e.code}）：{detail[:300]}") from e
    except urllib.error.URLError as e:
        raise AIProviderError(f"連線失敗：{e.reason}") from e
    except TimeoutError as e:
        raise AIProviderError("請求逾時，請確認服務是否正常。") from e
    try:
        return json.loads(body)
    except ValueError as e:
        raise AIProviderError("回應不是合法的 JSON，可能不是預期的服務。") from e


def get_json(url: str, headers: dict = None, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(url, method="GET")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise AIProviderError(f"伺服器回傳錯誤（HTTP {e.code}）：{detail[:300]}") from e
    except urllib.error.URLError as e:
        raise AIProviderError(f"連線失敗：{e.reason}") from e
    except TimeoutError as e:
        raise AIProviderError("請求逾時，請確認服務是否正常。") from e
    try:
        return json.loads(body)
    except ValueError as e:
        raise AIProviderError("回應不是合法的 JSON，可能不是預期的服務。") from e
