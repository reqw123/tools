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


# ── 研究生模式：從專案文件生成一批任務便利貼 ──────────────────────────
_THESIS_SEED_PER_FILE = 9000       # 每個檔案最多餵這麼多字
_THESIS_SEED_TOTAL = 30000         # 全部合起來的上限
_THESIS_SEED_MAX_FILES = 8         # 最多挑幾個檔案（預設；使用者可在全域設定調 1–40）
_THESIS_SEED_SCAN_CAP = 400        # 掃描時最多看幾個候選檔（避免超大專案卡住）
_SEED_MAX_ENTRY_BYTES = 12 * 1024 * 1024  # 單一文件超過這個大小就略過（純取文字，不需要巨檔）
# 「像文件」的副檔名——純文字類直接讀，.docx 抽 word/document.xml、.ipynb 抽
# markdown ＋程式碼 cell（跳過輸出）。資料夾與 .zip 用同一份清單。
_SEED_EXTS = (
    ".md", ".markdown", ".mdx", ".txt", ".text", ".rst", ".rest",
    ".docx", ".tex", ".ipynb", ".org", ".adoc", ".asciidoc",
)
_SEED_EXTS_LABEL = ".md / .markdown / .txt / .rst / .docx / .tex / .ipynb / .org"
# 檔名／路徑帶這些字的優先（進度、大綱、架構、說明類文件對「產任務」最有料）
_SEED_NAME_HINTS = (
    "readme", "context", "overview", "outline", "architecture", "design",
    "roadmap", "proposal", "進度", "彙整", "導覽", "大綱", "架構", "摘要",
    "設計", "規劃", "計畫", "todo", "backlog", "adr",
)
_SEED_DIR_HINTS = ("doc", "docs", "paper", "notes", "spec")
_SEED_SKIP_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build",
    ".pytest_cache", "site-packages", ".mypy_cache",
}

_THESIS_TAGS = [
    "緒論", "文獻探討", "研究方法", "研究結果", "討論",
    "實驗", "資料", "寫作", "未來工作", "其他",
]


def _docx_text_from_bytes(data: bytes) -> str:
    import io
    import zipfile

    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            xml = z.read("word/document.xml").decode("utf-8", "ignore")
    except (KeyError, zipfile.BadZipFile):
        return ""
    out = []
    for para in re.findall(r"<w:p[ >].*?</w:p>", xml, re.S):
        runs = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", para)
        text = "".join(runs).strip()
        if text:
            out.append(text)
    return "\n".join(out)


def _ipynb_text_from_bytes(data: bytes) -> str:
    """Jupyter notebook → 只留 markdown cell 的文字 ＋ code cell 的原始碼
    （跳過執行輸出、base64 圖、metadata）。解析不了就回空字串。"""
    try:
        nb = json.loads(data.decode("utf-8", "ignore"))
        cells = nb.get("cells", [])
    except (ValueError, AttributeError):
        return ""
    out = []
    for cell in cells:
        if not isinstance(cell, dict):
            continue
        src = cell.get("source", "")
        text = "".join(src) if isinstance(src, list) else str(src)
        text = text.strip()
        if not text:
            continue
        if cell.get("cell_type") == "code":
            out.append("```\n" + text + "\n```")
        else:
            out.append(text)
    return "\n\n".join(out)


def _seed_score(rel_path: str, size: int) -> int:
    """rel_path 這個候選文件有多值得餵給 AI——名字/資料夾像文件的加分，
    docx 略加分（多半是論文草稿），太大的稍微減分（tie-break 用）。"""
    low = rel_path.replace("\\", "/").lower()
    name = low.rsplit("/", 1)[-1]
    dirs = low.split("/")[:-1]
    score = 0
    if any(h in name for h in _SEED_NAME_HINTS):
        score += 5
    if any(any(h in d for h in _SEED_DIR_HINTS) for d in dirs):
        score += 3
    if re.match(r"^(0[_-]|\d)", name):
        score += 2
    if name.endswith((".docx", ".tex")):  # 多半是論文草稿本體
        score += 1
    if size > 60000:
        score -= 1
    return score


def _extract_text(name: str, data: bytes) -> str:
    low = name.lower()
    if low.endswith(".docx"):
        return _docx_text_from_bytes(data)
    if low.endswith(".ipynb"):
        return _ipynb_text_from_bytes(data)
    return data.decode("utf-8", errors="ignore")


class SeedSourceError(Exception):
    """來源（資料夾／.zip）本身有問題——打不開、裡面的檔案全都讀不了等。
    訊息是給使用者看的繁體中文，cmd_thesis_seed 會原樣回成 error 欄位。"""


def _collect_seed_docs(
    source: str,
    per_file: int = _THESIS_SEED_PER_FILE,
    total: int = _THESIS_SEED_TOTAL,
    max_files: int = _THESIS_SEED_MAX_FILES,
):
    """source 是一個資料夾或一個 .zip。挑出最多 `max_files` 個文件類檔案
    （依 _seed_score 排序），組成餵給 AI 的文字。`per_file`／`total`／`max_files`
    是每檔／全部的字數上限與檔案數上限（使用者可在 notes-web「全域設定 →
    研究生」調）。回傳 `(text, used_files)`；找不到任何可讀文件回 ("", [])；
    來源打不開／裡面的檔案全都讀不了時丟 SeedSourceError（訊息給使用者看）。"""
    import zipfile
    import zlib

    per_file = max(1000, int(per_file or _THESIS_SEED_PER_FILE))
    total = max(2000, int(total or _THESIS_SEED_TOTAL))
    max_files = max(1, min(40, int(max_files or _THESIS_SEED_MAX_FILES)))

    src = Path(source)
    candidates = []  # (score, size, label, getter)

    if src.is_file() and src.suffix.lower() == ".zip":
        try:
            zf = zipfile.ZipFile(src)
        except (OSError, zipfile.BadZipFile) as exc:
            raise SeedSourceError(f"打不開這個 .zip：{exc}") from exc
        skipped_big = skipped_unreadable = 0
        with zf:
            for info in zf.infolist():
                if info.is_dir() or len(candidates) >= _THESIS_SEED_SCAN_CAP:
                    continue
                rel = info.filename
                if not rel.lower().endswith(_SEED_EXTS):
                    continue
                if any(part in _SEED_SKIP_DIRS for part in rel.replace("\\", "/").split("/")):
                    continue
                if info.file_size > _SEED_MAX_ENTRY_BYTES:
                    skipped_big += 1
                    continue
                try:
                    data = zf.read(info)
                except (OSError, zipfile.BadZipFile, EOFError, RuntimeError,
                        NotImplementedError, zlib.error):
                    # Windows 11 內建「壓縮成 ZIP 檔案」對大檔會用 Deflate64（method 9），
                    # Python 的 zipfile 讀不了 → NotImplementedError；有密碼的 zip → RuntimeError。
                    skipped_unreadable += 1
                    continue
                candidates.append((
                    _seed_score(rel, info.file_size), info.file_size, rel,
                    (lambda d=data, n=rel: _extract_text(n, d)),
                ))
        if not candidates and (skipped_big or skipped_unreadable):
            bits = []
            if skipped_unreadable:
                bits.append(
                    f"{skipped_unreadable} 個檔案讀不了（多半是 Windows 內建壓縮的 Deflate64 格式）——"
                    "請改用 7-Zip、或在檔案總管選取「資料夾」而不是先壓縮，直接把資料夾路徑貼進來"
                )
            if skipped_big:
                bits.append(f"{skipped_big} 個檔案超過 {_SEED_MAX_ENTRY_BYTES // (1024 * 1024)}MB 已略過")
            raise SeedSourceError("這個 .zip 裡的文件都無法讀取：" + "；".join(bits))
    elif src.is_dir():
        for path in src.rglob("*"):
            if len(candidates) >= _THESIS_SEED_SCAN_CAP:
                break
            if not path.is_file() or path.suffix.lower() not in _SEED_EXTS:
                continue
            if any(part in _SEED_SKIP_DIRS for part in path.parts):
                continue
            try:
                size = path.stat().st_size
            except OSError:
                continue
            rel = str(path.relative_to(src))
            candidates.append((
                _seed_score(rel, size), size, rel,
                (lambda p=path, n=rel: _extract_text(n, p.read_bytes())),
            ))
    else:
        return "", []

    # 分數高→低，同分小檔優先；docx 至少留一個（論文草稿）
    candidates.sort(key=lambda c: (-c[0], c[1]))
    picked = candidates[:max_files]
    if not any(lbl.lower().endswith(".docx") for _s, _z, lbl, _g in picked):
        docx = next((c for c in candidates if c[2].lower().endswith(".docx")), None)
        if docx:
            picked = picked[: max(0, max_files - 1)] + [docx]

    parts, used = [], []
    for _score, _size, label, getter in picked:
        try:
            text = (getter() or "").strip()
        except (OSError, UnicodeError):
            continue
        if len(text) < 40:
            continue
        parts.append(f"===== {label} =====\n{text[:per_file]}")
        used.append(label)
    return "\n\n".join(parts)[:total], used


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
    """stdin: {source} → {drafts: [{title,tag,body}], used_files, error, call_count}。
    `source` 是一個資料夾或一個 .zip；自動挑出裡面最像「文件」的幾個檔案
    （純文字類／.docx／.tex／.ipynb，見 _SEED_EXTS，依檔名/路徑評分），一次 AI 呼叫產出一批任務便利貼
    草稿。不寫入——前端審核過再走既有的 /api/ai/save-notes（會存進目前作用中
    的便利貼集合，也就是研究生那份）。"""
    source = ((payload or {}).get("source") or (payload or {}).get("projectDir") or "").strip()
    p = Path(source) if source else None
    if not source or not (p.is_dir() or (p.is_file() and p.suffix.lower() == ".zip")):
        return {"drafts": [], "used_files": [], "error": f"找不到資料夾或 .zip：{source or '(未設定)'}", "call_count": 0}

    try:
        docs, used_files = _collect_seed_docs(
            source,
            per_file=(payload or {}).get("perFileChars") or _THESIS_SEED_PER_FILE,
            total=(payload or {}).get("totalChars") or _THESIS_SEED_TOTAL,
            max_files=(payload or {}).get("maxFiles") or _THESIS_SEED_MAX_FILES,
        )
    except SeedSourceError as exc:
        return {"drafts": [], "used_files": [], "error": str(exc), "call_count": 0}
    if len(docs) < 200:
        kind = ".zip" if p.is_file() else "資料夾"
        return {"drafts": [], "used_files": used_files,
                "error": f"在這個{kind}裡找不到可讀的文件（{_SEED_EXTS_LABEL}）", "call_count": 0}

    ai = _ai()
    ok, reason = ai.is_configured()
    if not ok:
        return {"drafts": [], "used_files": used_files, "error": f"{reason}，請先設定好 AI", "call_count": ai.get_call_count()}
    try:
        provider = ai.build_provider()
    except AIProviderError as exc:
        return {"drafts": [], "used_files": used_files, "error": str(exc), "call_count": ai.get_call_count()}

    ai.record_call()
    try:
        response = provider.generate_description(_build_thesis_seed_prompt(docs))
    except AIProviderError as exc:
        return {"drafts": [], "used_files": used_files, "error": str(exc), "call_count": ai.get_call_count()}
    except Exception as exc:  # noqa: BLE001
        return {"drafts": [], "used_files": used_files,
                "error": f"{type(exc).__name__}: {exc}", "call_count": ai.get_call_count()}

    drafts = _parse_thesis_seed(response)
    if not drafts:
        return {"drafts": [], "used_files": used_files,
                "error": "AI 回應無法解析成便利貼清單", "call_count": ai.get_call_count()}
    return {"drafts": drafts, "used_files": used_files, "error": None, "call_count": ai.get_call_count()}


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
