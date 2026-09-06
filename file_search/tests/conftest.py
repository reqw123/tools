"""共用 fixtures／小工具。

原則：所有測試都在 pytest 的 tmp_path 底下建立自己的資料目錄，絕不碰專案
真正的 indexes/。每個 Repository 都吃 indexes_dir 參數，Service 都吃注入的
Repository，所以整條路徑都可以在暫存目錄裡跑。
"""

import zipfile
from pathlib import Path

import pytest

from file_search_app.models import IndexEntry


# ── 索引 .md ─────────────────────────────────────────────────────────

_MD_HEADER = "# 測試索引\n\n| 路徑 | 分類 | 說明 |\n|---|---|---|\n"


def make_index_md(path: Path, rows) -> Path:
    """rows: [(path_str, category, desc), ...]。用最單純的表格格式寫一份索引檔。"""
    lines = [_MD_HEADER]
    for p, c, d in rows:
        lines.append(f"| `{p}` | {c} | {d} |\n")
    path.write_text("".join(lines), encoding="utf-8")
    return path


def entry(path="C:/x/a.txt", category="", description="", source_index=None, row_index=0, serial=1, added_at=None):
    return IndexEntry(
        path=path, category=category, description=description,
        source_index=source_index or Path("idx.md"),
        row_index=row_index, serial=serial, added_at=added_at,
    )


@pytest.fixture
def data_dir(tmp_path):
    d = tmp_path / "indexes"
    d.mkdir()
    return d


# ── OOXML 產生器（給 preview_service 的 docx/xlsx 擷取測試用）─────────

def write_docx(path: Path, paragraphs):
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    body = "".join(f'<w:p><w:r><w:t>{p}</w:t></w:r></w:p>' for p in paragraphs)
    doc = f'<?xml version="1.0"?><w:document xmlns:w="{ns}"><w:body>{body}</w:body></w:document>'
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("word/document.xml", doc)


def write_xlsx(path: Path, rows):
    s = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
    shared = []
    for row in rows:
        for cell in row:
            if cell not in shared:
                shared.append(cell)
    sst = (
        f'<sst xmlns="{s}">'
        + "".join(f"<si><t>{v}</t></si>" for v in shared)
        + "</sst>"
    )
    sheet_rows = ""
    for row in rows:
        cells = "".join(
            f'<c t="s"><v>{shared.index(v)}</v></c>' for v in row
        )
        sheet_rows += f"<row>{cells}</row>"
    sheet = f'<worksheet xmlns="{s}"><sheetData>{sheet_rows}</sheetData></worksheet>'
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("xl/sharedStrings.xml", sst)
        zf.writestr("xl/worksheets/sheet1.xml", sheet)


def make_zip(path: Path, names):
    with zipfile.ZipFile(path, "w") as zf:
        for n in names:
            zf.writestr(n, b"x")


# ── 假 HTTP（AI provider 測試用）─────────────────────────────────────

class FakeResponse:
    def __init__(self, body: bytes, status=200):
        self._body = body
        self.status = status

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def tk_root():
    """能建 Tk root 就給，環境沒 GUI 就 skip 整個測試。"""
    tk = pytest.importorskip("tkinter")
    try:
        root = tk.Tk()
    except tk.TclError as exc:  # pragma: no cover - 只有無頭環境會走到
        pytest.skip(f"Tk 不可用：{exc}")
    root.withdraw()
    yield root
    try:
        root.destroy()
    except Exception:
        pass
