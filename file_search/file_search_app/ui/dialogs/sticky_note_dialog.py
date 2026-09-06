"""新增／編輯一則便利貼的小視窗——標題、內容（多行）、標籤（可留空，Combobox
提供既有標籤自動完成但不限制只能選清單裡的值）。新增跟編輯共用同一個視窗，
差別只在標題／按鈕文字，以及編輯時預先帶入現有值。

右上角「🤖 用檔案生成」：挑一個本機檔案送給目前設定的 AI，生成標題／標籤／
內容三個欄位並直接填進這個表單（不是另開一個批次挑選／審核的對話框）——
這個視窗本來就是「一次新增一則、送出前都還能改」的地方，AI 生成的草稿套進
同一個表單、走同一套確認流程最自然，不需要為了這個功能另外做一整套批次
UI。跟「🔬 選檔案問 AI」（`main_window._on_ask_ai_about_file`）共用同一套
「選檔案→送出前確認→背景呼叫」流程，只是這裡呼叫的是
`AIDescriptionService.generate_suggestions()` 帶入 `StickyNoteService` 的
document-to-note prompt，回來解析成三個欄位而不是一段說明文字。"""

import queue
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, font as tkfont, messagebox, ttk

from file_search_app.config import (
    BTN_EDIT_ACTIVE, BTN_EDIT_BG, BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_MISSING_FG,
    COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.models import IndexEntry
from file_search_app.ui.async_task import poll_queue, start_worker
from file_search_app.ui.dialogs.ai_confirm_dialog import ask_ai_confirm
from file_search_app.ui.styles import styled_button


class StickyNoteDialog(tk.Toplevel):
    def __init__(
        self, parent, known_tags, on_confirm, ai_description, sticky_service,
        title="新增便利貼", confirm_text="新增",
        initial_title="", initial_body="", initial_tag="",
    ):
        super().__init__(parent)
        self.title(title)
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("440x480")
        self.minsize(380, 400)

        self._ai_description = ai_description
        self._sticky_service = sticky_service

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        self._font_hint = font_hint = tkfont.Font(family=FONT_FAMILY, size=10)

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        # 按鈕列／錯誤訊息先用 side="bottom" 釘在底部、預先保留好自己的高度，
        # 不管上面內容框想要多高，這兩塊的可見度都不會被擠掉——這正是先前
        # 「新增便利貼看不到確認按鈕」的成因：Text 元件預設高度是 24 行，比
        # 對話框本身還高，之前又是按 top 依序排到最後才放按鈕列，內容框一路
        # 往下擠，按鈕列自然被推到看不見的地方。
        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(side="bottom", fill="x", pady=(10, 0))

        self._error_var = tk.StringVar(value="")
        tk.Label(
            pad, textvariable=self._error_var, bg=COLOR_BG, fg=COLOR_MISSING_FG, font=font_hint, anchor="w",
        ).pack(side="bottom", fill="x")

        header_row = tk.Frame(pad, bg=COLOR_BG)
        header_row.pack(fill="x", pady=(0, 2))
        tk.Label(
            header_row, text=f"📌 {title}", bg=COLOR_BG,
            font=tkfont.Font(family=FONT_FAMILY, size=14, weight="bold"), anchor="w",
        ).pack(side="left", fill="x", expand=True)
        self._ai_btn = styled_button(
            header_row, "🤖 用檔案生成", self._on_ai_generate, BTN_EDIT_BG, BTN_EDIT_ACTIVE, font_hint,
        )
        self._ai_btn.pack(side="right")
        tk.Label(
            pad, text="常用指令、網站、工具等，方便隨手複製使用。",
            bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint, anchor="w",
        ).pack(fill="x", pady=(0, 10))

        tk.Label(pad, text="標題：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self.title_var = tk.StringVar(value=initial_title)
        title_entry = tk.Entry(pad, textvariable=self.title_var, font=font_label)
        title_entry.pack(fill="x", pady=(2, 10), ipady=4)
        title_entry.focus_set()
        title_entry.select_range(0, "end")

        tk.Label(
            pad, text="標籤（可留空；跟既有標籤同名會套用同一個顏色）：",
            bg=COLOR_BG, font=font_label, anchor="w", wraplength=380, justify="left",
        ).pack(fill="x")
        self.tag_var = tk.StringVar(value=initial_tag)
        ttk.Combobox(
            pad, textvariable=self.tag_var, values=sorted(known_tags), font=font_label,
        ).pack(fill="x", pady=(2, 10))

        tk.Label(
            pad, text="內容（可多行，例如一組指令步驟；超過看得到的行數可以捲動）：",
            bg=COLOR_BG, font=font_label, anchor="w", wraplength=380, justify="left",
        ).pack(fill="x")
        body_frame = tk.Frame(pad, highlightbackground=COLOR_STATUS_FG, highlightthickness=1)
        body_frame.pack(fill="both", expand=True, pady=(2, 0))
        self.body_text = tk.Text(body_frame, font=font_label, wrap="word", relief="flat", padx=6, pady=6, height=8)
        body_scroll = ttk.Scrollbar(body_frame, orient="vertical", command=self.body_text.yview)
        self.body_text.configure(yscrollcommand=body_scroll.set)
        self.body_text.pack(side="left", fill="both", expand=True)
        body_scroll.pack(side="right", fill="y")
        if initial_body:
            self.body_text.insert("1.0", initial_body)

        def _confirm(_event=None):
            title_value = self.title_var.get().strip()
            if not title_value:
                self._error_var.set("標題不能留空。")
                title_entry.focus_set()
                return
            body_value = self.body_text.get("1.0", "end-1c")
            on_confirm(title_value, body_value, self.tag_var.get())
            self.destroy()

        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        styled_button(btn_row, confirm_text, _confirm, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label).pack(
            side="right", padx=(0, 8)
        )

        # Esc 取消、Enter 確認——內容框（Text）本身要能正常換行，所以 Enter
        # 只綁在標題／標籤兩個單行輸入上，不綁整個視窗。
        self.bind("<Escape>", lambda _e: self.destroy())
        title_entry.bind("<Return>", _confirm)
        self.bind("<Control-Return>", _confirm)  # 焦點在內容框時用 Ctrl+Enter 送出

    def _on_ai_generate(self):
        """挑一個檔案送給目前設定的 AI，生成標題／標籤／內容並直接填進這個
        表單——不會自動送出，使用者看過（甚至再改過）才按下面的「新增」／
        「儲存」。跟 main_window 的「🔬 選檔案問 AI」同一套「選檔案→送出前
        確認→背景呼叫」流程，只是這裡走 StickyNoteService 的
        document-to-note prompt。

        處理中狀態不是只改按鈕文字——另外跳一個小的「AI 生成中」進度視窗
        （沿用 `_on_ask_ai_about_file` 同一套：不定進度條 + `grab_set()` +
        擋掉關閉鍵），理由是這個表單本身在等待期間還是可以互動：使用者若
        在 AI 回來前就按了「新增」，便利貼會用舊的（可能是空的）欄位值先
        送出，AI 的結果稍後回來時這個視窗多半已經關掉、結果就直接被丟棄
        （`_poll` 有檢查 `winfo_exists()`）——不是壞掉，但等於白跑一次 AI
        呼叫。用一個會奪走整個表單操作焦點的進度視窗，讓「正在處理中」這
        件事不可能被忽略，也讓使用者在結果回來前沒辦法誤按送出。"""
        ok, reason = self._ai_description.is_configured()
        if not ok:
            messagebox.showwarning("AI 生成便利貼", f"{reason}，請先在「AI 設定」設定好再試一次。")
            return
        path = filedialog.askopenfilename(parent=self, title="選擇要送給 AI 分析、生成便利貼內容的檔案")
        if not path:
            return

        target = self._ai_description.current_target_summary()
        call_count = self._ai_description.get_call_count()
        name = Path(path).name
        body = (
            f"即將把檔案「{name}」擷取到的內容送出，請 AI 生成標題／標籤／內容，"
            "直接填進這個表單（不會自動新增，填好之後還能自己修改）。\n\n"
            f"{self._ai_description.target_disclosure_lines()}\n\n"
            f"這是全部 AI 功能累計第 {call_count + 1} 次呼叫"
            "（僅供參考，實際費用/額度以 Provider 帳單為準）。"
        )
        confirm_text = "送到 OpenAI 生成" if target["provider"] == "openai" else "送到 Ollama 生成"
        if not ask_ai_confirm(self, self._ai_description.target_confirm_title(), body, confirm_text=confirm_text):
            return

        self._ai_btn.config(state="disabled", text="⏳ 生成中…")

        progress = tk.Toplevel(self)
        progress.title("AI 生成中")
        progress.configure(bg=COLOR_BG)
        progress.transient(self)
        progress.grab_set()
        progress.resizable(False, False)
        progress.geometry("380x140")
        tk.Label(
            progress,
            text=f"正在把「{name}」送去 {target['label']} 分析，生成便利貼草稿…\n"
                 "（視檔案大小與模型速度，可能需要數秒到數十秒）",
            bg=COLOR_BG, font=self._font_hint, anchor="w", justify="left", wraplength=340,
        ).pack(fill="x", padx=18, pady=(18, 10))
        bar = ttk.Progressbar(progress, mode="indeterminate")
        bar.pack(fill="x", padx=18)
        bar.start(12)
        progress.protocol("WM_DELETE_WINDOW", lambda: None)  # 生成中不讓關，避免留下孤兒執行緒狀態

        entry = IndexEntry(path=path, category="", description="", source_index=Path(path), row_index=0)
        result_queue = queue.Queue()

        def _worker():
            try:
                results, _cancelled = self._ai_description.generate_suggestions(
                    [entry], {},
                    prompt_builder=self._sticky_service.build_document_to_note_prompt,
                    image_prompt_builder=self._sticky_service.build_document_to_note_image_prompt,
                )
                result_queue.put(("done", results[0]))
            except Exception as exc:  # noqa: BLE001 — 任何未預期例外都要回報，不能讓輪詢空轉
                result_queue.put(("failed", str(exc)))

        def _finish():
            bar.stop()
            progress.destroy()
            if self.winfo_exists():
                self._ai_btn.config(state="normal", text="🤖 用檔案生成")

        def _on_message(message):
            _finish()
            kind, payload = message
            if kind in ("failed", "error"):
                messagebox.showerror("AI 生成便利貼", f"發生未預期的錯誤：\n{payload}")
                return True
            _entry, raw, error = payload
            if error is not None:
                messagebox.showerror("AI 生成便利貼", f"生成失敗：\n{error}")
                return True
            if raw is None:
                messagebox.showinfo(
                    "AI 生成便利貼",
                    "這個檔案沒有可以分析的內容（可能是二進位檔、空檔，或缺少對應的解析套件）。",
                )
                return True
            draft = self._sticky_service.parse_document_to_note_response(raw)
            if draft is None:
                messagebox.showerror("AI 生成便利貼", "AI 回應格式無法解析，請重試一次。")
                return True
            self.title_var.set(draft["title"])
            self.tag_var.set(draft["tag"])
            self.body_text.delete("1.0", "end")
            self.body_text.insert("1.0", draft["body"])
            self._error_var.set("")
            return True

        start_worker(_worker, result_queue)
        poll_queue(self, result_queue, _on_message, interval_ms=120)
