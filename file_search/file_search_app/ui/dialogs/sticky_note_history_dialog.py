"""版本記錄（時光機）——每次便利貼有實質變動，`.sticky_notes.json` 就會自動
存一份時間戳快照（見 StickyNoteHistoryRepository）。這個對話框把那些快照列
出來，讓使用者整份還原到某個版本——給「垃圾桶救不回來」的情況用：批次改
標籤改錯一批、編輯覆蓋掉內容、匯入蓋掉一堆……。

還原是「整份」的（連垃圾桶一起回到那個時間點），而且還原前會先自動存一份
「現在」的快照，所以還原本身也可以再還原回去。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_IMPORT_ACTIVE, BTN_IMPORT_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_BG, COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY,
    STICKY_CARD_META_COLOR, STICKY_CARD_TEXT_COLOR,
)
from file_search_app.ui.styles import bind_wheel_recursive, styled_button


class StickyNoteHistoryDialog(tk.Toplevel):
    def __init__(self, parent, service, on_change):
        """service: StickyNoteService（呼叫 list_history / restore_snapshot）。
        on_change()：還原成功後呼叫，讓面板重新整理。"""
        super().__init__(parent)
        self.title("版本記錄")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("460x520")
        self.minsize(360, 360)
        self.resizable(True, True)

        self._service = service
        self._on_change = on_change

        self._font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        self._font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        self._font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad,
            text="每次便利貼有變動都會自動存一份版本。挑一個版本可以整份還原"
                 "（連垃圾桶一起）——給批次操作出錯、內容被覆蓋這種垃圾桶救不回來"
                 "的情況用。還原前會先存一份「現在」，所以還原也能再還原。",
            bg=COLOR_BG, font=self._font_hint, fg=COLOR_STATUS_FG,
            justify="left", anchor="w", wraplength=420,
        ).pack(fill="x", pady=(0, 10))

        self._count_var = tk.StringVar()
        tk.Label(
            pad, textvariable=self._count_var, bg=COLOR_BG, fg=COLOR_STATUS_FG,
            font=self._font_hint, anchor="w",
        ).pack(fill="x", pady=(0, 4))

        list_outer = tk.Frame(
            pad, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        list_outer.pack(fill="both", expand=True, pady=(4, 10))
        self._canvas = tk.Canvas(list_outer, bg=COLOR_PREVIEW_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(list_outer, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=scroll.set)
        self._canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._inner = tk.Frame(self._canvas, bg=COLOR_PREVIEW_BG)
        inner_id = self._canvas.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>", lambda _e: self._canvas.configure(scrollregion=self._canvas.bbox("all")))
        self._canvas.bind("<Configure>", lambda e: self._canvas.itemconfig(inner_id, width=e.width))

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x")
        styled_button(
            btn_row, "關閉", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_label,
        ).pack(side="right")

        self._reload()

    def _reload(self):
        for widget in self._inner.winfo_children():
            widget.destroy()

        snapshots = self._service.list_history()
        self._count_var.set(
            f"共 {len(snapshots)} 個版本（最新的在最上面）" if snapshots
            else "還沒有任何版本——新增／編輯／刪除便利貼之後就會開始記錄。"
        )
        for i, snap in enumerate(snapshots):
            row = tk.Frame(
                self._inner, bg=COLOR_PREVIEW_BG,
                highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
            )
            row.pack(fill="x", pady=2, padx=2)

            text_col = tk.Frame(row, bg=COLOR_PREVIEW_BG)
            text_col.pack(side="left", fill="x", expand=True, padx=(8, 8), pady=6)
            when = f"{snap['taken_at']:%Y-%m-%d %H:%M:%S}"
            headline = f"{when}　（最新）" if i == 0 else when
            tk.Label(
                text_col, text=headline, bg=COLOR_PREVIEW_BG, fg=STICKY_CARD_TEXT_COLOR,
                font=self._font_name, anchor="w",
            ).pack(fill="x")
            meta = f"{snap['note_count']} 則便利貼"
            if snap["trash_count"]:
                meta += f"　·　垃圾桶 {snap['trash_count']} 則"
            tk.Label(
                text_col, text=meta, bg=COLOR_PREVIEW_BG, fg=STICKY_CARD_META_COLOR,
                font=self._font_hint, anchor="w",
            ).pack(fill="x")

            styled_button(
                row, "還原到這個版本",
                lambda sid=snap["id"], w=when: self._on_restore(sid, w),
                BTN_IMPORT_BG, BTN_IMPORT_ACTIVE, self._font_hint,
            ).pack(side="right", anchor="n", padx=(0, 6), pady=6)

        bind_wheel_recursive(self._inner, lambda e: self._canvas.yview_scroll(int(-e.delta / 120), "units"))

    def _on_restore(self, snapshot_id, when):
        if not messagebox.askyesno(
            "還原版本",
            f"確定要把所有便利貼（連垃圾桶）整份還原到 {when} 的版本嗎？\n\n"
            "目前的狀態會先自動存一份，之後可以再還原回來。",
            parent=self,
        ):
            return
        if self._service.restore_snapshot(snapshot_id):
            self._on_change()
            self._reload()
            messagebox.showinfo("還原版本", f"已還原到 {when} 的版本。", parent=self)
        else:
            messagebox.showerror("還原版本", "還原失敗——這份版本可能已經損毀或被清掉了。", parent=self)
            self._reload()
