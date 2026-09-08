"""Ollama 服務客戶端——預設打 http://localhost:11434（本機），也可以把「服務位址」
指到區網內另一台跑 Ollama 的電腦（例如 http://192.168.1.50:11434）。不需要 API
Key；指到本機時內容不離開這台電腦，指到區網主機時內容只在區域網路內傳到那台電腦、
不會上網際網路、也不會計費。

要讓別台電腦連得到，提供服務的那台機器上 Ollama 必須以 OLLAMA_HOST=0.0.0.0 啟動
（預設只綁 127.0.0.1、只收本機連線），且防火牆要放行 11434 埠——這是對方機器的設定，
不是這個 App 能代勞的。"""

import base64
import ipaddress
from urllib.parse import urlparse

from file_search_app.ai.base import (
    AIProvider, AIProviderError, get_json, post_json, unexpected_response_error,
)

DEFAULT_BASE_URL = "http://localhost:11434"
DEFAULT_MODEL = "llama3.1"
DEFAULT_HOST = "localhost"
DEFAULT_PORT = 11434

# 這幾個主機名／位址代表「就是這台電腦」，指到它們就是本機連線。
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "0.0.0.0", ""}


def normalize_base_url(base_url: str) -> str:
    """把使用者填的服務位址整理成可以直接餵給 urllib 的樣子：去頭尾空白與尾端
    斜線，沒有帶 scheme（只填了 `192.168.1.50:11434` 這種）就補上 `http://`。
    空字串退回預設值。"""
    url = (base_url or "").strip().rstrip("/")
    if not url:
        return DEFAULT_BASE_URL
    if "://" not in url:
        url = "http://" + url
    return url


def split_standard_url(base_url: str):
    """把服務位址拆成 (host, is_standard)：

    - `host` 是中間可修改的那一段（IP 或主機名），空的話回 `localhost`。
    - `is_standard` 為 True 代表整個位址就是 `http://<host>:11434` 的標準
      樣子，設定視窗可以用「只開放中間 IP 欄、前後綴唯讀」的分段輸入呈現；
      False 代表有自訂 scheme（https）、自訂連接埠或路徑，設定視窗要退回
      完整網址輸入框，不能把使用者原本的設定吃掉。
    """
    parsed = urlparse(normalize_base_url(base_url))
    host = parsed.hostname or DEFAULT_HOST
    try:
        port = parsed.port
    except ValueError:  # 連接埠不是合法數字
        port = None
    is_standard = (
        parsed.scheme == "http"
        and port == DEFAULT_PORT
        and parsed.path in ("", "/")
        and not parsed.query
        and not parsed.fragment
        and not parsed.username
        and not parsed.password
    )
    return host, is_standard


def build_standard_url(host: str) -> str:
    """分段輸入的反向操作：把中間那段 host 組回 `http://<host>:11434`。"""
    host = (host or "").strip().strip("/")
    if "://" in host:  # 使用者把整段網址貼進中間欄——取出主機名就好
        host = urlparse(host).hostname or DEFAULT_HOST
    if not host:
        host = DEFAULT_HOST
    if ":" in host and not host.startswith("["):  # IPv6 字面位址要包中括號
        host = f"[{host}]"
    return f"http://{host}:{DEFAULT_PORT}"


def _with_latest(name: str) -> str:
    """Ollama 內部把沒帶 tag 的名稱一律當成 `:latest`——比對時兩邊都補齊。"""
    name = (name or "").strip()
    return name if ":" in name else f"{name}:latest"


def model_in_list(name: str, names) -> bool:
    """`name` 這個模型在不在 `names` 清單裡（`llama3.1` 與 `llama3.1:latest`
    視為同一個）。"""
    if not name:
        return False
    want = _with_latest(name)
    return want in {_with_latest(n) for n in names} or name in set(names)


def parse_model_names(tags: dict) -> list:
    """從 `/api/tags` 的回應裡抽出模型名稱清單（保留原順序、不去重）。清單版
    `list_models()` 跟 `OllamaProvider.test_connection()` 共用同一套解析。"""
    models = tags.get("models") if isinstance(tags, dict) else None
    if not isinstance(models, list):
        return []
    return [m.get("name", "") for m in models if isinstance(m, dict) and m.get("name")]


def list_models(base_url: str, timeout: float = 8.0) -> list:
    """回傳那台 Ollama 已下載的模型名稱清單（依名稱排序，不重複）。連不上／
    回應看不懂時拋 AIProviderError（沿用 get_json 既有的錯誤包裝）。設定視窗
    的模型下拉選單用這個。"""
    data = get_json(f"{normalize_base_url(base_url)}/api/tags", timeout=timeout)
    return sorted(set(parse_model_names(data)), key=str.lower)


def embed_texts(base_url: str, model: str, texts, timeout: float = 60.0) -> list:
    """把一批文字丟給 Ollama 的 `/api/embed`，回傳等長的向量清單（每個是
    list[float]）。給「便利貼語意搜尋」算相似度用——不經過 AIProvider 介面
    （那是給生成式回應用的），embedding 是獨立的一支端點。

    - `texts` 空清單直接回 `[]`，不打 API。
    - 連不上／回應格式不對／向量數量對不上，一律拋 `AIProviderError`
      （沿用 `post_json` 的錯誤包裝），呼叫端只要接這一種。
    - 用新版的 `/api/embed`（吃 `input` 陣列、一次一批）；舊版 Ollama
      （2024 年中以前）沒有這支，會回 404 → `AIProviderError`，呼叫端把
      它當成「這台 Ollama 太舊、語意搜尋不可用」提示使用者升級。
    """
    items = [str(t or "") for t in texts]
    if not items:
        return []
    model = (model or "").strip()
    if not model:
        raise AIProviderError("沒有指定嵌入模型（embedding model），無法做語意搜尋。")
    try:
        data = post_json(
            f"{normalize_base_url(base_url)}/api/embed",
            {"model": model, "input": items},
            timeout=timeout,
        )
    except AIProviderError as exc:
        msg = str(exc)
        if "does not support embeddings" in msg or "HTTP 501" in msg or "HTTP 404" in msg:
            raise AIProviderError(
                f"這台 Ollama 沒辦法用「{model}」做文字向量（embedding）——"
                "請改用純 embedding 模型（例如 nomic-embed-text：先在該電腦 "
                f"`ollama pull nomic-embed-text`），或確認 Ollama 版本夠新。原始錯誤：{msg}"
            ) from exc
        raise
    if isinstance(data, dict) and data.get("error"):
        raise AIProviderError(str(data["error"]))
    vectors = data.get("embeddings") if isinstance(data, dict) else None
    if not isinstance(vectors, list) or len(vectors) != len(items):
        raise unexpected_response_error(data)
    out = []
    for vec in vectors:
        if not isinstance(vec, list) or not vec:
            raise unexpected_response_error(data)
        out.append([float(x) for x in vec])
    return out


def is_local_endpoint(base_url: str) -> bool:
    """服務位址是不是指向這台電腦本身（loopback）。用來讓送出前的確認視窗
    講清楚「內容不會離開這台電腦」還是「內容會透過區網傳到另一台電腦」。"""
    host = (urlparse(normalize_base_url(base_url)).hostname or "").lower()
    if host in _LOCAL_HOSTS:
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


class OllamaProvider(AIProvider):
    def __init__(self, base_url: str = DEFAULT_BASE_URL, model: str = DEFAULT_MODEL):
        self._base_url = normalize_base_url(base_url)
        self._model = (model or DEFAULT_MODEL).strip()
        # 一次連線期間 /api/show 的結果不會變，查過就記住，批次分析大量圖片時
        # 不用每張圖都重打一次。None＝還沒查；dict＝查到了；False＝查過但失敗。
        self._show_cache = None

    def _show(self) -> dict:
        """POST /api/show 拿這個模型的中繼資料（能力、家族、參數等）。查不到
        （模型沒下載、舊版 Ollama 沒這個端點）時回空 dict，不拋例外——呼叫端
        自己決定「查不到」要當成什麼。"""
        if isinstance(self._show_cache, dict):
            return self._show_cache
        try:
            # 舊版 Ollama 認 `name`、新版認 `model`，兩個都帶著最保險。
            data = post_json(
                f"{self._base_url}/api/show",
                {"name": self._model, "model": self._model}, timeout=15.0,
            )
        except AIProviderError:
            data = {}
        self._show_cache = data if isinstance(data, dict) else {}
        return self._show_cache

    def _vision_support(self):
        """回傳 True／False／None：

        - True／False：Ollama 的 /api/show 有回 `capabilities` 清單，能明確
          判斷這個模型支不支援看圖（vision）。
        - None：問不到（舊版 Ollama 沒有 capabilities 欄位、或模型沒下載），
          沒有把握就不要擋，讓實際請求自己去踩伺服器的錯誤。
        """
        caps = self._show().get("capabilities")
        if isinstance(caps, list) and caps:
            return "vision" in caps
        return None

    def _generate(self, payload: dict, timeout: float) -> str:
        data = post_json(f"{self._base_url}/api/generate", payload, timeout=timeout)
        if "error" in data:
            raise AIProviderError(str(data["error"]))
        response = data.get("response")
        if not isinstance(response, str):
            # response 缺漏、是 null，或被中繼代理／壞掉的端點改成數字/物件——
            # 一律當成回應格式不對，包成 AIProviderError；不要讓 .strip() 對
            # 非字串丟出 AttributeError，那會穿過呼叫端「只接 AIProviderError」
            # 的防護、把背景執行緒打死。
            raise unexpected_response_error(data)
        return response.strip()

    def generate_description(self, prompt: str) -> str:
        return self._generate({"model": self._model, "prompt": prompt, "stream": False}, timeout=120.0)

    def generate_image_description(self, prompt: str, image_bytes: bytes, mime_type: str) -> str:
        # Ollama 的 /api/generate 支援 images 這個欄位（base64 字串陣列），
        # 不需要 data URL 前綴、也不用帶 mime_type。只有支援視覺的模型
        # （例如 llava、llama3.2-vision、qwen2.5vl、moondream）看得懂圖片；
        # 選了純文字模型（qwen2.5、llama3.1 等）時，Ollama 有時直接回錯、有時
        # 卻是「悄悄忽略圖片、照著文字硬掰一段」——後者最麻煩，使用者以為 AI
        # 看過圖了，其實沒有。所以先問 /api/show 的 capabilities，能確定不支援
        # 就直接擋下來、講清楚原因，不送出這次請求。
        if self._vision_support() is False:
            raise AIProviderError(
                f"目前選用的模型「{self._model}」不支援圖片辨識（vision），沒辦法分析圖片。"
                "請在提供 Ollama 的那台電腦上改用支援視覺的模型（例如 llava、llama3.2-vision、"
                "qwen2.5vl、moondream），並在「AI 設定」把模型名稱改成該視覺模型。"
                "（純文字檔的批次補說明不受影響，仍可正常使用。）"
            )
        b64 = base64.b64encode(image_bytes).decode("ascii")
        payload = {"model": self._model, "prompt": prompt, "images": [b64], "stream": False}
        return self._generate(payload, timeout=240.0)

    def test_connection(self):
        # /api/tags 列出該服務已下載的模型，用來確認服務有沒有在跑、位址對不對。
        # 區網主機可能比本機慢一點（要經過網路），逾時放寬到 15 秒。
        tags = get_json(f"{self._base_url}/api/tags", timeout=15.0)

        # 連得上還不夠：使用者填的模型名稱如果那台電腦根本沒下載、或下載了但
        # 是純文字模型，之後真的用起來還是會失敗，而且「連線成功」的綠字會讓
        # 人以為一切就緒。這裡多做兩個檢查，把問題在設定當下就講出來（回傳一
        # 段警語字串，不是拋例外——連線本身是成功的）。
        installed = parse_model_names(tags)
        if installed and not self._model_installed(installed):
            sample = "、".join(installed[:8]) + ("…" if len(installed) > 8 else "")
            return (
                f"⚠️ 連得上服務，但那台電腦沒有名為「{self._model}」的模型。"
                f"已安裝的有：{sample}。請改填其中一個，或先在該電腦 `ollama pull {self._model}`。"
            )
        if self._vision_support() is False:
            return (
                f"⚠️ 連線成功，但模型「{self._model}」是純文字模型，不支援圖片辨識——"
                "文字檔的批次補說明可以用，圖片會分析失敗。要分析圖片請改用視覺模型"
                "（例如 llava、llama3.2-vision、qwen2.5vl）。"
            )
        return None

    def _model_installed(self, installed: list) -> bool:
        return model_in_list(self._model, installed)
