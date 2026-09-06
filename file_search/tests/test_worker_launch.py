import sys

import pytest

from file_search_app import worker_launch


def test_worker_argv_source_mode(monkeypatch):
    monkeypatch.setattr(worker_launch, "is_frozen", lambda: False)
    argv = worker_launch.worker_argv("transcription", "a.mp3", "out.txt")
    assert argv[0] == sys.executable
    assert argv[1].endswith("_transcription_worker.py")
    assert argv[-2:] == ["a.mp3", "out.txt"]


def test_worker_argv_frozen_mode(monkeypatch):
    monkeypatch.setattr(worker_launch, "is_frozen", lambda: True)
    argv = worker_launch.worker_argv("legacy_office", ".doc", "C:/x.doc")
    assert argv == [sys.executable, "--run-worker", "legacy_office", ".doc", "C:/x.doc"]


def test_worker_argv_unknown():
    with pytest.raises(KeyError):
        worker_launch.worker_argv("nope")


def test_worker_available(monkeypatch):
    monkeypatch.setattr(worker_launch, "is_frozen", lambda: False)
    assert worker_launch.worker_available("transcription") is True
    assert worker_launch.worker_available("nope") is False
    monkeypatch.setattr(worker_launch, "is_frozen", lambda: True)
    assert worker_launch.worker_available("anything") is True
