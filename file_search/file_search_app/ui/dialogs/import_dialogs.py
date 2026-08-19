"""批次匯入一整個資料夾——跟 AddEntryDialog（一次一個檔案、逐一填分類/說明）
不同，這裡是先選範圍（要不要含子資料夾、篩選副檔名），按「掃描」看會匯入
幾筆，整批共用同一個分類，說明欄留空（批次匯入的檔案通常沒空一個個寫關鍵字，
之後要補可以用「編輯索引檔案」直接在 .md 裡寫，或事後用搜尋找到、重新
拖曳一次覆蓋）。已經在索引裡的路徑會自動略過，不會造成重複列。"""

import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_CYAN_ACTIVE, BTN_CYAN_BG, BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_MISSING_FG, COLOR_STATUS_FG,
    EXT_CATEGORIES, FONT_FAMILY, SCAN_HARD_LIMIT, SCAN_SOFT_LIMIT,
)
from file_search_app.services.scan_service import ScanService
from file_search_app.ui.styles import lighten, styled_button
from file_search_app.ui.widgets.scan_widgets import render_category_counts, run_scan_with_progress


class ImportFolderDialog(tk.Toplevel):
    def __init__(self, parent, scan_service: ScanService, folder, existing_paths, existing_categories, on_confirm):
        super().__init__(parent)
        self.title("匯入資料夾")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("620x680")
        self.minsize(560, 600)
        self.resizable(True, True)

        self._scan_service = scan_service
        self._folder = folder
        self._existing_paths = existing_paths  # set，已用 str(Path(...)) 正規化過
        self._on_confirm = on_confirm
        self._scanned_new = []  # 上次掃描結果裡，尚未在索引中的檔案清單
        self._selected_types = set()  # 目前點選的類型標籤（對應 EXT_CATEGORIES 的第一個欄位）
        self._type_buttons = {}  # 標籤 -> (Button, 顏色)，切換選取狀態時要改按鈕的顏色

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        font_warning = tkfont.Font(family=FONT_FAMILY, size=10, weight="bold")
        font_type_btn = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad, text=f"📂 {folder}", bg=COLOR_BG, font=tkfont.Font(family=FONT_FAMILY, size=13, weight="bold"),
            anchor="w", wraplength=560, justify="left",
        ).pack(fill="x", pady=(0, 12))

        self._recursive_var = tk.BooleanVar(value=False)
        tk.Checkbutton(
            pad, text="包含子資料夾", variable=self._recursive_var, bg=COLOR_BG,
            activebackground=COLOR_BG, font=font_label, command=self._invalidate_scan,
        ).pack(anchor="w")

        ext_row = tk.Frame(pad, bg=COLOR_BG)
        ext_row.pack(fill="x", pady=(10, 0))
        tk.Label(
            ext_row, text="檔案類型篩選（點選要收錄的類型；一個都不選＝不篩選，收錄全部檔案）：",
            bg=COLOR_BG, font=font_label, anchor="w", wraplength=560, justify="left",
        ).pack(anchor="w")

        type_grid = tk.Frame(ext_row, bg=COLOR_BG)
        type_grid.pack(fill="x", pady=(8, 0))
        _COLS = 3
        for idx, (label, icon, exts, color) in enumerate(EXT_CATEGORIES):
            row, col = divmod(idx, _COLS)
            btn = tk.Button(
                type_grid, text=f"{icon} {label}", font=font_type_btn, relief="flat", bd=0,
                cursor="hand2", padx=10, pady=8,
                command=lambda lbl=label: self._toggle_type(lbl),
            )
            btn.grid(row=row, column=col, padx=4, pady=4, sticky="ew")
            self._type_buttons[label] = (btn, color)
        for col in range(_COLS):
            type_grid.grid_columnconfigure(col, weight=1)
        self._refresh_type_buttons()

        tk.Label(pad, text="分類（整批套用同一個，可留空）：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x", pady=(14, 0))
        self.category_var = tk.StringVar()
        ttk.Combobox(
            pad, textvariable=self.category_var, values=sorted(existing_categories), font=font_label,
        ).pack(fill="x", pady=(2, 10))

        scan_row = tk.Frame(pad, bg=COLOR_BG)
        scan_row.pack(fill="x", pady=(4, 0))
        styled_button(scan_row, "掃描", self._do_scan, BTN_CYAN_BG, BTN_CYAN_ACTIVE, font_label).pack(side="left")
        self._result_var = tk.StringVar(value="按「掃描」看看會匯入哪些檔案")
        self._result_label = tk.Label(
            scan_row, textvariable=self._result_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
            anchor="w", wraplength=440, justify="left",
        )
        self._result_label.pack(side="left", padx=(10, 0))
        self._font_result_normal = font_hint
        self._font_result_warning = font_warning

        # 掃描完之後除了上面那行總筆數，還會在這裡列出九個類別（含「其他」）各
        # 自掃到幾筆；沒掃描過／結果是空的時候這個 Frame 沒有子元件、天生 0 高度，
        # 不會佔版面或留下一條空白。
        self._font_hint = font_hint
        self._category_counts_frame = tk.Frame(pad, bg=COLOR_BG)
        self._category_counts_frame.pack(fill="x", pady=(6, 0))

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x", pady=(14, 0))
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        self._confirm_btn = styled_button(
            btn_row, "匯入", self._confirm, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label,
        )
        self._confirm_btn.pack(side="right", padx=(0, 8))
        self._confirm_btn.config(state="disabled")  # 掃描過、確認過筆數之前不能直接匯入

    def _invalidate_scan(self):
        """篩選條件一改，先前掃描結果就作廢，逼使用者重新按「掃描」確認新的
        範圍與筆數，避免看到舊的預覽數字卻匯入了新條件下的結果，兩者對不上。"""
        self._scanned_new = []
        self._confirm_btn.config(state="disabled")
        self._result_var.set("篩選條件已改變，請重新按「掃描」")
        self._result_label.config(fg=COLOR_MISSING_FG, font=self._font_result_warning)
        self._update_category_counts([])

    def _toggle_type(self, label):
        if label in self._selected_types:
            self._selected_types.discard(label)
        else:
            self._selected_types.add(label)
        self._refresh_type_buttons()
        self._invalidate_scan()

    def _refresh_type_buttons(self):
        """選取中＝原色底＋白字，未選取＝同色系的淡色底＋原色字，兩種狀態都
        看得出屬於哪個類型、又能一眼分辨目前點選了哪些。"""
        for label, (btn, color) in self._type_buttons.items():
            if label in self._selected_types:
                btn.config(bg=color, fg="#ffffff", activebackground=color, activeforeground="#ffffff")
            else:
                light = lighten(color, 0.75)
                btn.config(bg=light, fg=color, activebackground=light, activeforeground=color)

    def _parse_extensions(self):
        """回傳目前點選的所有類型按鈕，其副檔名集合的聯集；一個都沒選就回傳空
        集合（不篩選，收錄全部檔案）。"""
        exts = set()
        for label in self._selected_types:
            for l2, _icon, cat_exts, _color in EXT_CATEGORIES:
                if l2 == label:
                    exts |= cat_exts
                    break
        return exts

    def _update_category_counts(self, files):
        for w in self._category_counts_frame.winfo_children():
            w.destroy()
        if files:
            render_category_counts(self._category_counts_frame, files, self._font_hint, self._scan_service)

    def _do_scan(self):
        self._scanned_new = []
        self._confirm_btn.config(state="disabled")
        self._result_var.set("掃描中…")
        self._result_label.config(fg=COLOR_STATUS_FG, font=self._font_result_normal)
        self._update_category_counts([])
        jobs = [(self._folder, self._recursive_var.get(), self._parse_extensions())]
        run_scan_with_progress(self, self._scan_service, jobs, self._on_scan_done)

    def _on_scan_done(self, result):
        found = result.files
        self._update_category_counts(found)
        if result.write_blocked:
            self._result_label.config(fg=COLOR_MISSING_FG, font=self._font_result_warning)
            self._scanned_new = []
            if result.hit_hard_limit:
                self._result_var.set(
                    f"⚠️ 掃描到 {len(found)}+ 個檔案時已達安全上限（{SCAN_HARD_LIMIT:,}），提前停止掃描，"
                    f"可能不小心選到範圍過大的資料夾（例如磁碟機根目錄）；這次掃描結果不會用來匯入。\n"
                    f"建議：取消「包含子資料夾」、加上副檔名篩選，或改選更小範圍的子資料夾再重新掃描。"
                )
            elif result.stopped_early:
                self._result_var.set(
                    f"已在 {len(found)} 筆時停止掃描，尚未掃描完整（超過安全筆數 {SCAN_SOFT_LIMIT}，"
                    f"這次掃描結果不會用來匯入）。建議加上副檔名篩選或縮小範圍後重新掃描。"
                )
            else:
                self._result_var.set(
                    f"掃描完成，共找到 {len(found)} 個檔案，超過可直接匯入的安全上限（{SCAN_SOFT_LIMIT}），"
                    f"這次掃描結果不會用來匯入。建議加上副檔名篩選或取消「包含子資料夾」再重新掃描。"
                )
            self._confirm_btn.config(state="disabled")
            return
        new_files = [p for p in found if str(p) not in self._existing_paths]
        skipped = len(found) - len(new_files)
        self._scanned_new = new_files
        self._result_var.set(f"找到 {len(found)} 個檔案，{skipped} 個已在索引中略過，將新增 {len(new_files)} 筆")
        self._result_label.config(
            fg=COLOR_MISSING_FG if skipped else COLOR_STATUS_FG,
            font=self._font_result_warning if skipped else self._font_result_normal,
        )
        self._confirm_btn.config(state="normal" if new_files else "disabled")
        if found and not new_files:
            self._result_var.set(f"找到 {len(found)} 個檔案，全部都已經在索引中，沒有新的可匯入")
            self._result_label.config(fg=COLOR_MISSING_FG, font=self._font_result_warning)

    def _confirm(self):
        if not self._scanned_new:
            return
        self._on_confirm(self._scanned_new, self.category_var.get())
        self.destroy()
