from file_search_app.repositories.ai_settings_repository import AISettingsRepository
from file_search_app.repositories.ai_usage_repository import AIUsageRepository
from file_search_app.services.ai_description_service import AIDescriptionService
from file_search_app.ai.base import AIProviderError
from tests.conftest import entry


class FakePreview:
    has_pil = True

    def __init__(self, text="擷取到的內容"):
        self._text = text

    def extract_preview_text(self, p, max_chars=3000):
        return self._text

    def prepare_image_for_ai(self, p, max_dimension=1024):
        return (b"jpegbytes", "image/jpeg")


class FakeTranscription:
    available = False

    def transcribe(self, p, progress_cb=None, cancel_check=None):
        return "", None, False


class FakeProvider:
    def __init__(self):
        self.calls = 0

    def generate_description(self, prompt):
        self.calls += 1
        return f"說明#{self.calls}"

    def generate_image_description(self, prompt, image_bytes, mime_type):
        self.calls += 1
        return "圖片說明"


def _svc(data_dir, tmp_path, provider=None, preview=None):
    settings = AISettingsRepository(indexes_dir=data_dir, secrets_dir=tmp_path / "sec")
    usage = AIUsageRepository(indexes_dir=data_dir)
    svc = AIDescriptionService(settings, preview or FakePreview(), FakeTranscription(), usage)
    if provider is not None:
        svc.build_provider = lambda *a, **k: provider
    return svc, usage


def test_is_configured(data_dir, tmp_path):
    svc, _u = _svc(data_dir, tmp_path)
    ok, reason = svc.is_configured()
    assert ok is False and "API Key" in reason
    svc._settings_repo.save({
        "provider": "ollama",
        "openai": {"api_key": "", "model": "m", "base_url": "u"},
        "ollama": {"base_url": "http://localhost:11434", "model": "llama3.1"},
    })
    assert svc.is_configured()[0] is True


def test_estimate_prompt_size():
    out = AIDescriptionService.estimate_prompt_size("x" * 1234)
    assert "1,234" in out and "非精確" in out


def test_target_summary_and_disclosure(data_dir, tmp_path):
    svc, _u = _svc(data_dir, tmp_path)
    t = svc.current_target_summary()
    assert t["provider"] == "openai" and t["leaves_machine"] is True
    assert "雲端" in svc.target_disclosure_lines()

    svc._settings_repo.save({
        "provider": "ollama",
        "openai": {"api_key": "", "model": "m", "base_url": "u"},
        "ollama": {"base_url": "http://192.168.1.9:11434", "model": "llava"},
    })
    t2 = svc.current_target_summary()
    assert t2["provider"] == "ollama" and t2["lan"] is True and t2["leaves_machine"] is True
    assert "區域網路" in svc.target_disclosure_lines()


def test_record_call_and_count(data_dir, tmp_path):
    svc, usage = _svc(data_dir, tmp_path)
    svc.record_call()
    svc.record_call()
    assert svc.get_call_count() == 2 == usage.load_call_count()


def test_generate_suggestions_text(data_dir, tmp_path):
    prov = FakeProvider()
    svc, usage = _svc(data_dir, tmp_path, provider=prov)
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    es = [entry(path=str(f), serial=1), entry(path=str(f), serial=2)]
    results, cancelled = svc.generate_suggestions(es, {})
    assert cancelled is False
    assert [r[1] for r in results] == ["說明#1", "說明#2"]
    assert usage.load_call_count() == 2


def test_generate_suggestions_missing_file_skipped(data_dir, tmp_path):
    prov = FakeProvider()
    svc, _u = _svc(data_dir, tmp_path, provider=prov)
    es = [entry(path=str(tmp_path / "ghost.txt"), serial=1)]
    results, _c = svc.generate_suggestions(es, {})
    assert results == [(es[0], None, None)]


def test_generate_suggestions_provider_error_captured(data_dir, tmp_path):
    class Boom:
        def generate_description(self, prompt):
            raise AIProviderError("金鑰錯誤")

    svc, _u = _svc(data_dir, tmp_path, provider=Boom())
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    results, _c = svc.generate_suggestions([entry(path=str(f), serial=1)], {})
    assert results[0][1] is None and "金鑰錯誤" in results[0][2]


def test_generate_suggestions_cancel(data_dir, tmp_path):
    prov = FakeProvider()
    svc, _u = _svc(data_dir, tmp_path, provider=prov)
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    es = [entry(path=str(f), serial=i) for i in range(4)]
    state = {"n": 0}

    def cancel():
        state["n"] += 1
        return state["n"] > 2

    results, cancelled = svc.generate_suggestions(es, {}, cancel_check=cancel)
    assert cancelled is True and len(results) == 2


def test_analyze_file_text(data_dir, tmp_path):
    prov = FakeProvider()
    svc, _u = _svc(data_dir, tmp_path, provider=prov)
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    answer, error, info = svc.analyze_file(str(f))
    assert error is None and answer.startswith("說明#")
    assert info["kind"] == "text" and "字元" in info["sent_desc"]


def test_generate_suggestions_custom_prompt_builder(data_dir, tmp_path):
    """便利貼「AI 生成便利貼」重用同一套流程時傳入自訂 prompt_builder／
    image_prompt_builder——確認真的有換掉，而不是還在用 build_prompt。"""
    prov = FakeProvider()
    svc, _u = _svc(data_dir, tmp_path, provider=prov)
    f = tmp_path / "a.txt"
    f.write_text("x", encoding="utf-8")
    seen = []

    def custom_prompt(entry, text):
        seen.append((entry.path, text))
        return "自訂 prompt"

    results, _c = svc.generate_suggestions(
        [entry(path=str(f), serial=1)], {}, prompt_builder=custom_prompt,
    )
    assert seen == [(str(f), "擷取到的內容")]
    assert results[0][1] == "說明#1"  # FakeProvider 不理會 prompt 內容，仍能正常跑完


def test_analyze_file_missing(data_dir, tmp_path):
    svc, _u = _svc(data_dir, tmp_path, provider=FakeProvider())
    answer, error, info = svc.analyze_file(str(tmp_path / "ghost.txt"))
    assert answer is None and "不存在" in error
