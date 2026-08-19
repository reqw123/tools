"""AI 批次說明——挑選要送給 AI 的檔案。

跟人工「批次補說明」完全分開的獨立入口：說明是空的項目可能有幾十甚至上百筆，
不是每一筆都想（或該）送給 AI 分析——雲端 Provider 要花錢、就算是本機
Ollama 也要花時間逐筆等回應。這個畫面預設**全部不勾選**，使用者自己搜尋、
挑選要送出的子集合，確認送出前還會再跳一次確認視窗（雲端 Provider 會特別
提示「內容將送到雲端」）。

只負責「挑選＋觸發＋顯示進度」，實際呼叫 AI、確認視窗、背景執行緒都是
呼叫端（MainWindow）透過 `on_run` 回呼負責；跑完的結果原樣透過 `on_finished`
交回去，審核／編輯／套用畫面是另一個對話框（BatchDescribeDialog）的事，
不在這裡處理。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_INDIGO_ACTIVE, BTN_INDIGO_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    BTN_TEAL_ACTIVE, BTN_TEAL_BG, COLOR_BG, COLOR_HEADER_BG, COLOR_PREVIEW_BG,
    COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.ui.styles import bind_wheel_recursive, icon_for, styled_button

# 處理中面板的配色：跟「🚀 送出」按鈕同一個靛色系，讓使用者一眼把「正在跑」
# 這個狀態跟觸發它的按鈕連起來，跟其他對話框的淡色提示容器（例如找出未收錄
# 檔案的固定底列）是同一種視覺語言，不是這個對話框自創一套。
_PROGRESS_BG = "#eef2ff"
_PROGRESS_BORDER = BTN_INDIGO_BG
_PROGRESS_TEXT_FG = "#3730a3"


class AISelectDialog(tk.Toplevel):
    def __init__(self, parent, entries, ai_service, on_open_ai_settings, on_run, on_finished):
        """entries: list[IndexEntry]（目前檢視範圍內、說明是空的項目）。
        ai_service：AIDescriptionService，只用來顯示目前設定的 Provider 名稱，
        不在這裡直接呼叫 AI。
        on_open_ai_settings(on_saved)：開啟 AI 設定視窗，儲存後呼叫 on_saved()。
        on_run(selected_entries, on_progress, on_done)：使用者確認送出後呼叫；
        on_progress(done, total, name) 回報進度，on_done(results) 在跑完（或
        使用者於呼叫端的確認視窗按下取消）時呼叫一次——results 是 None 代表
        沒有真的送出（設定不足／使用者取消確認），此時這個視窗保持開啟讓
        使用者調整後再試；否則是 [(IndexEntry, suggestion, error), ...]。
        on_finished(results)：真的有結果時，這個視窗關閉後呼叫一次，交給
        呼叫端接手後續（開審核視窗、顯示統計）。"""
        super().__init__(parent)
        self.title("AI 批次說明")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("720x680")
        self.minsize(520, 440)
        self.resizable(True, True)

        self._entries = entries
        self._ai_service = ai_service
        self._on_open_ai_settings = on_open_ai_settings
        self._on_run = on_run
        self._on_finished = on_finished
        self._row_records = []  # [(entry, var, row_frame, 搜尋用小寫全文), ...]

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)
        font_name = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")
        font_warning = tkfont.Font(family=FONT_FAMILY, size=10, weight="bold")

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad,
            text=f"目前檢視範圍內有 {len(entries)} 筆說明是空的項目。勾選要送給 AI 產生建議說明的檔案"
                 "（預設全部不勾選，送出前會再次確認）——AI 產生的建議之後還會有審核畫面可以逐筆修改、"
                 "決定要不要套用。",
            bg=COLOR_BG, font=font_hint, fg=COLOR_STATUS_FG, anchor="w", justify="left", wraplength=680,
        ).pack(fill="x", pady=(0, 8))

        provider_row = tk.Frame(pad, bg=COLOR_BG)
        provider_row.pack(fill="x", pady=(0, 8))
        self._provider_var = tk.StringVar()
        tk.Label(
            provider_row, textvariable=self._provider_var, bg=COLOR_BG, fg=COLOR_HEADER_BG, font=font_label,
        ).pack(side="left")
        styled_button(
            provider_row, "⚙️ AI 設定...", self._open_ai_settings, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        ).pack(side="left", padx=(10, 0))
        self._refresh_provider_label()

        search_row = tk.Frame(pad, bg=COLOR_BG)
        search_row.pack(fill="x")
        tk.Label(search_row, text="🔍", bg=COLOR_BG, font=font_label).pack(side="left", padx=(0, 6))
        self._search_var = tk.StringVar()
        search_entry = tk.Entry(search_row, textvariable=self._search_var, font=font_label, relief="flat")
        search_entry.pack(side="left", fill="x", expand=True, ipady=4)
        search_entry.focus_set()
        self._search_var.trace_add("write", lambda *_a: self._apply_filter())

        select_row = tk.Frame(pad, bg=COLOR_BG)
        select_row.pack(fill="x", pady=(8, 4))
        self._match_count_var = tk.StringVar()
        tk.Label(
            select_row, textvariable=self._match_count_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
        ).pack(side="left")
        styled_button(
            select_row, "全部取消勾選", self._uncheck_all, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        ).pack(side="right")
        styled_button(
            select_row, "勾選目前顯示", self._check_visible, BTN_TEAL_BG, BTN_TEAL_ACTIVE, font_hint,
        ).pack(side="right", padx=(0, 8))

        list_outer = tk.Frame(
            pad, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        list_outer.pack(fill="both", expand=True, pady=(4, 10))
        canvas = tk.Canvas(list_outer, bg=COLOR_PREVIEW_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(list_outer, orient="vertical", command=canvas.yview)
        canvas.configure(yscrollcommand=scroll.set)
        canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        inner = tk.Frame(canvas, bg=COLOR_PREVIEW_BG)
        inner_id = canvas.create_window((0, 0), window=inner, anchor="nw")
        inner.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.bind("<Configure>", lambda e: canvas.itemconfig(inner_id, width=e.width))

        for entry in entries:
            var = tk.BooleanVar(value=False)  # 預設不勾選：使用者自己決定要送哪幾筆給 AI
            row = tk.Frame(inner, bg=COLOR_PREVIEW_BG)
            row.pack(fill="x", pady=1, padx=2)
            tk.Checkbutton(
                row, variable=var, bg=COLOR_PREVIEW_BG, activebackground=COLOR_PREVIEW_BG,
                command=self._update_submit_state,
            ).pack(side="left", anchor="n")
            tk.Label(
                row, text=f"{icon_for(entry.path)} {entry.name}", bg=COLOR_PREVIEW_BG,
                font=font_name, anchor="w", justify="left",
            ).pack(side="left", fill="x", expand=True, padx=(4, 0), pady=(4, 6))
            haystack = f"{entry.name}\n{entry.category}\n{entry.path}\n{entry.source_index.name}".lower()
            self._row_records.append((entry, var, row, haystack))

        bind_wheel_recursive(inner, lambda e: canvas.yview_scroll(int(-e.delta / 120), "units"))
        self._apply_filter()

        # 處理中面板：平常不佔位置（沒有 pack），送出後才顯示，跑完/取消就
        # 收起來——這樣「還沒開始」跟「已經在跑」兩種狀態不會混在同一條灰字
        # 裡分不清楚。
        self._progress_frame = tk.Frame(
            pad, bg=_PROGRESS_BG, highlightbackground=_PROGRESS_BORDER, highlightthickness=1,
        )
        progress_inner = tk.Frame(self._progress_frame, bg=_PROGRESS_BG)
        progress_inner.pack(fill="x", padx=12, pady=10)
        headline_row = tk.Frame(progress_inner, bg=_PROGRESS_BG)
        headline_row.pack(fill="x")
        self._progress_headline_var = tk.StringVar(value="🤖 正在請 AI 產生說明…")
        tk.Label(
            headline_row, textvariable=self._progress_headline_var, bg=_PROGRESS_BG, fg=_PROGRESS_TEXT_FG,
            font=font_warning, anchor="w",
        ).pack(side="left")
        self._progress_percent_var = tk.StringVar(value="0%")
        tk.Label(
            headline_row, textvariable=self._progress_percent_var, bg=_PROGRESS_BG, fg=_PROGRESS_TEXT_FG,
            font=font_warning, anchor="e",
        ).pack(side="right")

        style = ttk.Style(self)
        style.configure("AIBatch.Horizontal.TProgressbar", background=BTN_INDIGO_BG, troughcolor="#e0e7ff")
        self._progress_bar = ttk.Progressbar(
            progress_inner, orient="horizontal", mode="determinate", style="AIBatch.Horizontal.TProgressbar",
        )
        self._progress_bar.pack(fill="x", pady=(6, 4))

        self._progress_detail_var = tk.StringVar(value="")
        tk.Label(
            progress_inner, textvariable=self._progress_detail_var, bg=_PROGRESS_BG, fg=_PROGRESS_TEXT_FG,
            font=font_hint, anchor="w", wraplength=640, justify="left",
        ).pack(fill="x")

        self._btn_row = btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x", pady=(6, 0))
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        self._submit_btn = styled_button(
            btn_row, "🚀 送出勾選項目給 AI", self._submit, BTN_INDIGO_BG, BTN_INDIGO_ACTIVE, font_label,
        )
        self._submit_btn.pack(side="right", padx=(0, 8))
        self._update_submit_state()

    def _refresh_provider_label(self):
        self._provider_var.set(f"目前使用：{self._ai_service.current_provider_label()}")

    def _open_ai_settings(self):
        self._on_open_ai_settings(self._refresh_provider_label)

    def _apply_filter(self):
        typed = self._search_var.get().strip().lower()
        shown = 0
        for _entry, _var, row, _haystack in self._row_records:
            row.pack_forget()
        for _entry, _var, row, haystack in self._row_records:
            if not typed or typed in haystack:
                row.pack(fill="x", pady=1, padx=2)
                shown += 1
        note = f"符合搜尋：{shown} / {len(self._entries)} 筆" if typed else f"共 {len(self._entries)} 筆"
        self._match_count_var.set(note)

    def _check_visible(self):
        typed = self._search_var.get().strip().lower()
        for _entry, var, _row, haystack in self._row_records:
            if not typed or typed in haystack:
                var.set(True)
        self._update_submit_state()

    def _uncheck_all(self):
        for _entry, var, _row, _haystack in self._row_records:
            var.set(False)
        self._update_submit_state()

    def _selected_count(self):
        return sum(1 for _e, v, _r, _h in self._row_records if v.get())

    def _update_submit_state(self):
        n = self._selected_count()
        self._submit_btn.config(text=f"🚀 送出勾選項目給 AI（{n}）" if n else "🚀 送出勾選項目給 AI")

    def _submit(self):
        selected = [entry for entry, v, _r, _h in self._row_records if v.get()]
        if not selected:
            messagebox.showinfo("AI 批次說明", "請先勾選至少一筆要送給 AI 的項目。")
            return
        self._submit_btn.config(state="disabled")
        self._show_progress(len(selected))
        self._on_run(selected, self._handle_progress, self._handle_done)

    def _show_progress(self, total):
        self._progress_headline_var.set("🤖 正在請 AI 產生說明…")
        self._progress_percent_var.set("0%")
        self._progress_detail_var.set(f"準備處理 {total} 筆")
        self._progress_bar.config(maximum=max(1, total), value=0)
        self._progress_frame.pack(fill="x", pady=(0, 8), before=self._btn_row)

    def _hide_progress(self):
        self._progress_frame.pack_forget()

    def _handle_progress(self, done, total, name):
        percent = int(done / total * 100) if total else 0
        self._progress_percent_var.set(f"{percent}%")
        self._progress_bar.config(maximum=max(1, total), value=done)
        self._progress_detail_var.set(f"{done} / {total}　目前：{icon_for(name)} {name}")

    def _handle_done(self, results):
        if results is None:
            # 設定不足，或呼叫端的確認視窗被使用者取消——保持這個視窗開著，
            # 讓使用者調整勾選或先去把 AI 設定填好再試一次。
            self._submit_btn.config(state="normal")
            self._hide_progress()
            return
        self.destroy()
        self._on_finished(results)
