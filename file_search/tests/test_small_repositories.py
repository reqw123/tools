"""cache / ai_usage / app_prefs / ai_settings repository。"""
import threading

from file_search_app.repositories.ai_settings_repository import AISettingsRepository
from file_search_app.repositories.ai_usage_repository import AIUsageRepository
from file_search_app.repositories.app_prefs_repository import AppPrefsRepository
from file_search_app.repositories.cache_repository import CacheRepository


# ── CacheRepository ─────────────────────────────────────────────────

def test_cache_hash_of_file(tmp_path):
    f = tmp_path / "a.bin"
    f.write_bytes(b"hello")
    import hashlib
    assert CacheRepository.compute_file_hash(f) == hashlib.sha256(b"hello").hexdigest()
    assert CacheRepository.compute_file_hash(tmp_path / "nope") is None


def test_cache_load_save_roundtrip(data_dir, tmp_path):
    r = CacheRepository(indexes_dir=data_dir)
    md = tmp_path / "x.md"
    r.save(md, {"C:/a.txt": {"hash": "h", "size": 1}})
    assert r.load(md)["C:/a.txt"]["hash"] == "h"


def test_cache_load_tolerates_bad_shapes(data_dir, tmp_path):
    r = CacheRepository(indexes_dir=data_dir)
    md = tmp_path / "x.md"
    cp = r.cache_path_for(md)
    cp.parent.mkdir(parents=True, exist_ok=True)
    cp.write_text("[]", encoding="utf-8")
    assert r.load(md) == {}
    cp.write_text('{"good": {"a": 1}, "bad": "not dict"}', encoding="utf-8")
    assert set(r.load(md)) == {"good"}


def test_cache_delete(data_dir, tmp_path):
    r = CacheRepository(indexes_dir=data_dir)
    md = tmp_path / "x.md"
    r.save(md, {"a": {"b": 1}})
    r.delete(md)
    assert r.load(md) == {}
    r.delete(md)  # 不存在也不該炸


# ── AIUsageRepository ───────────────────────────────────────────────

def test_usage_counter_increments(data_dir):
    r = AIUsageRepository(indexes_dir=data_dir)
    assert r.load_call_count() == 0
    assert r.increment_call_count() == 1
    assert r.increment_call_count(3) == 4


def test_usage_counter_tolerates_garbage(data_dir):
    (data_dir / ".ai_usage.json").write_text("boom", encoding="utf-8")
    assert AIUsageRepository(indexes_dir=data_dir).load_call_count() == 0


def test_usage_counter_thread_safe(data_dir):
    r = AIUsageRepository(indexes_dir=data_dir)

    def bump():
        for _ in range(40):
            r.increment_call_count()

    ts = [threading.Thread(target=bump) for _ in range(5)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert r.load_call_count() == 200


# ── AppPrefsRepository ─────────────────────────────────────────────

def test_app_prefs_seek_seconds_roundtrip_and_clamp(data_dir):
    r = AppPrefsRepository(indexes_dir=data_dir)
    assert r.load_seek_seconds() == 5           # 預設
    r.save_seek_seconds(9999)
    assert r.load_seek_seconds() == 600          # 夾到 MAX
    r.save_seek_seconds(-4)
    assert r.load_seek_seconds() == 1            # 夾到 MIN


def test_app_prefs_help_delta_roundtrip(data_dir):
    r = AppPrefsRepository(indexes_dir=data_dir)
    assert r.load_help_font_delta() == 0
    r.save_help_font_delta(3)
    assert r.load_help_font_delta() == 3


def test_app_prefs_survives_corrupt_nested_shape(data_dir):
    (data_dir / ".app_prefs.json").write_text('{"media": "broken", "help": 7}', encoding="utf-8")
    r = AppPrefsRepository(indexes_dir=data_dir)
    assert r.load_seek_seconds() == 5
    assert r.load_help_font_delta() == 0
    r.save_seek_seconds(10)   # 不該因為 media 是字串而炸
    assert r.load_seek_seconds() == 10


# ── AISettingsRepository ───────────────────────────────────────────

def test_ai_settings_defaults(data_dir, tmp_path):
    r = AISettingsRepository(indexes_dir=data_dir, secrets_dir=tmp_path / "sec")
    s = r.load()
    assert s["provider"] == "openai"
    assert s["openai"]["api_key"] == ""
    assert s["ollama"]["base_url"] == "http://localhost:11434"


def test_ai_settings_api_key_not_written_to_portable_file(data_dir, tmp_path):
    sec = tmp_path / "sec"
    r = AISettingsRepository(indexes_dir=data_dir, secrets_dir=sec)
    r.save({
        "provider": "openai",
        "openai": {"api_key": "sk-secret", "model": "m", "base_url": "u"},
        "ollama": {"base_url": "http://localhost:11434", "model": "llama3.1"},
    })
    portable = (data_dir / ".ai_settings.json").read_text(encoding="utf-8")
    assert "sk-secret" not in portable
    assert "sk-secret" in (sec / "ai_secrets.json").read_text(encoding="utf-8")
    # 再讀回來 key 要補回去
    assert r.load()["openai"]["api_key"] == "sk-secret"


def test_ai_settings_migrates_legacy_plaintext_key(data_dir, tmp_path):
    (data_dir / ".ai_settings.json").write_text(
        '{"provider": "openai", "openai": {"api_key": "sk-old", "model": "m", "base_url": "u"}}',
        encoding="utf-8",
    )
    sec = tmp_path / "sec"
    r = AISettingsRepository(indexes_dir=data_dir, secrets_dir=sec)
    assert r.load()["openai"]["api_key"] == "sk-old"
    # 遷移後舊檔明碼要被清空
    assert "sk-old" not in (data_dir / ".ai_settings.json").read_text(encoding="utf-8")
    assert "sk-old" in (sec / "ai_secrets.json").read_text(encoding="utf-8")


def test_ai_settings_tolerates_garbage(data_dir, tmp_path):
    (data_dir / ".ai_settings.json").write_text("nonsense", encoding="utf-8")
    r = AISettingsRepository(indexes_dir=data_dir, secrets_dir=tmp_path / "sec")
    assert r.load()["provider"] == "openai"
