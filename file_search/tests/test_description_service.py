from file_search_app.repositories.cache_repository import CacheRepository
from file_search_app.repositories.index_repository import IndexRepository
from file_search_app.repositories.metadata_repository import MetadataRepository
from file_search_app.services.description_service import DescriptionService
from file_search_app.services.index_service import IndexService
from tests.conftest import entry, make_index_md


class FakePreview:
    has_pil = True

    def extract_preview_text(self, p, max_chars=3000):
        return "第一行\n第二行\n第三行"


def _svc(data_dir):
    ir = IndexRepository(indexes_dir=data_dir)
    cr = CacheRepository(indexes_dir=data_dir)
    mr = MetadataRepository(indexes_dir=data_dir)
    return DescriptionService(FakePreview(), IndexService(ir, cr, mr)), ir


def test_find_blank_entries_excludes_filled_and_missing(tmp_path, data_dir):
    svc, _ir = _svc(data_dir)
    real = tmp_path / "a.txt"
    real.write_text("x", encoding="utf-8")
    es = [
        entry(path=str(real), description="", serial=1),
        entry(path=str(real), description="有說明", serial=2),
        entry(path=str(tmp_path / "ghost.txt"), description="", serial=3),
    ]
    assert [e.serial for e in svc.find_blank_entries(es)] == [1]


def test_build_suggestion_image_returns_empty(tmp_path, data_dir):
    svc, _ir = _svc(data_dir)
    img = tmp_path / "p.png"
    img.write_bytes(b"x")
    assert svc.build_suggestion(entry(path=str(img)), {}) == ""


def test_build_suggestion_text_uses_cache_or_extract(tmp_path, data_dir):
    svc, _ir = _svc(data_dir)
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    got = svc.build_suggestion(entry(path=str(f)), {})
    assert got == "第一行\n第二行\n第三行"
    cached = svc.build_suggestion(entry(path=str(f)), {str(f): {"text": "來自快取"}})
    assert cached == "來自快取"


def test_build_suggestion_missing_file_none(tmp_path, data_dir):
    svc, _ir = _svc(data_dir)
    assert svc.build_suggestion(entry(path=str(tmp_path / "x.txt")), {}) is None


def test_generate_suggestions_and_cancel(tmp_path, data_dir):
    svc, _ir = _svc(data_dir)
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    blanks = [entry(path=str(f), serial=i) for i in range(3)]
    res, cancelled = svc.generate_suggestions(blanks, {})
    assert cancelled is False and len(res) == 3

    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        return calls["n"] > 1

    res, cancelled = svc.generate_suggestions(blanks, {}, cancel_check=cancel)
    assert cancelled is True and len(res) == 1


def test_apply_updates_writes_desc_keeps_category(data_dir, tmp_path):
    svc, ir = _svc(data_dir)
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    md = make_index_md(data_dir / "i.md", [(str(f), "原分類", "")])
    e = ir.load_entries(md)[0]
    assert svc.apply_updates([(e, "新說明")]) == 1
    after = ir.load_entries(md)[0]
    assert (after.category, after.description) == ("原分類", "新說明")
