"""索引集（indexes/ 底下的 .md 檔案）讀寫——只做 Markdown 表格層級的解析與
寫入，不知道 Tkinter、不顯示 messagebox、不決定要不要寫入（那是 Service／
UI 決定的事，這裡只負責「已經決定要寫」之後怎麼安全地寫）。"""

import re
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.models import IndexEntry
from file_search_app.repositories.atomic_io import atomic_write_text

# 表格列格式：| `路徑` | 分類 | 說明 |——分類欄、說明欄都可以留空，兩欄都用
# `[^|]*?`（0 個以上）而不是 `+?`（1 個以上），不然真正空白的儲存格會因為
# `+?` 至少要吃 1 個字元、往前借了一個空格字元，解析出來變成 " " 而不是 ""。
# 用的是簡單逐行 regex，不依賴任何 Markdown 套件。
_ROW_RE = re.compile(
    r"^\|\s*(?P<fence>`+)(?P<path>.*?)(?P=fence)\s*\|"
    r"\s*(?P<category>[^|]*?)\s*\|\s*(?P<description>[^|]*?)\s*\|"
)

_INVALID_FILENAME_CHARS = set('<>:"/\\|?*')

_DEFAULT_INDEX_NAME = "file_index.md"
_DEFAULT_INDEX_TEMPLATE = """# 📑 檔案快速索引

> 這份文件是 `file_search.py` 的其中一份索引來源，**完全手動維護**——程式不會
> 掃描任何資料夾，只讀這份表格（或用「拖曳檔案」「新增檔案...」「匯入資料夾...」
> 功能自動新增列）。
>
> `file_search.py` 支援**多份索引檔案**：`indexes/` 資料夾底下每一個 `.md` 檔
> 都是獨立一份索引集，程式標題列的下拉選單可以切換要搜尋哪一份；要新增一份
> 新的索引集，直接在 `indexes/` 底下新建一個 `.md` 檔、照同樣的表格格式寫即可，
> 不用改程式碼。
>
> **格式規定（跟這一行格式不一樣的列，程式會直接跳過、不會出錯，但那筆資料就搜尋不到）**：
>
> ```
> | `完整路徑\\檔名.副檔名` | 分類 | 一句話說明或關鍵字 |
> ```
>
> - 開頭是 `|`，接著檔名用單一反引號 `` ` `` 包住，然後是**分類**欄（自訂文字，
>   例如「論文」「截圖」「教學筆記」——程式會依目前這份索引裡出現過的分類自動
>   組成篩選下拉選單，同一個分類名稱打法要一致，不然會被當成兩種不同分類），
>   最後是**說明**欄
> - 路徑裡有反引號的話沒辦法收錄，實務上檔名幾乎不會用到反引號，不用擔心
> - 路徑建議用**完整絕對路徑**，因為這些檔案通常散落在硬碟各處，不像同一個
>   專案資料夾底下的檔案能用相對路徑
> - 分類欄、說明欄都不能包含 `|` 符號（會被誤判成表格分隔線，文字會被腰斬），
>   要表達「或」的意思請用「／」
> - 分類欄留空（`| \\`路徑\\` |  | 說明 |`）也可以，篩選下拉選單會把這種歸類成
>   「未分類」
> - 一行只能收錄一個檔案；同一個檔案要多個關鍵字都搜得到，就把關鍵字都寫進說明欄，
>   搜尋是比對說明欄全文，不是只比對第一個詞
> - 用「拖曳檔案」「新增檔案...」「匯入資料夾...」新增的列，會自動照這個格式
>   附加到表格最後一行，不用手動維護對齊；表格裡列的先後順序不影響搜尋結果，
>   純粹是你閱讀這份文件時的順序

| 路徑 | 分類 | 說明 |
|---|---|---|
"""


def _sanitize_cell(text: str) -> str:
    """表格欄位不能含 `|` 或實際換行；儲存前轉成安全的單行文字。"""
    return " ".join(text.replace("|", "／").split())


def _format_path_code(path_str: str) -> str:
    """用比路徑內最長反引號序列更長的 Markdown code span 包住路徑。"""
    longest = max((len(run) for run in re.findall(r"`+", path_str)), default=0)
    fence = "`" * max(1, longest + 1)
    return f"{fence}{path_str}{fence}"


class IndexRepository:
    """indexes/ 底下 .md 索引檔案的讀寫層。"""

    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.indexes_dir = indexes_dir

    # ── 索引集本身（列出／建立／刪除）───────────────────────────────

    def list_index_files(self):
        """回傳 indexes/ 底下所有 .md 索引檔案，依檔名排序；資料夾不存在就回傳空清單。"""
        if not self.indexes_dir.exists():
            return []
        return sorted(self.indexes_dir.glob("*.md"))

    def ensure_default_index(self) -> None:
        """indexes/ 底下完全沒有 .md 檔案時（資料夾遺失、被搬走、或第一次使用這個
        工具），自動建立一份格式正確的空白索引檔案，程式才不會一啟動就卡在「沒有
        索引可用」的空畫面；只要底下還有任何一份 .md（就算不是這個預設檔名），這
        個函式什麼都不做，不會動到既有內容，也不會覆蓋掉手動維護的資料。"""
        self.indexes_dir.mkdir(parents=True, exist_ok=True)
        if self.list_index_files():
            return
        atomic_write_text(self.indexes_dir / _DEFAULT_INDEX_NAME, _DEFAULT_INDEX_TEMPLATE)

    def validate_name(self, raw: str):
        """把使用者輸入的索引集名稱正規化成檔名（沒打 .md 副檔名的話自動補上），
        回傳 (檔名, None) 代表合法可用；回傳 (None, 錯誤原因) 代表不合法——包含
        Windows 檔名不能用的符號、名稱是空的、或跟 indexes/ 底下既有檔案撞名。"""
        name = raw.strip()
        if not name:
            return None, "請輸入索引集名稱"
        if name in (".", ".."):
            return None, "不是合法的檔名"
        bad = _INVALID_FILENAME_CHARS & set(name)
        if bad:
            return None, f"檔名不能包含：{' '.join(sorted(bad))}"
        filename = name if name.lower().endswith(".md") else f"{name}.md"
        if len(filename) <= 3:  # 去掉 .md 後名稱是空的（例如只打了「.md」本身）
            return None, "請輸入索引集名稱"
        if (self.indexes_dir / filename).exists():
            return None, f"「{filename}」已經存在，換個名稱"
        return filename, None

    def create_index_file(self, filename: str) -> Path:
        """在 indexes/ 底下建立一份新的空白索引檔案（跟 ensure_default_index() 用
        同一份範本，開頭附格式規定說明），回傳新檔案的 Path。呼叫端要先用
        validate_name() 檢查過檔名合法、沒有撞名。"""
        self.indexes_dir.mkdir(parents=True, exist_ok=True)
        path = self.indexes_dir / filename
        atomic_write_text(path, _DEFAULT_INDEX_TEMPLATE)
        return path

    def delete_index_file(self, md_path: Path) -> None:
        md_path.unlink()

    # ── 資料列 ───────────────────────────────────────────────────────

    def read_text(self, md_path: Path) -> str:
        return md_path.read_text(encoding="utf-8") if md_path.exists() else ""

    def write_text(self, md_path: Path, text: str) -> None:
        atomic_write_text(md_path, text)

    def load_entries(self, md_path: Path):
        """回傳 [IndexEntry, ...]，依表格列在檔案裡出現的順序（row_index 就是這個
        順序，0-based，只算可解析的資料列）；讀不到檔案或格式不符的列都安靜跳過，
        不拋例外——索引檔案是手動編輯的東西，格式一時打錯不該讓整支程式打不開。
        serial／added_at 這兩個顯示用欄位這裡不填（由 Service 層依目前檢視範圍
        統一指定），維持預設值。"""
        entries = []
        try:
            text = md_path.read_text(encoding="utf-8")
        except OSError:
            return entries
        row_index = 0
        for line in text.splitlines():
            m = _ROW_RE.match(line.strip())
            if m:
                entries.append(IndexEntry(
                    path=m.group("path"),
                    category=m.group("category"),
                    description=m.group("description"),
                    source_index=md_path,
                    row_index=row_index,
                ))
                row_index += 1
        return entries

    def append_row(self, md_path: Path, path_str: str, category: str, desc: str) -> None:
        """把一列新資料附加到指定索引檔案的表格最後一行。只負責寫 Markdown；
        加入時間紀錄由呼叫端（Service）另外透過 MetadataRepository 處理。"""
        existing = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
        if existing and not existing.endswith("\n"):
            existing += "\n"
        line = f"| {_format_path_code(path_str)} | {_sanitize_cell(category)} | {_sanitize_cell(desc)} |\n"
        atomic_write_text(md_path, existing + line)

    def update_row_by_path(self, md_path: Path, path_str: str, category: str, desc: str) -> int:
        """把索引檔案裡「路徑完全等於 path_str」的資料列，分類／說明換成新的值；
        其餘所有內容（包含這一列在表格裡的相對位置）不變。回傳實際更新了幾列——
        正常應該剛好 1，0 代表在檔案裡找不到這個路徑（可能索引檔案被外部改過），
        大於 1 代表原本就有重複列（不是這個函式造成的，是既有資料本身重複），
        這種情況全部一起更新，不會留下一部分沒改到的舊值。"""
        text = md_path.read_text(encoding="utf-8")
        new_line = f"| {_format_path_code(path_str)} | {_sanitize_cell(category)} | {_sanitize_cell(desc)} |\n"
        out_lines = []
        updated = 0
        for line in text.splitlines(keepends=True):
            m = _ROW_RE.match(line.strip())
            if m and m.group("path") == path_str:
                out_lines.append(new_line)
                updated += 1
            else:
                out_lines.append(line)
        if updated:
            atomic_write_text(md_path, "".join(out_lines))
        return updated

    def update_row_by_occurrence(self, md_path: Path, occurrence_index: int, category: str, desc: str) -> bool:
        """精確更新指定「索引資料列序號」（0-based，只計算可解析的資料列，跟
        remove_rows_by_occurrences() 用同一套編號）那一列的分類／說明，路徑本身
        不變。跟 update_row_by_path() 的差別：那個是依路徑比對，同一路徑在同一份
        索引重複出現時會把全部符合的列一起改掉；這個只改序號對上的那一列，就算
        有其他列路徑完全相同也不會被連帶動到。回傳 True 代表確實改到那一列，
        False 代表序號超出目前檔案範圍（可能索引檔案剛好被外部修改過，行數變少）。"""
        text = md_path.read_text(encoding="utf-8")
        out_lines = []
        occurrence = 0
        updated = False
        for line in text.splitlines(keepends=True):
            stripped = line.strip()
            m = _ROW_RE.match(stripped)
            if m:
                if occurrence == occurrence_index:
                    new_line = f"| {_format_path_code(m.group('path'))} | {_sanitize_cell(category)} | {_sanitize_cell(desc)} |\n"
                    out_lines.append(new_line)
                    updated = True
                else:
                    out_lines.append(line)
                occurrence += 1
            else:
                out_lines.append(line)
        if updated:
            atomic_write_text(md_path, "".join(out_lines))
        return updated

    def remove_missing_rows(self, md_path: Path):
        """回傳 (移除筆數, 完整新內容字串)——只移除「表格資料列且路徑檔案已不存在」的
        整行，其餘所有內容（說明文字、格式規定、表頭分隔線）原封不動保留。這裡不
        直接寫入檔案，讓呼叫端（Service／UI）可以先把筆數顯示給使用者確認過，再
        呼叫 write_text() 真正套用。"""
        text = md_path.read_text(encoding="utf-8")
        kept, removed = [], 0
        for line in text.splitlines(keepends=True):
            m = _ROW_RE.match(line.strip())
            if m and not Path(m.group("path")).exists():
                removed += 1
                continue
            kept.append(line)
        return removed, "".join(kept)

    def remove_rows_by_paths(self, md_path: Path, paths_to_remove) -> tuple:
        """回傳 (刪除筆數, 完整新內容字串)——只移除路徑落在 paths_to_remove 集合裡的
        資料列，其餘所有內容（說明文字、格式規定、表頭分隔線）原封不動保留。跟
        remove_missing_rows() 的差別：那個是自動判斷「檔案已不存在」，這個是由
        呼叫端指定要刪哪幾筆，不管檔案還在不在。"""
        text = md_path.read_text(encoding="utf-8")
        kept, removed = [], 0
        for line in text.splitlines(keepends=True):
            m = _ROW_RE.match(line.strip())
            if m and m.group("path") in paths_to_remove:
                removed += 1
                continue
            kept.append(line)
        return removed, "".join(kept)

    def remove_rows_by_occurrences(self, md_path: Path, occurrence_indexes) -> tuple:
        """精確移除指定的「索引資料列序號」（0-based，只計算可解析的資料列）。

        與依路徑刪除不同，即使同一路徑在同一份索引重複出現多次，也只會刪除
        呼叫端指定的那幾筆，保留選中的那一列。回傳 (刪除筆數, 完整新內容字串)，
        不直接寫入檔案。
        """
        wanted = set(occurrence_indexes)
        text = md_path.read_text(encoding="utf-8")
        kept = []
        removed = 0
        occurrence = 0
        for line in text.splitlines(keepends=True):
            if _ROW_RE.match(line.strip()):
                if occurrence in wanted:
                    removed += 1
                    occurrence += 1
                    continue
                occurrence += 1
            kept.append(line)
        return removed, "".join(kept)
