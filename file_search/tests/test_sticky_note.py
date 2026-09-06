from file_search_app.repositories.sticky_note_repository import StickyNoteRepository
from file_search_app.services.sticky_note_service import (
    AI_SEARCH_BODY_SNIPPET_CHARS,
    StickyNoteService,
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
