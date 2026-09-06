import json

import pytest

import file_search_app.ai.base as base
from file_search_app.ai import ollama_provider as om
from file_search_app.ai import openai_provider as oai
from file_search_app.ai.base import AIProviderError
from tests.conftest import FakeResponse


# ── base.post_json / get_json ─────────────────────────────────────

def test_post_json_ok(monkeypatch):
    captured = {}

    def fake_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["body"] = req.data
        return FakeResponse(b'{"ok": true}')

    monkeypatch.setattr(base.urllib.request, "urlopen", fake_urlopen)
    out = base.post_json("http://x/y", {"a": 1}, headers={"H": "v"})
    assert out == {"ok": True}
    assert json.loads(captured["body"]) == {"a": 1}


def test_post_json_http_error_wrapped(monkeypatch):
    import urllib.error

    def fake_urlopen(req, timeout=None):
        raise urllib.error.HTTPError("http://x", 429, "Too Many", {}, fp=None)

    monkeypatch.setattr(base.urllib.request, "urlopen", fake_urlopen)
    with pytest.raises(AIProviderError) as ei:
        base.post_json("http://x", {})
    assert "429" in str(ei.value)


def test_post_json_bad_json_wrapped(monkeypatch):
    monkeypatch.setattr(base.urllib.request, "urlopen", lambda req, timeout=None: FakeResponse(b"<html>"))
    with pytest.raises(AIProviderError):
        base.post_json("http://x", {})


# ── OpenAIProvider ────────────────────────────────────────────────

def test_openai_generate_description(monkeypatch):
    def fake_post(url, payload, headers=None, timeout=60.0):
        assert url.endswith("/chat/completions")
        assert headers["Authorization"] == "Bearer sk-x"
        return {"choices": [{"message": {"content": "  一段說明  "}}]}

    monkeypatch.setattr(oai, "post_json", fake_post)
    p = oai.OpenAIProvider(api_key="sk-x", model="gpt-4o-mini")
    assert p.generate_description("hi") == "一段說明"


def test_openai_missing_key_raises(monkeypatch):
    p = oai.OpenAIProvider(api_key="", model="m")
    with pytest.raises(AIProviderError):
        p.generate_description("hi")


def test_openai_reasoning_model_param_retry(monkeypatch):
    calls = []

    def fake_post(url, payload, headers=None, timeout=60.0):
        calls.append(payload)
        if "max_tokens" in payload:
            raise AIProviderError("Unsupported parameter: 'max_tokens' ... Use 'max_completion_tokens' instead.")
        return {"choices": [{"message": {"content": "ok"}}]}

    monkeypatch.setattr(oai, "post_json", fake_post)
    p = oai.OpenAIProvider(api_key="sk-x", model="o3")
    assert p.generate_description("hi") == "ok"
    assert "max_completion_tokens" in calls[1]


def test_openai_bad_response_shape(monkeypatch):
    monkeypatch.setattr(oai, "post_json", lambda *a, **k: {"nope": 1})
    p = oai.OpenAIProvider(api_key="sk-x", model="m")
    with pytest.raises(AIProviderError):
        p.generate_description("hi")


# ── ollama_provider helpers ───────────────────────────────────────

def test_normalize_base_url():
    assert om.normalize_base_url("  192.168.1.5:11434/ ") == "http://192.168.1.5:11434"
    assert om.normalize_base_url("") == om.DEFAULT_BASE_URL
    assert om.normalize_base_url("https://x:9/") == "https://x:9"


def test_split_and_build_standard_url():
    host, std = om.split_standard_url("http://192.168.1.5:11434")
    assert host == "192.168.1.5" and std is True
    _h, std2 = om.split_standard_url("https://x:11434")
    assert std2 is False
    assert om.build_standard_url("box") == "http://box:11434"
    assert om.build_standard_url("::1") == "http://[::1]:11434"


def test_is_local_endpoint():
    assert om.is_local_endpoint("http://localhost:11434") is True
    assert om.is_local_endpoint("http://127.0.0.1:11434") is True
    assert om.is_local_endpoint("http://192.168.1.5:11434") is False


def test_model_in_list_latest_equivalence():
    assert om.model_in_list("llama3.1", ["llama3.1:latest"]) is True
    assert om.model_in_list("llava:13b", ["llava:13b"]) is True
    assert om.model_in_list("x", ["y"]) is False


# ── OllamaProvider ────────────────────────────────────────────────

def test_ollama_generate(monkeypatch):
    monkeypatch.setattr(om, "post_json", lambda url, payload, timeout=60.0: {"response": "  嗨  "})
    assert om.OllamaProvider().generate_description("hi") == "嗨"


def test_ollama_generate_error_field(monkeypatch):
    monkeypatch.setattr(om, "post_json", lambda *a, **k: {"error": "model not found"})
    with pytest.raises(AIProviderError):
        om.OllamaProvider().generate_description("hi")


def test_ollama_generate_non_string_response_wrapped(monkeypatch):
    monkeypatch.setattr(om, "post_json", lambda *a, **k: {"response": 12345})
    with pytest.raises(AIProviderError):
        om.OllamaProvider().generate_description("hi")


def test_ollama_vision_blocks_text_only_model(monkeypatch):
    prov = om.OllamaProvider(model="llama3.1")
    monkeypatch.setattr(prov, "_show", lambda: {"capabilities": ["completion"]})
    with pytest.raises(AIProviderError):
        prov.generate_image_description("p", b"img", "image/jpeg")


def test_ollama_test_connection_warns_missing_model(monkeypatch):
    prov = om.OllamaProvider(model="ghost")
    monkeypatch.setattr(om, "get_json", lambda url, timeout=15.0: {"models": [{"name": "llama3.1:latest"}]})
    monkeypatch.setattr(prov, "_show", lambda: {})
    warning = prov.test_connection()
    assert warning and "ghost" in warning


def test_list_models(monkeypatch):
    monkeypatch.setattr(om, "get_json", lambda url, timeout=8.0: {"models": [{"name": "b"}, {"name": "a"}, {"name": "a"}]})
    assert om.list_models("http://localhost:11434") == ["a", "b"]
