from datetime import datetime
from pathlib import Path

from file_search_app.repositories.metadata_repository import MetadataRepository


def repo(d):
    return MetadataRepository(indexes_dir=d)


def test_record_and_get_added_time(data_dir):
    r = repo(data_dir)
    md = Path("a.md")
    r.record_added_time(md, "C:/x/1.txt")
    data = r.load_added_times()
    got = r.get_added_at(data, md, "C:/x/1.txt")
    assert isinstance(got, datetime)
    assert r.get_added_at(data, md, "C:/other.txt") is None


def test_record_added_times_batch_single_write(data_dir):
    r = repo(data_dir)
    md = Path("a.md")
    r.record_added_times(md, ["C:/1.txt", "C:/2.txt", "C:/3.txt"])
    data = r.load_added_times()
    assert set(data["a.md"]) == {"C:/1.txt", "C:/2.txt", "C:/3.txt"}


def test_record_added_times_empty_noop(data_dir):
    r = repo(data_dir)
    r.record_added_times(Path("a.md"), [])
    assert not (data_dir / ".added_times.json").exists()


def test_load_added_times_tolerates_garbage(data_dir):
    (data_dir / ".added_times.json").write_text("not json", encoding="utf-8")
    assert repo(data_dir).load_added_times() == {}
    (data_dir / ".added_times.json").write_text('{"a.md": "should be dict"}', encoding="utf-8")
    assert repo(data_dir).load_added_times() == {}


def test_remove_index_drops_its_bucket(data_dir):
    r = repo(data_dir)
    r.record_added_time(Path("a.md"), "C:/1.txt")
    r.record_added_time(Path("b.md"), "C:/2.txt")
    r.remove_index("a.md")
    data = r.load_added_times()
    assert "a.md" not in data and "b.md" in data


def test_known_folders_roundtrip(data_dir):
    r = repo(data_dir)
    assert r.load_known_folders() == []
    r.save_known_folders(["C:/A", "C:/B", ""])
    assert r.load_known_folders() == ["C:/A", "C:/B"]
