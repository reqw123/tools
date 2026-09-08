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
import re
import sys
from pathlib import Path

# 讓 `import file_search_app` 找得到（server/ 的上上上層 = file_search/）
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from file_search_app.ai.base import AIProviderError  # noqa: E402
from file_search_app.models import IndexEntry  # noqa: E402
from file_search_app.repositories.ai_settings_repository import AISettingsRepository  # noqa: E402
from file_search_app.repositories.ai_usage_repository import AIUsageRepository  # noqa: E402
from file_search_app.repositories.notes_settings_repository import NotesSettingsRepository  # noqa: E402
from file_search_app.repositories.sticky_note_repository import StickyNoteRepository  # noqa: E402
from file_search_app.services.ai_description_service import AIDescriptionService  # noqa: E402
from file_search_app.services.note_semantic_service import NoteSemanticService  # noqa: E402
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


def _embed_model(payload) -> str:
    """語意搜尋的 embedding 模型：優先用前端傳來的（notes-web 存在
    `.notes_settings.json` 的 `embedModel`，會一起帶進 payload），沒帶就自己
    從同一份設定檔讀，再沒有就用預設。"""
    model = ((payload or {}).get("model") or "").strip()
    return model or NotesSettingsRepository().load_embed_model()


def cmd_semantic_search(payload, notes_file):
    """stdin: {query, tag?, model?, topK?, minScore?} → 依語意相似度排序的
    便利貼 id 清單。用本機 Ollama 的 embedding 模型算，向量有快取
    （indexes/.sticky_notes_embeddings.json）。Ollama 連不上／模型沒下載
    一律回 {ok:false, error}，不拋——前端據此退回關鍵字搜尋。"""
    payload = payload or {}
    svc = NoteSemanticService(_sticky(notes_file))
    return svc.search(
        query=payload.get("query", ""),
        tag=payload.get("tag") or "",
        model=_embed_model(payload),
        top_k=payload.get("topK") or None,
        min_score=payload.get("minScore"),
    )


def cmd_semantic_status(payload, notes_file):
    """stdin: {model?} → {ok, model, installed, error}；語意搜尋能不能用
    （Ollama 連得上、embedding 模型下載了嗎）。給前端決定要不要 disable
    「語意」開關、提示 `ollama pull`。"""
    svc = NoteSemanticService(_sticky(notes_file))
    return svc.status(_embed_model(payload))


# ── 研究生模式：從論文專案文件生成一批任務便利貼 ──────────────────────
_THESIS_SEED_FILES = [
    "paper/CONTEXT.md",
    "paper/docs/0_進度彙整.md",
    "paper/docs/0_AI_專案導覽地圖.md",
    "paper/docs/adr/0001-統一健康風險評分引擎.md",
    "CLAUDE.md",
]
_THESIS_SEED_PER_FILE = 9000
_THESIS_SEED_TOTAL = 30000
_THESIS_TAGS = [
    "緒論", "文獻探討", "研究方法", "研究結果", "討論",
    "實驗", "資料", "寫作", "未來工作", "其他",
]


def _docx_text(path: Path) -> str:
    """從 .docx 抽段落純文字（不裝 python-docx，直接讀 zip 裡的 document.xml）。"""
    import re
    import zipfile

    try:
        with zipfile.ZipFile(path) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
    except (OSError, KeyError, zipfile.BadZipFile):
        return ""
    out = []
    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        runs = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", para)
        text = "".join(runs).strip()
        if text:
            out.append(text)
    return "\n".join(out)


def _read_thesis_docs(project_dir: str) -> str:
    root = Path(project_dir)
    parts = []
    for rel in _THESIS_SEED_FILES:
        p = root / rel
        if p.is_file():
            try:
                parts.append(f"===== {rel} =====\n{p.read_text('utf-8', errors='ignore')[:_THESIS_SEED_PER_FILE]}")
            except OSError:
                pass
    for docx in root.glob("*.docx"):
        body = _docx_text(docx)
        if body:
            parts.append(f"===== 論文草稿 {docx.name}（節錄）=====\n{body[:_THESIS_SEED_PER_FILE]}")
            break
    return "\n\n".join(parts)[:_THESIS_SEED_TOTAL]


def _build_thesis_seed_prompt(docs: str) -> str:
    tag_list = "、".join(_THESIS_TAGS)
    return (
        "你是碩士研究生的論文助理。下面是一份論文專案的內部文件（含進度彙整、"
        "架構、ADR、論文草稿節錄）。請據此產出一批『任務便利貼』，把這位研究生"
        "接下來要做的事拆解、分配到便利貼牆上。每則便利貼是一個具體、可執行的"
        "任務或要點——例如某一章某一節要補寫什麼、某個已知技術缺口要怎麼處理、"
        "某個實驗／驗證要跑、某項未來工作。\n\n"
        "【輸出格式，務必嚴格遵守】你的整個回覆必須是、而且只能是一個 JSON 陣列，"
        "從 `[` 開始、以 `]` 結束，中間不要有任何說明文字、不要用 ``` 圍欄、"
        "不要用 Markdown。陣列每個元素是一個物件：\n"
        '  {"title": "一句話任務標題（繁中，20 字內）", '
        f'"tag": "{tag_list} 之中最貼切的一個", '
        '"body": "2~5 行說明，分項時每行用 - 開頭，純文字"}\n\n'
        "範例（格式示意，實際內容要根據文件）：\n"
        '[{"title":"補寫 3.4 SQA 幾何判定門檻","tag":"研究方法",'
        '"body":"- 說明骨長穩定性檢查的門檻怎麼定\\n- 引用 test_bone_length_stability 模式1/3 的 flag rate 追蹤"},'
        '{"title":"Class B shake_count 權重限制誠實揭露","tag":"討論",'
        '"body":"- 0.40 權重無文獻支持\\n- 在討論章寫成研究限制，附獸醫共識來源"}]\n\n'
        "產出 12～18 則，涵蓋各章節與文件裡點出的已知缺口／未來工作，內容要具體"
        "（引用文件裡的實際名詞，例如 Class A/B/C、SQA、個體化基線、消融實驗、"
        "個體行為基線、JointAttention），不要泛泛而談、不要重複。\n\n"
        "===== 專案文件 =====\n" + docs
    )


_THESIS_TAG_HINTS = [
    ("緒論", "緒論"), ("問題定義", "緒論"), ("研究目的", "緒論"), ("研究背景", "緒論"),
    ("文獻", "文獻探討"),
    ("研究方法", "研究方法"), ("方法", "研究方法"), ("前處理", "研究方法"),
    ("架構", "研究方法"), ("模型", "研究方法"), ("SQA", "研究方法"),
    ("結果", "研究結果"), ("實驗結果", "研究結果"),
    ("消融", "實驗"), ("驗證", "實驗"), ("校準", "實驗"), ("實驗", "實驗"),
    ("資料", "資料"), ("dataset", "資料"), ("標註", "資料"), ("ground truth", "資料"),
    ("未來", "未來工作"), ("後續", "未來工作"),
    ("討論", "討論"), ("限制", "討論"), ("結論", "討論"),
    ("撰寫", "寫作"), ("寫", "寫作"), ("排版", "寫作"), ("章", "寫作"),
]


def _tag_from_context(text: str) -> str:
    low = (text or "").lower()
    for needle, tag in _THESIS_TAG_HINTS:
        if needle.lower() in low:
            return tag
    return "其他"


def _parse_thesis_seed_markdown(raw: str):
    """AI 不聽 JSON 指示、回了 Markdown 大綱時的退路——把「標題行 + 底下的
    子項目」抓成便利貼：`### 某章某節` / `1. xxx` / `- xxx` / `**xxx**` 當
    一則的標題，緊接的縮排 `-`／`*` 子項目併成 body，tag 從最近的章節標題推。"""
    lines = [ln.rstrip() for ln in (raw or "").splitlines()]
    section = ""
    drafts = []
    i = 0
    head_re = re.compile(r"^\s*(?:#{2,4}\s+|[0-9]+[.)、]\s+|[-*]\s+|\*\*)(.+?)\*{0,2}\s*$")
    sub_re = re.compile(r"^\s{1,}(?:[-*]|[0-9]+[.)、])\s+(.+?)\s*$")
    while i < len(lines):
        ln = lines[i]
        i += 1
        if not ln.strip():
            continue
        if ln.lstrip().startswith("#"):
            section = re.sub(r"^#+\s*", "", ln).strip()
        m = head_re.match(ln)
        if not m:
            continue
        title = m.group(1).strip(" *#-").strip()
        if len(title) < 2 or len(title) > 60:
            continue
        subs = []
        while i < len(lines) and sub_re.match(lines[i]):
            subs.append("- " + sub_re.match(lines[i]).group(1).strip())
            i += 1
        # 純章節標題（「第三章 方法」「4.2 …」）沒 body 的一律丟掉——那是大綱不是任務
        if re.match(r"^第[一二三四五六七八九十]+[章節]|^[0-9]+(\.[0-9]+)*[\s、]", title) and not subs:
            continue
        drafts.append({
            "title": title[:200],
            "tag": _tag_from_context(f"{section} {title}"),
            "body": "\n".join(subs)[:4000],
        })
    return [d for d in drafts if d["body"] or len(d["title"]) >= 8][:24]


def _parse_thesis_seed(raw: str):
    """先當 JSON 陣列解析（整段 → 抓第一個 [...] 片段）；小模型不聽指示回
    Markdown 大綱時，退回 _parse_thesis_seed_markdown。"""
    text = (raw or "").strip()
    candidates = [text]
    match = re.search(r"\[.*\]", text, re.S)
    if match:
        candidates.append(match.group(0))

    for candidate in candidates:
        try:
            data = json.loads(candidate)
        except (ValueError, TypeError):
            continue
        if not isinstance(data, list):
            continue
        out = []
        for item in data:
            if not isinstance(item, dict):
                continue
            title = str(item.get("title", "")).strip()
            if not title:
                continue
            tag = str(item.get("tag", "")).strip()
            out.append({
                "title": title[:200],
                "tag": tag if tag in _THESIS_TAGS else "其他",
                "body": str(item.get("body", "")).strip()[:4000],
            })
        if out:
            return out

    return _parse_thesis_seed_markdown(text)


def cmd_thesis_seed(payload, _notes_file):
    """stdin: {projectDir} → {drafts: [{title,tag,body}], error, call_count}。
    讀論文專案的幾份關鍵文件 + 論文草稿，一次 AI 呼叫產出一批任務便利貼草稿。
    不寫入——前端審核過再走既有的 /api/ai/save-notes（會存進目前作用中的
    便利貼集合，也就是研究生那份）。"""
    project_dir = ((payload or {}).get("projectDir") or "").strip()
    if not project_dir or not Path(project_dir).is_dir():
        return {"drafts": [], "error": f"找不到論文專案資料夾：{project_dir or '(未設定)'}", "call_count": 0}

    docs = _read_thesis_docs(project_dir)
    if len(docs) < 200:
        return {"drafts": [], "error": "在專案資料夾裡找不到可讀的文件（paper/docs/、CONTEXT.md、*.docx）", "call_count": 0}

    ai = _ai()
    ok, reason = ai.is_configured()
    if not ok:
        return {"drafts": [], "error": f"{reason}，請先設定好 AI", "call_count": ai.get_call_count()}
    try:
        provider = ai.build_provider()
    except AIProviderError as exc:
        return {"drafts": [], "error": str(exc), "call_count": ai.get_call_count()}

    ai.record_call()
    try:
        response = provider.generate_description(_build_thesis_seed_prompt(docs))
    except AIProviderError as exc:
        return {"drafts": [], "error": str(exc), "call_count": ai.get_call_count()}
    except Exception as exc:  # noqa: BLE001
        return {"drafts": [], "error": f"{type(exc).__name__}: {exc}", "call_count": ai.get_call_count()}

    drafts = _parse_thesis_seed(response)
    if not drafts:
        return {"drafts": [], "error": "AI 回應無法解析成便利貼清單", "call_count": ai.get_call_count()}
    return {"drafts": drafts, "error": None, "call_count": ai.get_call_count()}


COMMANDS = {
    "target": cmd_target,
    "settings-get": cmd_settings_get,
    "settings-set": cmd_settings_set,
    "test": cmd_test,
    "models": cmd_models,
    "search": cmd_search,
    "generate-note": cmd_generate_note,
    "semantic-search": cmd_semantic_search,
    "semantic-status": cmd_semantic_status,
    "thesis-seed": cmd_thesis_seed,
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
