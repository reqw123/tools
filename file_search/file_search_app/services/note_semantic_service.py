"""便利貼「語意搜尋」——用本機 Ollama 的 embedding 模型，把查詢句和每則便利貼
都轉成向量，依 cosine 相似度排序，讓「意思相近但字面不同」的便利貼也找得到
（例如查「出國要帶的東西」找得到標題寫「行李清單」的那則）。

設計取捨：
- **只靠 Ollama 的 `/api/embed`**，不經過 `AIProvider` 介面（那是生成式回應
  用的）。位址沿用 `.ai_settings.json` 的 `ollama.base_url`，跟一般 AI 搜尋
  同一台；模型另外指定（`nomic-embed-text` 之類的純 embedding 模型，跟聊天
  模型不同），由呼叫端傳入（notes-web 存在 `.notes_settings.json`）。
- **向量快取**：`indexes/.sticky_notes_embeddings.json`，每則便利貼記
  `{hash, vec}`——`hash` 是「標題＋標籤＋內文」的 md5，內容沒變就不重算。
  換模型或換位址（維度／語意空間都不同）會整份作廢重算。
- **相似度門檻**：低於門檻的直接不回，避免「每則都沾一點邊」的雜訊。
- 任何 Ollama 端的失敗（連不上、模型沒下載、太舊沒有 `/api/embed`）都收斂成
  `{"ok": False, "error": ...}`，不拋例外——語意搜尋是加分功能，壞掉時前端
  照樣退回關鍵字搜尋。

純邏輯、不碰 Tkinter；`embed_fn` 可注入，測試不需要真的 Ollama。
"""

from __future__ import annotations

import hashlib
import math

from file_search_app.ai.base import AIProviderError
from file_search_app.ai.ollama_provider import (
    DEFAULT_BASE_URL, embed_texts, list_models, model_in_list,
)
from file_search_app.config import (
    STICKY_EMBED_MODEL_DEFAULT, STICKY_SEMANTIC_MIN_SCORE,
)
from file_search_app.repositories.ai_settings_repository import AISettingsRepository
from file_search_app.repositories.json_store import read_json, write_json

_EMBED_BATCH = 64  # 一次送多少則便利貼給 /api/embed；太多會讓單一請求逾時
_MAX_TEXT_CHARS = 2000  # 每則便利貼餵給 embedding 的字數上限（便利貼本來就短）


def _note_text(note) -> str:
    """一則便利貼轉成給 embedding 的純文字：標題、標籤、內文串起來。"""
    parts = [note.title or "", note.tag or "", note.body or ""]
    return "\n".join(p for p in parts if p).strip()[:_MAX_TEXT_CHARS]


def _hash(text: str) -> str:
    return hashlib.md5(text.encode("utf-8")).hexdigest()


def cosine(a, b) -> float:
    """兩個等長向量的 cosine 相似度；任一為零向量回 0.0。"""
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


class NoteSemanticService:
    def __init__(
        self,
        sticky_service,
        ai_settings_repo: AISettingsRepository | None = None,
        cache_path=None,
        embed_fn=None,
    ):
        self._sticky = sticky_service
        self._settings_repo = ai_settings_repo or AISettingsRepository()
        # 快取檔跟 .sticky_notes.json 放同一個資料夾（便利貼檔可能被 --notes-file
        # 指到別處，快取就跟著走，不會用到別份便利貼的向量）。
        if cache_path is not None:
            self._cache_path = cache_path
        else:
            self._cache_path = self._sticky._repo.path.with_name(".sticky_notes_embeddings.json")
        self._embed_fn = embed_fn  # (base_url, model, texts) -> list[vec]；None＝用真的 Ollama

    # ── 位址／模型 ────────────────────────────────────────────────────
    def _base_url(self) -> str:
        url = self._settings_repo.load().get("ollama", {}).get("base_url", "")
        return url.strip() or DEFAULT_BASE_URL

    def _resolve_model(self, model: str) -> str:
        return (model or "").strip() or STICKY_EMBED_MODEL_DEFAULT

    def _embed(self, base_url: str, model: str, texts):
        fn = self._embed_fn or embed_texts
        return fn(base_url, model, texts)

    # ── 快取 ─────────────────────────────────────────────────────────
    def _load_cache(self, base_url: str, model: str) -> dict:
        data = read_json(self._cache_path, None)
        if (
            isinstance(data, dict)
            and data.get("model") == model
            and data.get("base_url") == base_url
            and isinstance(data.get("vectors"), dict)
        ):
            return data["vectors"]
        return {}  # 沒有、格式不對、或換了模型／位址 → 整份重算

    def _save_cache(self, base_url: str, model: str, vectors: dict) -> None:
        try:
            write_json(self._cache_path, {"model": model, "base_url": base_url, "vectors": vectors})
        except OSError:
            pass  # 快取寫不進去不影響這次搜尋結果，下次再算一遍就是

    # ── 對外 ─────────────────────────────────────────────────────────
    def status(self, model: str = "") -> dict:
        """語意搜尋能不能用：Ollama 連得上嗎、指定的 embedding 模型下載了嗎。
        給前端決定要不要 disable「語意」開關、或提示 `ollama pull`。"""
        model = self._resolve_model(model)
        base_url = self._base_url()
        try:
            installed = list_models(base_url)
        except AIProviderError as exc:
            return {"ok": False, "model": model, "installed": None, "error": str(exc)}
        ready = model_in_list(model, installed)
        return {
            "ok": ready,
            "model": model,
            "installed": ready,
            "error": None if ready else (
                f"這台 Ollama 還沒有「{model}」這個模型，請先執行 `ollama pull {model}`。"
            ),
        }

    def search(
        self,
        query: str,
        tag: str = "",
        model: str = "",
        top_k: int | None = None,
        min_score: float | None = None,
    ) -> dict:
        """回傳 `{"ok", "results": [{"id", "score"}], "model", "error",
        "embedded", "total"}`——`results` 已依相似度高到低排序、濾掉低於門檻的。
        `embedded` 是這次實際重算了幾則的向量（除錯用）。"""
        query = (query or "").strip()
        model = self._resolve_model(model)
        threshold = STICKY_SEMANTIC_MIN_SCORE if min_score is None else float(min_score)
        base_url = self._base_url()

        if not query:
            return {"ok": True, "results": [], "model": model, "error": None, "embedded": 0, "total": 0}

        notes = self._sticky.list_notes()
        if tag:
            notes = [n for n in notes if n.tag == tag]
        if not notes:
            return {"ok": True, "results": [], "model": model, "error": None, "embedded": 0, "total": 0}

        cache = self._load_cache(base_url, model)
        texts = {n.id: _note_text(n) for n in notes}
        hashes = {nid: _hash(t) for nid, t in texts.items()}

        stale = [n.id for n in notes if cache.get(n.id, {}).get("hash") != hashes[n.id]]
        embedded = 0
        try:
            for i in range(0, len(stale), _EMBED_BATCH):
                chunk = stale[i:i + _EMBED_BATCH]
                vecs = self._embed(base_url, model, [texts[nid] for nid in chunk])
                for nid, vec in zip(chunk, vecs):
                    cache[nid] = {"hash": hashes[nid], "vec": vec}
                    embedded += 1
            (query_vec,) = self._embed(base_url, model, [query])
        except AIProviderError as exc:
            # 有算到一些就先存起來，下次不用整份重來
            if embedded:
                self._save_cache(base_url, model, cache)
            return {"ok": False, "results": [], "model": model, "error": str(exc),
                    "embedded": embedded, "total": len(notes)}

        # 清掉已刪除便利貼留下的向量，快取不會無限長大
        live_ids = set(texts)
        dead = [k for k in cache if k not in live_ids]
        for k in dead:
            cache.pop(k, None)
        if embedded or dead:
            self._save_cache(base_url, model, cache)

        scored = []
        for n in notes:
            vec = cache.get(n.id, {}).get("vec")
            score = cosine(query_vec, vec) if vec else 0.0
            if score >= threshold:
                scored.append({"id": n.id, "score": round(score, 4)})
        scored.sort(key=lambda r: r["score"], reverse=True)
        if top_k:
            scored = scored[:top_k]
        return {"ok": True, "results": scored, "model": model, "error": None,
                "embedded": embedded, "total": len(notes)}
