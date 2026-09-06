from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
from file_search_app.services.sticky_note_service import (
    AI_SEARCH_BODY_SNIPPET_CHARS,
    StickyNoteService,
    due_status,
    format_due_date,
    parse_due_date,
    preview_text,
)


def svc(data_dir):
    return StickyNoteService(StickyNoteRepository(indexes_dir=data_dir))


# ── preview_text ───────────────────────────────────────────────────

def test_preview_text_first_two_nonblank_lines():
    assert preview_text("a\n\nb\nc\nd") == "a\nb …"
    assert preview_text("only one") == "only one"
    assert preview_text("   \n  ") == ""


# ── CRUD via mutate ────────────────────────────────────────────────

def test_add_list_update_delete(data_dir):
    s = svc(data_dir)
    n = s.add_note("  標題  ", "  內容  ", "  工作  ")
    assert (n.title, n.body, n.tag) == ("標題", "內容", "工作")
    assert len(s.list_notes()) == 1
    assert s.update_note(n.id, "改", "改", "生活") is True
    assert s.list_notes()[0].tag == "生活"
    assert s.update_note("ghost-id", "x", "x", "x") is False
    s.delete_note(n.id)
    assert s.list_notes() == []


def test_update_missing_id_does_not_write(data_dir):
    s = svc(data_dir)
    s.add_note("a", "b", "")
    f = data_dir / ".sticky_notes.json"
    before = f.read_text(encoding="utf-8")
    assert s.update_note("nope", "x", "y", "z") is False
    assert f.read_text(encoding="utf-8") == before


def test_update_bumps_created_at_and_reorders(data_dir, monkeypatch):
    import file_search_app.services.sticky_note_service as mod
    from datetime import datetime

    clock = [datetime(2026, 1, 1), datetime(2026, 1, 2), datetime(2026, 6, 30)]

    class Clock:
        @staticmethod
        def now():
            return clock.pop(0)

    monkeypatch.setattr(mod, "datetime", Clock)
    s = svc(data_dir)
    a = s.add_note("A", "", "")   # 2026-01-01
    s.add_note("B", "", "")       # 2026-01-02  →  B 在上
    assert [n.title for n in s.list_notes()] == ["B", "A"]
    s.update_note(a.id, "A 改", "", "")  # created_at → 2026-06-30，A 跳到最上
    got = s.list_notes()
    assert [n.title for n in got] == ["A 改", "B"]
    assert got[0].created_at == datetime(2026, 6, 30)


def test_update_tags_batch_only_changes_checked(data_dir):
    s = svc(data_dir)
    a = s.add_note("A", "bodyA", "old")
    b = s.add_note("B", "bodyB", "old")
    c = s.add_note("C", "bodyC", "other")
    assert s.update_tags([a.id, c.id, "unknown"], "new") == 2
    by_id = {n.id: n for n in s.list_notes()}
    assert by_id[a.id].tag == "new"
    assert by_id[c.id].tag == "new"
    assert by_id[b.id].tag == "old"  # 沒被選到的不受影響
    # 標題／內容不動
    assert by_id[a.id].body == "bodyA"


def test_update_tags_strips_and_can_clear(data_dir):
    s = svc(data_dir)
    a = s.add_note("A", "", "old")
    assert s.update_tags([a.id], "  new tag  ") == 1
    assert s.list_notes()[0].tag == "new tag"
    assert s.update_tags([a.id], "") == 1
    assert s.list_notes()[0].tag == ""


def test_update_tags_does_not_bump_created_at(data_dir, monkeypatch):
    import file_search_app.services.sticky_note_service as mod
    from datetime import datetime

    clock = [datetime(2026, 1, 1), datetime(2026, 6, 30)]

    class Clock:
        @staticmethod
        def now():
            return clock.pop(0)

    monkeypatch.setattr(mod, "datetime", Clock)
    s = svc(data_dir)
    a = s.add_note("A", "", "old")  # 2026-01-01
    s.update_tags([a.id], "new")
    assert s.list_notes()[0].created_at == datetime(2026, 1, 1)  # 沒有被更新成「重新建立」


def test_update_tags_no_match_returns_zero(data_dir):
    s = svc(data_dir)
    s.add_note("A", "", "old")
    f = data_dir / ".sticky_notes.json"
    before = f.read_text(encoding="utf-8")
    assert s.update_tags(["ghost-id"], "new") == 0
    assert f.read_text(encoding="utf-8") == before  # 沒有匹配就不該寫檔


# ── 標籤自訂顏色 ──────────────────────────────────────────────────

def test_color_for_tag_uses_override_when_set(data_dir):
    s = svc(data_dir)
    life_hashed = s.color_for_tag("life")
    assert s.get_tag_color_override("work") == ""  # 一開始沒有自訂過
    s.set_tag_color("work", "#ff0000")
    assert s.color_for_tag("work") == "#ff0000"
    assert s.get_tag_color_override("work") == "#ff0000"
    # 自訂 work 的顏色不該影響到 life——雜湊配色照舊
    assert s.color_for_tag("life") == life_hashed


def test_clear_tag_color_reverts_to_hash(data_dir):
    s = svc(data_dir)
    hashed = s.color_for_tag("work")
    s.set_tag_color("work", "#00ff00")
    assert s.color_for_tag("work") == "#00ff00"
    s.clear_tag_color("work")
    assert s.color_for_tag("work") == hashed
    assert s.get_tag_color_override("work") == ""


def test_clear_tag_color_on_unset_tag_is_noop(data_dir):
    s = svc(data_dir)
    s.clear_tag_color("never-set")  # 不該拋例外，也不該無謂寫檔
    assert s.get_tag_color_override("never-set") == ""


def test_set_tag_color_persists_across_reload(data_dir):
    s = svc(data_dir)
    s.set_tag_color("work", "#123456")
    reloaded = svc(data_dir)
    assert reloaded.color_for_tag("work") == "#123456"


def test_empty_tag_never_gets_override(data_dir):
    s = svc(data_dir)
    s.set_tag_color("", "#ff0000")  # 空標籤——不該真的存進去
    assert s.get_tag_color_override("") == ""
    assert s.color_for_tag("") == "#e5e7eb"  # STICKY_NEUTRAL_COLOR，不受影響


def test_delete_notes_batch(data_dir):
    s = svc(data_dir)
    a = s.add_note("a", "", "")
    s.add_note("b", "", "")
    c = s.add_note("c", "", "")
    assert s.delete_notes([a.id, c.id, "unknown"]) == 2
    assert [n.title for n in s.list_notes()] == ["b"]


def test_list_notes_newest_first(data_dir, monkeypatch):
    import file_search_app.services.sticky_note_service as mod
    from datetime import datetime

    times = iter([datetime(2026, 1, 1, 0, 0), datetime(2026, 1, 2, 0, 0)])

    class FrozenDT:
        @staticmethod
        def now():
            return next(times)

    monkeypatch.setattr(mod, "datetime", FrozenDT)
    s = svc(data_dir)
    s.add_note("first", "", "")
    s.add_note("second", "", "")
    assert [n.title for n in s.list_notes()] == ["second", "first"]


def test_search_by_text_and_tag(data_dir):
    s = svc(data_dir)
    s.add_note("Docker 指令", "docker ps", "devops")
    s.add_note("Git 指令", "git status", "devops")
    s.add_note("購物清單", "牛奶", "生活")
    notes = s.list_notes()
    assert {n.title for n in s.search(notes, "docker", "")} == {"Docker 指令"}
    assert {n.title for n in s.search(notes, "", "devops")} == {"Docker 指令", "Git 指令"}
    assert {n.title for n in s.search(notes, "git", "devops")} == {"Git 指令"}
    assert s.search(notes, "無此內容", "") == []


def test_known_tags(data_dir):
    s = svc(data_dir)
    s.add_note("a", "", "z")
    s.add_note("b", "", "a")
    s.add_note("c", "", "")
    assert s.known_tags() == ["a", "z"]
    # 傳入現成清單時不再讀檔
    assert s.known_tags(s.list_notes()) == ["a", "z"]


def test_color_for_tag_stable_and_neutral(data_dir):
    s = svc(data_dir)
    assert s.color_for_tag("") == s.color_for_tag("")  # neutral
    c1 = s.color_for_tag("工作")
    c2 = s.color_for_tag("工作")
    assert c1 == c2 and c1.startswith("#") and len(c1) == 7
    assert s.color_for_tag("工作") != s.color_for_tag("生活")


def test_repository_recovers_from_corrupt_file(data_dir):
    (data_dir / ".sticky_notes.json").write_text("broken", encoding="utf-8")
    s = svc(data_dir)
    assert s.list_notes() == []
    assert s.load_panel_visible() is True


# ── AI 搜尋 prompt / 回應解析 ──────────────────────────────────────

def test_build_ai_search_prompt_numbers_and_truncates(data_dir):
    s = svc(data_dir)
    s.add_note("標題A", "x" * (AI_SEARCH_BODY_SNIPPET_CHARS + 50), "t")
    prompt = s.build_ai_search_prompt(s.list_notes(), "有哪些")
    assert "1. 標題：標題A" in prompt
    assert "有哪些" in prompt
    assert "x" * (AI_SEARCH_BODY_SNIPPET_CHARS + 1) not in prompt  # 被截斷


def test_parse_ai_search_response_json(data_dir):
    s = svc(data_dir)
    s.add_note("n1", "", "")
    s.add_note("n2", "", "")
    notes = sorted(s.list_notes(), key=lambda n: n.title)  # n1, n2
    ans, matched = s.parse_ai_search_response('{"answer": "找到了", "ids": [2], "list_tags": false}', notes)
    assert ans == "找到了"
    assert [m.title for m in matched] == ["n2"]


def test_parse_ai_search_response_json_in_fence(data_dir):
    s = svc(data_dir)
    s.add_note("n1", "", "")
    notes = s.list_notes()
    ans, matched = s.parse_ai_search_response(
        '前綴亂講\n```json\n{"answer": "A", "ids": [1], "list_tags": false}\n```\n', notes
    )
    assert ans == "A" and len(matched) == 1


def test_parse_ai_search_response_list_tags_uses_python_list(data_dir):
    s = svc(data_dir)
    s.add_note("n1", "", "工作")
    s.add_note("n2", "", "生活")
    notes = s.list_notes()
    ans, _ = s.parse_ai_search_response('{"answer": "目前的標籤：", "ids": [], "list_tags": true}', notes)
    assert "1. " in ans and "工作" in ans and "生活" in ans


def test_parse_ai_search_response_empty_answer_not_leaking_json(data_dir):
    s = svc(data_dir)
    s.add_note("n1", "", "t")
    notes = s.list_notes()
    ans, _ = s.parse_ai_search_response('{"answer": "", "ids": [1], "list_tags": false}', notes)
    assert ans == "（AI 沒有提供文字說明）"
    assert "{" not in ans


def test_parse_ai_search_response_legacy_label_fallback(data_dir):
    s = svc(data_dir)
    s.add_note("n1", "", "")
    s.add_note("n2", "", "")
    notes = sorted(s.list_notes(), key=lambda n: n.title)
    ans, matched = s.parse_ai_search_response("答案：舊格式\n編號：2", notes)
    assert "舊格式" in ans
    assert [m.title for m in matched] == ["n2"]


def test_parse_ai_search_response_bad_ids_type(data_dir):
    s = svc(data_dir)
    s.add_note("n1", "", "")
    notes = s.list_notes()
    ans, matched = s.parse_ai_search_response('{"answer": "hi", "ids": null, "list_tags": false}', notes)
    assert ans == "hi" and matched == []


# ── export ─────────────────────────────────────────────────────────

def test_export_markdown_code_fence_survives_backticks(data_dir):
    s = svc(data_dir)
    s.add_note("含反引號", "```py\nprint(1)\n```", "")
    md = s.export_markdown(s.list_notes())
    assert "````" in md  # 圍欄比內容的 ``` 長
    assert "🏷️" not in md  # 無標籤不輸出標籤列


# ── 垃圾桶 ─────────────────────────────────────────────────────────

def test_delete_note_moves_to_trash_not_gone(data_dir):
    s = svc(data_dir)
    a = s.add_note("A", "", "")
    s.add_note("B", "", "")
    s.delete_note(a.id)
    assert [n.title for n in s.list_notes()] == ["B"]
    assert [t.title for t in s.list_trash()] == ["A"]


def test_restore_note_brings_it_back(data_dir):
    s = svc(data_dir)
    a = s.add_note("A", "bodyA", "work")
    s.delete_note(a.id)
    assert s.restore_note(a.id) is True
    restored = s.list_notes()[0]
    assert (restored.id, restored.title, restored.tag) == (a.id, "A", "work")
    assert s.list_trash() == []
    assert s.restore_note("ghost-id") is False


def test_delete_notes_batch_moves_multiple_to_trash(data_dir):
    s = svc(data_dir)
    a = s.add_note("a", "", "")
    s.add_note("b", "", "")
    c = s.add_note("c", "", "")
    assert s.delete_notes([a.id, c.id, "unknown"]) == 2
    assert [n.title for n in s.list_notes()] == ["b"]
    assert {t.title for t in s.list_trash()} == {"a", "c"}


def test_purge_note_removes_permanently(data_dir):
    s = svc(data_dir)
    a = s.add_note("A", "", "")
    s.delete_note(a.id)
    assert s.purge_note(a.id) is True
    assert s.list_trash() == []
    assert s.purge_note(a.id) is False  # already gone, idempotent-safe


def test_empty_trash_clears_everything_and_counts(data_dir):
    s = svc(data_dir)
    a = s.add_note("a", "", "")
    b = s.add_note("b", "", "")
    s.delete_note(a.id)
    s.delete_note(b.id)
    assert s.empty_trash() == 2
    assert s.list_trash() == []
    assert s.empty_trash() == 0  # nothing left, no error


def test_list_trash_newest_deleted_first(data_dir, monkeypatch):
    import file_search_app.services.sticky_note_service as mod
    from datetime import datetime

    times = iter([
        datetime(2026, 1, 1), datetime(2026, 1, 2),  # add_note x2 (created_at, unused here)
        datetime(2026, 1, 10), datetime(2026, 1, 20),  # delete_note x2 (deleted_at)
    ])

    class FrozenDT:
        @staticmethod
        def now():
            return next(times)

    monkeypatch.setattr(mod, "datetime", FrozenDT)
    s = svc(data_dir)
    a = s.add_note("first-deleted", "", "")
    b = s.add_note("second-deleted", "", "")
    s.delete_note(a.id)
    s.delete_note(b.id)
    assert [t.title for t in s.list_trash()] == ["second-deleted", "first-deleted"]


# ── 匯出/匯入含插圖 ───────────────────────────────────────────────

def test_export_json_embeds_image_bytes(data_dir):
    images_dir = data_dir / ".sticky_note_images"
    images_dir.mkdir(parents=True)
    (images_dir / "photo.png").write_bytes(b"\x89PNG\r\n\x1a\nFAKE")

    s = svc(data_dir)
    from file_search_app.models import StickyNote
    from datetime import datetime
    s._repo.mutate(lambda notes: notes + [
        StickyNote(id="img1", title="WithImg", body="", tag="", created_at=datetime.now(), image="photo.png"),
    ])
    dump = s.export_json(s.list_notes())
    assert '"image_data": "data:image/png;base64,' in dump


def test_import_json_writes_embedded_image_to_destination(data_dir, tmp_path):
    src_images = data_dir / ".sticky_note_images"
    src_images.mkdir(parents=True)
    (src_images / "photo.png").write_bytes(b"\x89PNG\r\n\x1a\nFAKE")

    source = svc(data_dir)
    from file_search_app.models import StickyNote
    from datetime import datetime
    source._repo.mutate(lambda notes: notes + [
        StickyNote(id="img1", title="WithImg", body="", tag="", created_at=datetime.now(), image="photo.png"),
    ])
    dump = source.export_json(source.list_notes())

    dest_dir = tmp_path / "dest"
    dest = svc(dest_dir)
    result = dest.import_json(dump)
    assert result == {"added": 1, "skipped": 0}
    dest_image = dest_dir / ".sticky_note_images" / "photo.png"
    assert dest_image.exists()
    assert dest_image.read_bytes() == b"\x89PNG\r\n\x1a\nFAKE"


def test_export_json_round_trips_via_import(data_dir):
    s = svc(data_dir)
    n1 = s.add_note("A", "內容A", "工作")
    n2 = s.add_note("B", "內容B", "")
    dump = s.export_json(s.list_notes())

    other = svc(data_dir / "other")  # 模擬「另一台電腦」，指向不同的資料夾
    result = other.import_json(dump)
    assert result == {"added": 2, "skipped": 0}
    imported = {n.id: n for n in other.list_notes()}
    assert set(imported) == {n1.id, n2.id}  # id 原封不動保留下來
    assert imported[n1.id].title == "A" and imported[n1.id].tag == "工作"


def test_import_json_skips_already_existing_by_id(data_dir):
    s = svc(data_dir)
    s.add_note("A", "", "")
    dump = s.export_json(s.list_notes())

    result = s.import_json(dump)  # 匯入同一份到同一份資料——id 都已存在
    assert result == {"added": 0, "skipped": 1}
    assert len(s.list_notes()) == 1  # 沒有變成兩筆


def test_import_json_rejects_bad_format(data_dir):
    s = svc(data_dir)
    try:
        s.import_json("not json")
        assert False, "應該要拋出 ValueError"
    except ValueError:
        pass
    try:
        s.import_json('{"no_notes_key": []}')
        assert False, "應該要拋出 ValueError"
    except ValueError:
        pass


def test_panel_state_persist(data_dir):
    s = svc(data_dir)
    s.save_panel_visible(False)
    assert s.load_panel_visible() is False


# ── AI 生成便利貼：prompt / 回應解析 ──────────────────────────────

class _FakeEntry:
    def __init__(self, name):
        self.name = name


def test_build_document_to_note_prompt_includes_known_tags_and_content(data_dir):
    s = svc(data_dir)
    s.add_note("existing", "", "工作")
    prompt = s.build_document_to_note_prompt(_FakeEntry("a.txt"), "文件內容片段")
    assert "工作" in prompt  # 既有標籤要附進去，讓模型優先沿用
    assert "a.txt" in prompt
    assert "文件內容片段" in prompt
    assert '"title"' in prompt and '"tag"' in prompt and '"body"' in prompt


def test_build_document_to_note_prompt_no_known_tags(data_dir):
    s = svc(data_dir)
    prompt = s.build_document_to_note_prompt(_FakeEntry("a.txt"), "x")
    assert "目前沒有任何既有標籤" in prompt


def test_build_document_to_note_image_prompt(data_dir):
    s = svc(data_dir)
    prompt = s.build_document_to_note_image_prompt(_FakeEntry("photo.jpg"))
    assert "photo.jpg" in prompt and "圖片" in prompt


def test_parse_document_to_note_response_json(data_dir):
    s = svc(data_dir)
    draft = s.parse_document_to_note_response(
        '{"title": "標題", "tag": "工作", "body": "內容"}'
    )
    assert draft == {"title": "標題", "tag": "工作", "body": "內容"}


def test_parse_document_to_note_response_json_in_fence(data_dir):
    s = svc(data_dir)
    draft = s.parse_document_to_note_response(
        '前綴亂講\n```json\n{"title": "T", "tag": "", "body": "B"}\n```\n'
    )
    assert draft == {"title": "T", "tag": "", "body": "B"}


def test_parse_document_to_note_response_missing_required_field(data_dir):
    s = svc(data_dir)
    assert s.parse_document_to_note_response('{"title": "", "tag": "x", "body": "B"}') is None
    assert s.parse_document_to_note_response('{"title": "T", "tag": "x", "body": ""}') is None


def test_parse_document_to_note_response_unparseable(data_dir):
    s = svc(data_dir)
    assert s.parse_document_to_note_response("不是 JSON，也沒有大括號") is None


# ── 到期日 ─────────────────────────────────────────────────────────

def test_parse_due_date_empty_and_valid():
    assert parse_due_date("") == ""
    assert parse_due_date("  ") == ""
    assert parse_due_date("2026-09-10") == "2026-09-10T23:59:59"


def test_parse_due_date_invalid_raises():
    try:
        parse_due_date("not-a-date")
        assert False, "應該要拋出 ValueError"
    except ValueError:
        pass


def test_format_due_date_round_trips_and_tolerates_junk():
    assert format_due_date("") == ""
    assert format_due_date(parse_due_date("2026-09-10")) == "2026-09-10"
    assert format_due_date("garbage") == ""  # 壞資料不炸掉，當作沒有到期日


def test_due_status_classifies_overdue_soon_later():
    from datetime import datetime

    now = datetime(2026, 9, 6, 12, 0, 0)
    assert due_status("", now=now) == ""
    overdue = parse_due_date("2026-09-05")
    soon = parse_due_date("2026-09-07")
    later = parse_due_date("2026-09-20")
    assert due_status(overdue, now=now) == "overdue"
    assert due_status(soon, now=now) == "soon"
    assert due_status(later, now=now) == ""


def test_add_and_update_note_carry_due_at(data_dir):
    s = svc(data_dir)
    n = s.add_note("A", "", "", parse_due_date("2026-09-10"))
    assert s.list_notes()[0].due_at == "2026-09-10T23:59:59"
    s.update_note(n.id, "A", "", "", parse_due_date("2026-09-20"))
    assert s.list_notes()[0].due_at == "2026-09-20T23:59:59"
    s.update_note(n.id, "A", "", "", "")  # 清除到期日
    assert s.list_notes()[0].due_at == ""


def test_due_at_survives_trash_and_restore(data_dir):
    s = svc(data_dir)
    n = s.add_note("A", "", "", parse_due_date("2026-09-10"))
    s.delete_note(n.id)
    assert s.list_trash()[0].due_at == "2026-09-10T23:59:59"
    s.restore_note(n.id)
    assert s.list_notes()[0].due_at == "2026-09-10T23:59:59"


def test_due_at_persists_across_repository_reload(data_dir):
    s = svc(data_dir)
    s.add_note("A", "", "", parse_due_date("2026-09-10"))
    reloaded = svc(data_dir)
    assert reloaded.list_notes()[0].due_at == "2026-09-10T23:59:59"
