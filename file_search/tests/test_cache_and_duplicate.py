from pathlib import Path

from file_search_app.repositories.cache_repository import CacheRepository, HASH_ALGO
from file_search_app.repositories.index_repository import IndexRepository
from file_search_app.repositories.metadata_repository import MetadataRepository
from file_search_app.services.cache_service import CacheService
from file_search_app.services.duplicate_service import DuplicateService
from file_search_app.services.index_service import IndexService
from tests.conftest import make_index_md


class FakePreview:
    """extract_preview_text 依內容回傳固定字串。"""
    def extract_preview_text(self, p, max_chars=3000):
        return f"TEXT<{Path(p).name}>"


def _services(data_dir):
    ir = IndexRepository(indexes_dir=data_dir)
    cr = CacheRepository(indexes_dir=data_dir)
    mr = MetadataRepository(indexes_dir=data_dir)
    cache_svc = CacheService(ir, cr, FakePreview())
    idx_svc = IndexService(ir, cr, mr)
    dup_svc = DuplicateService(ir, cr, idx_svc)
    return ir, cr, cache_svc, idx_svc, dup_svc


def test_refresh_entry_creates_and_detects_no_change(data_dir, tmp_path):
    _ir, _cr, cache_svc, _idx, _dup = _services(data_dir)
    f = tmp_path / "a.txt"
    f.write_text("hello", encoding="utf-8")
    cache = {}
    assert cache_svc.refresh_entry(str(f), cache) is True
    assert cache[str(f)]["hash_algo"] == HASH_ALGO
    assert cache[str(f)]["text"] == "TEXT<a.txt>"
    # 沒變 → 回 False
    assert cache_svc.refresh_entry(str(f), cache) is False
    # 內容變了 → 回 True
    f.write_text("changed", encoding="utf-8")
    assert cache_svc.refresh_entry(str(f), cache) is True


def test_refresh_entry_drops_missing(data_dir, tmp_path):
    _ir, _cr, cache_svc, _idx, _dup = _services(data_dir)
    cache = {"C:/gone.txt": {"hash": "h"}}
    assert cache_svc.refresh_entry("C:/gone.txt", cache) is True
    assert "C:/gone.txt" not in cache


def test_update_cache_for_index_prunes_stale(data_dir, tmp_path):
    ir, cr, cache_svc, _idx, _dup = _services(data_dir)
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    md = make_index_md(data_dir / "i.md", [(str(f), "", "")])
    cr.save(md, {"C:/stale.txt": {"hash": "old"}})
    seen = []
    cache = cache_svc.update_cache_for_index(md, progress_cb=lambda d, t: seen.append((d, t)))
    assert str(f) in cache and "C:/stale.txt" not in cache
    assert seen == [(1, 1)]


def test_write_transcript_text_no_length_cap(data_dir, tmp_path):
    ir, cr, cache_svc, idx_svc, _dup = _services(data_dir)
    f = tmp_path / "clip.mp3"
    f.write_bytes(b"fakeaudio")
    md = make_index_md(data_dir / "i.md", [(str(f), "", "")])
    entries, _c, _s = idx_svc.load_all_entries(md)
    long_text = "詞 " * 5000
    cache = cache_svc.write_transcript_text(entries[0], long_text)
    assert cache[str(f)]["text"] == long_text
    assert cache[str(f)]["hash_algo"] == HASH_ALGO


def test_duplicate_group_only_real_dupes(data_dir, tmp_path):
    ir, cr, cache_svc, _idx, dup_svc = _services(data_dir)
    a = tmp_path / "a.txt"
    b = tmp_path / "b.txt"
    c = tmp_path / "c.txt"
    a.write_text("same", encoding="utf-8")
    b.write_text("same", encoding="utf-8")
    c.write_text("different", encoding="utf-8")
    md = make_index_md(data_dir / "i.md", [(str(a), "", ""), (str(b), "", ""), (str(c), "", "")])
    cache_svc.update_cache_for_index(md)
    groups = dup_svc.group([md])
    assert len(groups) == 1
    paths = {e.path for e in groups[0].entries}
    assert paths == {str(a), str(b)}


def test_duplicate_remove_entries_delegates(data_dir, tmp_path):
    ir, cr, cache_svc, idx_svc, dup_svc = _services(data_dir)
    a = tmp_path / "a.txt"
    b = tmp_path / "b.txt"
    a.write_text("same", encoding="utf-8")
    b.write_text("same", encoding="utf-8")
    md = make_index_md(data_dir / "i.md", [(str(a), "", ""), (str(b), "", "")])
    cache_svc.update_cache_for_index(md)
    groups = dup_svc.group([md])
    to_remove = groups[0].entries[1:]
    assert dup_svc.remove_entries(to_remove) == 1
    assert len(ir.load_entries(md)) == 1
