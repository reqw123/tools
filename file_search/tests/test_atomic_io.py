import os

import pytest

from file_search_app.repositories.atomic_io import atomic_write_text


def test_writes_content_and_creates_parent(tmp_path):
    target = tmp_path / "sub" / "deep" / "f.txt"
    atomic_write_text(target, "hello")
    assert target.read_text(encoding="utf-8") == "hello"


def test_overwrite_is_atomic_replace(tmp_path):
    target = tmp_path / "f.txt"
    atomic_write_text(target, "v1")
    atomic_write_text(target, "v2")
    assert target.read_text(encoding="utf-8") == "v2"


def test_no_tmp_files_left_behind(tmp_path):
    target = tmp_path / "f.txt"
    atomic_write_text(target, "x")
    leftovers = [p for p in tmp_path.iterdir() if p.name != "f.txt"]
    assert leftovers == []


def test_failure_cleans_up_tmp(tmp_path, monkeypatch):
    target = tmp_path / "f.txt"

    def boom(*a, **k):
        raise RuntimeError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(RuntimeError):
        atomic_write_text(target, "x")
    assert list(tmp_path.iterdir()) == []
