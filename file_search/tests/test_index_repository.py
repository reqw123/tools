from file_search_app.repositories.index_repository import IndexRepository
from tests.conftest import make_index_md


def repo(data_dir):
    return IndexRepository(indexes_dir=data_dir)


def test_load_entries_parses_rows(data_dir):
    md = make_index_md(data_dir / "a.md", [
        ("C:/x/1.txt", "工作", "報告"),
        ("C:/x/2.pdf", "", "沒有分類"),
    ])
    entries = repo(data_dir).load_entries(md)
    assert [e.path for e in entries] == ["C:/x/1.txt", "C:/x/2.pdf"]
    assert entries[0].category == "工作"
    assert entries[1].category == ""       # 空分類要解析成空字串，不是 " "
    assert [e.row_index for e in entries] == [0, 1]


def test_load_entries_skips_malformed_and_missing_file(data_dir):
    md = data_dir / "a.md"
    md.write_text("# hi\n| `C:/ok.txt` | c | d |\nnot a row\n|missing pipe\n", encoding="utf-8")
    entries = repo(data_dir).load_entries(md)
    assert [e.path for e in entries] == ["C:/ok.txt"]
    assert repo(data_dir).load_entries(data_dir / "nope.md") == []


def test_append_row_and_append_rows(data_dir):
    r = repo(data_dir)
    md = make_index_md(data_dir / "a.md", [])
    r.append_row(md, "C:/a.txt", "cat", "d")
    r.append_rows(md, [("C:/b.txt", "", ""), ("C:/c.txt", "x", "y")])
    entries = r.load_entries(md)
    assert [e.path for e in entries] == ["C:/a.txt", "C:/b.txt", "C:/c.txt"]


def test_append_rows_empty_is_noop(data_dir):
    r = repo(data_dir)
    md = make_index_md(data_dir / "a.md", [("C:/a.txt", "", "")])
    before = md.read_text(encoding="utf-8")
    r.append_rows(md, [])
    assert md.read_text(encoding="utf-8") == before


def test_append_row_sanitises_pipe_and_newline(data_dir):
    r = repo(data_dir)
    md = make_index_md(data_dir / "a.md", [])
    r.append_row(md, "C:/a.txt", "a|b", "line1\nline2")
    e = r.load_entries(md)[0]
    assert "|" not in e.category and e.category == "a／b"
    assert "\n" not in e.description


def test_path_code_fence_grows_for_backticks(data_dir):
    r = repo(data_dir)
    md = make_index_md(data_dir / "a.md", [])
    weird = "C:/a`b``c.txt"
    r.append_row(md, weird, "", "")
    assert r.load_entries(md)[0].path == weird


def test_update_row_by_occurrence_targets_one_of_duplicates(data_dir):
    r = repo(data_dir)
    md = make_index_md(data_dir / "a.md", [
        ("C:/dup.txt", "old", "old"),
        ("C:/dup.txt", "old", "old"),
    ])
    ok = r.update_row_by_occurrence(md, 1, "new", "new")
    assert ok is True
    entries = r.load_entries(md)
    assert (entries[0].category, entries[1].category) == ("old", "new")


def test_update_row_by_occurrence_out_of_range(data_dir):
    r = repo(data_dir)
    md = make_index_md(data_dir / "a.md", [("C:/a.txt", "", "")])
    assert r.update_row_by_occurrence(md, 5, "x", "y") is False


def test_remove_rows_by_occurrences_keeps_the_rest(data_dir):
    r = repo(data_dir)
    md = make_index_md(data_dir / "a.md", [
        ("C:/1.txt", "", ""), ("C:/2.txt", "", ""), ("C:/3.txt", "", ""),
    ])
    removed, new_text = r.remove_rows_by_occurrences(md, {0, 2})
    assert removed == 2
    r.write_text(md, new_text)
    assert [e.path for e in r.load_entries(md)] == ["C:/2.txt"]


def test_remove_missing_rows(data_dir, tmp_path):
    real = tmp_path / "real.txt"
    real.write_text("x", encoding="utf-8")
    r = repo(data_dir)
    md = make_index_md(data_dir / "a.md", [
        (str(real), "", ""),
        (str(tmp_path / "ghost.txt"), "", ""),
    ])
    removed, new_text = r.remove_missing_rows(md)
    assert removed == 1
    assert str(real) in new_text and "ghost.txt" not in new_text


def test_validate_name(data_dir):
    r = repo(data_dir)
    assert r.validate_name("  ")[0] is None
    assert r.validate_name("a<b")[0] is None
    assert r.validate_name(".md")[0] is None
    fn, err = r.validate_name("我的索引")
    assert fn == "我的索引.md" and err is None
    (data_dir / "exists.md").write_text("x", encoding="utf-8")
    assert r.validate_name("exists")[0] is None


def test_ensure_default_index_only_when_empty(data_dir):
    r = repo(data_dir)
    r.ensure_default_index()
    files = r.list_index_files()
    assert len(files) == 1
    # 已有檔案時不再動作
    r.ensure_default_index()
    assert r.list_index_files() == files


def test_create_and_delete_index_file(data_dir):
    r = repo(data_dir)
    p = r.create_index_file("new.md")
    assert p.exists() and p in r.list_index_files()
    r.delete_index_file(p)
    assert not p.exists()
