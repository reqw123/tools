"""網頁後端 ↔ file_search_app 既有 AI 邏輯的橋接（files-web 用）。

不重寫任何 AI 流程——直接用桌面版的 AIDescriptionService（Provider 連線／記帳／
設定）與 PreviewService（從被索引的檔案擷取文字／準備圖片）。Node 端把這支當
子行程呼叫：指令從 argv、輸入從 stdin(JSON)、輸出到 stdout(JSON)。

  python ai_bridge.py <command>

command：
  target          目前 AI 設定的去向摘要（label / model / endpoint / leaves_machine / lan）+ 累計呼叫次數 + 是否已設定
  settings-get     讀設定（API Key 只回 has_key，不回值）
  settings-set     stdin: {provider, openai:{api_key?,model,base_url}, ollama:{base_url,model}} → 存檔，回同 settings-get
  test             stdin: (可選) 未存檔的設定 dict；測連線 → {ok, warning, error}
  models           stdin: (可選) 未存檔的設定 dict；那台 Ollama 的已安裝模型清單 → {models: string[]|null, error}
  suggest-one      stdin: {path, category?}；把這個檔案（文字擷取或圖片）送給目前設定的
                   Provider 產生一段說明 → {suggestion: string|null, error: string|null, skipped: bool}

結束碼 0＝成功；非 0＝失敗，stdout 一律是 {"error": "..."}。
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# 讓 `import file_search_app` 找得到（server/ 的上上上層 = file_search/）
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from file_search_app.ai.base import AIProviderError  # noqa: E402
from file_search_app.models import IndexEntry  # noqa: E402
from file_search_app.repositories.ai_settings_repository import AISettingsRepository  # noqa: E402
from file_search_app.repositories.ai_usage_repository import AIUsageRepository  # noqa: E402
from file_search_app.services.ai_description_service import AIDescriptionService  # noqa: E402
from file_search_app.services.preview_service import PreviewService  # noqa: E402


class _NoTranscription:
    """網頁版不做音訊／影片轉錄（本機 faster-whisper，太重）。給一個 available=False
    的空物件，讓 AIDescriptionService._transcribe_for 直接回空字串——那類檔案於是
    走「沒有可摘要的內容」被略過，而不是因為 transcription_service 是 None 而炸掉。"""

    available = False

    def transcribe(self, _path):  # pragma: no cover - 不會被呼到（available 是 False）
        return "", None, False


def _ai() -> AIDescriptionService:
    # 設定檔／用量計數用預設路徑，跟桌面版與便利貼網頁共用同一份
    # .ai_settings.json / .ai_usage.json。
    return AIDescriptionService(
        AISettingsRepository(), PreviewService(), _NoTranscription(), AIUsageRepository()
    )


def _mask(settings: dict) -> dict:
    o = settings.get("openai", {})
    return {
        "provider": settings.get("provider"),
        "openai": {
            "model": o.get("model", ""),
            "base_url": o.get("base_url", ""),
            "has_key": bool((o.get("api_key") or "").strip()),
        },
        "ollama": {
            "base_url": settings.get("ollama", {}).get("base_url", ""),
            "model": settings.get("ollama", {}).get("model", ""),
        },
    }


def _merge_unsaved(ai, payload):
    """把設定視窗傳來、還沒存檔的欄位補上已存的值（沒帶 api_key 就沿用舊的），
    組成完整 settings。payload 為空回 None（用存檔值）。"""
    if not payload:
        return None
    current = ai._settings_repo.load()
    return {
        "provider": payload.get("provider") or current.get("provider"),
        "openai": {
            "api_key": payload.get("openai", {}).get("api_key") or current["openai"]["api_key"],
            "model": payload.get("openai", {}).get("model") or current["openai"]["model"],
            "base_url": payload.get("openai", {}).get("base_url") or current["openai"]["base_url"],
        },
        "ollama": {
            "base_url": payload.get("ollama", {}).get("base_url") or current["ollama"]["base_url"],
            "model": payload.get("ollama", {}).get("model") or current["ollama"]["model"],
        },
    }


def cmd_target(_payload, _extra):
    ai = _ai()
    ok, reason = ai.is_configured()
    t = ai.current_target_summary()
    return {
        "configured": ok,
        "reason": reason,
        "provider": t["provider"],
        "label": t["label"],
        "model": t["model"],
        "endpoint": t["endpoint"],
        "leaves_machine": bool(t["leaves_machine"]),
        "lan": bool(t.get("lan")),
        "call_count": ai.get_call_count(),
    }


def cmd_settings_get(_payload, _extra):
    return _mask(AISettingsRepository().load())


def cmd_settings_set(payload, _extra):
    repo = AISettingsRepository()
    current = repo.load()
    incoming = payload or {}
    merged = {
        "provider": incoming.get("provider") or current.get("provider"),
        "openai": {
            "model": (incoming.get("openai", {}).get("model") or current["openai"]["model"]).strip(),
            "base_url": (incoming.get("openai", {}).get("base_url") or current["openai"]["base_url"]).strip(),
            "api_key": (incoming.get("openai", {}).get("api_key") or current["openai"]["api_key"]),
        },
        "ollama": {
            "base_url": (incoming.get("ollama", {}).get("base_url") or current["ollama"]["base_url"]).strip(),
            "model": (incoming.get("ollama", {}).get("model") or current["ollama"]["model"]).strip(),
        },
    }
    repo.save(merged)
    return _mask(repo.load())


def cmd_test(payload, _extra):
    ai = _ai()
    try:
        warning = ai.test_connection(_merge_unsaved(ai, payload))
        return {"ok": True, "warning": warning, "error": None}
    except AIProviderError as exc:
        return {"ok": False, "warning": None, "error": str(exc)}


def cmd_models(payload, _extra):
    ai = _ai()
    try:
        return {"models": ai.list_ollama_models(_merge_unsaved(ai, payload)), "error": None}
    except AIProviderError as exc:
        return {"models": None, "error": str(exc)}


def cmd_suggest_one(payload, _extra):
    """把單一檔案送給目前設定的 Provider 產生一段說明。逐檔一次呼叫（前端迴圈跑
    N 次、顯示進度），對應桌面版 AIDescriptionService._generate_one 的一筆。"""
    payload = payload or {}
    path = (payload.get("path") or "").strip()
    if not path:
        return {"suggestion": None, "error": "沒有給檔案路徑", "skipped": False}

    ai = _ai()
    ok, reason = ai.is_configured()
    if not ok:
        return {"suggestion": None, "error": reason, "skipped": False}
    try:
        provider = ai.build_provider()
    except AIProviderError as exc:
        return {"suggestion": None, "error": str(exc), "skipped": False}

    entry = IndexEntry(
        path=path, category=(payload.get("category") or ""), description="",
        source_index=Path(path), row_index=0,
    )
    try:
        suggestion, error = ai._generate_one(provider, entry, {})
    except Exception as exc:  # noqa: BLE001 — 任何未預期例外都回成 error，不讓子行程崩掉
        return {"suggestion": None, "error": f"{type(exc).__name__}: {exc}", "skipped": False}

    if suggestion is None and error is None:
        # 圖片沒裝 Pillow、二進位／空檔、音訊影片（網頁版不轉錄）——沒有可摘要的內容
        return {"suggestion": None, "error": None, "skipped": True}
    return {"suggestion": suggestion, "error": error, "skipped": False}


COMMANDS = {
    "target": cmd_target,
    "settings-get": cmd_settings_get,
    "settings-set": cmd_settings_set,
    "test": cmd_test,
    "models": cmd_models,
    "suggest-one": cmd_suggest_one,
}


def main() -> int:
    try:
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    args = sys.argv[1:]
    if not args or args[0] not in COMMANDS:
        print(json.dumps({"error": f"未知指令：{args[0] if args else '(無)'}"}, ensure_ascii=False))
        return 2

    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else None

    try:
        result = COMMANDS[args[0]](payload, None)
    except AIProviderError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        return 1
    except Exception as exc:  # noqa: BLE001
        print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False))
        return 3

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
