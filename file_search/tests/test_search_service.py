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
