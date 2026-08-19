"""文件與文字內容擷取——純文字讀取、PDF 文字擷取、Office 文件內容擷取、
壓縮檔內容列表、圖片預覽資料準備。不依賴 Tkinter：圖片這邊只回傳 PIL Image
（縮圖處理過），真正轉成 Tk 看得懂的 PhotoImage 是 UI 層自己的事（PhotoImage
本身就是 Tk 物件，天生不可能脫離 Tk 存在）。

純文字類型不再靠副檔名白名單決定支不支援——TEXT_EXTS 只是「已知一定是文字，
不用檢查就直接讀」的快速通道；沒列在裡面、也不是 docx/pptx/xlsx/pdf/zip 的
其他副檔名，一律用 `_looks_like_text()` 偵測開頭內容像不像文字，像的話照樣
當文字讀出來——這樣原始碼、設定檔、標記語言之類沒特別處理過的格式（.html、
.js、.h、.css、.sql……）都能自動被支援，不用每種格式都手動加進白名單；
真正的二進位格式（圖片／音訊／影片／執行檔等）則會被這個偵測擋下來，不會
被硬解成一堆亂碼塞進預覽或 AI 摘要。"""

import io
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from file_search_app.config import (
    AUDIO_EXTS, IMAGE_EXTS, OOXML_NS, PREVIEW_READ_BYTES, TEXT_EXTS, VIDEO_EXTS,
)

try:
    from PIL import Image
    HAS_PIL = True
except ImportError:
    HAS_PIL = False

# 舊版二進位 Office 格式（.doc/.ppt/.xls，微軟 97-2003 那種，不是
# docx/pptx/xlsx 那種 zip 包 XML）沒有輕量的純 Python 解析方式，改用 Office
# COM 自動化（見 _legacy_office_worker.py）；沒裝 pywin32／沒裝 Office 都會
# 安靜失敗退回 None，不需要在這裡另外偵測可不可用。
_LEGACY_OFFICE_EXTS = {".doc", ".ppt", ".xls"}
_LEGACY_OFFICE_WORKER = Path(__file__).with_name("_legacy_office_worker.py")
# COM 自動化偶爾會卡在一個沒人會去點的彈出視窗（巨集警告、受保護的檢視…），
# 逾時就直接放棄這一筆，不要讓「更新內容快取」或「AI 批次說明」整批卡死；
# 一般檔案開啟通常幾秒內就完成，30 秒已經是相當寬鬆的上限。
_LEGACY_OFFICE_TIMEOUT = 30.0

# 已知一定是二進位格式，看到就直接跳過、不用花時間讀開頭 bytes 判斷——
# 圖片／音訊／影片有自己的專屬處理（縮圖／播放器），這裡不重複處理；
# 壓縮檔（.zip 除外，見 _read_zip_listing）／執行檔目前沒有對應的內容解析器，
# 硬當文字讀只會得到亂碼。
_KNOWN_BINARY_EXTS = IMAGE_EXTS | AUDIO_EXTS | VIDEO_EXTS | {
    ".rar", ".7z", ".rtf",
    ".exe", ".dll", ".msi", ".iso", ".bin", ".dat",
    ".class", ".pyc", ".so", ".o", ".obj", ".db", ".sqlite",
}
# 判斷「開頭這段 bytes 像不像文字」時，這些控制字元算正常（換行/Tab/換頁/
# 倒退/ESC——終端機跳脫序列、程式碼縮排都可能用到），其餘 0x00–0x1F 範圍的
# 控制字元只有二進位格式才會大量出現。
_TEXT_CONTROL_WHITELIST = {0x09, 0x0A, 0x0D, 0x0C, 0x08, 0x1B}


def _looks_like_text(raw: bytes) -> bool:
    """簡單的二進位／文字判斷式，不靠副檔名：只要開頭這段 bytes 裡「不正常的
    控制字元」比例夠低，就當作是文字檔案。門檻抓得寬鬆（5%），正常文字檔案
    這個比例幾乎是 0，二進位格式（圖片／壓縮檔／執行檔）通常一開頭就會踩到
    大量這類位元組。"""
    if not raw:
        return False
    if b"\x00" in raw:  # null byte 幾乎必然代表二進位內容
        return False
    sample = raw[:8192]
    bad = sum(1 for b in sample if b < 0x20 and b not in _TEXT_CONTROL_WHITELIST)
    return bad / len(sample) < 0.05


def _decode_text_bytes(raw: bytes) -> str:
    """依序試幾種常見編碼（含中文 Windows 常用的 cp950/big5），全部失敗才用
    utf-8 + errors="replace"（可能在截斷處出現一兩個亂碼字元，預覽用途可以
    接受，不值得為了這個把整份都讀完再判斷）。"""
    for enc in ("utf-8-sig", "utf-8", "cp950", "big5", "cp936"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _truncate(text: str, max_chars: int) -> str:
    text = text.strip()
    if len(text) > max_chars:
        return text[:max_chars].rstrip() + "\n\n…（內容過長，僅預覽開頭部分）"
    return text


def _read_plain_text(p: Path, max_chars: int) -> str:
    """已知一定是文字的副檔名（TEXT_EXTS）：只讀開頭一段 bytes，不用先檢查
    像不像文字就直接解碼。"""
    with open(p, "rb") as f:
        raw = f.read(PREVIEW_READ_BYTES)
    return _truncate(_decode_text_bytes(raw), max_chars)


def _read_generic_text(p: Path, max_chars: int):
    """副檔名不在任何已知清單裡的檔案：讀開頭一段 bytes，先用 `_looks_like_text()`
    判斷值不值得當文字讀，看起來不像文字（多半是沒特別處理過的二進位格式）
    就回傳 None，讓呼叫端退回一般圖示，不會把亂碼塞進預覽或 AI 摘要。"""
    with open(p, "rb") as f:
        raw = f.read(PREVIEW_READ_BYTES)
    if not _looks_like_text(raw):
        return None
    return _truncate(_decode_text_bytes(raw), max_chars)


def _read_zip_listing(p: Path, max_chars: int):
    """壓縮檔不解開實際內容（避免踩到 zip 炸彈或讀到超大內容），只列出裡面
    的檔名當作「內容節錄」——對搜尋／AI 摘要來說，知道壓縮檔裡裝了哪些檔案
    通常已經夠判斷這是不是要找的東西。"""
    with zipfile.ZipFile(p) as zf:
        names = zf.namelist()
    if not names:
        return None
    listing = "\n".join(names[:300])
    header = f"（壓縮檔，內含 {len(names)} 個項目，以下為部分檔名列表）\n"
    return _truncate(header + listing, max_chars)


def _read_docx_text(p: Path, max_chars: int) -> str:
    ns = OOXML_NS["w"]
    with zipfile.ZipFile(p) as zf:
        with zf.open("word/document.xml") as f:
            tree = ET.parse(f)
    paras = []
    for para in tree.getroot().iter(f"{{{ns}}}p"):
        line = "".join(t.text or "" for t in para.iter(f"{{{ns}}}t")).strip()
        if line:
            paras.append(line)
    return _truncate("\n".join(paras), max_chars)


def _read_pptx_text(p: Path, max_chars: int) -> str:
    ns = OOXML_NS["a"]
    with zipfile.ZipFile(p) as zf:
        slide_names = sorted(
            (n for n in zf.namelist() if re.match(r"ppt/slides/slide\d+\.xml$", n)),
            key=lambda n: int(re.search(r"\d+", n).group()),
        )
        chunks = []
        for name in slide_names:
            with zf.open(name) as f:
                tree = ET.parse(f)
            texts = [t.text for t in tree.getroot().iter(f"{{{ns}}}t") if t.text and t.text.strip()]
            if texts:
                chunks.append(f"【第 {len(chunks) + 1} 頁】" + " ".join(texts))
    return _truncate("\n".join(chunks), max_chars)


def _read_xlsx_text(p: Path, max_chars: int) -> str:
    ns = OOXML_NS["s"]
    with zipfile.ZipFile(p) as zf:
        shared = []
        if "xl/sharedStrings.xml" in zf.namelist():
            with zf.open("xl/sharedStrings.xml") as f:
                tree = ET.parse(f)
            for si in tree.getroot().iter(f"{{{ns}}}si"):
                shared.append("".join(t.text or "" for t in si.iter(f"{{{ns}}}t")))
        sheet_names = sorted(
            (n for n in zf.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)),
            key=lambda n: int(re.search(r"\d+", n).group()),
        )
        if not sheet_names:
            return ""
        with zf.open(sheet_names[0]) as f:
            tree = ET.parse(f)
        rows_out = []
        for row in tree.getroot().iter(f"{{{ns}}}row"):
            cells = []
            for c in row.iter(f"{{{ns}}}c"):
                v = c.find(f"{{{ns}}}v")
                if v is None or v.text is None:
                    continue
                if c.get("t") == "s":
                    idx = int(v.text)
                    cells.append(shared[idx] if idx < len(shared) else "")
                else:
                    cells.append(v.text)
            if cells:
                rows_out.append(" | ".join(cells))
            if len(rows_out) >= 60:  # 預覽用，不需要整份試算表都轉出來
                break
    return _truncate("\n".join(rows_out), max_chars)


def _read_pdf_text(p: Path, max_chars: int):
    """看環境裡有沒有裝 pypdf 或舊名 PyPDF2，兩者都沒裝就回傳 None（呼叫端會
    退回一般圖示＋提示，不會讓整支工具因為少一個選用套件而打不開）。"""
    try:
        from pypdf import PdfReader
    except ImportError:
        try:
            from PyPDF2 import PdfReader
        except ImportError:
            return None
    try:
        reader = PdfReader(str(p))
        if getattr(reader, "is_encrypted", False):
            try:
                if reader.decrypt("") == 0:
                    return None
            except Exception:
                return None
    except Exception:
        return None
    chunks = []
    for page in reader.pages[:5]:
        try:
            chunks.append(page.extract_text() or "")
        except Exception:
            continue
    text = "\n".join(chunks).strip()
    return _truncate(text, max_chars) if text else None


def _read_legacy_office_text(p: Path, ext: str, max_chars: int):
    """.doc／.ppt／.xls：獨立子行程呼叫 Office COM 自動化擷取文字（見
    `_legacy_office_worker.py` 檔頭說明）。沒裝 pywin32、沒裝 Office、逾時、
    或任何其他失敗，一律安靜回傳 None——這條路徑本來就是「能撐則撐、撐不住
    就退回一般圖示」的最後防線，不該讓整支工具因為這個選用功能而卡住或掛掉。"""
    if not _LEGACY_OFFICE_WORKER.exists():
        return None
    try:
        proc = subprocess.run(
            [sys.executable, str(_LEGACY_OFFICE_WORKER), ext, str(p)],
            capture_output=True, timeout=_LEGACY_OFFICE_TIMEOUT,
        )
    except Exception:
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    text = proc.stdout.decode("utf-8", errors="replace").strip()
    return _truncate(text, max_chars) if text else None


class PreviewService:
    """封裝檔案內容擷取邏輯——供全文快取（CacheService）、批次補說明
    （DescriptionService）與主視窗預覽面板共用同一套解析結果。"""

    has_pil = HAS_PIL

    def extract_preview_text(self, p: Path, max_chars: int = 3000):
        """回傳這個檔案適合放進預覽區塊（或送給 AI 摘要）的純文字內容；不支援
        的類型或讀取失敗（檔案損毀、格式跟副檔名對不上等）一律回傳 None，
        呼叫端退回顯示圖示＋提示，不會讓預覽面板顯示一堆亂碼或讓整支程式
        掛掉。

        判斷順序：已知格式（純文字白名單／docx／pptx／xlsx／pdf／zip／舊版
        doc·ppt·xls）各自用專屬邏輯解析；已知一定是二進位的格式（圖片／
        音訊／影片／執行檔等）直接跳過；其餘所有沒特別處理過的副檔名都嘗試
        當文字讀，讀出來像不像文字由內容本身判斷，不是靠副檔名——這樣
        「所有檔案類型」都有機會被支援，不用每種格式都手動加進白名單。"""
        ext = p.suffix.lower()
        try:
            if ext in TEXT_EXTS:
                return _read_plain_text(p, max_chars)
            if ext == ".docx":
                return _read_docx_text(p, max_chars) or None
            if ext == ".pptx":
                return _read_pptx_text(p, max_chars) or None
            if ext == ".xlsx":
                return _read_xlsx_text(p, max_chars) or None
            if ext == ".pdf":
                return _read_pdf_text(p, max_chars)
            if ext == ".zip":
                return _read_zip_listing(p, max_chars)
            if ext in _LEGACY_OFFICE_EXTS:
                return _read_legacy_office_text(p, ext, max_chars)
            if ext in _KNOWN_BINARY_EXTS:
                return None
            return _read_generic_text(p, max_chars)
        except Exception:
            return None

    def load_image_thumbnail(self, p: Path, bound: int):
        """讀圖並縮到 (bound, bound) 以內（保持長寬比），回傳 PIL Image；沒裝
        Pillow、檔案不是圖片、或讀取失敗（損毀檔案等）都回傳 None，由呼叫端
        退回圖示＋提示，不讓預覽面板掛掉。"""
        if not HAS_PIL or p.suffix.lower() not in IMAGE_EXTS:
            return None
        try:
            img = Image.open(p)
            img.thumbnail((bound, bound))
            return img
        except Exception:
            return None

    def prepare_image_for_ai(self, p: Path, max_dimension: int = 1024):
        """把圖片縮小、統一轉成 JPEG bytes，準備送給支援視覺的 AI 模型——
        vision 模型的收費／處理時間通常跟圖片解析度成正比，這裡刻意縮小，
        不送原始解析度的圖檔；轉成同一種格式也省得呼叫端要處理各種來源
        格式（PNG/GIF/WEBP…）各自的相容性問題。沒裝 Pillow、檔案不是圖片、
        或讀取失敗都回傳 None，由呼叫端當作「沒有內容可以送」處理。回傳
        (jpeg_bytes, mime_type)。"""
        if not HAS_PIL or p.suffix.lower() not in IMAGE_EXTS:
            return None
        try:
            img = Image.open(p)
            img.thumbnail((max_dimension, max_dimension))
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")  # JPEG 不支援透明通道／調色盤模式
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            return buf.getvalue(), "image/jpeg"
        except Exception:
            return None
