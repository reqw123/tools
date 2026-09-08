"""便利貼「語意搜尋」——用本機 Ollama 的 embedding 模型，把查詢句和每則便利貼
都轉成向量，依 cosine 相似度排序，讓「意思相近但字面不同」的便利貼也找得到
（例如查「出國要帶的東西」找得到標題寫「行李清單」的那則）。

設計取捨：
- **只靠 Ollama 的 `/api/embed`**，不經過 `AIProvider` 介面（那是生成式回應
  用的）。位址沿用 `.ai_settings.json` 的 `ollama.base_url`，跟一般 AI 搜尋
  同一台；模型另外指定（純 embedding 模型，跟聊天模型不同；預設 bge-m3，
  中文效果好），由呼叫端傳入（notes-web 存在 `.notes_settings.json`）。
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
    STICKY_EMBED_MODEL_DEFAULT, STICKY_SEMANTIC_MAX_RESULTS, STICKY_SEMANTIC_MIN_SCORE,
    STICKY_SEMANTIC_RELATIVE_BAND, STICKY_SEMANTIC_RELATIVE_RATIO,
)
from file_search_app.repositories.ai_settings_repository import AISettingsRepository
from file_search_app.repositories.json_store import read_json, write_json

_EMBED_BATCH = 64  # 一次送多少則便利貼給 /api/embed；太多會讓單一請求逾時
_MAX_TEXT_CHARS = 2000  # 每則便利貼餵給 embedding 的字數上限（便利貼本來就短）
# 快取版本——餵給 embedding 的文字格式／前綴邏輯一改，舊向量就不能再用，
# 靠這個數字強制整份重算（換模型／位址本來就會重算，這個管的是「同一個
# 模型但程式改過」的情形）。
_EMBED_CACHE_SCHEME = 2


def _task_prefixes(model: str):
    """(查詢前綴, 文件前綴)——有些非對稱檢索模型要求查詢句和被檢索文件各自
    加不同前綴才準（E5 系列、mxbai）。認不出來的模型一律不加，直接餵原文
    （bge-m3、多數模型都吃原文；nomic 雖然官方建議加 search_query/
    search_document，但實測對中文反而更差，所以這裡不加）。"""
    m = (model or "").lower()
    if "e5" in m:  # multilingual-e5, e5-large, e5-base…
        return "query: ", "passage: "
    if "mxbai-embed" in m:
        return "Represent this sentence for searching relevant passages: ", ""
    return "", ""


def _note_text(note) -> str:
    """一則便利貼轉成給 embedding 的純文字。

    刻意把『分類』寫成一句自然語言放最前面（「這則便利貼的分類是「飲料」。」）
    ——實測差很多：便利貼內文通常很短又是專有名詞（「珍珠奶茶」），單靠內文
    embedding 跟「我口渴了」這種情境式查詢對不太起來；但把分類講白之後，
    同分類的便利貼就會一起浮上來（查「我口渴了」→ 飲料類的三則都進前三）。
    分類本來就是使用者自己下的最強語意標籤，讓它在向量裡份量重一點是對的。
    """
    body = (note.body or "").strip()
    lead = f"這則便利貼的分類是「{note.tag}」。" if note.tag else ""
    title = f"標題：{note.title}。" if note.title else ""
    return f"{lead}{title}內容：{body}"[:_MAX_TEXT_CHARS]


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
            # 快取檔名跟著便利貼檔走（研究生模式是另一份 .thesis_notes.json）——
            # .sticky_notes.json → .sticky_notes_embeddings.json
            notes_path = self._sticky._repo.path
            self._cache_path = notes_path.with_name(f"{notes_path.stem}_embeddings.json")
        self._embed_fn = embed_fn  # (base_url, model, texts) -> list[vec]；None＝用真的 Ollama

    # ── 位址／模型 ────────────────────────────────────────────────────
    def _base_url(self) -> str:
        url = self._settings_repo.load().get("ollama", {}).get("base_url", "")
        return url.strip() or DEFAULT_BASE_URL

    def _resolve_model(self, model: str) -> str:
        return (model or "").strip() or STICKY_EMBED_MODEL_DEFAULT

    def _embed(self, base_url: str, model: str, texts, prefix: str = ""):
        fn = self._embed_fn or embed_texts
        return fn(base_url, model, [f"{prefix}{t}" for t in texts] if prefix else list(texts))

    # ── 快取 ─────────────────────────────────────────────────────────
    def _load_cache(self, base_url: str, model: str) -> dict:
        data = read_json(self._cache_path, None)
        if (
            isinstance(data, dict)
            and data.get("model") == model
            and data.get("base_url") == base_url
            and data.get("scheme") == _EMBED_CACHE_SCHEME
            and isinstance(data.get("vectors"), dict)
        ):
            return data["vectors"]
        return {}  # 沒有、格式不對、或換了模型／位址／程式版本 → 整份重算

    def _save_cache(self, base_url: str, model: str, vectors: dict) -> None:
        try:
            write_json(self._cache_path, {
                "model": model, "base_url": base_url,
                "scheme": _EMBED_CACHE_SCHEME, "vectors": vectors,
            })
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
        "embedded", "total", "top_score"}`——`results` 依相似度高到低排序。

        篩選不是用固定的絕對門檻（不同模型的分數分布差很多，nomic 之類的
        「什麼都 0.4 起跳」，固定門檻等於整面牆都回來）。改成：
        - 絕對地板 `min_score`（預設 STICKY_SEMANTIC_MIN_SCORE）——最高分都
          沒過就當「沒有真的相關的」，回空清單。
        - 相對區間：只留跟『最高分』差距在 STICKY_SEMANTIC_RELATIVE_BAND
          以內的，把長尾的「沾一點邊」切掉。
        - 上限 `top_k`（預設 STICKY_SEMANTIC_MAX_RESULTS）。
        `embedded` 是這次實際重算了幾則的向量（除錯用）。"""
        query = (query or "").strip()
        model = self._resolve_model(model)
        floor = STICKY_SEMANTIC_MIN_SCORE if min_score is None else float(min_score)
        limit = int(top_k) if top_k else STICKY_SEMANTIC_MAX_RESULTS
        base_url = self._base_url()
        empty = {"ok": True, "results": [], "model": model, "error": None,
                 "embedded": 0, "total": 0, "top_score": 0.0}

        if not query:
            return empty

        notes = self._sticky.list_notes()
        if tag:
            notes = [n for n in notes if n.tag == tag]
        if not notes:
            return empty

        q_prefix, d_prefix = _task_prefixes(model)
        cache = self._load_cache(base_url, model)
        texts = {n.id: _note_text(n) for n in notes}
        hashes = {nid: _hash(t) for nid, t in texts.items()}

        stale = [n.id for n in notes if cache.get(n.id, {}).get("hash") != hashes[n.id]]
        embedded = 0
        try:
            for i in range(0, len(stale), _EMBED_BATCH):
                chunk = stale[i:i + _EMBED_BATCH]
                vecs = self._embed(base_url, model, [texts[nid] for nid in chunk], d_prefix)
                for nid, vec in zip(chunk, vecs):
                    cache[nid] = {"hash": hashes[nid], "vec": vec}
                    embedded += 1
            (query_vec,) = self._embed(base_url, model, [query], q_prefix)
        except AIProviderError as exc:
            # 有算到一些就先存起來，下次不用整份重來
            if embedded:
                self._save_cache(base_url, model, cache)
            return {"ok": False, "results": [], "model": model, "error": str(exc),
                    "embedded": embedded, "total": len(notes), "top_score": 0.0}

        # 清掉已刪除便利貼留下的向量，快取不會無限長大
        live_ids = set(texts)
        dead = [k for k in cache if k not in live_ids]
        for k in dead:
            cache.pop(k, None)
        if embedded or dead:
            self._save_cache(base_url, model, cache)

        ranked = sorted(
            (
                {"id": n.id, "score": round(cosine(query_vec, cache.get(n.id, {}).get("vec") or []), 4)}
                for n in notes
            ),
            key=lambda r: r["score"], reverse=True,
        )
        top = ranked[0]["score"] if ranked else 0.0
        if top < floor:
            return {"ok": True, "results": [], "model": model, "error": None,
                    "embedded": embedded, "total": len(notes), "top_score": top}
        cutoff = max(
            floor,
            top * STICKY_SEMANTIC_RELATIVE_RATIO,
            top - STICKY_SEMANTIC_RELATIVE_BAND,
        )
        results = [r for r in ranked if r["score"] >= cutoff][:limit]
        return {"ok": True, "results": results, "model": model, "error": None,
                "embedded": embedded, "total": len(notes), "top_score": top}
