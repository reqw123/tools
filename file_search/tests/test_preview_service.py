from file_search_app.services.preview_service import (
    SLOW_EXTRACT_EXTS,
    PreviewService,
)
from tests.conftest import make_zip, write_docx, write_xlsx

P = PreviewService()


def test_plain_text_utf8(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("你好 world", encoding="utf-8")
    assert P.extract_preview_text(f) == "你好 world"


def test_plain_text_truncates(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("A" * 5000, encoding="utf-8")
    out = P.extract_preview_text(f, max_chars=100)
    assert out.startswith("A" * 100) and "內容過長" in out


def test_generic_extension_text_detection(tmp_path):
    good = tmp_path / "a.weirdext"
    good.write_text("function foo() { return 1 }", encoding="utf-8")
    assert "function foo" in P.extract_preview_text(good)

    binary = tmp_path / "b.weirdext"
    binary.write_bytes(bytes(range(0, 32)) * 50)  # 大量控制字元
    assert P.extract_preview_text(binary) is None


def test_null_byte_is_binary(tmp_path):
    f = tmp_path / "a.weirdext"
    f.write_bytes(b"text\x00more")
    assert P.extract_preview_text(f) is None


def test_known_binary_ext_skipped(tmp_path):
    f = tmp_path / "a.png"
    f.write_bytes(b"not really a png but text-like enough")
    assert P.extract_preview_text(f) is None


def test_docx_extraction(tmp_path):
    f = tmp_path / "d.docx"
    write_docx(f, ["第一段", "第二段"])
    out = P.extract_preview_text(f)
    assert "第一段" in out and "第二段" in out


def test_xlsx_extraction(tmp_path):
    f = tmp_path / "s.xlsx"
    write_xlsx(f, [["姓名", "分數"], ["小明", "90"]])
    out = P.extract_preview_text(f)
    assert "姓名" in out and "小明" in out


def test_zip_listing(tmp_path):
    f = tmp_path / "z.zip"
    make_zip(f, ["a.txt", "dir/b.txt"])
    out = P.extract_preview_text(f)
    assert "a.txt" in out and "dir/b.txt" in out and "壓縮檔" in out


def test_corrupt_docx_returns_none(tmp_path):
    f = tmp_path / "d.docx"
    f.write_bytes(b"not a zip")
    assert P.extract_preview_text(f) is None


def test_slow_extract_exts_membership():
    for e in (".doc", ".docx", ".pdf", ".xlsx", ".zip", ".7z"):
        assert e in SLOW_EXTRACT_EXTS
    assert ".txt" not in SLOW_EXTRACT_EXTS


def test_utf16_with_bom(tmp_path):
    f = tmp_path / "a.txt"
    f.write_bytes("哈囉世界".encode("utf-16"))
    assert "哈囉世界" in P.extract_preview_text(f)


def test_image_helpers_without_pil_are_safe(tmp_path, monkeypatch):
    import file_search_app.services.preview_service as ps
    monkeypatch.setattr(ps, "HAS_PIL", False)
    f = tmp_path / "a.png"
    f.write_bytes(b"x")
    assert PreviewService().load_image_thumbnail(f, 100) is None
    assert PreviewService().prepare_image_for_ai(f) is None
