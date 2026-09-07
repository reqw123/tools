from file_search_app.services.search_service import SearchService
from tests.conftest import entry

S = SearchService()


def _entries():
    return [
        entry(path="C:/docs/report.pdf", category="工作", description="季度報告", serial=1),
        entry(path="C:/docs/note.txt", category="", description="隨手記", serial=2),
        entry(path="C:/pics/cat.png", category="圖片", description="貓咪", serial=3),
    ]


def test_distinct_categories():
    assert S.distinct_categories(_entries()) == ["圖片", "工作"]


def test_build_category_options_adds_uncategorised_only_when_present():
    opts = S.build_category_options(_entries())
    assert opts[0] == "全部" and "未分類" in opts
    no_blank = [entry(category="A"), entry(category="B")]
    assert "未分類" not in S.build_category_options(no_blank)


def test_build_folder_options():
    opts = S.build_folder_options(_entries())
    assert opts[0] == "全部"
    assert any(o.endswith("docs") for o in opts)


def test_filter_by_category_uncategorised():
    res = S.filter_entries(_entries(), "", "未分類", "全部", {})
    assert [e.serial for e in res] == [2]


def test_filter_by_folder():
    from pathlib import Path
    folder = S.build_folder_options(_entries())[1]  # 第一個非「全部」
    res = S.filter_entries(_entries(), "", "全部", folder, {})
    assert res and all(str(Path(e.path).parent) == folder for e in res)


def test_filter_by_keyword_matches_name_desc_path_serial():
    es = _entries()
    assert [e.serial for e in S.filter_entries(es, "報告", "全部", "全部", {})] == [1]
    assert [e.serial for e in S.filter_entries(es, "cat.png", "全部", "全部", {})] == [3]
    assert [e.serial for e in S.filter_entries(es, "3", "全部", "全部", {})] == [3]


def test_filter_by_cached_text():
    es = _entries()
    cache = {"C:/docs/note.txt": {"text": "這裡有一個秘密關鍵字 xyzzy"}}
    res = S.filter_entries(es, "xyzzy", "全部", "全部", cache)
    assert [e.serial for e in res] == [2]


def test_filter_preserves_serial_and_order():
    es = _entries()
    res = S.filter_entries(es, "", "全部", "全部", {})
    assert [e.serial for e in res] == [1, 2, 3]


# ── 內文命中片段 ───────────────────────────────────────────────────

def test_content_match_snippets_only_for_content_only_hits():
    es = _entries()
    cache = {
        # note.txt：query 只在內文（欄位沒有「祕密」）→ 要有片段；前後都夠長 → 頭尾補「…」
        "C:/docs/note.txt": {"text": "鋪陳" * 40 + "這裡藏了一個祕密關鍵字" + "收尾" * 40},
        # report.pdf：query 也在內文，但檔名/說明沒有「祕密」→ 也算內文命中
        "C:/docs/report.pdf": {"text": "季度祕密報表"},
        # cat.png：內文沒有 query
        "C:/pics/cat.png": {"text": "只是一張貓的圖"},
    }
    snips = S.content_match_snippets(es, "祕密", cache)
    assert set(snips) == {"C:/docs/note.txt", "C:/docs/report.pdf"}
    assert "祕密" in snips["C:/docs/note.txt"]
    assert snips["C:/docs/note.txt"].startswith("…") and snips["C:/docs/note.txt"].endswith("…")

    # query 命中檔名時不給片段（清單欄位本身就看得出來）
    assert S.content_match_snippets(es, "note", {"C:/docs/note.txt": {"text": "note note note"}}) == {}
    # query 太短 → 不給片段
    assert S.content_match_snippets(es, "祕", cache) == {}


def test_make_snippet_context_and_ellipsis():
    text = "A" * 100 + " TARGET " + "B" * 100
    snip = SearchService._make_snippet(text, "target")   # 不分大小寫
    assert "TARGET" in snip
    assert snip.startswith("…") and snip.endswith("…")
    assert len(snip) < 120                                # 只帶前後一小段
    # query 在開頭 → 前面不補「…」
    assert SearchService._make_snippet("TARGET 後面的內容", "TARGET").startswith("TARGET")
    assert SearchService._make_snippet("完全沒有", "target") == ""
