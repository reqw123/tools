"""索引清單本體——包住 ttk.Treeview，顯示資料一律對應 IndexEntry，不再靠
`values[4]`／`values[5]` 這種容易在加欄位後位移出錯的寫法：每一列的 iid
對應哪一筆 IndexEntry，存在 `_entries_by_iid` 這個 dict 裡，要拿選取列的
資料一律透過 `selected_entry()`。

流水號（serial）完全來自 IndexEntry.serial，這裡只負責顯示，不會重新編號；
「每個索引集從 1 開始、搜尋或篩選後保留原序號、全部索引模式依合併順序編號」
這些規則都是上層（IndexService／SearchService）決定好、entries 傳進來的
順序與 serial 就已經是最終結果。"""

import tkinter as tk
from tkinter import ttk

from file_search_app.config import COLOR_MISSING_FG, MISSING_ICON
from file_search_app.models import format_added_at
from file_search_app.ui.styles import icon_for

_COLUMNS = ("serial", "icon", "name", "category", "desc", "path", "source", "added_at")
_HEADINGS = {
    "serial": "序號", "icon": "", "name": "檔名", "category": "分類", "desc": "說明",
    "path": "路徑", "source": "來源索引集", "added_at": "加入時間",
}
_WIDTHS = {
    "serial": 58, "icon": 36, "name": 200, "category": 90, "desc": 400,
    "path": 240, "source": 110, "added_at": 110,
}


class IndexTree:
    def __init__(
        self, parent, font, *,
        on_select=None, on_activate=None, on_delete_key=None, on_space=None, on_seek=None,
    ):
        """on_select()：選取變化。on_activate()：雙擊／Enter。on_delete_key(event)：
        Delete 鍵，回傳值會原樣交回 Tkinter（可以是 "break"）。on_space(event)：
        空白鍵。on_seek(event, delta_ms)：左右鍵。"""
        self.frame = tk.Frame(parent)
        # 欄位加總起來的「自然寬度」本來會變成清單的隱性寬度下限，空間不夠時
        # 反而是預覽區塊被擠縮——關掉 propagate，寬度改由呼叫端（MainWindow 的
        # _sync_body_layout）統一算。
        self.frame.pack_propagate(False)
        self.frame.grid_propagate(False)

        style = ttk.Style(parent)
        style.configure("FileSearch.Treeview", font=font, rowheight=32)
        style.configure("FileSearch.Treeview.Heading", font=font)
        # 明確指定選取列的藍底白字；不同 Windows 佈景仍維持一致的 selected mark。
        style.map(
            "FileSearch.Treeview",
            background=[("selected", "#2563eb")],
            foreground=[("selected", "#ffffff")],
        )

        self._tree = ttk.Treeview(
            self.frame, columns=_COLUMNS, show="headings", selectmode="browse", style="FileSearch.Treeview",
        )
        for col in _COLUMNS:
            self._tree.heading(col, text=_HEADINGS[col])
            self._tree.column(col, width=_WIDTHS[col], anchor="w", stretch=(col in ("desc", "path")))
        self._tree.column("icon", anchor="center", stretch=False)
        self._tree.column("serial", anchor="center", stretch=False)
        self._tree.column("source", anchor="w", stretch=False)
        self._tree.column("added_at", anchor="center", stretch=False)

        # 使用明顯可見的傳統 Scrollbar（較寬的拉桿），避免 Windows ttk 佈景把
        # slider 畫得太細、看起來像沒有捲動條；同時補上橫向拉桿查看長路徑。
        vsb = tk.Scrollbar(
            self.frame, orient="vertical", command=self._tree.yview, width=18,
            bg="#94a3b8", activebackground="#64748b", troughcolor="#e2e8f0",
        )
        hsb = tk.Scrollbar(
            self.frame, orient="horizontal", command=self._tree.xview, width=18,
            bg="#94a3b8", activebackground="#64748b", troughcolor="#e2e8f0",
        )
        self._tree.configure(yscrollcommand=vsb.set, xscrollcommand=hsb.set)
        self.frame.grid_rowconfigure(0, weight=1)
        self.frame.grid_columnconfigure(0, weight=1)
        self._tree.grid(row=0, column=0, sticky="nsew")
        vsb.grid(row=0, column=1, sticky="ns")
        hsb.grid(row=1, column=0, sticky="ew")
        self._tree.tag_configure("missing", foreground=COLOR_MISSING_FG)

        self._tree.bind("<Double-1>", lambda _e: on_activate() if on_activate else None)
        self._tree.bind("<Return>", lambda _e: on_activate() if on_activate else None)
        self._tree.bind("<<TreeviewSelect>>", lambda _e: on_select() if on_select else None)
        self._tree.bind("<Delete>", lambda e: on_delete_key(e) if on_delete_key else None)
        self._tree.bind("<space>", lambda e: on_space(e) if on_space else None)
        self._tree.bind("<Left>", lambda e: on_seek(e, -5000) if on_seek else None)
        self._tree.bind("<Right>", lambda e: on_seek(e, 5000) if on_seek else None)
        self._tree.bind("<Home>", lambda _e: self.jump_to_edge(False))
        self._tree.bind("<End>", lambda _e: self.jump_to_edge(True))
        self._tree.bind("<Control-Home>", lambda _e: self.jump_to_edge(False))
        self._tree.bind("<Control-End>", lambda _e: self.jump_to_edge(True))

        self._entries_by_iid = {}

    def configure_width(self, width: int) -> None:
        self.frame.configure(width=width)

    def enable_drop(self, handler) -> None:
        from tkinterdnd2 import DND_FILES
        self._tree.drop_target_register(DND_FILES)
        self._tree.dnd_bind("<<Drop>>", handler)

    def focus_set(self) -> None:
        self._tree.focus_set()

    # ── 顯示 ─────────────────────────────────────────────────────────

    def set_entries(self, entries, aggregate_mode: bool) -> None:
        """依 entries（IndexEntry 清單，順序＝顯示順序）重建整份清單。"""
        self._tree.delete(*self._tree.get_children())
        self._entries_by_iid = {}
        for entry in entries:
            exists = entry.exists
            icon = icon_for(entry.path) if exists else MISSING_ICON
            source_display = entry.source_index.name if aggregate_mode else ""
            added_display = format_added_at(entry.added_at)
            iid = self._tree.insert(
                "", "end",
                values=(
                    entry.serial, icon, entry.name, entry.category, entry.description,
                    entry.path, source_display, added_display,
                ),
                tags=() if exists else ("missing",),
            )
            self._entries_by_iid[iid] = entry

    # ── 選取 ─────────────────────────────────────────────────────────

    def selected_entry(self):
        sel = self._tree.selection()
        if not sel:
            return None
        return self._entries_by_iid.get(sel[0])

    def select_entry_by_iid(self, iid) -> None:
        self._tree.selection_set(iid)
        self._tree.focus(iid)
        self._tree.see(iid)

    def jump_to_edge(self, last: bool = False) -> str:
        """選取並確實捲到目前清單的第一筆或最後一筆。"""
        items = self._tree.get_children("")
        if not items:
            return "break"
        target = items[-1] if last else items[0]
        self._tree.selection_set(target)
        self._tree.focus(target)
        self._tree.see(target)
        # yview_moveto 可確保最後一列貼近視窗底部，不只做到「剛好可見」。
        self._tree.yview_moveto(1.0 if last else 0.0)
        self._tree.focus_set()
        return "break"
