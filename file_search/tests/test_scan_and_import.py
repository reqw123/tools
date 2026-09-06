from pathlib import Path

from file_search_app.services.import_service import ImportService, path_key
from file_search_app.services.scan_service import ScanService
from tests.conftest import entry


# ── ScanService ───────────────────────────────────────────────────

def _tree(tmp_path):
    (tmp_path / "sub").mkdir()
    (tmp_path / "a.txt").write_text("x", encoding="utf-8")
    (tmp_path / "b.pdf").write_text("x", encoding="utf-8")
    (tmp_path / "sub" / "c.txt").write_text("x", encoding="utf-8")
    return tmp_path


def test_iter_scan_files_non_recursive(tmp_path):
    _tree(tmp_path)
    files = list(ScanService.iter_scan_files(tmp_path, recursive=False, extensions=set()))
    assert {f.name for f in files} == {"a.txt", "b.pdf"}


def test_iter_scan_files_recursive_and_ext_filter(tmp_path):
    _tree(tmp_path)
    files = list(ScanService.iter_scan_files(tmp_path, recursive=True, extensions={".txt"}))
    assert {f.name for f in files} == {"a.txt", "c.txt"}


def test_iter_jobs_chains(tmp_path):
    _tree(tmp_path)
    jobs = [(tmp_path, False, {".txt"}), (tmp_path / "sub", False, set())]
    files = list(ScanService.iter_jobs(jobs))
    assert {f.name for f in files} == {"a.txt", "c.txt"}


def test_categorize_counts_sums_to_total(tmp_path):
    files = [Path("a.docx"), Path("b.pdf"), Path("c.pdf"), Path("d.weird")]
    counts = ScanService.categorize_counts(files)
    total = sum(c for _l, _i, c in counts)
    assert total == 4
    d = {label: c for label, _i, c in counts}
    assert d["PDF"] == 2 and d["其他"] == 1


def test_find_unindexed_uses_case_insensitive_key():
    existing = {path_key(r"C:\docs\a.txt")}
    found = [Path(r"C:\docs\A.TXT"), Path(r"C:\docs\b.txt")]
    out = ScanService.find_unindexed(found, existing)
    assert [p.name for p in out] == ["b.txt"]


# ── ImportService ─────────────────────────────────────────────────

def test_path_key_normalises_case_and_separators():
    assert path_key("C:/A/B.TXT") == path_key(r"c:\a\b.txt")


def test_parse_dnd_paths():
    data = "{C:/a b/c.txt} C:/d.txt {C:/e f.png}"
    assert ImportService.parse_dnd_paths(data) == ["C:/a b/c.txt", "C:/d.txt", "C:/e f.png"]


def test_existing_path_keys():
    keys = ImportService(None).existing_path_keys([entry(path=r"C:\X\one.txt")])
    assert keys == {path_key(r"c:\x\ONE.txt")}


def test_normalize_candidates_classifies(tmp_path):
    real = tmp_path / "real.txt"
    real.write_text("x", encoding="utf-8")
    (tmp_path / "folder").mkdir()
    svc = ImportService(None)
    existing = {path_key(str(real))}
    accepted, missing, folders, dups = svc.normalize_candidates(
        [str(real), str(tmp_path / "folder"), str(tmp_path / "ghost.txt")],
        existing,
    )
    assert accepted == []
    assert (missing, folders, dups) == (1, 1, 1)


def test_normalize_candidates_dedups_within_batch(tmp_path):
    f = tmp_path / "x.txt"
    f.write_text("x", encoding="utf-8")
    svc = ImportService(None)
    accepted, _m, _f, dups = svc.normalize_candidates([str(f), str(f).upper()], set())
    assert len(accepted) == 1 and dups == 1


class _FakeIndexService:
    def __init__(self):
        self.calls = []

    def add_entries(self, md_path, path_strs, category, desc):
        self.calls.append((md_path, list(path_strs), category, desc))
        return len(path_strs)


def test_import_folder_delegates_batched():
    fake = _FakeIndexService()
    svc = ImportService(fake)
    files = [Path("C:/1.txt"), Path("C:/2.txt")]
    n = svc.import_folder(Path("i.md"), files, "分類")
    assert n == 2
    assert fake.calls == [(Path("i.md"), [str(p) for p in files], "分類", "")]
