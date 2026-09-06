"""新增／編輯一筆索引資料、新增一份索引集——兩個對話框都只負責收集輸入與
即時驗證，確認後透過 on_confirm 回呼把結果交回呼叫端（MainWindow），由
呼叫端呼叫 Service 實際寫入。"""

import tkinter as tk
from pathlib import Path
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_BG, COLOR_MISSING_FG, COLOR_STATUS_FG, FONT_FAMILY, INDEXES_DIR,
)
from file_search_app.ui.styles import icon_for, styled_button


class AddEntryDialog(tk.Toplevel):
    """新增／編輯一列索引資料的小視窗——拖曳檔案進主視窗、按「新增檔案...」瀏覽
    挑選、或選一筆既有結果按「編輯所選列」時都會跳出這個視窗，讓使用者填/改
    分類／說明文字，確認後才真的寫進 .md 檔案。新增跟編輯共用同一個視窗，差別
    只在標題／按鈕文字，以及編輯時會把現有值預先填好（initial_category／
    initial_desc）。"""

    def __init__(
        self, parent, path_str, existing_categories, on_confirm,
        title="新增到索引", confirm_text="新增", initial_category="", initial_desc="", on_cancel=None,
    ):
        super().__init__(parent)
        self.title(title)
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.resizable(False, False)

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad, text=f"{icon_for(path_str)}  {Path(path_str).name}", bg=COLOR_BG,
            font=tkfont.Font(family=FONT_FAMILY, size=14, weight="bold"), anchor="w",
        ).pack(fill="x")
        tk.Label(
            pad, text=path_str, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
            anchor="w", wraplength=420, justify="left",
        ).pack(fill="x", pady=(0, 10))

        tk.Label(pad, text="分類（可留空，或從既有分類挑一個）：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self.category_var = tk.StringVar(value=initial_category)
        ttk.Combobox(
            pad, textvariable=self.category_var, values=sorted(existing_categories), font=font_label,
        ).pack(fill="x", pady=(2, 10))

        tk.Label(pad, text="說明（可打多個關鍵字，搜尋會比對全文）：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self.desc_var = tk.StringVar(value=initial_desc)
        desc_entry = tk.Entry(pad, textvariable=self.desc_var, font=font_label)
        desc_entry.pack(fill="x", pady=(2, 14), ipady=4)
        desc_entry.focus_set()
        desc_entry.select_range(0, "end")

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x")

        def _confirm():
            on_confirm(self.category_var.get(), self.desc_var.get())
            self.destroy()

        def _cancel():
            self.destroy()
            if on_cancel:
                parent.after_idle(on_cancel)

        styled_button(btn_row, "取消", _cancel, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        styled_button(btn_row, confirm_text, _confirm, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label).pack(side="right", padx=(0, 8))
        desc_entry.bind("<Return>", lambda _e: _confirm())
        self.protocol("WM_DELETE_WINDOW", _cancel)


class CreateIndexDialog(tk.Toplevel):
    """新增一份索引集，或（`import_source_name` 有給值時）把一份外部既有的
    .md 檔匯入成一份新的索引集——之前「新增」這件事只能靠使用者自己跑去
    indexes/ 資料夾底下手動新建一個 .md 檔案（照範本格式寫），這個視窗補上
    對應的按鈕；「匯入」則是補上「沒辦法把既有 .md 帶進來」那個缺口
    （例如從另一台電腦複製過來、或用「匯出索引集」存出去的檔案）。

    兩者本質上是同一個問題——「決定一個合法、不撞名的檔名」——共用同一套
    即時驗證的名稱輸入框，差別只在標題文字、預先帶入的名稱（匯入用來源
    檔名），以及 on_confirm 拿到檔名後實際做什麼（建立空白 vs 寫入匯入的
    內容），那部分由呼叫端決定，這裡不碰實際內容。"""

    def __init__(self, parent, validate_name, on_confirm, *, import_source_name=None):
        """validate_name(raw) -> (filename|None, err|None)，通常直接是
        IndexService.validate_name。import_source_name 有給值就是「匯入」
        模式：用它預先帶入名稱輸入框（去掉副檔名），標題／提示文字也跟著換。"""
        super().__init__(parent)
        importing = import_source_name is not None
        self.title("匯入索引集" if importing else "新增索引集")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.resizable(False, False)
        self._validate_name = validate_name

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        font_warning = tkfont.Font(family=FONT_FAMILY, size=10, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad, text="📥 匯入索引集" if importing else "🗂 新增索引集", bg=COLOR_BG,
            font=tkfont.Font(family=FONT_FAMILY, size=14, weight="bold"), anchor="w",
        ).pack(fill="x")
        hint = (
            f"會把「{import_source_name}」的內容存成 {INDEXES_DIR.name}/ 底下一份新的索引集，"
            "建立後自動切換過去。"
            if importing else
            f"會在 {INDEXES_DIR.name}/ 底下建立一份新的空白 .md 索引檔案，建立後自動切換過去。"
        )
        tk.Label(
            pad, text=hint,
            bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint, anchor="w", wraplength=380, justify="left",
        ).pack(fill="x", pady=(0, 10))

        tk.Label(pad, text="名稱（不用打 .md，會自動補上）：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        initial_name = Path(import_source_name).stem if importing else ""
        self.name_var = tk.StringVar(value=initial_name)
        name_entry = tk.Entry(pad, textvariable=self.name_var, font=font_label)
        name_entry.pack(fill="x", pady=(2, 4), ipady=4)
        name_entry.focus_set()
        name_entry.select_range(0, "end")

        self._hint_var = tk.StringVar(value="")
        self._hint_label = tk.Label(
            pad, textvariable=self._hint_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
            anchor="w", wraplength=380, justify="left",
        )
        self._hint_label.pack(fill="x", pady=(0, 10))

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x")

        def _confirm():
            filename, _err = self._validate_name(self.name_var.get())
            if not filename:
                return  # 按鈕正常情況下已經是 disabled，這裡多擋一層防呆
            on_confirm(filename)
            self.destroy()

        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        self._confirm_btn = styled_button(
            btn_row, "匯入" if importing else "建立", _confirm, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label,
        )
        self._confirm_btn.pack(side="right", padx=(0, 8))
        self._confirm_btn.config(state="disabled")

        def _on_name_change(*_a):
            filename, err = self._validate_name(self.name_var.get())
            if err:
                self._hint_var.set(err)
                # 一個字都還沒打的時候（初始狀態）不用紅字嚇人，等使用者真的打了
                # 什麼但不合法（撞名、有不合法符號）才標紅。匯入模式一開始就
                # 帶了來源檔名，所以「有沒有打過字」改看跟初始值是否不同都
                # 不重要——一律照「目前有沒有內容」判斷即可，邏輯不變。
                has_input = bool(self.name_var.get().strip())
                self._hint_label.config(
                    fg=COLOR_MISSING_FG if has_input else COLOR_STATUS_FG,
                    font=font_warning if has_input else font_hint,
                )
                self._confirm_btn.config(state="disabled")
            else:
                self._hint_var.set(f"將建立：{filename}")
                self._hint_label.config(fg=COLOR_STATUS_FG, font=font_hint)
                self._confirm_btn.config(state="normal")

        self.name_var.trace_add("write", _on_name_change)
        name_entry.bind("<Return>", lambda _e: _confirm() if str(self._confirm_btn["state"]) == "normal" else None)
        _on_name_change()  # 匯入模式已經帶了預設名稱，開窗當下就先驗證一次
