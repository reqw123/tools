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


# ── BatchRecategorizeDialog ──────────────────────────────────────────

def test_batch_recategorize_applies_to_checked_only(tk_root, monkeypatch):
    from file_search_app.ui.dialogs.batch_recategorize_dialog import BatchRecategorizeDialog
    import file_search_app.ui.dialogs.batch_recategorize_dialog as mod

    monkeypatch.setattr(mod.messagebox, "askyesno", lambda *_a, **_kw: True)
    entries = [
        entry(path="C:/x/a.txt", category="old", serial=1, row_index=0),
        entry(path="C:/x/b.txt", category="old", serial=2, row_index=1),
    ]
    captured = {}
    d = BatchRecategorizeDialog(
        tk_root, entries, existing_categories=["old"],
        on_confirm=lambda checked, category: captured.update(checked=checked, category=category),
    )
    tk_root.update()
    assert len(d._list.row_widgets) == 2

    # 只勾第一筆——records 是 (item, var, haystack)，同 BulkDeleteDialog 的用法。
    _item, var, _haystack = d._list.records[0]
    var.set(True)
    d.category_var.set("new")
    d._confirm()

    assert captured["category"] == "new"
    assert [e.path for e in captured["checked"]] == ["C:/x/a.txt"]


def test_batch_recategorize_no_selection_shows_info(tk_root, monkeypatch):
    from file_search_app.ui.dialogs.batch_recategorize_dialog import BatchRecategorizeDialog
    import file_search_app.ui.dialogs.batch_recategorize_dialog as mod

    shown = {}
    monkeypatch.setattr(mod.messagebox, "showinfo", lambda title, msg: shown.update(title=title, msg=msg))
    entries = [entry(path="C:/x/a.txt", serial=1, row_index=0)]
    d = BatchRecategorizeDialog(tk_root, entries, [], on_confirm=lambda *_a: None)
    tk_root.update()
    d._confirm()
    assert "尚未勾選" in shown.get("msg", "")
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


def test_sticky_panel_due_only_filters_and_sorts(tk_root, data_dir):
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService, parse_due_date
    from file_search_app.ui.widgets.sticky_note_panel import StickyNotePanel
    import tkinter.font as tkfont
    from datetime import datetime, timedelta

    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))
    no_due = svc.add_note("NoDue", "", "")
    soon = svc.add_note("Soon", "", "", parse_due_date((datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")))
    overdue = svc.add_note("Overdue", "", "", parse_due_date((datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")))

    class FakeAIDesc:
        def is_configured(self):
            return True, ""

    panel = StickyNotePanel(tk_root, svc, FakeAIDesc(), on_open_ai_settings=lambda e: None,
                            font_hint=tkfont.Font(size=10), width=380, on_collapse=lambda: None)
    tk_root.update()
    assert {n.id for n in panel._last_shown} == {no_due.id, soon.id, overdue.id}

    panel._due_only_var.set(True)
    panel._refresh()
    # 沒有到期日的被濾掉，剩下的依到期日由早到晚排（逾期的最先到期）。
    assert [n.id for n in panel._last_shown] == [overdue.id, soon.id]
    assert "只看快到期" in panel._count_var.get()

    panel._due_only_var.set(False)
    panel._refresh()
    assert {n.id for n in panel._last_shown} == {no_due.id, soon.id, overdue.id}


def test_sticky_note_dialog_tag_color_picker(tk_root, data_dir, monkeypatch):
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.ui.dialogs.sticky_note_dialog import StickyNoteDialog
    import file_search_app.ui.dialogs.sticky_note_dialog as mod

    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))

    dlg = StickyNoteDialog(
        tk_root, known_tags=[], on_confirm=lambda *_a: None,
        ai_description=None, sticky_service=svc, initial_tag="work",
    )
    tk_root.update()

    # 一開始沒自訂過顏色，色塊顯示雜湊配色，「重設」按鈕停用。
    hashed = svc.color_for_tag("work")
    assert dlg._tag_swatch.cget("bg") == hashed
    assert str(dlg._reset_color_btn["state"]) == "disabled"

    # 模擬使用者用色盤選了紅色——colorchooser.askcolor 回傳 (rgb_tuple, hex_str)。
    monkeypatch.setattr(mod.colorchooser, "askcolor", lambda *_a, **_kw: ((255, 0, 0), "#ff0000"))
    dlg._pick_tag_color()
    assert svc.get_tag_color_override("work") == "#ff0000"
    assert dlg._tag_swatch.cget("bg") == "#ff0000"
    assert str(dlg._reset_color_btn["state"]) == "normal"

    # 切換到別的標籤——色塊要跟著換成那個標籤自己的顏色（沒自訂過就是雜湊配色）。
    other_hashed = svc.color_for_tag("life")
    dlg.tag_var.set("life")
    tk_root.update()
    assert dlg._tag_swatch.cget("bg") == other_hashed
    assert str(dlg._reset_color_btn["state"]) == "disabled"

    # 切回 work，重設應該清掉剛剛設定的紅色，退回雜湊配色。
    dlg.tag_var.set("work")
    tk_root.update()
    dlg._reset_tag_color()
    assert svc.get_tag_color_override("work") == ""
    assert dlg._tag_swatch.cget("bg") == hashed
    dlg.destroy()


def test_sticky_note_dialog_pick_color_without_tag_shows_info(tk_root, data_dir, monkeypatch):
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.ui.dialogs.sticky_note_dialog import StickyNoteDialog
    import file_search_app.ui.dialogs.sticky_note_dialog as mod

    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))
    shown = {}
    monkeypatch.setattr(mod.messagebox, "showinfo", lambda title, msg: shown.update(title=title, msg=msg))

    dlg = StickyNoteDialog(
        tk_root, known_tags=[], on_confirm=lambda *_a: None,
        ai_description=None, sticky_service=svc,
    )
    tk_root.update()
    dlg._pick_tag_color()
    assert "標籤" in shown.get("msg", "")
    dlg.destroy()


def test_sticky_trash_dialog_restore(tk_root, data_dir):
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.ui.dialogs.sticky_note_trash_dialog import StickyNoteTrashDialog

    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))
    a = svc.add_note("Trashed", "body", "work")
    svc.delete_note(a.id)
    assert svc.list_trash()

    changed = {"n": 0}
    dlg = StickyNoteTrashDialog(
        tk_root, svc, svc.color_for_tag, on_change=lambda: changed.__setitem__("n", changed["n"] + 1),
    )
    tk_root.update()
    assert len(dlg._row_records) == 1

    dlg._on_restore(a.id)
    assert svc.list_trash() == []
    assert [n.title for n in svc.list_notes()] == ["Trashed"]
    assert changed["n"] == 1
    dlg.destroy()


def test_sticky_batch_recategorize_applies_to_checked_only(tk_root, data_dir, monkeypatch):
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.ui.dialogs.sticky_note_batch_recategorize_dialog import (
        StickyNoteBatchRecategorizeDialog,
    )
    import file_search_app.ui.dialogs.sticky_note_batch_recategorize_dialog as mod

    monkeypatch.setattr(mod.messagebox, "askyesno", lambda *_a, **_kw: True)
    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))
    a = svc.add_note("A", "", "old")
    svc.add_note("B", "", "old")
    notes = svc.list_notes()

    dlg = StickyNoteBatchRecategorizeDialog(
        tk_root, notes, svc.known_tags(notes), svc.color_for_tag,
        on_confirm=lambda note_ids, tag: svc.update_tags(note_ids, tag),
    )
    tk_root.update()
    assert len(dlg._row_records) == 2

    target_note, var, _row, _haystack = next(r for r in dlg._row_records if r[0].id == a.id)
    var.set(True)
    dlg.tag_var.set("new")
    dlg._confirm()

    by_id = {n.id: n for n in svc.list_notes()}
    assert by_id[a.id].tag == "new"
    assert by_id[target_note.id].tag == "new"
    other = next(n for n in svc.list_notes() if n.id != a.id)
    assert other.tag == "old"  # 沒勾的那則不受影響


def test_sticky_batch_recategorize_check_by_tag(tk_root, data_dir):
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.ui.dialogs.sticky_note_batch_recategorize_dialog import (
        StickyNoteBatchRecategorizeDialog,
    )

    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))
    a = svc.add_note("A", "", "work")
    b = svc.add_note("B", "", "work")
    c = svc.add_note("C", "", "life")
    d = svc.add_note("D", "", "")  # 無標籤
    notes = svc.list_notes()

    dlg = StickyNoteBatchRecategorizeDialog(
        tk_root, notes, svc.known_tags(notes), svc.color_for_tag, on_confirm=lambda *_a: None,
    )
    tk_root.update()

    # 選「work」一鍵勾選底下兩則，不影響其他標籤。
    dlg._by_tag_var.set("work")
    dlg._check_by_tag()
    checked_ids = {note.id for note, v, _row, _h in dlg._row_records if v.get()}
    assert checked_ids == {a.id, b.id}

    dlg._uncheck_all()
    # 選「（無標籤）」只勾到沒有標籤的那一則。
    dlg._by_tag_var.set("（無標籤）")
    dlg._check_by_tag()
    checked_ids = {note.id for note, v, _row, _h in dlg._row_records if v.get()}
    assert checked_ids == {d.id}
    assert c.id not in checked_ids
    dlg.destroy()


def test_sticky_batch_recategorize_check_by_tag_scrolls_to_it(tk_root, data_dir, monkeypatch):
    import file_search_app.services.sticky_note_service as mod
    from datetime import datetime, timedelta
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.ui.dialogs.sticky_note_batch_recategorize_dialog import (
        StickyNoteBatchRecategorizeDialog,
    )

    # 固定時間戳，確保排序（最新在上）是決定性的：target 最早建立，會被
    # 排到清單最後面，符合「需要捲動才看得到」的情境，不受機器時鐘解析度影響。
    base = datetime(2026, 1, 1)
    clock = iter(base + timedelta(seconds=i) for i in range(41))

    class Clock:
        @staticmethod
        def now():
            return next(clock)

    monkeypatch.setattr(mod, "datetime", Clock)
    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))
    target = svc.add_note("Target", "", "work")
    for i in range(40):
        svc.add_note(f"filler{i}", "", "other")
    notes = svc.list_notes()  # 最新在上：filler 們比 target 晚建立，排在它前面，
                              # target 因此落在清單底部，符合「需要捲動才看得到」的情境。

    dlg = StickyNoteBatchRecategorizeDialog(
        tk_root, notes, svc.known_tags(notes), svc.color_for_tag, on_confirm=lambda *_a: None,
    )
    tk_root.update()
    before = dlg._canvas.yview()[0]
    assert before == 0.0  # 一開始在最上面

    # 先搜尋一個不相關的關鍵字，模擬「使用者剛用過搜尋框」的情境——
    # _check_by_tag 應該要自己清掉這個殘留的搜尋條件，不然目標列可能被濾掉。
    dlg._search_var.set("filler")
    tk_root.update()

    dlg._by_tag_var.set("work")
    dlg._check_by_tag()
    tk_root.update()

    assert dlg._search_var.get() == ""  # 搜尋框被清空了
    checked_ids = {note.id for note, v, _row, _h in dlg._row_records if v.get()}
    assert checked_ids == {target.id}
    after = dlg._canvas.yview()[0]
    assert after > before  # 真的捲動過去了，不是還停在最上面
    dlg.destroy()


def test_sticky_batch_recategorize_no_selection_shows_info(tk_root, data_dir, monkeypatch):
    from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
    from file_search_app.services.sticky_note_service import StickyNoteService
    from file_search_app.ui.dialogs.sticky_note_batch_recategorize_dialog import (
        StickyNoteBatchRecategorizeDialog,
    )
    import file_search_app.ui.dialogs.sticky_note_batch_recategorize_dialog as mod

    shown = {}
    monkeypatch.setattr(mod.messagebox, "showinfo", lambda title, msg: shown.update(title=title, msg=msg))
    svc = StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))
    svc.add_note("A", "", "")
    notes = svc.list_notes()

    dlg = StickyNoteBatchRecategorizeDialog(
        tk_root, notes, svc.known_tags(notes), svc.color_for_tag, on_confirm=lambda *_a: None,
    )
    tk_root.update()
    dlg._confirm()
    assert "尚未勾選" in shown.get("msg", "")
    dlg.destroy()


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
