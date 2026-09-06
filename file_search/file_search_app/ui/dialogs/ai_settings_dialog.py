"""AI 設定——選擇要用 OpenAI 還是 Ollama，填 API Key／服務位址／模型名稱，
可以先「測試連線」再儲存。只負責收集輸入與呼叫 AIDescriptionService 做
連線測試／交回儲存結果，不直接寫設定檔（存檔動作經由呼叫端注入的
`ai_settings_repo` 完成，性質上等同其他 Dialog 不直接寫索引檔案的原則）。"""

import queue
import threading
import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.ai.ollama_provider import DEFAULT_BASE_URL as OLLAMA_DEFAULT_BASE_URL
from file_search_app.ai.ollama_provider import DEFAULT_MODEL as OLLAMA_DEFAULT_MODEL
from file_search_app.ai.ollama_provider import (
    build_standard_url as ollama_build_standard_url,
)
from file_search_app.ai.ollama_provider import is_local_endpoint as ollama_is_local_endpoint
from file_search_app.ai.ollama_provider import model_in_list as ollama_model_in_list
from file_search_app.ai.ollama_provider import normalize_base_url as ollama_normalize_base_url
from file_search_app.ai.ollama_provider import (
    split_standard_url as ollama_split_standard_url,
)
from file_search_app.ai.openai_provider import DEFAULT_BASE_URL as OPENAI_DEFAULT_BASE_URL
from file_search_app.ai.openai_provider import DEFAULT_MODEL as OPENAI_DEFAULT_MODEL
from file_search_app.config import (
    BTN_CREATE_ACTIVE, BTN_CREATE_BG, BTN_PRIMARY_ACTIVE, BTN_PRIMARY_BG,
    BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_PREVIEW_BORDER,
    COLOR_STATUS_FG, FONT_FAMILY,
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
                 "雲端，Ollama 在本機或區網內另一台電腦上執行、內容不會離開你的區域網路、也不會計費。"
                 "API Key 會以明碼存在本機使用者"
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
            provider_row, text="Ollama（本機或區網電腦執行，不需要 API Key）", variable=self._provider_var, value="ollama",
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
        saved_base = ollama_cfg.get("base_url") or OLLAMA_DEFAULT_BASE_URL
        host, is_standard = ollama_split_standard_url(saved_base)
        font_addr = tkfont.Font(family="Consolas", size=13)

        # 最上面先問「Ollama 在哪裡跑」，用大白話而不是要使用者懂 localhost。
        # 選「這台電腦」時整個位址欄收起來——一般人不用看、也不會改了 IP 之後
        # 忘記怎麼設定回本機（再點一次「這台電腦」就好）。只有標準的
        # http://localhost:11434 才預設在「這台電腦」；本機自訂埠/https 這種
        # 少見情況歸到「另一台電腦（進階）」那邊，才不會把使用者原本的設定吃掉。
        local_default = ollama_is_local_endpoint(saved_base) and is_standard
        self._ollama_where_var = tk.StringVar(value="local" if local_default else "lan")
        where_row = tk.Frame(self._ollama_frame, bg=COLOR_BG)
        where_row.pack(fill="x", pady=(0, 4))
        tk.Label(where_row, text="Ollama 服務在哪裡？", bg=COLOR_BG, font=font_label, anchor="w").pack(fill="x")
        tk.Radiobutton(
            where_row, text="🖥️ 就在這台電腦（大多數人選這個）", variable=self._ollama_where_var,
            value="local", command=self._sync_ollama_where,
            bg=COLOR_BG, activebackground=COLOR_BG, font=font_label,
        ).pack(anchor="w")
        tk.Radiobutton(
            where_row, text="🌐 區網裡的另一台電腦（進階）", variable=self._ollama_where_var,
            value="lan", command=self._sync_ollama_where,
            bg=COLOR_BG, activebackground=COLOR_BG, font=font_label,
        ).pack(anchor="w")

        # 選「這台電腦」時顯示這行灰字取代整個位址欄：講清楚不用設定、位址是什麼。
        self._ollama_local_note = tk.Label(
            self._ollama_frame,
            text="位址就是預設的 http://localhost:11434，不用另外設定——"
                 "這台電腦本身有跑 Ollama 就能用。",
            bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint, anchor="w", wraplength=440, justify="left",
        )

        self._ollama_addr_label = tk.Label(
            self._ollama_frame, text="那台電腦的位址（只需改中間的 IP／主機名）：",
            bg=COLOR_BG, font=font_label, anchor="w",
        )

        # 分段輸入：http:// 與 :11434 唯讀（灰底、不可點），中間那段是唯一
        # 要動的地方——藍色粗框＋開啟這區時自動聚焦並選取，讓使用者一眼看出
        # 「改這裡就好」。一般人維持預設的 localhost，少數要連區網另一台
        # Ollama 的人把中間改成對方 IP（例如 192.168.1.50）即可。
        self._ollama_addr_row = tk.Frame(
            self._ollama_frame, bg="#ffffff",
            highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        prefix = tk.Entry(
            self._ollama_addr_row, font=font_addr, width=7, justify="right",
            relief="flat", bd=0, readonlybackground="#e2e8f0",
            fg=COLOR_STATUS_FG, disabledforeground=COLOR_STATUS_FG,
        )
        prefix.insert(0, "http://")
        prefix.configure(state="readonly")
        prefix.pack(side="left", ipady=4)
        self._ollama_host_var = tk.StringVar(value=host)
        self._ollama_host_entry = tk.Entry(
            self._ollama_addr_row, textvariable=self._ollama_host_var, font=font_addr,
            relief="flat", bd=0, highlightthickness=2,
            highlightcolor=BTN_CREATE_BG, highlightbackground="#ffffff",
        )
        self._ollama_host_entry.pack(side="left", fill="x", expand=True, ipady=4)
        suffix = tk.Entry(
            self._ollama_addr_row, font=font_addr, width=7,
            relief="flat", bd=0, readonlybackground="#e2e8f0",
            fg=COLOR_STATUS_FG, disabledforeground=COLOR_STATUS_FG,
        )
        suffix.insert(0, ":11434")
        suffix.configure(state="readonly")
        suffix.pack(side="left", ipady=4)

        self._ollama_seg_hint = tk.Label(
            self._ollama_frame,
            text="把中間改成那台電腦的區網 IP，例如 192.168.1.50。改回本機請點上面的"
                 "「就在這台電腦」。\n"
                 "提供服務的那台電腦上，Ollama 需以 OLLAMA_HOST=0.0.0.0 啟動（預設只收本機連線）、"
                 "防火牆也要放行 11434 埠；這是對方電腦的設定，本程式無法代為調整。\n"
                 "指到區網電腦時，內容會透過區域網路傳到那台電腦，但不會上網際網路、也不會計費。",
            bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint, anchor="w", wraplength=440, justify="left",
        )

        # 進階逃生口：自訂連接埠或走 https 時，改用完整網址輸入框——不常見，
        # 但不能因為分段輸入而讓原本這樣設定的使用者無路可走。載入時若存檔的
        # 位址不是標準樣子就自動切到這個模式。
        self._ollama_advanced_var = tk.BooleanVar(value=not is_standard)
        self._ollama_advanced_chk = tk.Checkbutton(
            self._ollama_frame, text="進階：自訂連接埠 / https（改用完整網址）",
            variable=self._ollama_advanced_var, command=self._sync_ollama_addr_mode,
            bg=COLOR_BG, activebackground=COLOR_BG, font=font_hint,
        )
        self._ollama_full_var = tk.StringVar(value=saved_base)
        self._ollama_full_entry = tk.Entry(self._ollama_frame, textvariable=self._ollama_full_var, font=font_addr)

        self._ollama_model_label = tk.Label(
            self._ollama_frame, text="模型名稱：", bg=COLOR_BG, font=font_label, anchor="w",
        )
        self._ollama_model_label.pack(fill="x", pady=(8, 0))
        self._ollama_model_var = tk.StringVar(value=ollama_cfg.get("model") or OLLAMA_DEFAULT_MODEL)
        combo_style = ttk.Style(self)
        combo_style.configure("AISettings.TCombobox", font=font_label)
        self.option_add("*TCombobox*Listbox.font", font_label)
        model_row = tk.Frame(self._ollama_frame, bg=COLOR_BG)
        model_row.pack(fill="x", pady=(2, 0))
        # 可編輯的下拉：清單是那台電腦 /api/tags 回報的已安裝模型（按下 🔄
        # 或開視窗時抓），但仍允許手動輸入——想用還沒 pull 的模型、或對方是
        # 抓不到清單的舊版 Ollama 時不會被卡死。
        self._ollama_model_combo = ttk.Combobox(
            model_row, textvariable=self._ollama_model_var, font=font_label,
            style="AISettings.TCombobox", state="normal", values=[],
        )
        self._ollama_model_combo.pack(side="left", fill="x", expand=True, ipady=2)
        self._ollama_models_loading = False
        self._ollama_refresh_btn = styled_button(
            model_row, "🔄 讀取清單", self._refresh_ollama_models,
            BTN_CREATE_BG, BTN_CREATE_ACTIVE, font_hint,
        )
        self._ollama_refresh_btn.pack(side="left", padx=(6, 0))
        self._ollama_model_hint_var = tk.StringVar(
            value="下拉為那台電腦已安裝的模型；也可以直接手動輸入名稱。"
        )
        tk.Label(
            self._ollama_frame, textvariable=self._ollama_model_hint_var, bg=COLOR_BG,
            fg=COLOR_STATUS_FG, font=font_hint, anchor="w", wraplength=440, justify="left",
        ).pack(fill="x", pady=(2, 0))

        self._sync_ollama_where()
        # _sync_visible_section 會在切到 Ollama 區時順手抓一次已安裝清單。
        self._sync_visible_section()

        self._status_var = tk.StringVar(value="")
        self._status_label = tk.Label(
            pad, textvariable=self._status_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_hint,
            anchor="w", wraplength=440, justify="left",
        )
        self._status_label.pack(fill="x", pady=(10, 0))

        self._testing = False
        btn_row = tk.Frame(pad, bg=COLOR_BG)
        btn_row.pack(fill="x", pady=(10, 0))
        styled_button(btn_row, "取消", self.destroy, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
        styled_button(btn_row, "儲存", self._save, BTN_PRIMARY_BG, BTN_PRIMARY_ACTIVE, font_label).pack(side="right", padx=(0, 8))
        self._test_btn = styled_button(btn_row, "測試連線", self._test_connection, BTN_CREATE_BG, BTN_CREATE_ACTIVE, font_label)
        self._test_btn.pack(side="left")

    def _sync_visible_section(self):
        self._openai_frame.pack_forget()
        self._ollama_frame.pack_forget()
        if self._provider_var.get() == "openai":
            self._openai_frame.pack(fill="x")
        else:
            self._ollama_frame.pack(fill="x")
            self._focus_ollama_host()
            # 切到 Ollama 這一區、下拉還是空的話，順手抓一次已安裝清單。
            if not self._ollama_model_combo.cget("values") and not self._ollama_models_loading:
                self.after(200, lambda: self._refresh_ollama_models(initial=True))

    def _focus_ollama_host(self):
        """把游標帶到「中間那段 IP」欄並整段選取，讓使用者一打字就覆蓋掉
        （只有「另一台電腦＋分段」模式才有意義；本機模式與進階完整網址模式
        都不搶焦點）。"""
        if self._ollama_where_var.get() == "local" or self._ollama_advanced_var.get():
            return
        entry = self._ollama_host_entry

        def _do():
            entry.focus_set()
            entry.selection_range(0, "end")
            entry.icursor("end")

        self.after(50, _do)

    def _sync_ollama_where(self):
        """在「這台電腦（本機）」與「區網另一台電腦」之間切換。選本機時把整個
        位址區（label／分段輸入／進階框）收起來，只留一行灰字說明——一般使用者
        不必懂 localhost，改了 IP 之後也不會找不到路回本機（再點一次「就在這台
        電腦」即可）。"""
        if self._ollama_where_var.get() == "local":
            self._ollama_advanced_var.set(False)
            for w in (
                self._ollama_addr_label, self._ollama_addr_row, self._ollama_seg_hint,
                self._ollama_advanced_chk, self._ollama_full_entry,
            ):
                w.pack_forget()
            self._ollama_local_note.pack(fill="x", pady=(2, 4), before=self._ollama_model_label)
        else:
            self._ollama_local_note.pack_forget()
            self._ollama_addr_label.pack(fill="x", before=self._ollama_model_label)
            self._ollama_advanced_chk.pack(anchor="w", pady=(2, 0), before=self._ollama_model_label)
            self._sync_ollama_addr_mode()
            # 從本機切過來時 host／完整網址欄可能還是 localhost——清掉，讓使用者
            # 直接填對方 IP（避免「另一台電腦」卻指著自己）。
            if not self._ollama_advanced_var.get() and ollama_is_local_endpoint(
                ollama_build_standard_url(self._ollama_host_var.get())
            ):
                self._ollama_host_var.set("")
                self._focus_ollama_host()

    def _sync_ollama_addr_mode(self):
        """「另一台電腦」底下，在「分段（只改 IP）」與「完整網址（進階）」兩種
        輸入之間切換，切換時把值帶到即將顯示的那一邊，不讓使用者剛打的東西消失。"""
        advanced = self._ollama_advanced_var.get()
        if advanced:
            if not self._ollama_full_var.get().strip():
                self._ollama_full_var.set(ollama_build_standard_url(self._ollama_host_var.get()))
            self._ollama_addr_row.pack_forget()
            self._ollama_seg_hint.pack_forget()
            self._ollama_full_entry.pack(
                fill="x", pady=(2, 4), ipady=4, before=self._ollama_advanced_chk,
            )
        else:
            new_host, _ = ollama_split_standard_url(self._ollama_full_var.get())
            self._ollama_host_var.set(new_host)
            self._ollama_full_entry.pack_forget()
            self._ollama_addr_row.pack(fill="x", pady=(2, 4), before=self._ollama_advanced_chk)
            self._ollama_seg_hint.pack(fill="x", pady=(0, 4), before=self._ollama_advanced_chk)
            self._focus_ollama_host()

    def _refresh_ollama_models(self, initial=False):
        """去目前填的那台 Ollama 的 /api/tags 抓已安裝的模型清單，填進下拉。
        放背景執行緒跑（區網主機要經過網路、可能要等幾秒），結果經 queue 交回
        主執行緒更新 UI。`initial=True` 是開視窗時的自動抓取——連不上只在提示
        列輕描淡寫（使用者本來就可能還沒開 Ollama），不跳錯誤；手動按「🔄
        讀取清單」時才把失敗原因講清楚。抓不到清單也不鎖死輸入，下拉仍可手動
        打字（想用還沒 pull 的模型、或對方是沒有 /api/tags 的舊版時）。"""
        if self._ollama_models_loading:
            return
        self._ollama_models_loading = True
        self._ollama_refresh_btn.configure(state="disabled")
        self._ollama_model_hint_var.set("讀取中…")
        settings = self._collect_settings()
        result_q = queue.Queue()

        def _work():
            try:
                result_q.put(("ok", self._service.list_ollama_models(settings)))
            except Exception as exc:  # 錯誤原樣交回主執行緒，由那邊決定怎麼顯示
                result_q.put(("err", exc))

        threading.Thread(target=_work, daemon=True).start()
        self.after(100, lambda: self._poll_ollama_models(result_q, initial))

    def _poll_ollama_models(self, result_q, initial):
        if not self.winfo_exists():  # 視窗已關，背景執行緒結果直接丟掉
            return
        try:
            status, payload = result_q.get_nowait()
        except queue.Empty:
            self.after(100, lambda: self._poll_ollama_models(result_q, initial))
            return

        self._ollama_models_loading = False
        self._ollama_refresh_btn.configure(state="normal")
        default_hint = "下拉為那台電腦已安裝的模型；也可以直接手動輸入名稱。"

        if status == "err":
            if initial:
                self._ollama_model_hint_var.set(
                    "（讀不到已安裝清單，可按「🔄 讀取清單」重試，或直接手動輸入模型名稱）"
                )
            else:
                self._ollama_model_hint_var.set(f"讀取清單失敗：{payload}")
            return

        names = list(payload or [])
        self._ollama_model_combo.configure(values=names)
        if not names:
            self._ollama_model_hint_var.set(
                "那台電腦目前沒有已安裝的模型；請先在該電腦 `ollama pull <模型>`，或手動輸入名稱。"
            )
            return

        current = self._ollama_model_var.get().strip()
        if not current:
            self._ollama_model_var.set(names[0])
            self._ollama_model_hint_var.set(default_hint)
        elif ollama_model_in_list(current, names):
            self._ollama_model_hint_var.set(default_hint)
        else:
            self._ollama_model_hint_var.set(
                f"目前填的「{current}」不在那台電腦的已安裝清單裡——可從下拉改選，"
                "或確認之後要在該電腦先 `ollama pull` 再用。"
            )

    def _collect_settings(self) -> dict:
        return {
            "provider": self._provider_var.get(),
            "openai": {
                "api_key": self._openai_key_var.get().strip(),
                "model": self._openai_model_var.get().strip() or OPENAI_DEFAULT_MODEL,
                "base_url": self._openai_base_var.get().strip() or OPENAI_DEFAULT_BASE_URL,
            },
            "ollama": {
                "base_url": self._collect_ollama_base_url(),
                "model": self._ollama_model_var.get().strip() or OLLAMA_DEFAULT_MODEL,
            },
        }

    def _collect_ollama_base_url(self) -> str:
        if self._ollama_where_var.get() == "local":
            # 「就在這台電腦」＝一律用預設位址，不管 host 欄殘留什麼值。
            return OLLAMA_DEFAULT_BASE_URL
        if self._ollama_advanced_var.get():
            # 進階：整段自訂——只補 http://、去尾斜線，其餘照使用者填的。
            return ollama_normalize_base_url(self._ollama_full_var.get())
        # 分段：中間 IP／主機名組回 http://<host>:11434。
        return ollama_build_standard_url(self._ollama_host_var.get())

    def _test_connection(self):
        """連線測試放背景執行緒跑——test_connection() 會實際打網路（OpenAI 端
        逾時可達 90 秒、區網 Ollama 沒開也要等 ~15 秒），在主執行緒直接呼叫
        會把這個 modal 視窗連同整個 App 一起凍住。跟旁邊的「讀取模型清單」
        同一套 queue 交回主執行緒的做法。"""
        if self._testing:
            return
        self._testing = True
        self._test_btn.configure(state="disabled")
        self._status_var.set("測試中…")
        settings = self._collect_settings()
        result_q = queue.Queue()

        def _work():
            try:
                result_q.put(("ok", self._service.test_connection(settings)))
            except Exception as exc:  # noqa: BLE001
                result_q.put(("err", exc))

        threading.Thread(target=_work, daemon=True).start()
        self.after(100, lambda: self._poll_test_connection(result_q))

    def _poll_test_connection(self, result_q):
        if not self.winfo_exists():
            return
        try:
            status, payload = result_q.get_nowait()
        except queue.Empty:
            self.after(100, lambda: self._poll_test_connection(result_q))
            return
        self._testing = False
        self._test_btn.configure(state="normal")
        if status == "err":
            self._status_var.set(f"❌ 連線失敗：{payload}")
            return
        # 連線成功但有值得提醒的問題（例如 Ollama 連得上、但選的模型沒下載
        # 或不支援圖片）——照樣顯示，不要用綠字「成功」把問題蓋掉。
        self._status_var.set(payload if payload else "✅ 連線成功！")

    def _save(self):
        settings = self._collect_settings()
        if settings["provider"] == "openai" and not settings["openai"]["api_key"]:
            messagebox.showwarning("AI 設定", "選擇 OpenAI 的話請先填入 API Key，或改選 Ollama。")
            return
        self._repo.save(settings)
        if self._on_saved:
            self._on_saved()
        self.destroy()
