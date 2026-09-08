"""便利貼語意搜尋（NoteSemanticService）——注入假的 embed_fn，不需要真的
Ollama。假向量用「固定詞表的 bag-of-words」，cosine 相似度就等於詞彙重疊度，
排序結果可預測。"""

import json

import pytest

from file_search_app.ai.base import AIProviderError
from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
from file_search_app.services import note_semantic_service as mod
from file_search_app.services.note_semantic_service import NoteSemanticService, cosine
from file_search_app.services.sticky_note_service import StickyNoteService

_VOCAB = ["旅遊", "行李", "運動", "跑步", "報稅", "財務"]


def _make_embed(calls):
    def fake_embed(base_url, model, texts):
        calls.append(list(texts))
        out = []
        for t in texts:
            # 詞彙完全不重疊 → 零向量 → cosine 回 0.0（正是「語意不相關」該有的）
            out.append([1.0 if w in t else 0.0 for w in _VOCAB])
        return out

    return fake_embed


@pytest.fixture
def sticky(data_dir):
    return StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))


def _seed(sticky):
    a = sticky.add_note("行李清單", "護照 旅遊 要帶的東西", "旅遊")
    b = sticky.add_note("晨跑計畫", "每天跑步 運動 30 分鐘", "健康")
    c = sticky.add_note("報稅提醒", "五月要處理財務 報稅", "理財")
    return a.id, b.id, c.id


def _svc(sticky, calls, **kw):
    return NoteSemanticService(sticky, embed_fn=_make_embed(calls), **kw)


# ── cosine ────────────────────────────────────────────────────────

def test_cosine_basic():
    assert cosine([1, 0], [1, 0]) == pytest.approx(1.0)
    assert cosine([1, 0], [0, 1]) == pytest.approx(0.0)
    assert cosine([1, 1], [1, 0]) == pytest.approx(0.70710, abs=1e-4)
    assert cosine([0, 0], [1, 1]) == 0.0
    assert cosine([1, 2, 3], [1, 2]) == 0.0  # 長度不一


# ── 排序 / 篩選 ───────────────────────────────────────────────────

def test_search_ranks_by_meaning(sticky):
    a, b, c = _seed(sticky)
    calls = []
    res = _svc(sticky, calls).search("出國前要準備的行李")
    assert res["ok"] is True
    ids = [r["id"] for r in res["results"]]
    assert ids == [a]  # 只有「行李清單」那則跨過門檻
    assert res["results"][0]["score"] > 0.35
    assert res["embedded"] == 3  # 三則便利貼第一次都要算


def test_search_empty_query_returns_empty(sticky):
    _seed(sticky)
    calls = []
    res = _svc(sticky, calls).search("   ")
    assert res == {"ok": True, "results": [], "model": mod.STICKY_EMBED_MODEL_DEFAULT,
                   "error": None, "embedded": 0, "total": 0, "top_score": 0.0}
    assert calls == []  # 沒送任何東西給 Ollama


def test_search_respects_tag_filter(sticky):
    a, b, c = _seed(sticky)
    calls = []
    res = _svc(sticky, calls).search("跑步 運動", tag="旅遊")
    assert res["results"] == []  # 「健康」那則被標籤篩掉了
    assert res["total"] == 1


def test_search_below_threshold_excluded(sticky):
    _seed(sticky)
    calls = []
    res = _svc(sticky, calls).search("完全無關的量子力學")
    assert res["results"] == []
    assert res["top_score"] == 0.0


def test_search_relative_cutoff_trims_long_tail(sticky, data_dir):
    """相對門檻：只留跟『最高分』夠接近的，分數掉太多的長尾切掉——不是固定
    絕對值（否則 bge-m3 那種「什麼都 0.4 起跳」的模型會整面牆都回來）。"""
    import math

    # 每則便利貼標題放一個 0–99 的數字；fake embed 讓 cosine 剛好等於 數字/100。
    wanted = [95, 90, 55, 50, 35, 20]
    for w in wanted:
        sticky.add_note(str(w), "", "")

    def graded_embed(_b, _m, texts):
        out = []
        for t in texts:
            if t == "__QUERY__":
                out.append([1.0, 0.0])
                continue
            d = next((n / 100 for n in wanted if f"標題：{n}。" in t), 0.0)
            out.append([d, math.sqrt(max(0.0, 1 - d * d))])  # 單位向量 → cosine == d
        return out

    svc = NoteSemanticService(sticky, embed_fn=graded_embed, cache_path=data_dir / ".e.json")
    res = svc.search("__QUERY__")
    scores = [r["score"] for r in res["results"]]
    assert scores == sorted(scores, reverse=True)
    # top=0.95；ratio 0.90 → 0.855、band 0.10 → 0.85 → cutoff 0.855 → 只留 0.95、0.90
    assert scores == [0.95, 0.9]
    assert res["top_score"] == 0.95


# ── 快取 ─────────────────────────────────────────────────────────

def test_vectors_cached_and_reused(sticky, data_dir):
    _seed(sticky)
    calls = []
    svc = _svc(sticky, calls)
    svc.search("行李")
    assert (data_dir / ".sticky_notes_embeddings.json").exists()

    calls.clear()
    res = svc.search("運動")
    assert res["embedded"] == 0  # 三則都命中快取
    assert calls == [["運動"]]  # 只有查詢句重新 embed


def test_cache_invalidated_on_note_edit(sticky):
    a, b, c = _seed(sticky)
    calls = []
    svc = _svc(sticky, calls)
    svc.search("行李")

    sticky.update_note(b, "晨跑計畫", "改成報稅 財務 相關內容", "健康")
    calls.clear()
    res = svc.search("行李")
    assert res["embedded"] == 1  # 只有被改過的那則重算


def test_cache_invalidated_on_model_change(sticky):
    _seed(sticky)
    calls = []
    svc = _svc(sticky, calls)
    svc.search("行李", model="model-a")
    calls.clear()
    res = svc.search("行李", model="model-b")
    assert res["embedded"] == 3  # 換模型 → 整份重算


def test_deleted_note_vector_pruned(sticky, data_dir):
    a, b, c = _seed(sticky)
    calls = []
    svc = _svc(sticky, calls)
    svc.search("行李")
    sticky.delete_note(a)
    svc.search("行李")
    cached = json.loads((data_dir / ".sticky_notes_embeddings.json").read_text(encoding="utf-8"))
    assert set(cached["vectors"]) == {b, c}


# ── Ollama 失敗 ──────────────────────────────────────────────────

def test_ollama_failure_returns_error_not_raises(sticky):
    _seed(sticky)

    def boom(*_a):
        raise AIProviderError("連線失敗：Connection refused")

    svc = NoteSemanticService(sticky, embed_fn=boom)
    res = svc.search("行李")
    assert res["ok"] is False
    assert "連線失敗" in res["error"]
    assert res["results"] == []


def test_status_reports_missing_model(sticky, monkeypatch):
    monkeypatch.setattr(mod, "list_models", lambda _url: ["llama3.1:latest", "qwen2.5:latest"])
    svc = NoteSemanticService(sticky, embed_fn=_make_embed([]))
    st = svc.status("nomic-embed-text")
    assert st["ok"] is False
    assert st["installed"] is False
    assert "ollama pull nomic-embed-text" in st["error"]


def test_status_ok_when_model_present(sticky, monkeypatch):
    monkeypatch.setattr(mod, "list_models", lambda _url: ["nomic-embed-text:latest"])
    svc = NoteSemanticService(sticky, embed_fn=_make_embed([]))
    st = svc.status("nomic-embed-text")
    assert st["ok"] is True
    assert st["installed"] is True
    assert st["error"] is None
