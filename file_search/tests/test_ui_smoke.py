"""Tk 相關的煙霧測試——重點放在這幾輪改過的行為：惰性建列 + 上限、
去抖動、便利貼面板 AI 結果失效、預覽背景擷取、AISelectDialog 取消線路。

環境沒有 GUI 時整檔 skip（見 conftest.tk_root）。
"""
import time
from pathlib import Path

from file_search_app.models import DuplicateGroup, IndexEntry
from tests.conftest import entry


def _pump(root, seconds=0.4):
    """跑 Tk 事件迴圈約 `seconds` 秒——去抖動(180ms)／背景擷取(120ms spawn +
    80ms poll) 都要靠這個等它們真的觸發。"""
    end = time.time() + seconds
    while time.time() < end:
        root.update()
        time.sleep(0.01)


# ── BulkDeleteDialog ──────────────────────────────────────────────

def test_bulk_delete_lazy_rows_and_cap(tk_root):
    from file_search_app.ui.dialogs.delete_dialogs import BulkDeleteDialog, _MAX_VISIBLE_ROWS

    total = _MAX_VISIBLE_ROWS + 200
    entries = [entry(path=f"C:/x/f{i}.txt", serial=i + 1, row_index=i) for i in range(total)]
    d = BulkDeleteDialog(tk_root, entries, on_confirm=lambda x: None)
    tk_root.update()
    assert len(d._list.row_widgets) == _MAX_VISIBLE_ROWS

    d._list.search_var.set("f7")
    d._list.refilter()
    # 名稱含 "f7"：f7 + f70..f79（總數 < 100，所以沒有 f7xx）= 11
    expected = sum(1 for i in range(total) if "f7" in f"f{i}.txt")
    assert d._list.match_var.get().startswith(f"符合搜尋：{expected}")
    d._list.check_visible()
    assert sum(1 for _it, v, _h in d._list.records if v.get()) == expected
    d.destroy()


def test_bulk_delete_missing_only_filter(tk_root, tmp_path):
    real = tmp_path / "real.txt"
    real.write_text("x", encoding="utf-8")
    entries = [
        entry(path=str(real), serial=1, row_index=0),
        entry(path=str(tmp_path / "ghost.txt"), serial=2, row_index=1),
    ]
    from file_search_app.ui.dialogs.delete_dialogs import BulkDeleteDialog
    d = BulkDeleteDialog(tk_root, entries, on_confirm=lambda x: None)
    tk_root.update()
    d._toggle_missing_only()
    tk_root.update()
    assert len(d._list.row_widgets) == 1
    d.destroy()


# ── AISelectDialog ────────────────────────────────────────────────

def test_ai_select_cancel_wiring(tk_root, tmp_path):
    from file_search_app.ui.dialogs.ai_description_dialog import AISelectDialog

    blanks = [entry(path=str(tmp_path / f"f{i}.txt"), serial=i + 1, row_index=i) for i in range(4)]
    captured = {}

    def fake_run(selected, on_prog, on_done, cancel_event):
        captured["cancel_event"] = cancel_event
        captured["on_done"] = on_done

    class FakeAI:
        def current_provider_label(self):
            return "Ollama（本機）"

    d = AISelectDialog(tk_root, blanks, FakeAI(),
                       on_open_ai_settings=lambda cb: None, on_run=fake_run,
                       on_finished=lambda r: captured.setdefault("finished", r))
    tk_root.update()
    d._list.records[0][1].set(True)
    d._submit()
    assert d._running is True and captured["cancel_event"] is not None

    d.destroy()
    assert captured["cancel_event"].is_set() is True and d._running is False
    # 視窗關掉後遲來的結果必須被丟掉，不呼叫 on_finished
    captured["on_done"]([(blanks[0], "s", None)])
    assert "finished" not in captured


def test_ai_select_lazy_rows(tk_root, tmp_path):
    from file_search_app.ui.dialogs.ai_description_dialog import AISelectDialog, _MAX_VISIBLE_ROWS

    blanks = [entry(path=str(tmp_path / f"f{i}.txt"), serial=i + 1, row_index=i)
              for i in range(_MAX_VISIBLE_ROWS + 50)]

    class FakeAI:
        def current_provider_label(self):
            return "OpenAI"

    d = AISelectDialog(tk_root, blanks, FakeAI(),
                       on_open_ai_settings=lambda cb: None, on_run=lambda *a: None,
                       on_finished=lambda r: None)
    tk_root.update()
    assert len(d._list.row_widgets) == _MAX_VISIBLE_ROWS
    d.destroy()


# ── DuplicateDialog ───────────────────────────────────────────────

def test_duplicate_dialog_cap(tk_root, monkeypatch):
    import file_search_app.ui.dialogs.duplicate_dialog as mod
    from file_search_app.ui.dialogs.duplicate_dialog import DuplicateDialog, _MAX_VISIBLE_GROUPS

    # _confirm() 會跳原生 messagebox（無事件迴圈時會永遠卡住）——測試裡直接放行
    monkeypatch.setattr(mod.messagebox, "askyesno", lambda *a, **k: True)
    monkeypatch.setattr(mod.messagebox, "showinfo", lambda *a, **k: None)

    def grp(i):
        es = [IndexEntry(path=f"C:/a/{i}_{j}.txt", category="", description="",
                         source_index=Path("i.md"), row_index=j) for j in range(2)]
        return DuplicateGroup(size=1, sha256=f"h{i}", entries=es)

    groups = [grp(i) for i in range(_MAX_VISIBLE_GROUPS + 30)]
    captured = {}
    d = DuplicateDialog(tk_root, groups, on_confirm=lambda x: captured.setdefault("n", len(x)))
    tk_root.update()
    assert len(d._keep_vars) == _MAX_VISIBLE_GROUPS + 30  # 全部組都有 keep_var
    d._keep_vars[0].set(0)
    d._confirm()
    # 只有第 0 組解析 → 刪 1 筆（另一筆保留）
    assert captured["n"] == 1


# ── 便利貼面板 ────────────────────────────────────────────────────

def test_sticky_panel_debounce_and_ai_invalidate(tk_root, data_dir):
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.ui.widgets.sticky_note_panel import StickyNotePanel

    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))
    svc.add_note("Docker", "docker ps", "devops")
    svc.add_note("Git", "git status", "devops")

    class FakeAIDesc:
        def is_configured(self):
            return True, ""

    import tkinter.font as tkfont
    panel = StickyNotePanel(tk_root, svc, FakeAIDesc(), on_open_ai_settings=lambda e: None,
                            font_hint=tkfont.Font(size=10), width=380, on_collapse=lambda: None)
    tk_root.update()

    # 模擬 AI 搜尋結果
    panel._ai_result_ids = {svc.list_notes()[0].id}
    panel._ai_query_snapshot = "x"
    panel._invalidate_ai_results()
    assert panel._ai_result_ids is None

    # 打字去抖動：trace 只排程，不立刻重畫
    panel._search_var.set("docker")
    assert panel._refresh_after_id is not None
    _pump(tk_root, 0.4)
    assert panel._refresh_after_id is None
    assert panel._last_shown and panel._last_shown[0].title == "Docker"


# ── 預覽面板背景擷取 ──────────────────────────────────────────────

def test_preview_panel_async_extract_stale_guard(tk_root, tmp_path):
    import tkinter.font as tkfont
    from file_search_app.services.preview_service import PreviewService
    from file_search_app.ui.widgets.preview_panel import PreviewPanel

    txt = tmp_path / "a.txt"
    txt.write_text("plain content", encoding="utf-8")
    fake_pdf = tmp_path / "b.pdf"
    fake_pdf.write_bytes(b"%PDF junk")

    class FakeMedia:
        available = False

    pp = PreviewPanel(tk_root, PreviewService(), FakeMedia(),
                      tkfont.Font(size=11), tkfont.Font(size=10), 320)
    e_txt = entry(path=str(txt), serial=1)
    e_pdf = entry(path=str(fake_pdf), serial=2)

    pp.show_entry(e_txt)
    assert pp._mode == "text"

    pp.show_entry(e_pdf)               # slow → 佔位「讀取中」
    assert pp._mode == "text"
    pp.show_entry(e_txt)               # 120ms spawn 前就切走
    _pump(tk_root, 0.5)
    assert pp._mode == "text"          # 顯示的是 txt，不是被 pdf 蓋掉

    pp.show_entry(e_pdf)
    _pump(tk_root, 0.6)
    assert pp._mode == "icon"          # 沒有 pypdf → 圖示

    tk_root.update()


# ── MainWindow 整體組裝煙霧 ──────────────────────────────────────

def test_main_window_wiring_smoke(tk_root, data_dir, tmp_path, monkeypatch):
    """照 app.py 的方式手動組裝一次 MainWindow（用暫存資料目錄），驗證所有
    Service／Repository 相依接得起來、視窗能建能關。會抓到像
    DuplicateService 建構子參數改了卻沒同步 app.py 這種 wiring 錯誤。"""
    from file_search_app.repositories.ai_settings_repository import AISettingsRepository
    from file_search_app.repositories.ai_usage_repository import AIUsageRepository
    from file_search_app.repositories.app_prefs_repository import AppPrefsRepository
    from file_search_app.repositories.cache_repository import CacheRepository
    from file_search_app.repositories.index_repository import IndexRepository
    from file_search_app.repositories.metadata_repository import MetadataRepository
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.ai_description_service import AIDescriptionService
    from file_search_app.services.cache_service import CacheService
    from file_search_app.services.description_service import DescriptionService
    from file_search_app.services.duplicate_service import DuplicateService
    from file_search_app.services.import_service import ImportService
    from file_search_app.services.index_service import IndexService
    from file_search_app.services.preview_service import PreviewService
    from file_search_app.services.scan_service import ScanService
    from file_search_app.services.search_service import SearchService
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.services.transcription_service import TranscriptionService
    from file_search_app.ui.main_window import MainWindow

    index_repo = IndexRepository(indexes_dir=data_dir)
    cache_repo = CacheRepository(indexes_dir=data_dir)
    metadata_repo = MetadataRepository(indexes_dir=data_dir)
    ai_settings_repo = AISettingsRepository(indexes_dir=data_dir, secrets_dir=tmp_path / "sec")
    ai_usage_repo = AIUsageRepository(indexes_dir=data_dir)
    sticky_repo = StickyNoteRepository(indexes_dir=data_dir)
    prefs_repo = AppPrefsRepository(indexes_dir=data_dir)

    preview = PreviewService()
    cache_svc = CacheService(index_repo, cache_repo, preview)
    index_svc = IndexService(index_repo, cache_repo, metadata_repo)
    dup_svc = DuplicateService(index_repo, cache_repo, index_svc)
    desc_svc = DescriptionService(preview, index_svc)
    transcription = TranscriptionService()
    ai_desc = AIDescriptionService(ai_settings_repo, preview, transcription, ai_usage_repo)
    sticky_svc = StickyNoteService(sticky_repo)

    class NoVLC:
        available = False

        def __init__(self, *a, **k):
            pass

        def release(self):
            pass

    # MainWindow 是 tk.Tk 的子類——要先把 conftest 的隱藏 root 收掉再建它。
    tk_root.destroy()
    w = MainWindow(
        index_service=index_svc, search_service=SearchService(), import_service=ImportService(index_svc),
        scan_service=ScanService(), duplicate_service=dup_svc, description_service=desc_svc,
        cache_service=cache_svc, preview_service=preview, metadata_repo=metadata_repo,
        ai_description_service=ai_desc, ai_settings_repo=ai_settings_repo,
        transcription_service=transcription, sticky_note_service=sticky_svc, app_prefs_repo=prefs_repo,
        media_controller_cls=NoVLC,
    )
    try:
        w.withdraw()
        w.update()
        assert w._sticky_panel is not None
        assert (data_dir / "file_index.md").exists()  # ensure_default_index 建了一份
    finally:
        w._on_close()
