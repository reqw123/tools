from datetime import datetime
from pathlib import Path

from file_search_app.models import IndexEntry, format_added_at
from file_search_app.ui.styles import darken, icon_for, lighten


def test_format_added_at_none():
    assert format_added_at(None) == "—"


def test_format_added_at_value():
    assert format_added_at(datetime(2026, 7, 3, 9, 5)) == "7/3 09:05"


def test_index_entry_derived_props(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    e = IndexEntry(path=str(f), category="c", description="d", source_index=Path("i.md"), row_index=0)
    assert e.name == "a.txt"
    assert e.path_obj == Path(str(f))
    assert e.exists is True
    e2 = IndexEntry(path=str(tmp_path / "missing.txt"), category="", description="",
                    source_index=Path("i.md"), row_index=1)
    assert e2.exists is False


def test_index_entry_path_is_raw_string_not_normalised():
    raw = "C:/mixed\\seps/file.TXT"
    e = IndexEntry(path=raw, category="", description="", source_index=Path("i.md"), row_index=0)
    assert e.path == raw  # 刻意不正規化，快取比對靠原始字串


def test_lighten_darken_bounds():
    assert lighten("#000000", 1.0) == "#ffffff"
    assert lighten("#ffffff", 0.5) == "#ffffff"
    assert darken("#ffffff", 1.0) == "#000000"
    assert darken("#808080", 0.0) == "#808080"


def test_lighten_darken_are_inverse_ish():
    base = "#3366cc"
    assert lighten(base, 0.0) == base
    assert darken(base, 0.0) == base


def test_icon_for_known_and_unknown():
    assert icon_for("x.pdf") != icon_for("x.unknownext")
    assert icon_for("x.PDF") == icon_for("x.pdf")  # 副檔名比對不分大小寫
