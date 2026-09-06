from file_search_app.repositories.cache_repository import CacheRepository
from file_search_app.repositories.index_repository import IndexRepository
from file_search_app.repositories.metadata_repository import MetadataRepository
from file_search_app.services.index_service import IndexService
from tests.conftest import make_index_md


def build(data_dir):
    ir = IndexRepository(indexes_dir=data_dir)
    cr = CacheRepository(indexes_dir=data_dir)
    mr = MetadataRepository(indexes_dir=data_dir)
    return IndexService(ir, cr, mr), ir, cr, mr


def test_add_entry_records_time(data_dir):
    svc, ir, _cr, mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [])
    svc.add_entry(md, "C:/a.txt", "cat", "desc")
    assert [e.path for e in ir.load_entries(md)] == ["C:/a.txt"]
    assert mr.get_added_at(mr.load_added_times(), md, "C:/a.txt") is not None


def test_add_entries_batch(data_dir):
    svc, ir, _cr, mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [])
    n = svc.add_entries(md, ["C:/1.txt", "C:/2.txt", "C:/3.txt"], "K", "")
    assert n == 3 and len(ir.load_entries(md)) == 3
    assert set(mr.load_added_times()[md.name]) == {"C:/1.txt", "C:/2.txt", "C:/3.txt"}


def test_load_all_entries_single_index_serials(data_dir):
    svc, _ir, _cr, _mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [("C:/1.txt", "", ""), ("C:/2.txt", "", "")])
    entries, cache, status = svc.load_all_entries(md)
    assert [e.serial for e in entries] == [1, 2]
    assert "a.md" in status
    assert cache == {}


def test_load_all_entries_aggregate_continuous_serials(data_dir):
    svc, _ir, _cr, _mr = build(data_dir)
    make_index_md(data_dir / "a.md", [("C:/1.txt", "", "")])
    make_index_md(data_dir / "b.md", [("C:/2.txt", "", ""), ("C:/3.txt", "", "")])
    entries, _cache, status = svc.load_all_entries(None)
    assert [e.serial for e in entries] == [1, 2, 3]
    assert {e.source_index.name for e in entries} == {"a.md", "b.md"}
    assert "全部索引" in status


def test_update_entry_by_row_index(data_dir):
    svc, ir, _cr, _mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [("C:/dup.txt", "old", ""), ("C:/dup.txt", "old", "")])
    entries, _c, _s = svc.load_all_entries(md)
    assert svc.update_entry(entries[1], "new", "n") is True
    after = ir.load_entries(md)
    assert (after[0].category, after[1].category) == ("old", "new")


def test_delete_entry_and_delete_entries(data_dir):
    svc, ir, _cr, _mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [
        ("C:/1.txt", "", ""), ("C:/2.txt", "", ""), ("C:/3.txt", "", ""),
    ])
    entries, _c, _s = svc.load_all_entries(md)
    assert svc.delete_entry(entries[0]) is True
    entries, _c, _s = svc.load_all_entries(md)
    assert svc.delete_entries(entries) == 2
    assert ir.load_entries(md) == []


def test_update_categories_single_file(data_dir):
    svc, ir, _cr, _mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [
        ("C:/1.txt", "old", "d1"), ("C:/2.txt", "old", "d2"), ("C:/3.txt", "old", "d3"),
    ])
    entries, _c, _s = svc.load_all_entries(md)
    updated = svc.update_categories([entries[0], entries[2]], "new")
    assert updated == 2
    after = ir.load_entries(md)
    assert [e.category for e in after] == ["new", "old", "new"]


def test_update_categories_groups_by_source_file_one_write_each(data_dir, monkeypatch):
    svc, ir, _cr, _mr = build(data_dir)
    a = make_index_md(data_dir / "a.md", [("C:/1.txt", "old", "")])
    b = make_index_md(data_dir / "b.md", [("C:/2.txt", "old", "")])
    entries, _c, _s = svc.load_all_entries(None)  # aggregate across both files

    calls = []
    orig = ir.update_categories_by_occurrences

    def spy(md_path, updates):
        calls.append(md_path)
        return orig(md_path, updates)

    monkeypatch.setattr(ir, "update_categories_by_occurrences", spy)
    updated = svc.update_categories(entries, "new")
    assert updated == 2
    assert sorted(calls) == sorted([a, b])  # exactly one write per distinct file
    assert ir.load_entries(a)[0].category == "new"
    assert ir.load_entries(b)[0].category == "new"


def test_update_categories_can_clear_to_empty(data_dir):
    svc, ir, _cr, _mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [("C:/1.txt", "old", "")])
    entries, _c, _s = svc.load_all_entries(md)
    assert svc.update_categories(entries, "") == 1
    assert ir.load_entries(md)[0].category == ""


def test_delete_index_drops_cache_and_metadata(data_dir):
    svc, ir, cr, mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [("C:/1.txt", "", "")])
    cr.save(md, {"C:/1.txt": {"hash": "h"}})
    mr.record_added_time(md, "C:/1.txt")
    svc.delete_index(md)
    assert not md.exists()
    assert cr.load(md) == {}
    assert "a.md" not in mr.load_added_times()


def test_preview_cleanup_then_apply(data_dir, tmp_path):
    svc, ir, _cr, _mr = build(data_dir)
    real = tmp_path / "real.txt"
    real.write_text("x", encoding="utf-8")
    md = make_index_md(data_dir / "a.md", [(str(real), "", ""), (str(tmp_path / "ghost.txt"), "", "")])
    pending = svc.preview_cleanup([md])
    assert pending and pending[0][1] == 1
    assert svc.apply_cleanup(pending) == 1
    assert [e.path for e in ir.load_entries(md)] == [str(real)]


def test_resolve_scope_files(data_dir):
    svc, _ir, _cr, _mr = build(data_dir)
    a = make_index_md(data_dir / "a.md", [])
    make_index_md(data_dir / "b.md", [])
    assert svc.resolve_scope_files(a) == [a]
    assert len(svc.resolve_scope_files(None)) == 2


def test_export_index_text_returns_raw_markdown(data_dir):
    svc, ir, _cr, _mr = build(data_dir)
    md = make_index_md(data_dir / "a.md", [("C:/1.txt", "cat", "desc")])
    assert svc.export_index_text(md) == ir.read_text(md)


def test_import_index_creates_new_file_from_content(data_dir):
    svc, ir, _cr, _mr = build(data_dir)
    src_content = "| `C:/x.txt` | k | v |\n"
    filename, err = svc.validate_name("imported")
    assert err is None
    p = svc.import_index(filename, src_content)
    assert p.exists()
    assert [e.path for e in ir.load_entries(p)] == ["C:/x.txt"]
