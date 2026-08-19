"""AI 設定——選擇要用 OpenAI 還是 Ollama，填 API Key／服務位址／模型名稱，
可以先「測試連線」再儲存。只負責收集輸入與呼叫 AIDescriptionService 做
連線測試／交回儲存結果，不直接寫設定檔（存檔動作經由呼叫端注入的
`ai_settings_repo` 完成，性質上等同其他 Dialog 不直接寫索引檔案的原則）。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox

from file_search_app.ai.ollama_provider import DEFAULT_BASE_URL as OLLAMA_DEFAULT_BASE_URL
from file_search_app.ai.ollama_provider import DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL
from file_search_app.ai.openai_provider import DEFAULT_BASE_URL as OPENAI_DEFAULT_BASE_URL
from file_search_app.ai.openai_provider import DEFAULT_MODEL as OPENAI_DEFAULT_MODEL
from file_search_app.config import (
    BTN_BLUE_ACTIVE, BTN_BLUE_BG, BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_STATUS_FG, FONT_FAMILY,
)
from file_search_app.ui.styles import styled_button


class AISettingsDialog(tk.Toplevel):
    def __init__(self, parent, ai_settings_repo, ai_service, on_saved=None):
        super().__init__(parent)
        self.title("AI 設定")
        self.configure(bg=COLOR_BG)
        self.transient(parent)
        self.grab_set()
        self.resizable(False, False)

        self._repo = ai_settings_repo
        self._service = ai_service
        self._on_saved = on_saved
        settings = ai_settings_repo.load()

        font_label = tkfont.Font(family=FONT_FAMILY, size=12)
        font_hint = tkfont.Font(family=FONT_FAMILY, size=10)

        pad = tk.Frame(self, bg=COLOR_BG)
        pad.pack(fill="both", expand=True, padx=16, pady=14)

        tk.Label(
            pad, text="🤖 AI 設定", bg=COLOR_BG,
            font=tkfont.Font(family=FONT_FAMILY, size=14, weight="bold"), anchor="w",
        ).pack(fill="x")
        tk.Label(
            pad,
            text="用來讓「批次補說明」呼叫 LLM 產生建議說明；OpenAI 需要付費 API Key、內容會送到"
                 "雲端，Ollama 是本機執行、內容不會離開這台電腦。API Key 會以明碼存在本機使用者"
                 "快取資料夾（%LOCALAPPDATA%\\file_search），不會存進 indexes/ 底下、不會寫進"
                 "索引 .md，也不會跟著索引資料夾被同步或分享出去。",
            bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint, anchor="w", wraplength=440, justify="left",
        ).pack(fill="x", pady=(4, 12))

        self._provider_var = tk.StringVar(value=settings.get("provider", "openai"))
        provider_row = tk.Frame(pad, bg=COLOR_BG)
        provider_row.pack(fill="x", pady=(0, 10))
        tk.Radiobutton(
            provider_row, text="OpenAI（雲端，需要 API Key）", variable=self._provider_var, value="openai",
            bg=COLOR_BG, activebackground=COLOR_BG, font=font_label, command=self._sync_visible_section,
        ).pack(anchor="w")
        tk.Radiobutton(
            provider_row, text="Ollama（本機執行，不需要 API Key）", variable=self._provider_var, value="ollama",
            bg=COLOR_BG, activebackground=COLOR_BG, font=font_label, command=self._sync_visible_section,
        ).pack(anchor="w")

        # OpenAI 欄位
        self._openai_frame = tk.Frame(pad, bg=COLOR_BG)
        openai_cfg = settings.get("openai", {})
        tk.Label(self._openai_frame, text="API Key：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self._openai_key_var = tk.StringVar(value=openai_cfg.get("api_key", ""))
        tk.Entry(
            self._openai_frame, textvariable=self._openai_key_var, font=font_label, show="•",
        ).pack(fill="x", pady=(2, 8), ipady=4)
        tk.Label(self._openai_frame, text="模型名稱：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self._openai_model_var = tk.StringVar(value=openai_cfg.get("model") or OPENAI_DEFAULT_MODEL)
        tk.Entry(self._openai_frame, textvariable=self._openai_model_var, font=font_label).pack(fill="x", pady=(2, 8), ipady=4)
        tk.Label(self._openai_frame, text="API 位址（一般不用改）：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self._openai_base_var = tk.StringVar(value=openai_cfg.get("base_url") or OPENAI_DEFAULT_BASE_URL)
        tk.Entry(self._openai_frame, textvariable=self._openai_base_var, font=font_label).pack(fill="x", pady=(2, 0), ipady=4)

        # Ollama 欄位
        self._ollama_frame = tk.Frame(pad, bg=COLOR_BG)
        ollama_cfg = settings.get("ollama", {})
        tk.Label(self._ollama_frame, text="服務位址：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self._ollama_base_var = tk.StringVar(value=ollama_cfg.get("base_url") or OLLAMA_DEFAULT_BASE_URL)
        tk.Entry(self._ollama_frame, textvariable=self._ollama_base_var, font=font_label).pack(fill="x", pady=(2, 8), ipady=4)
        tk.Label(self._ollama_frame, text="模型名稱：", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        self._ollama_model_var = tk.StringVar(value=ollama_cfg.get("model") or OLLAMA_DEFAULT_MODEL)
        tk.Entry(self._ollama_frame, textvariable=self._ollama_model_var, font=font_label).pack(fill="x", pady=(2, 0), ipady=4)

        self._sync_visible_section()

        self._status_var = tk.StringVar(value="")
        self._status_label = tk.Label(
            pad, textvariable=self._status_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
            anchor="w", wraplength=440, justify="left",
        )
        self._status_label.pack(fill="x", pady=(10, 0))

        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x", pady=(10, 0))
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        styled_button(btn_row, "儲存", self._save, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label).pack(side="right", padx=(0, 8))
        styled_button(btn_row, "測試連線", self._test_connection, BTN_BLUE_BG, BTN_BLUE_ACTIVE, font_label).pack(side="left")

    def _sync_visible_section(self):
        self._openai_frame.pack_forget()
        self._ollama_frame.pack_forget()
        if self._provider_var.get() == "openai":
            self._openai_frame.pack(fill="x")
        else:
            self._ollama_frame.pack(fill="x")

    def _collect_settings(self) -> dict:
        return {
            "provider": self._provider_var.get(),
            "openai": {
                "api_key": self._openai_key_var.get().strip(),
                "model": self._openai_model_var.get().strip() or OPENAI_DEFAULT_MODEL,
                "base_url": self._openai_base_var.get().strip() or OPENAI_DEFAULT_BASE_URL,
            },
            "ollama": {
                "base_url": self._ollama_base_var.get().strip() or OLLAMA_DEFAULT_BASE_URL,
                "model": self._ollama_model_var.get().strip() or OLLAMA_DEFAULT_MODEL,
            },
        }

    def _test_connection(self):
        self._status_var.set("測試中…")
        self.update_idletasks()
        try:
            self._service.test_connection(self._collect_settings())
        except Exception as exc:
            self._status_var.set(f"❌ 連線失敗：{exc}")
            return
        self._status_var.set("✅ 連線成功！")

    def _save(self):
        settings = self._collect_settings()
        if settings["provider"] == "openai" and not settings["openai"]["api_key"]:
            messagebox.showwarning("AI 設定", "選擇 OpenAI 的話請先填入 API Key，或改選 Ollama。")
            return
        self._repo.save(settings)
        if self._on_saved:
            self._on_saved()
        self.destroy()
