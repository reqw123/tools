"""網頁後端 ↔ file_search_app 既有 AI 邏輯的橋接。

不重寫任何 AI 流程——直接用桌面版的 StickyNoteService（組 prompt／解析回應）
跟 AIDescriptionService（Provider 連線／記帳／設定）。Node 端把這支當子行程
呼叫，指令從 argv、輸入從 stdin(JSON)、輸出到 stdout(JSON)。

  python ai_bridge.py <command> [--notes-file PATH]

command：
  target          目前 AI 設定的去向摘要（label / model / endpoint / leaves_machine）+ 累計呼叫次數 + 是否已設定
  settings-get     讀設定（API Key 只回 has_key，不回值）
  settings-set     stdin: {provider, openai:{api_key?,model,base_url}, ollama:{base_url,model}} → 存檔，回同 settings-get
  test             stdin: (可選) 未存檔的設定 dict；測連線 → {ok, warning, error}
  models           stdin: (可選) 未存檔的設定 dict；那台 Ollama 的已安裝模型清單 → {models: string[]|null, error}
  search           stdin: {query, tag?} → 用 --notes-file 的便利貼跑 AI 搜尋 → {answer, ids(便利貼 id 陣列), call_count}
  generate-note    stdin: {path, category?}；把這個檔案送給目前設定的 Provider，生成一則
                   便利貼草稿（標題／標籤／內容）→ {draft: {title,tag,body}|null, error, skipped}。
                   不寫入任何東西——存不存看前端另外呼叫 POST /api/notes（notes.ts 既有的
                   建立端點，不用再走 Python）。

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
from file_search_app.repositories.sticky_note_repository import StickyNoteRepository  # noqa: E402
from file_search_app.services.ai_description_service import AIDescriptionService  # noqa: E402
from file_search_app.services.preview_service import PreviewService  # noqa: E402
from file_search_app.services.sticky_note_service import StickyNoteService  # noqa: E402


class _NoTranscription:
    """網頁版不做音訊／影片轉錄（本機 faster-whisper，太重）。給一個
    available=False 的空物件，讓 AIDescriptionService._transcribe_for 直接回
    空字串——那類檔案於是走「沒有可摘要的內容」被略過，不會因為
    transcription_service 是 None 而炸掉。跟 files-web 的 ai_bridge.py
    同一份。"""

    available = False

    def transcribe(self, _path):  # pragma: no cover - 不會被呼到（available 是 False）
        return "", None, False


def _ai() -> AIDescriptionService:
    # preview / transcription 原本只給「便利貼 AI 搜尋」用不到（傳 None），但
    # 「AI 生成便利貼」要從檔案內容擷取文字／圖片，這裡補上跟 files-web
    # 同一組 PreviewService／_NoTranscription。設定檔／用量計數仍用預設路徑
    # → 跟桌面版共用同一份 .ai_settings.json / .ai_usage.json /
    # %LOCALAPPDATA%\file_search\ai_secrets.json，設定一次三邊都通。
    return AIDescriptionService(AISettingsRepository(), PreviewService(), _NoTranscription(), AIUsageRepository())


def _sticky(notes_file: str | None) -> StickyNoteService:
    repo = StickyNoteRepository()
    if notes_file:
        repo.path = Path(notes_file)
    return StickyNoteService(repo)


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


def cmd_target(_payload, _notes_file):
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


def cmd_settings_get(_payload, _notes_file):
    return _mask(AISettingsRepository().load())


def cmd_settings_set(payload, _notes_file):
    repo = AISettingsRepository()
    current = repo.load()
    incoming = payload or {}

    merged = {
        "provider": incoming.get("provider") or current.get("provider"),
        "openai": {
            "model": (incoming.get("openai", {}).get("model") or current["openai"]["model"]).strip(),
            "base_url": (incoming.get("openai", {}).get("base_url") or current["openai"]["base_url"]).strip(),
            # 沒帶新 key（或帶空字串）就沿用舊的，不會被清掉
            "api_key": (incoming.get("openai", {}).get("api_key") or current["openai"]["api_key"]),
        },
        "ollama": {
            "base_url": (incoming.get("ollama", {}).get("base_url") or current["ollama"]["base_url"]).strip(),
            "model": (incoming.get("ollama", {}).get("model") or current["ollama"]["model"]).strip(),
        },
    }
    repo.save(merged)
    return _mask(repo.load())


def _merge_unsaved(ai, payload):
    """把設定視窗傳來、還沒存檔的欄位補上已存的值（沒帶 api_key 就沿用舊的，
    不然 OpenAI 一定失敗），組成一份完整 settings。payload 為空回 None（用存檔值）。"""
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


def cmd_test(payload, _notes_file):
    ai = _ai()
    settings = _merge_unsaved(ai, payload)
    try:
        warning = ai.test_connection(settings)
        return {"ok": True, "warning": warning, "error": None}
    except AIProviderError as exc:
        return {"ok": False, "warning": None, "error": str(exc)}


def cmd_models(payload, _notes_file):
    """那台 Ollama（依存檔設定，或傳入還沒儲存的 settings）已安裝的模型清單，給
    「AI 設定」的模型下拉用。連不上不算硬錯誤——回 {models: null, error} 讓前端
    輕描淡寫（使用者可能還沒開 Ollama），仍可手動輸入模型名稱。"""
    ai = _ai()
    settings = _merge_unsaved(ai, payload)
    try:
        return {"models": ai.list_ollama_models(settings), "error": None}
    except AIProviderError as exc:
        return {"models": None, "error": str(exc)}


def cmd_search(payload, notes_file):
    query = (payload or {}).get("query", "").strip()
    tag = (payload or {}).get("tag") or ""
    if not query:
        raise ValueError("query 不能是空的")

    svc = _sticky(notes_file)
    notes = svc.list_notes()
    if tag:
        notes = [n for n in notes if n.tag == tag]
    if not notes:
        return {"answer": "目前這個範圍沒有任何便利貼。", "ids": [], "call_count": _ai().get_call_count()}

    ai = _ai()
    ok, reason = ai.is_configured()
    if not ok:
        raise AIProviderError(f"{reason}，請先設定好 AI")

    prompt = svc.build_ai_search_prompt(notes, query)
    provider = ai.build_provider()
    ai.record_call()  # 跟桌面版同一個時機：build_provider 成功後、真的送出前
    response = provider.generate_description(prompt)
    answer, matched = svc.parse_ai_search_response(response, notes)
    return {
        "answer": answer,
        "ids": [n.id for n in matched],
        "call_count": ai.get_call_count(),
    }


def cmd_generate_note(payload, notes_file):
    """把單一檔案送給目前設定的 Provider，生成一則便利貼草稿（標題／標籤／
    內容），不寫入任何東西——存檔是前端另外呼叫既有的 `POST /api/notes`
    （`notes.ts`，直接讀寫 `.sticky_notes.json`，不需要 Python）。跟
    files-web 的 `cmd_generate_note` 同一套邏輯（`_generate_one` 帶入
    `StickyNoteService` 的 document-to-note prompt）。`notes_file` 這裡其實
    用不到（生成階段不碰便利貼檔案），純粹是 `_sticky()` 的既有簽章要求，
    跟 `cmd_search` 一樣照樣傳進去。"""
    payload = payload or {}
    path = (payload.get("path") or "").strip()
    if not path:
        return {"draft": None, "error": "沒有給檔案路徑", "skipped": False}

    ai = _ai()
    ok, reason = ai.is_configured()
    if not ok:
        return {"draft": None, "error": reason, "skipped": False}
    try:
        provider = ai.build_provider()
    except AIProviderError as exc:
        return {"draft": None, "error": str(exc), "skipped": False}

    sticky = _sticky(notes_file)
    entry = IndexEntry(
        path=path, category=(payload.get("category") or ""), description="",
        source_index=Path(path), row_index=0,
    )
    try:
        raw, error = ai._generate_one(
            provider, entry, {},
            prompt_builder=sticky.build_document_to_note_prompt,
            image_prompt_builder=sticky.build_document_to_note_image_prompt,
        )
    except Exception as exc:  # noqa: BLE001 — 任何未預期例外都回成 error，不讓子行程崩掉
        return {"draft": None, "error": f"{type(exc).__name__}: {exc}", "skipped": False}

    if raw is None and error is None:
        # 圖片沒裝 Pillow、二進位／空檔、音訊影片（網頁版不轉錄）——沒有可分析的內容
        return {"draft": None, "error": None, "skipped": True}
    if error is not None:
        return {"draft": None, "error": error, "skipped": False}

    draft = sticky.parse_document_to_note_response(raw)
    if draft is None:
        return {"draft": None, "error": "AI 回應格式無法解析", "skipped": False}
    return {"draft": draft, "error": None, "skipped": False}


COMMANDS = {
    "target": cmd_target,
    "settings-get": cmd_settings_get,
    "settings-set": cmd_settings_set,
    "test": cmd_test,
    "models": cmd_models,
    "search": cmd_search,
    "generate-note": cmd_generate_note,
}


def main() -> int:
    # Node 用 UTF-8 寫 stdin、期待 UTF-8 stdout；Windows 的 Python 預設卻是
    # cp950 之類——不強制 UTF-8 的話，中文的 query／tag 會變亂碼，模型就看不懂。
    try:
        sys.stdin.reconfigure(encoding="utf-8")
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

    args = sys.argv[1:]
    if not args or args[0] not in COMMANDS:
        print(json.dumps({"error": f"未知指令：{args[0] if args else '(無)'}"}, ensure_ascii=False))
        return 2
    command = args[0]
    notes_file = None
    if "--notes-file" in args:
        notes_file = args[args.index("--notes-file") + 1]

    raw = sys.stdin.read()
    payload = json.loads(raw) if raw.strip() else None

    try:
        result = COMMANDS[command](payload, notes_file)
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
