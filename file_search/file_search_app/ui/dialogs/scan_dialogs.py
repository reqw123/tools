"""未收錄掃描——「找出未收錄檔案」與它管理的「常用資料夾清單」。

常用資料夾清單本身也是存在 indexes/ 底下的資料（MetadataRepository 管），
但這兩個對話框不直接碰 Repository：讀寫都是呼叫端（MainWindow）注入的
`load_folders`／`save_folders` callable，維持「Dialog 不得直接讀寫索引檔案」
的分工。
"""

import tkinter as tk
from pathlib import Path
from tkinter import filedialog, font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_BLUE_ACTIVE, BTN_BLUE_BG, BTN_CYAN_ACTIVE, BTN_CYAN_BG, BTN_DANGER_ACTIVE, BTN_DANGER_BG,
    BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, BTN_TEAL_ACTIVE, BTN_TEAL_BG,
    COLOR_BG, COLOR_MISSING_FG, COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, COLOR_STATUS_FG,
    FONT_FAMILY, SCAN_HARD_LIMIT, SCAN_SOFT_LIMIT,
)
from file_search_app.services.scan_service import ScanService
from file_search_app.ui.styles import bind_wheel_recursive, icon_for, styled_button
from file_search_app.ui.widgets.scan_widgets import render_category_counts, run_scan_with_progress


class KnownFoldersDialog(tk.Toplevel):
    """管理「常用資料夾清單」——「找出未收錄檔案」可以直接勾這裡面的資料夾一次
    掃描，不用每次都重新瀏覽選一次。"""

    def __init__(self, parent, load_folders, save_folders, on_change=None):
        super().__init__(parent)
        self.title("常用資料夾清單")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("560x420")
        self.minsize(420, 320)
        self.resizable(True, True)
        self._load_folders = load_folders
        self._save_folders = save_folders
        self._on_change = on_change

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad, text="「找出未收錄檔案」可以一次掃描這份清單裡勾選的資料夾。",
            bg=COLOR_BG, font=font_hint, fg=COLOR_STATUS_FG, anchor="w",
        ).pack(fill="x", pady=(0, 8))

        list_frame = tk.Frame(pad, bg=COLOR_BG)
        list_frame.pack(fill="both", expand=True)
        self._listbox = tk.Listbox(list_frame, font=font_label, selectmode="extended", activestyle="none")
        scroll = ttk.Scrollbar(list_frame, orient="vertical", command=self._listbox.yview)
        self._listbox.configure(yscrollcommand=scroll.set)
        self._listbox.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x", pady=(10, 0))
        styled_button(
            btn_row, "新增資料夾...", self._add_folder, BTN_BLUE_BG, BTN_BLUE_ACTIVE, font_label,
        ).pack(side="left")
        styled_button(
            btn_row, "移除選取", self._remove_selected, BTN_DANGER_BG, BTN_DANGER_ACTIVE, font_label,
        ).pack(side="left", padx=(8, 0))
        styled_button(btn_row, "關閉", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")

        self._refresh_list()

    def _refresh_list(self):
        self._listbox.delete(0, "end")
        for f in self._load_folders():
            self._listbox.insert("end", f)

    def _add_folder(self):
        folder = filedialog.askdirectory(title="選擇要加入常用清單的資料夾")
        if not folder:
            return
        folders = self._load_folders()
        norm = str(Path(folder))
        if norm not in folders:
            folders.append(norm)
            self._save_folders(folders)
            self._refresh_list()
            if self._on_change:
                self._on_change()

    def _remove_selected(self):
        sel = self._listbox.curselection()
        if not sel:
            return
        to_remove = {self._listbox.get(i) for i in sel}
        folders = [f for f in self._load_folders() if f not in to_remove]
        self._save_folders(folders)
        self._refresh_list()
        if self._on_change:
            self._on_change()


class UnindexedScanDialog(tk.Toplevel):
    """掃描「常用資料夾清單」（可以再加一個臨時瀏覽的資料夾），列出還沒被
    任何索引集收錄的檔案（比對全部索引集聯集），勾選要新增的，統一指定要
    寫進哪一份索引集、套用同一個分類。"""

    def __init__(
        self, parent, scan_service: ScanService, load_folders, existing_paths_all, existing_categories,
        index_files, default_index, on_confirm, on_manage_folders,
    ):
        super().__init__(parent)
        self.title("找出未收錄檔案")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("920x760")
        self.minsize(700, 560)
        self.resizable(True, True)

        self._scan_service = scan_service
        self._load_folders = load_folders
        self._existing_paths_all = existing_paths_all  # set，全部索引集已收錄路徑聯集
        self._on_confirm = on_confirm
        self._on_manage_folders = on_manage_folders
        self._found = []  # 上次掃描結果裡，尚未被任何索引集收錄的檔案
        self._scan_folder_count = 0  # 上次掃描涵蓋幾個資料夾，結果訊息文字要用
        self._vars = {}
        self._extra_folder = None

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        font_warning = tkfont.Font(family=FONT_FAMILY, size=10, weight="bold")
        font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")

        # 主內容與固定操作列分成兩個 grid row；掃描清單再長也只能擴張 row 0，
        # 永遠不會蓋住 row 1 的收錄按鈕。
        self.grid_rowconfigure(0, weight=1)
        self.grid_columnconfigure(0, weight=1)
        pad = tk.Frame(self, bg=COLOR_BG)
        pad.grid(row=0, column=0, sticky="nsew", padx=16, pady=(14, 6))

        top_row = tk.Frame(pad, bg=COLOR_BG)
        top_row.pack(fill="x")
        tk.Label(top_row, text="常用資料夾清單（勾選要掃描的）：", bg=COLOR_BG, font=font_label, anchor="w").pack(side="left")
        styled_button(
            top_row, "管理清單...", self._open_manage_folders, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        ).pack(side="right")

        self._folder_vars = {}
        self._folder_list_frame = tk.Frame(
            pad, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        self._folder_list_frame.pack(fill="x", pady=(4, 8))
        self._reload_known_folders()

        browse_row = tk.Frame(pad, bg=COLOR_BG)
        browse_row.pack(fill="x")
        styled_button(
            browse_row, "臨時瀏覽其他資料夾...", self._browse_extra, BTN_BLUE_BG, BTN_BLUE_ACTIVE, font_hint,
        ).pack(side="left")
        self._extra_var = tk.StringVar(value="")
        tk.Label(
            browse_row, textvariable=self._extra_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
        ).pack(side="left", padx=(8, 0))

        self._recursive_var = tk.BooleanVar(value=True)
        tk.Checkbutton(
            pad, text="包含子資料夾", variable=self._recursive_var, bg=COLOR_BG,
            activebackground=COLOR_BG, font=font_label,
        ).pack(anchor="w", pady=(6, 0))

        scan_row = tk.Frame(pad, bg=COLOR_BG)
        scan_row.pack(fill="x", pady=(8, 4))
        styled_button(scan_row, "掃描", self._do_scan, BTN_CYAN_BG, BTN_CYAN_ACTIVE, font_label).pack(side="left")
        self._result_var = tk.StringVar(value="按「掃描」看看有哪些檔案還沒收錄")
        self._result_label = tk.Label(
            scan_row, textvariable=self._result_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
            anchor="w", wraplength=500, justify="left",
        )
        self._result_label.pack(side="left", padx=(10, 0))
        self._font_result_normal = font_hint
        self._font_result_warning = font_warning

        self._font_hint = font_hint
        self._category_counts_frame = tk.Frame(pad, bg=COLOR_BG)
        self._category_counts_frame.pack(fill="x", pady=(0, 6))

        list_outer = tk.Frame(
            pad, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        list_outer.pack(fill="both", expand=True, pady=(4, 10))
        canvas = tk.Canvas(list_outer, bg=COLOR_PREVIEW_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(list_outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._inner = tk.Frame(canvas, bg=COLOR_PREVIEW_BG)
        inner_id = canvas.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(inner_id, width=e.width))
        self._canvas = canvas
        self._font_name = font_name

        select_row = tk.Frame(pad, bg=COLOR_BG)
        select_row.pack(fill="x")
        self._selected_count_var = tk.StringVar(value="已勾選 0 筆")
        tk.Label(
            select_row, textvariable=self._selected_count_var, bg=COLOR_BG,
            fg=COLOR_STATUS_FG, font=font_hint,
        ).pack(side="left")
        self._quick_confirm_btn = styled_button(
            select_row, "✅ 收錄勾選項目到索引", self._confirm,
            BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label,
        )
        self._quick_confirm_btn.pack(side="left", padx=(12, 0))
        self._quick_confirm_btn.config(state="disabled")
        styled_button(
            select_row, "全部取消勾選", self._uncheck_all, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        ).pack(side="right")
        styled_button(
            select_row, "全部勾選", self._check_all, BTN_TEAL_BG, BTN_TEAL_ACTIVE, font_hint,
        ).pack(side="right", padx=(0, 8))

        # 固定底部操作列不放在 pad／Canvas 裡面，避免掃描結果或全部勾選後被遮擋。
        fixed_footer = tk.Frame(
            self, bg="#dbeafe", highlightbackground="#2563eb", highlightthickness=2,
        )
        fixed_footer.grid(row=1, column=0, sticky="ew", padx=16, pady=(0, 14))
        footer_inputs = tk.Frame(fixed_footer, bg="#dbeafe")
        footer_inputs.pack(fill="x", padx=12, pady=(9, 5))
        tk.Label(
            footer_inputs, text="固定收錄操作列", bg="#dbeafe", fg="#1e3a8a",
            font=tkfont.Font(family=FONT_FAMILY, size=11, weight="bold"),
        ).pack(side="left", padx=(0, 16))
        tk.Label(footer_inputs, text="加入到：", bg="#dbeafe", font=font_label).pack(side="left")
        self._index_files = index_files
        self._target_var = tk.StringVar(value=default_index.name if default_index else "")
        ttk.Combobox(
            footer_inputs, textvariable=self._target_var, state="readonly",
            values=[f.name for f in index_files], font=font_label, width=18,
        ).pack(side="left", padx=(4, 14))
        tk.Label(footer_inputs, text="分類：", bg="#dbeafe", font=font_label).pack(side="left")
        self.category_var = tk.StringVar()
        ttk.Combobox(
            footer_inputs, textvariable=self.category_var, values=sorted(existing_categories), font=font_label, width=14,
        ).pack(side="left", padx=(4, 0))

        footer_actions = tk.Frame(fixed_footer, bg="#dbeafe")
        footer_actions.pack(fill="x", padx=12, pady=(0, 9))
        tk.Label(
            footer_actions, textvariable=self._selected_count_var, bg="#dbeafe",
            fg="#1e3a8a", font=font_label,
        ).pack(side="left")
        styled_button(footer_actions, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        self._confirm_btn = styled_button(
            footer_actions, "✅ 收錄勾選項目到索引", self._confirm, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label,
        )
        self._confirm_btn.pack(side="right", padx=(0, 8))
        self._confirm_btn.config(state="disabled")

    def _set_confirm_state(self, enabled):
        state = "normal" if enabled else "disabled"
        self._confirm_btn.config(state=state)
        self._quick_confirm_btn.config(state=state)

    def _update_selected_count(self):
        count = sum(1 for v in self._vars.values() if v.get())
        self._selected_count_var.set(f"已勾選 {count} 筆")

    def _open_manage_folders(self):
        self._on_manage_folders()
        self._reload_known_folders()

    def _reload_known_folders(self):
        for w in self._folder_list_frame.winfo_children():
            w.destroy()
        self._folder_vars = {}
        known = self._load_folders()
        if not known:
            tk.Label(
                self._folder_list_frame, text="（清單是空的，按「管理清單...」新增）",
                bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG,
            ).pack(anchor="w", padx=8, pady=6)
            return
        for f in known:
            var = tk.BooleanVar(value=True)
            self._folder_vars[f] = var
            tk.Checkbutton(
                self._folder_list_frame, text=f, variable=var, bg=COLOR_PREVIEW_BG,
                activebackground=COLOR_PREVIEW_BG, anchor="w",
            ).pack(fill="x", padx=6)

    def _browse_extra(self):
        folder = filedialog.askdirectory(title="選擇要臨時掃描的資料夾（不會加入常用清單）")
        if folder:
            self._extra_folder = Path(folder)
            self._extra_var.set(f"＋ {folder}")
        else:
            self._extra_folder = None
            self._extra_var.set("")

    def _update_category_counts(self, files):
        for w in self._category_counts_frame.winfo_children():
            w.destroy()
        if files:
            render_category_counts(self._category_counts_frame, files, self._font_hint, self._scan_service)

    def _do_scan(self):
        folders = [Path(f) for f, v in self._folder_vars.items() if v.get() and Path(f).is_dir()]
        if self._extra_folder:
            folders.append(self._extra_folder)
        if not folders:
            self._result_var.set("沒有選取任何資料夾，請先勾選常用清單裡的資料夾，或臨時瀏覽一個。")
            self._result_label.config(fg=COLOR_MISSING_FG, font=self._font_result_warning)
            return
        self._found = []
        self._rebuild_checklist()
        self._update_category_counts([])
        self._set_confirm_state(False)
        self._result_var.set("掃描中…")
        self._result_label.config(fg=COLOR_STATUS_FG, font=self._font_result_normal)
        self._scan_folder_count = len(folders)
        jobs = [(f, self._recursive_var.get(), set()) for f in folders]
        run_scan_with_progress(self, self._scan_service, jobs, self._on_scan_done)

    def _on_scan_done(self, result):
        found = result.files
        if result.write_blocked:
            self._result_label.config(fg=COLOR_MISSING_FG, font=self._font_result_warning)
            self._found = []
            # 這種情況下沒有「未收錄」子集可看，改列出這次掃到的全部檔案依類別
            # 分布，幫使用者判斷是哪種類型的檔案把筆數撐爆的，好挑要不要縮小範圍。
            self._update_category_counts(found)
            if result.hit_hard_limit:
                self._result_var.set(
                    f"⚠️ 掃描到 {len(found)}+ 個檔案時已達安全上限（{SCAN_HARD_LIMIT:,}），提前停止掃描，"
                    f"可能不小心選到範圍過大的資料夾（例如磁碟機根目錄）；這次掃描結果不會用來加入索引。\n"
                    f"建議：取消「包含子資料夾」，或到「管理清單...」拿掉範圍過大的資料夾、改用更小範圍的子資料夾。"
                )
            elif result.stopped_early:
                self._result_var.set(
                    f"已在 {len(found)} 筆時停止掃描，尚未掃描完整（超過安全筆數 {SCAN_SOFT_LIMIT}，"
                    f"這次掃描結果不會用來加入索引）。建議縮小範圍後重新掃描。"
                )
            else:
                self._result_var.set(
                    f"掃描完成，共找到 {len(found)} 個檔案，超過可直接加入索引的安全上限（{SCAN_SOFT_LIMIT}），"
                    f"這次掃描結果不會用來加入索引。建議縮小範圍後重新掃描。"
                )
            self._rebuild_checklist()
            self._set_confirm_state(False)
            return
        self._found = self._scan_service.find_unindexed(found, self._existing_paths_all)
        self._update_category_counts(self._found)
        self._result_var.set(
            f"掃描 {self._scan_folder_count} 個資料夾，找到 {len(found)} 個檔案，其中 {len(self._found)} 個還沒被收錄"
        )
        skipped = len(found) - len(self._found)
        self._result_label.config(
            fg=COLOR_MISSING_FG if skipped else COLOR_STATUS_FG,
            font=self._font_result_warning if skipped else self._font_result_normal,
        )
        self._rebuild_checklist()
        self._set_confirm_state(bool(self._found))

    def _rebuild_checklist(self):
        for w in self._inner.winfo_children():
            w.destroy()
        self._vars = {}
        for p in self._found:
            var = tk.BooleanVar(value=False)
            self._vars[str(p)] = var
            row = tk.Frame(self._inner, bg=COLOR_PREVIEW_BG)
            row.pack(fill="x", pady=1, padx=2)
            tk.Checkbutton(
                row, variable=var, bg=COLOR_PREVIEW_BG, activebackground=COLOR_PREVIEW_BG,
                command=self._update_selected_count,
            ).pack(side="left")
            tk.Label(
                row, text=f"{icon_for(str(p))} {p}", bg=COLOR_PREVIEW_BG,
                font=self._font_name, anchor="w",
            ).pack(side="left", fill="x", expand=True)
        bind_wheel_recursive(self._inner, lambda e: self._canvas.yview_scroll(int(-e.delta / 120), "units"))
        self._update_selected_count()

    def _check_all(self):
        for v in self._vars.values():
            v.set(True)
        self._update_selected_count()

    def _uncheck_all(self):
        for v in self._vars.values():
            v.set(False)
        self._update_selected_count()

    def _confirm(self):
        checked = [p for p in self._found if self._vars.get(str(p)) and self._vars[str(p)].get()]
        if not checked:
            messagebox.showinfo("找出未收錄檔案", "尚未勾選任何項目。")
            return
        target_name = self._target_var.get()
        target = next((f for f in self._index_files if f.name == target_name), None)
        if target is None:
            messagebox.showwarning("找出未收錄檔案", "請選擇要加入的索引集。")
            return
        category = self.category_var.get().strip() or "未分類"
        if not messagebox.askyesno(
            "確認收錄到索引",
            f"確定要把勾選的 {len(checked)} 個檔案收錄到「{target.name}」嗎？\n\n"
            f"分類：{category}\n說明：暫時留空，可稍後使用「批次補說明」補上。",
        ):
            return
        self._on_confirm(checked, target, category)
        self.destroy()
