"""「選檔案問 AI」的結果檢視視窗——純粹把模型的回覆顯示出來讓使用者看，
不編輯、不寫回任何索引（那是「AI 批次說明」的事）。

字體固定比一般 messagebox 大、可捲動、可整段選取複製；視窗可調整大小，
避免回覆特別長時按不到底部的按鈕。
"""

import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_COPY_ACTIVE, BTN_COPY_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_BG, COLOR_HEADER_BG, COLOR_PREVIEW_BG, COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.platform import file_actions
from file_search_app.ui.styles import center_over_parent, icon_for, styled_button


class AIAnalyzeResultDialog(tk.Toplevel):
    def __init__(self, parent, *, file_path: str, file_name: str, target: dict, kind: str, answer: str):
        super().__init__(parent)
        self.title("AI 分析結果")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.geometry("820x620")
        self.minsize(560, 380)
        self.resizable(True, True)

        font_head = tkfont.Font(family=FONT_FAMILY, size=13, weight="bold")
        font_meta = tkfont.Font(family=FONT_FAMILY, size=11)
        font_btn = tkfont.Font(family=FONT_FAMILY, size=12)
        # 回覆本文預設 15pt，明顯大於系統 messagebox 的小字。
        self._body_font = tkfont.Font(family=FONT_FAMILY, size=15)

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=18, pady=16)

        tk.Label(
            pad, text=f"{icon_for(file_path)}  {file_name}", bg=COLOR_BG, fg=COLOR_HEADER_BG,
            font=font_head, anchor="w", justify="left", wraplength=760,
        ).pack(fill="x")

        kind_label = {
            "image": "以圖片（視覺模型）分析",
            "text": "以擷取到的文字分析",
            "media-transcribed": "先本機語音轉錄成文字再分析",
        }.get(kind, "已分析")
        leaves = "內容已離開這台電腦" if target.get("leaves_machine") else "內容未離開這台電腦"
        tk.Label(
            pad,
            text=f"分析方式：{kind_label}\n"
                 f"送往：{target.get('label', '')}　模型：{target.get('model', '')}\n"
                 f"位址：{target.get('endpoint', '')}　（{leaves}）",
            bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_meta, anchor="w", justify="left", wraplength=760,
        ).pack(fill="x", pady=(4, 10))

        body_wrap = tk.Frame(pad, bg=COLOR_PREVIEW_BG, highlightbackground="#c7d3dc", highlightthickness=1)
        body_wrap.pack(fill="both", expand=True)
        self._text = tk.Text(
            body_wrap, wrap="word", font=self._body_font, bg="#ffffff", fg="#17202a",
            relief="flat", padx=14, pady=12, bd=0, highlightthickness=0,
            selectbackground="#2563eb", selectforeground="#ffffff",
        )
        scroll = ttk.Scrollbar(body_wrap, orient="vertical", command=self._text.yview)
        self._text.configure(yscrollcommand=scroll.set)
        self._text.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._text.insert("1.0", answer)
        self._text.configure(state="disabled")
        self._text.bind(
            "<MouseWheel>",
            lambda e: (self._text.yview_scroll(int(-e.delta / 120), "units"), "break")[1],
        )

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x", pady=(12, 0))
        tk.Label(
            btn_row, text="※ 這段回覆只是顯示出來供你查看，不會寫進任何索引說明。",
            bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_meta, anchor="w",
        ).pack(side="left")
        styled_button(btn_row, "關閉", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_btn).pack(side="right")
        self._copy_btn = styled_button(
            btn_row, "複製內容", self._copy, BTN_COPY_BG, BTN_COPY_ACTIVE, font_btn,
        )
        self._copy_btn.pack(side="right", padx=(0, 8))

        self.bind("<Escape>", lambda _e: self.destroy())
        self.update_idletasks()
        center_over_parent(self, parent)

    def _copy(self):
        file_actions.copy_to_clipboard(self, self._text.get("1.0", "end-1c"))
        self._copy_btn.config(text="已複製 ✓")
        self.after(1200, lambda: self._copy_btn.winfo_exists() and self._copy_btn.config(text="複製內容"))
