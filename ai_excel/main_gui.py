# -*- coding: utf-8 -*-
"""
main_gui.py
============
Tkinter 主程式。只負責 UI 組裝與事件轉發，所有業務邏輯都委派給其他模組。

規則（需求 #26 #27 #28）：
  - AI 呼叫一律在背景 Thread 執行。
  - Tkinter 元件只能在主執行緒更新。
  - 背景結果一律透過 queue.Queue() + after() 回傳到主執行緒。

版面配置：
  整個工作流程分成三個清楚標示的區塊，用分頁（Notebook）呈現，
  避免所有面板疊在同一個直向捲軸裡（過去曾經因為版面太擠，
  導致「確認執行」按鈕被擠出畫面外）：

    ① 設定          — AI Provider / Key / Ollama Host、Excel 連接
    ② 格式選擇       — Region 清單、結構分析、Schema Mapping、公司模板
    ③ AI 需求與套用   — 自然語言／圖片輸入、AI 解析、操作預覽、確認執行

  分頁上方留一條常駐的「目前連接狀態」細條，不管切到哪一頁都看得到
  目前連的是哪個活頁簿／工作表；最下方留一條常駐的「儲存 Excel + 狀態列」。
"""

from __future__ import annotations

import json
import os
import queue
import subprocess
import threading
import tkinter as tk
from tkinter import ttk, messagebox, filedialog, simpledialog
from tkinter.scrolledtext import ScrolledText

import pythoncom

import settings as S
from excel_manager import ExcelManager, ExcelConnectionError, SheetGrid
from region_detector import detect_regions, Region
from structure_analyzer import analyze_region, StructureInfo
from report_classifier import classify_structure, classify_region, ClassificationResult
from schema_mapper import auto_map, build_llm_mapping_prompt, parse_llm_mapping_result, merge_confirmed_mapping, MappingResult
from template_manager import TemplateManager, Template
from ai_manager import AIManager
from operation_planner import parse_operation, try_deterministic_parse_multi, OperationPlan, PlanValidationError
from report_handlers import get_handler
from report_handlers.base import HandlerError, MultipleCandidatesError, HandlerResult

FONT = "Microsoft JhengHei"
FONT_MONO = "Consolas"

# ----------------------------------------------------------------------
# 色彩系統：每個大區塊有自己的強調色，整個 App 共用同一套底色 / 字色，
# 讓使用者一眼就能分辨「現在在哪個階段」。
# ----------------------------------------------------------------------
BG_APP = "#eef2f7"
BG_PANEL = "#ffffff"
BG_HEADER = "#1e293b"
FG_HEADER_SUB = "#94a3b8"

TEXT_MUTED = "#64748b"
TEXT_DARK = "#1e293b"

COLOR_SUCCESS = "#15803d"
COLOR_WARNING = "#b45309"
COLOR_DANGER = "#dc2626"
COLOR_INFO = "#2563eb"

ACCENT_SETTINGS = "#7c3aed"   # ① 設定 —— 紫
ACCENT_FORMAT = "#0d9488"     # ② 格式選擇 —— 青綠
ACCENT_AI = "#ea580c"         # ③ AI 需求與套用 —— 橘

BTN_NEUTRAL = "#475569"


def _darken(hex_color: str, factor: float = 0.85) -> str:
    hex_color = hex_color.lstrip("#")
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    r, g, b = (max(0, int(c * factor)) for c in (r, g, b))
    return f"#{r:02x}{g:02x}{b:02x}"


def _col_letter(col: int) -> str:
    """把 1-based 欄號轉成 Excel 欄字母（1->A, 2->B, ..., 27->AA）。"""
    letters = ""
    while col > 0:
        col, rem = divmod(col - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _region_range_label(region: Region) -> str:
    """Region 範圍顯示成 Excel 慣用的儲存格格式（例如 A2:G28），
    而不是內部用的 (列,欄) 數字座標，比較好對照到 Excel 畫面上的位置。"""
    return f"{_col_letter(region.left)}{region.top}:{_col_letter(region.right)}{region.bottom}"


def make_button(parent, text, command, bg=COLOR_INFO, fg="white", font_size=11, **kw):
    return tk.Button(
        parent, text=text, command=command, bg=bg, fg=fg,
        activebackground=_darken(bg), activeforeground=fg,
        relief="flat", cursor="hand2", font=(FONT, font_size, "bold"),
        padx=14, pady=9, bd=0, highlightthickness=0, **kw,
    )


class ExcelAIApp(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title(S.APP_TITLE)
        self.geometry("1520x980")
        self.minsize(1250, 820)
        self.configure(bg=BG_APP)
        # 全域預設字型：Label / Entry / Combobox 等沒特別指定 font= 的元件，
        # 都會套用這個大小，避免跟其他手動指定過大小的元件混雜、大小不一致。
        self.option_add("*Font", (FONT, 11))

        self.excel = ExcelManager()
        self.templates = TemplateManager()
        self.ai = AIManager()

        self._queue: "queue.Queue" = queue.Queue()
        self._busy = False

        # Sheet / Region 狀態
        self.current_grid: SheetGrid | None = None
        self.current_regions: list[Region] = []
        self.region_analysis: dict[str, tuple[StructureInfo | None, ClassificationResult]] = {}
        self.selected_region: Region | None = None
        self.selected_structure: StructureInfo | None = None
        self.selected_classification: ClassificationResult | None = None
        self.current_mapping: MappingResult | None = None
        self.matched_template: Template | None = None

        # 待確認的操作：一次可能有多筆各自獨立的指令（例如逗號分隔的多筆修改），
        # 每一筆都是 {"plan": OperationPlan, "handler": ReportHandler, "steps": [...]}
        self.pending_items: list[dict] = []

        self.selected_images: list[str] = []

        self._build_ui()
        self.after(100, self._poll_queue)

    # ==================================================================
    # UI 組裝
    # ==================================================================

    def _setup_style(self):
        style = ttk.Style(self)
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass

        style.configure("TNotebook", background=BG_APP, borderwidth=0, tabmargins=(6, 6, 6, 0))
        style.configure("TNotebook.Tab", font=(FONT, 12, "bold"), padding=(18, 10),
                         background="#d9e2ec", foreground=TEXT_MUTED)
        style.map("TNotebook.Tab",
                  background=[("selected", BG_PANEL)],
                  foreground=[("selected", TEXT_DARK)])

        style.configure("Treeview", font=(FONT, 11), rowheight=30, background=BG_PANEL,
                         fieldbackground=BG_PANEL)
        style.configure("Treeview.Heading", font=(FONT, 11, "bold"))

        style.configure("TCombobox", padding=4)
        style.configure("Horizontal.TProgressbar", troughcolor="#e2e8f0", background=ACCENT_AI)

    def _build_ui(self):
        self._setup_style()
        self._build_header()
        self._build_connection_strip()

        self.notebook = ttk.Notebook(self)
        self.notebook.pack(fill="both", expand=True, padx=10, pady=(8, 4))

        tab_settings = tk.Frame(self.notebook, bg=BG_APP)
        tab_format = tk.Frame(self.notebook, bg=BG_APP)
        tab_ai = tk.Frame(self.notebook, bg=BG_APP)

        self.notebook.add(tab_settings, text="① 設定")
        self.notebook.add(tab_format, text="② 格式選擇")
        self.notebook.add(tab_ai, text="③ AI 需求與套用")

        self._build_section_header(
            tab_settings, "①", "AI 與 Excel 設定",
            "選擇 AI 提供者、輸入金鑰（可測試連線）、連接並掃描目前開啟的 Excel",
            ACCENT_SETTINGS,
        )
        self._build_ai_panel(tab_settings)
        self._build_excel_panel(tab_settings)

        self._build_section_header(
            tab_format, "②", "報表結構與欄位對應",
            "選擇自動偵測到的資料區塊（Region）、確認欄位對應到標準 Schema、儲存／套用公司模板",
            ACCENT_FORMAT,
        )
        self._build_region_panel(tab_format)
        self._build_detail_panel(tab_format)

        self._build_section_header(
            tab_ai, "③", "AI 需求與套用",
            "輸入自然語言指令或上傳圖片 → AI／規則解析成操作計畫 → 確認無誤後套用寫入 Excel",
            ACCENT_AI,
        )
        self._build_command_panel(tab_ai)
        self._build_preview_panel(tab_ai)

        self._build_bottom_bar()

        self.notebook.bind("<<NotebookTabChanged>>", self._on_tab_changed)

    def _build_section_header(self, parent, badge, title, subtitle, accent):
        bar = tk.Frame(parent, bg=accent)
        bar.pack(fill="x", pady=(0, 8))
        row = tk.Frame(bar, bg=accent)
        row.pack(fill="x", padx=14, pady=8)

        tk.Label(row, text=badge, bg="white", fg=accent, font=(FONT, 14, "bold"),
                  width=2, height=1).pack(side="left", padx=(0, 10))

        text_col = tk.Frame(row, bg=accent)
        text_col.pack(side="left", fill="x", expand=True)
        tk.Label(text_col, text=title, bg=accent, fg="white", font=(FONT, 14, "bold"),
                  anchor="w").pack(fill="x")
        tk.Label(text_col, text=subtitle, bg=accent, fg="#f8fafc", font=(FONT, 10),
                  anchor="w").pack(fill="x")

    def _build_header(self):
        frame = tk.Frame(self, bg=BG_HEADER)
        frame.pack(fill="x")
        tk.Label(frame, text="🤖 " + S.APP_TITLE, bg=BG_HEADER, fg="white",
                  font=(FONT, 22, "bold")).pack(anchor="w", padx=16, pady=(12, 0))
        tk.Label(frame, text="Region Detector / Report Classifier / Structure Analyzer / "
                              "Schema Mapper / Company Template / AI Provider 切換",
                  bg=BG_HEADER, fg=FG_HEADER_SUB, font=(FONT, 11)).pack(anchor="w", padx=16, pady=(0, 10))

    def _build_connection_strip(self):
        """常駐細條：不管切到哪一頁分頁，都看得到目前連的是哪個活頁簿／工作表。"""
        strip = tk.Frame(self, bg="#dbe4f0")
        strip.pack(fill="x")
        self.conn_strip_var = tk.StringVar(value="📄 尚未連接 Excel —— 請到「① 設定」分頁按「連接 / 重新掃描」")
        tk.Label(strip, textvariable=self.conn_strip_var, bg="#dbe4f0", fg="#1e3a5f",
                  font=(FONT, 10, "bold"), anchor="w").pack(fill="x", padx=14, pady=4)

    def _on_tab_changed(self, _evt=None):
        pass

    # ------------------------------------------------------------------
    # ① 設定：AI
    # ------------------------------------------------------------------

    def _build_ai_panel(self, parent):
        frame = tk.LabelFrame(parent, text="AI 設定", font=(FONT, 12, "bold"),
                               bg=BG_PANEL, fg=TEXT_DARK)
        frame.pack(fill="x", padx=12, pady=(0, 8))

        # 上次關閉程式時自動存的設定（本機 user_settings.json）—— 這是『每次啟動都自動記得』
        # 的主要機制，不依賴 Windows 環境變數的生效時機（setx 只對『之後』新開的程序有效，
        # 如果在同一個終端機/IDE 視窗裡重跑，該視窗當下還是讀不到，才會有「每次都要重打」的狀況）。
        saved = S.load_user_settings()

        tk.Label(frame, text="Provider", bg=BG_PANEL).grid(row=0, column=0, padx=8, pady=6, sticky="w")
        self.provider_var = tk.StringVar(value=saved.get("provider", "Ollama"))
        provider_combo = ttk.Combobox(frame, textvariable=self.provider_var,
                                       values=["Ollama", "OpenAI"], state="readonly", width=12)
        provider_combo.grid(row=0, column=1, padx=5, sticky="w")
        provider_combo.bind("<<ComboboxSelected>>", self._on_provider_changed)

        tk.Label(frame, text="Model", bg=BG_PANEL).grid(row=0, column=2, padx=(20, 5))
        self.model_var = tk.StringVar(value=saved.get("model", S.DEFAULT_OLLAMA_MODEL))
        self.model_combo = ttk.Combobox(frame, textvariable=self.model_var, width=22)
        self.model_combo.grid(row=0, column=3, padx=5, sticky="w")

        self.test_conn_btn = make_button(frame, "🔌 測試連線", self.test_connection, bg=ACCENT_SETTINGS)
        self.test_conn_btn.grid(row=0, column=4, padx=(20, 8), sticky="e")

        tk.Label(frame, text="OpenAI API Key", bg=BG_PANEL).grid(row=1, column=0, padx=8, pady=6, sticky="w")
        # 優先順序：本機自動記憶的設定 > 環境變數 OPENAI_API_KEY > 空白
        default_api_key = saved.get("openai_api_key") or os.environ.get("OPENAI_API_KEY", "")
        self.api_key_var = tk.StringVar(value=default_api_key)
        self.api_key_entry = ttk.Entry(frame, textvariable=self.api_key_var, show="*", width=55)
        self.api_key_entry.grid(row=1, column=1, columnspan=3, padx=5, sticky="we")

        make_button(frame, "💾 存成系統環境變數", self.save_api_key_to_env, bg=BTN_NEUTRAL).grid(
            row=1, column=4, padx=(20, 8), sticky="e")

        tk.Label(frame, text="Ollama Host", bg=BG_PANEL).grid(row=2, column=0, padx=8, pady=6, sticky="w")
        default_host = saved.get("ollama_host") or os.environ.get("OLLAMA_HOST", S.DEFAULT_OLLAMA_HOST)
        self.ollama_host_var = tk.StringVar(value=default_host)
        self.ollama_host_entry = ttk.Entry(frame, textvariable=self.ollama_host_var, width=55)
        self.ollama_host_entry.grid(row=2, column=1, columnspan=3, padx=5, sticky="we")

        self.ai_settings_hint_var = tk.StringVar()
        tk.Label(frame, textvariable=self.ai_settings_hint_var, fg=TEXT_MUTED, bg=BG_PANEL,
                  font=(FONT, 9)).grid(row=3, column=0, columnspan=5, padx=8, pady=(2, 8), sticky="w")

        frame.columnconfigure(3, weight=1)
        self._on_provider_changed()

        # 欄位一有變動就自動存到本機設定檔（debounce 600ms），下次開程式會自動帶回來，
        # 不需要每次手動重打，也不需要特地按存檔按鈕。
        self._settings_save_after_id = None
        for var in (self.provider_var, self.model_var, self.api_key_var, self.ollama_host_var):
            var.trace_add("write", self._schedule_save_ai_settings)
        self._update_ai_settings_hint()

    def _schedule_save_ai_settings(self, *_args):
        if self._settings_save_after_id:
            self.after_cancel(self._settings_save_after_id)
        self._settings_save_after_id = self.after(600, self._save_ai_settings_now)

    def _save_ai_settings_now(self):
        self._settings_save_after_id = None
        S.save_user_settings({
            "provider": self.provider_var.get(),
            "model": self.model_var.get(),
            "openai_api_key": self.api_key_var.get(),
            "ollama_host": self.ollama_host_var.get(),
        })
        self._update_ai_settings_hint()

    def _update_ai_settings_hint(self):
        self.ai_settings_hint_var.set(
            f"✓ 已自動記住這些設定（存在 {S.SETTINGS_FILE.name}），下次開程式會自動帶入，不用重打。"
            f"　⚠ 此檔含明文 API Key，請勿分享此資料夾／上傳到 Git。"
        )

    def save_api_key_to_env(self):
        key = self.api_key_var.get().strip()
        if not key:
            messagebox.showwarning("環境變數", "請先在上方輸入 API Key。")
            return
        # 立即讓『目前這個程式』可以用（本次執行期間有效）
        os.environ["OPENAI_API_KEY"] = key
        try:
            # 額外寫入 Windows 使用者環境變數，給其他程式/終端機用。
            # 注意：這對『目前已開啟』的終端機/IDE 視窗不會生效，只有『之後重新開』的
            # 新視窗才讀得到——這正是先前『每次都要重打』的原因之一，所以本程式改成
            # 主要靠上面的本機設定檔自動記憶，這個按鈕只是額外選項。
            subprocess.run(["setx", "OPENAI_API_KEY", key], check=True,
                            capture_output=True, text=True)
            messagebox.showinfo(
                "環境變數",
                "已將 OPENAI_API_KEY 存成 Windows 使用者環境變數。\n\n"
                "本程式（含之後重開）都會自動記得這把 Key；"
                "其他『目前已開啟』的終端機或程式要重新開啟才會讀到新的環境變數。",
            )
        except Exception as e:  # noqa: BLE001
            messagebox.showwarning(
                "環境變數",
                f"已在本次執行中套用這把 Key，但寫入系統環境變數失敗：\n{e}\n\n"
                f"不影響本程式的自動記憶功能。",
            )
        self._status("API Key 已套用", "success")

    # ------------------------------------------------------------------
    # ① 設定：Excel
    # ------------------------------------------------------------------

    def _build_excel_panel(self, parent):
        frame = tk.LabelFrame(parent, text="Excel 活頁簿 / Sheet", font=(FONT, 12, "bold"),
                               bg=BG_PANEL, fg=TEXT_DARK)
        frame.pack(fill="x", padx=12, pady=(0, 8))

        self.excel_info_var = tk.StringVar(value="尚未連接 Excel，請先在 Excel 開啟報表檔案，再按右邊的按鈕連接。")
        tk.Label(frame, textvariable=self.excel_info_var, justify="left", anchor="w", bg=BG_PANEL).pack(
            side="left", padx=10, pady=10, fill="x", expand=True)

        tk.Label(frame, text="Sheet：", bg=BG_PANEL).pack(side="left")
        self.sheet_var = tk.StringVar()
        self.sheet_combo = ttk.Combobox(frame, textvariable=self.sheet_var, state="readonly", width=18)
        self.sheet_combo.pack(side="left", padx=4)
        self.sheet_combo.bind("<<ComboboxSelected>>", self._on_sheet_changed)

        make_button(frame, "🔗 連接 / 重新掃描", self.scan_workbook, bg=ACCENT_SETTINGS).pack(
            side="right", padx=10, pady=8)

    # ------------------------------------------------------------------
    # ② 格式選擇：Region 清單
    # ------------------------------------------------------------------

    def _build_region_panel(self, parent):
        frame = tk.LabelFrame(parent, text="Region 清單（自動偵測的多個資料區塊）", font=(FONT, 12, "bold"),
                               bg=BG_PANEL, fg=TEXT_DARK)
        frame.pack(fill="both", padx=12, pady=(0, 8))

        columns = ("region", "kind", "report_type", "box")
        self.region_tree = ttk.Treeview(frame, columns=columns, show="headings", height=6)
        for col, label, width in [("region", "Region", 90), ("kind", "類型(kind)", 110),
                                   ("report_type", "判斷報表類型", 160), ("box", "範圍", 220)]:
            self.region_tree.heading(col, text=label)
            self.region_tree.column(col, width=width, anchor="w")
        self.region_tree.pack(fill="x", padx=10, pady=8)
        self.region_tree.bind("<<TreeviewSelect>>", self._on_region_selected)

    # ------------------------------------------------------------------
    # ② 格式選擇：結構分析 / Schema Mapping / 模板
    # ------------------------------------------------------------------

    def _build_detail_panel(self, parent):
        frame = tk.LabelFrame(parent, text="結構分析 / Schema Mapping / 公司模板", font=(FONT, 12, "bold"),
                               bg=BG_PANEL, fg=TEXT_DARK)
        frame.pack(fill="both", expand=True, padx=12, pady=(0, 8))

        top = tk.Frame(frame, bg=BG_PANEL)
        top.pack(fill="x", padx=10, pady=6)
        self.detail_info_var = tk.StringVar(value="請先在上面的 Region 清單選擇一個 Region")
        tk.Label(top, textvariable=self.detail_info_var, justify="left", anchor="w", bg=BG_PANEL,
                  font=(FONT, 11, "bold"), fg=ACCENT_FORMAT).pack(side="left", fill="x", expand=True)

        mapping_columns = ("header", "canonical", "source")
        self.mapping_tree = ttk.Treeview(frame, columns=mapping_columns, show="headings", height=6)
        for col, label, width in [("header", "Excel 欄位", 160), ("canonical", "標準欄位 (canonical)", 180),
                                   ("source", "判斷來源", 120)]:
            self.mapping_tree.heading(col, text=label)
            self.mapping_tree.column(col, width=width, anchor="w")
        self.mapping_tree.pack(fill="both", expand=True, padx=10, pady=4)

        btn_row = tk.Frame(frame, bg=BG_PANEL)
        btn_row.pack(fill="x", padx=10, pady=(4, 10))

        tk.Label(btn_row, text="公司名稱：", bg=BG_PANEL).pack(side="left")
        self.company_var = tk.StringVar()
        ttk.Entry(btn_row, textvariable=self.company_var, width=18).pack(side="left", padx=4)

        self.ai_mapping_btn = make_button(btn_row, "🤖 AI Mapping", self.run_ai_mapping, bg=ACCENT_FORMAT)
        self.ai_mapping_btn.pack(side="left", padx=4)
        make_button(btn_row, "💾 儲存模板", self.save_template, bg=ACCENT_FORMAT).pack(side="left", padx=4)
        make_button(btn_row, "🗂 模板管理", self.open_template_manager, bg=BTN_NEUTRAL).pack(side="left", padx=4)

    # ------------------------------------------------------------------
    # ③ AI 需求與套用：自然語言 / 圖片
    # ------------------------------------------------------------------

    def _build_command_panel(self, parent):
        frame = tk.LabelFrame(parent, text="自然語言需求 / 圖片", font=(FONT, 12, "bold"),
                               bg=BG_PANEL, fg=TEXT_DARK)
        frame.pack(fill="x", padx=12, pady=(0, 8))

        self.command_text = ScrolledText(frame, height=3, font=(FONT, 12))
        self.command_text.pack(fill="x", padx=10, pady=(10, 4))
        self.command_text.insert("1.0", "例如：幫我在谷樺 7/24 改為機器麵線 777 件")

        row = tk.Frame(frame, bg=BG_PANEL)
        row.pack(fill="x", padx=10, pady=(0, 10))
        make_button(row, "🖼 選擇圖片（僅 OpenAI）", self.select_images, bg=BTN_NEUTRAL).pack(side="left")
        make_button(row, "清除圖片", self.clear_images, bg=BTN_NEUTRAL).pack(side="left", padx=6)
        self.image_var = tk.StringVar(value="沒有圖片")
        tk.Label(row, textvariable=self.image_var, bg=BG_PANEL).pack(side="left", padx=8)
        self.analyze_btn = make_button(row, "🤖 AI 解析需求", self.analyze_request, bg=ACCENT_AI, font_size=11)
        self.analyze_btn.pack(side="right")

    # ------------------------------------------------------------------
    # ③ AI 需求與套用：操作預覽 + 確認執行
    # ------------------------------------------------------------------

    def _build_preview_panel(self, parent):
        frame = tk.LabelFrame(parent, text="操作預覽（Operation Plan Preview）", font=(FONT, 12, "bold"),
                               bg=BG_PANEL, fg=TEXT_DARK)
        frame.pack(fill="both", expand=True, padx=12, pady=(0, 4))

        # 明確的『目前處理狀態』橫幅，讓「送出後不知道處理到哪」「回覆後不知道要按哪裡」一目了然
        self.plan_status_var = tk.StringVar(value="尚無待處理的操作")
        self.plan_status_label = tk.Label(frame, textvariable=self.plan_status_var,
                                           font=(FONT, 12, "bold"), anchor="w", fg=TEXT_MUTED, bg=BG_PANEL)
        self.plan_status_label.pack(fill="x", padx=10, pady=(8, 0))

        self.progress = ttk.Progressbar(frame, mode="indeterminate")
        # 平常隱藏，只有處理中才 pack 出來（見 _set_busy，插在 banner 下方／文字框上方）

        # 重要：按鈕列要「先」用 side="bottom" 佔住底部空間，
        # 之後再讓文字框用 expand=True 去填滿剩下的區域。
        # 如果順序相反（先塞會 expand 的文字框），文字框會把整個容器的空間
        # 全部吃光，導致按鈕被擠壓到 0 高度、整顆『看不到』（曾經發生過的 bug）。
        action_row = tk.Frame(frame, bg=BG_PANEL)
        action_row.pack(side="bottom", fill="x", padx=10, pady=10)
        self.execute_btn = make_button(action_row, "✅ 確認執行（把上面的計畫寫入 Excel）",
                                        self.execute_pending_plan, bg=ACCENT_AI, font_size=11)
        self.execute_btn.config(state="disabled")
        self.execute_btn.pack(fill="x", expand=True, ipady=6)

        self.preview = ScrolledText(frame, font=(FONT_MONO, 11))
        self.preview.pack(fill="both", expand=True, padx=10, pady=8)

    # ------------------------------------------------------------------
    # 常駐底部列
    # ------------------------------------------------------------------

    def _build_bottom_bar(self):
        frame = tk.Frame(self, bg=BG_APP)
        frame.pack(fill="x", padx=10, pady=8)

        make_button(frame, "💾 儲存 Excel", self.save_excel, bg=COLOR_INFO).pack(side="left")

        self.status_var = tk.StringVar(value="準備完成")
        self.status_label = tk.Label(frame, textvariable=self.status_var, font=(FONT, 11, "bold"), bg=BG_APP)
        self.status_label.pack(side="right")

    # ==================================================================
    # AI Provider
    # ==================================================================

    def _on_provider_changed(self, _evt=None):
        if self.provider_var.get() == "Ollama":
            self.model_combo.config(values=S.OLLAMA_MODELS, state="readonly")
            if self.model_var.get() not in S.OLLAMA_MODELS:
                self.model_var.set(S.DEFAULT_OLLAMA_MODEL)
            self.api_key_entry.config(state="disabled")
            self.ollama_host_entry.config(state="normal")
        else:
            self.model_combo.config(values=S.OPENAI_MODELS, state="normal")
            if self.model_var.get() not in S.OPENAI_MODELS:
                self.model_var.set(S.DEFAULT_OPENAI_MODEL)
            self.api_key_entry.config(state="normal")
            self.ollama_host_entry.config(state="disabled")

    def _configure_ai(self):
        provider = S.PROVIDER_OPENAI if self.provider_var.get() == "OpenAI" else S.PROVIDER_OLLAMA
        self.ai.configure(provider=provider, model=self.model_var.get().strip(),
                           api_key=self.api_key_var.get().strip(),
                           ollama_host=self.ollama_host_var.get().strip() or S.DEFAULT_OLLAMA_HOST)

    def test_connection(self):
        if self._busy:
            return
        self._configure_ai()
        self._set_busy(True, f"⏳ 正在測試 {self.provider_var.get()} 連線...")
        self.ai.run_async(self.ai.test_connection, self._queue, tag="test_connection")

    # ==================================================================
    # Excel 連接 / 掃描
    # ==================================================================

    def scan_workbook(self):
        try:
            info = self.excel.get_workbook_info()
            sheets = self.excel.list_sheets()
            self.sheet_combo.config(values=sheets)
            self.sheet_var.set(info["active_sheet"])
            self.excel_info_var.set(
                f"活頁簿：{info['name']}　|　工作表數：{info['sheet_count']}　|　目前使用中：{info['active_sheet']}"
            )
            self.scan_current_sheet()
            self._status("Excel 連接成功", "success")
        except ExcelConnectionError as e:
            messagebox.showerror("Excel 連接失敗", str(e))
            self._status("Excel 連接失敗", "error")
        except Exception as e:  # noqa: BLE001
            messagebox.showerror("錯誤", f"掃描 Excel 時發生未預期的錯誤：\n{e}")
            self._status("掃描失敗", "error")

    def _on_sheet_changed(self, _evt=None):
        try:
            self.excel.set_active_sheet(self.sheet_var.get())
            self.scan_current_sheet()
        except Exception as e:  # noqa: BLE001
            messagebox.showerror("錯誤", str(e))

    def scan_current_sheet(self):
        try:
            grid = self.excel.read_sheet_grid(self.sheet_var.get() or None)
        except Exception as e:  # noqa: BLE001
            messagebox.showerror("讀取工作表失敗", str(e))
            self._status("讀取失敗", "error")
            return

        self.current_grid = grid
        self.current_regions = detect_regions(grid)
        self.region_analysis = {}

        for region in self.current_regions:
            structure, classification = None, None
            if region.kind == "table" and region.header_row:
                try:
                    structure = analyze_region(region, grid, self.current_regions)
                    classification = classify_structure(structure, grid)
                except Exception:
                    classification = ClassificationResult(S.REPORT_UNKNOWN, 0.0, [])
            else:
                classification = classify_region(region, grid)
            self.region_analysis[region.region_id] = (structure, classification)

        self._refresh_region_tree()
        self._status(f"掃描完成，找到 {len(self.current_regions)} 個 Region", "success")
        self._update_connection_strip()
        self._auto_select_best_region()

    def _auto_select_best_region(self):
        """自動選取最可能是使用者要處理的那個 Region，省得每次掃描完都要
        自己點一次才會觸發公司模板比對——分數/信心不夠明確時（例如好幾個
        table 分不出主次、或全部都是 unknown/notice）就不猜，維持原本
        『使用者自己選』的行為，不強迫套用不確定的結果。"""
        best_id, best_score = None, 0.0
        for region in self.current_regions:
            _, classification = self.region_analysis.get(region.region_id, (None, None))
            if not classification or classification.report_type == S.REPORT_UNKNOWN:
                continue
            score = classification.confidence
            if classification.report_type == S.REPORT_CUSTOMER_STATEMENT:
                score += 0.05  # 目前完整支援的主要類型，同分時優先選它
            if score > best_score:
                best_score, best_id = score, region.region_id

        if best_id is None or best_score < 0.5:
            return

        self.region_tree.selection_set(best_id)
        self.region_tree.focus(best_id)
        self.region_tree.see(best_id)
        self._on_region_selected()

    def _update_connection_strip(self):
        try:
            info = self.excel.get_workbook_info()
            self.conn_strip_var.set(
                f"📄 {info['name']}　|　工作表：{info['active_sheet']}　|　"
                f"偵測到 {len(self.current_regions)} 個 Region　→　"
                f"請到「② 格式選擇」確認欄位對應，再到「③ AI 需求與套用」下指令"
            )
        except Exception:  # noqa: BLE001
            pass

    def _refresh_region_tree(self):
        for row in self.region_tree.get_children():
            self.region_tree.delete(row)
        for region in self.current_regions:
            structure, classification = self.region_analysis.get(region.region_id, (None, None))
            rtype = S.REPORT_TYPE_LABELS.get(classification.report_type, classification.report_type) \
                if classification else "-"
            box = _region_range_label(region)
            self.region_tree.insert("", "end", iid=region.region_id,
                                     values=(region.region_id, region.kind, rtype, box))

    # ==================================================================
    # Region 選取 -> 結構分析 / Schema Mapping
    # ==================================================================

    def _on_region_selected(self, _evt=None):
        sel = self.region_tree.selection()
        if not sel:
            return
        region_id = sel[0]
        region = next((r for r in self.current_regions if r.region_id == region_id), None)
        if region is None:
            return

        self.selected_region = region
        structure, classification = self.region_analysis.get(region_id, (None, None))
        self.selected_structure = structure
        self.selected_classification = classification

        if structure is None:
            self.detail_info_var.set(
                f"Region {region_id}　kind={region.kind}　（此區塊非標準表格，僅能檢視 / 交給 AI 分析）"
            )
            for row in self.mapping_tree.get_children():
                self.mapping_tree.delete(row)
            self.current_mapping = None
            return

        template, score = self.templates.find_best_match(
            sheet_name=region.sheet_name,
            headers=[h.name for h in structure.headers],
            region_signature={"n_cols": region.n_cols, "n_rows": region.n_rows},
            report_type=classification.report_type if classification else None,
        )
        self.matched_template = template if (template and score >= 0.6) else None
        if self.matched_template:
            self.company_var.set(self.matched_template.company_name)

        template_dict = self.matched_template.to_json() if self.matched_template else None
        self.current_mapping = auto_map(structure.headers, template_dict)

        rtype_label = S.REPORT_TYPE_LABELS.get(classification.report_type, classification.report_type)
        tpl_text = f"　|　匹配模板：{self.matched_template.company_name} ({score:.0%})" if self.matched_template else "　|　無匹配模板"
        self.detail_info_var.set(
            f"報表類型：{rtype_label}（信心 {classification.confidence:.0%}）　|　"
            f"Header Row：{structure.header_row}　|　資料列：{structure.data_start_row}~{structure.data_end_row}　|　"
            f"總計列：{structure.total_row}{tpl_text}"
        )

        self._refresh_mapping_tree()

    def _refresh_mapping_tree(self):
        for row in self.mapping_tree.get_children():
            self.mapping_tree.delete(row)
        if not self.current_mapping or not self.selected_structure:
            return
        for h in self.selected_structure.headers:
            canonical = self.current_mapping.header_to_canonical.get(h.name, "(未對應)")
            source = self.current_mapping.source.get(h.name, "-")
            self.mapping_tree.insert("", "end", values=(h.name, canonical, source))

    # ==================================================================
    # AI Mapping（需求 #9：LLM 結果必須先預覽，不可直接套用）
    # ==================================================================

    def run_ai_mapping(self):
        if self._busy:
            return
        if not self.selected_structure or not self.current_mapping:
            messagebox.showwarning("AI Mapping", "請先在「② 格式選擇」分頁的 Region 清單選擇一個表格類型的 Region。")
            return
        if not self.current_mapping.unresolved:
            messagebox.showinfo("AI Mapping", "目前所有欄位都已經有把握的對應，不需要呼叫 AI。")
            return

        self._configure_ai()
        sample_rows = self._sample_rows(self.selected_structure, self.current_grid, limit=5)
        prompt = build_llm_mapping_prompt(self.selected_structure.headers, sample_rows)

        self._set_busy(True, "AI 正在分析欄位 Mapping...")
        self.ai.run_async(self.ai.text_json, self._queue, tag="mapping",
                           system_prompt="你是企業 Excel Schema Mapping 系統。", user_prompt=prompt)

    def _handle_mapping_result(self, result: dict):
        preview = parse_llm_mapping_result(result, self.selected_structure.headers)
        if not preview:
            messagebox.showinfo("AI Mapping", "AI 沒有提出任何有把握的新對應。")
            return

        confirmed = self._show_mapping_preview_dialog(preview)
        if not confirmed:
            self._status("AI Mapping 已取消（未套用）", "warning")
            return

        self.current_mapping = merge_confirmed_mapping(self.current_mapping, self.selected_structure.headers, confirmed)
        self._refresh_mapping_tree()
        self._status("AI Mapping 已套用", "success")

    def _show_mapping_preview_dialog(self, preview: dict) -> dict:
        """顯示 LLM Mapping 預覽，使用者可取消勾選後才確認套用。"""
        dlg = tk.Toplevel(self)
        dlg.title("AI Mapping 預覽（請確認後套用）")
        dlg.geometry("480x400")
        dlg.configure(bg=BG_PANEL)
        dlg.transient(self)
        dlg.grab_set()

        tk.Label(dlg, text="AI 提出以下欄位對應，取消勾選代表不套用：", font=(FONT, 11, "bold"),
                  bg=BG_PANEL).pack(anchor="w", padx=10, pady=8)

        vars_map = {}
        for header, canonical in preview.items():
            var = tk.BooleanVar(value=True)
            vars_map[header] = (var, canonical)
            tk.Checkbutton(dlg, text=f"{header}  →  {canonical} ({S.CANONICAL_LABELS_ZH.get(canonical, canonical)})",
                            variable=var, bg=BG_PANEL).pack(anchor="w", padx=16, pady=2)

        result = {"confirmed": {}}

        def on_confirm():
            result["confirmed"] = {h: c for h, (v, c) in vars_map.items() if v.get()}
            dlg.destroy()

        def on_cancel():
            result["confirmed"] = {}
            dlg.destroy()

        btn_row = tk.Frame(dlg, bg=BG_PANEL)
        btn_row.pack(fill="x", padx=10, pady=10)
        make_button(btn_row, "取消", on_cancel, bg=BTN_NEUTRAL).pack(side="right", padx=4)
        make_button(btn_row, "確認套用", on_confirm, bg=COLOR_SUCCESS).pack(side="right", padx=4)

        self.wait_window(dlg)
        return result["confirmed"]

    def _sample_rows(self, structure: StructureInfo, grid: SheetGrid, limit: int = 5) -> list[dict]:
        rows = []
        for r in range(structure.data_start_row, min(structure.data_end_row, structure.data_start_row + limit - 1) + 1):
            row = {}
            for h in structure.headers:
                cell = grid.get(r, h.column)
                row[h.name] = cell.value if cell else None
            rows.append(row)
        return rows

    # ==================================================================
    # 公司模板
    # ==================================================================

    def save_template(self):
        if not self.selected_structure or not self.current_mapping:
            messagebox.showwarning("儲存模板", "請先選擇一個表格類型的 Region。")
            return
        company = self.company_var.get().strip()
        if not company:
            messagebox.showwarning("儲存模板", "請輸入公司名稱。")
            return

        report_type = self.selected_classification.report_type if self.selected_classification else S.REPORT_UNKNOWN
        canonical_mapping = {c: h for h, c in self.current_mapping.header_to_canonical.items()}
        formula_rules = {
            self._header_name_of(col): fp.template
            for col, fp in self.selected_structure.formula_patterns.items()
        }
        blank_rules = {
            self._header_name_of(col): canonical
            for col, canonical in self.selected_structure.blank_inheritance.items()
        }

        tpl = Template(
            company_name=company,
            report_type=report_type,
            sheet_name=self.selected_region.sheet_name,
            header_row=self.selected_structure.header_row,
            headers=[h.name for h in self.selected_structure.headers],
            canonical_mapping=canonical_mapping,
            region_signature={"n_rows": self.selected_region.n_rows, "n_cols": self.selected_region.n_cols},
            formula_rules=formula_rules,
            blank_inheritance_rules=blank_rules,
            summary_rules={"total_row_offset": None},
            key_columns=list(canonical_mapping.keys()),
        )
        path = self.templates.save_template(tpl)
        self._status(f"模板已儲存：{path.name}", "success")
        messagebox.showinfo("儲存模板", f"已儲存公司模板：{company}")

    def _header_name_of(self, column: int) -> str:
        for h in self.selected_structure.headers:
            if h.column == column:
                return h.name
        return str(column)

    def open_template_manager(self):
        dlg = tk.Toplevel(self)
        dlg.title("公司模板管理")
        dlg.geometry("700x420")
        dlg.configure(bg=BG_PANEL)

        listbox = tk.Listbox(dlg, font=(FONT, 11))
        listbox.pack(fill="both", expand=True, padx=10, pady=10)

        templates = self.templates.list_templates()
        for t in templates:
            rtype_label = S.REPORT_TYPE_LABELS.get(t.report_type, t.report_type)
            listbox.insert("end", f"{t.company_name} | {rtype_label} | Sheet={t.sheet_name} | Header={t.header_row}")

        def apply_selected():
            sel = listbox.curselection()
            if not sel:
                return
            tpl = templates[sel[0]]
            self.company_var.set(tpl.company_name)
            self.matched_template = tpl
            if self.selected_structure:
                self.current_mapping = auto_map(self.selected_structure.headers, tpl.to_json())
                self._refresh_mapping_tree()
            dlg.destroy()

        def delete_selected():
            sel = listbox.curselection()
            if not sel:
                return
            tpl = templates[sel[0]]
            if messagebox.askyesno("刪除模板", f"確定刪除模板：{tpl.company_name}？", parent=dlg):
                self.templates.delete_template(tpl.company_name, tpl.report_type)
                dlg.destroy()

        btn_row = tk.Frame(dlg, bg=BG_PANEL)
        btn_row.pack(fill="x", padx=10, pady=(0, 10))
        make_button(btn_row, "套用", apply_selected, bg=ACCENT_FORMAT).pack(side="left")
        make_button(btn_row, "刪除", delete_selected, bg=COLOR_DANGER).pack(side="left", padx=6)

    # ==================================================================
    # 圖片
    # ==================================================================

    def select_images(self):
        paths = filedialog.askopenfilenames(
            title="選擇圖片（收據 / 報表截圖 / 表格 / 公告 / 名冊）",
            filetypes=[("圖片", "*.jpg *.jpeg *.png *.webp *.gif"), ("全部檔案", "*.*")],
        )
        if not paths:
            return
        self.selected_images = list(paths)
        self.image_var.set(f"已選擇 {len(paths)} 張圖片")

    def clear_images(self):
        self.selected_images = []
        self.image_var.set("沒有圖片")

    # ==================================================================
    # AI 解析需求 -> Operation Plan -> Handler
    # ==================================================================

    def analyze_request(self):
        if self._busy:
            return

        user_text = self.command_text.get("1.0", "end").strip()
        if not user_text and not self.selected_images:
            messagebox.showwarning("AI 解析", "請輸入需求文字，或選擇圖片。")
            return
        if self.selected_images and self.provider_var.get() != "OpenAI":
            messagebox.showwarning("AI 解析", "圖片解析僅支援 OpenAI，請切換 Provider 或清除圖片。")
            return

        self.pending_items = []
        self.execute_btn.config(state="disabled")
        self.preview.delete("1.0", "end")

        # 先試著把輸入拆成好幾筆各自獨立、都能被規則式解析器辨識的指令
        # （例如用逗號分隔的多筆修改）。拆得出來就不用等 AI，一次全部處理，
        # 也不會像之前那樣，逗號後面的其他指令被整段送進 AI 之後悄悄消失。
        if not self.selected_images:
            plans = try_deterministic_parse_multi(user_text)
            if plans:
                self._handle_batch_result(plans)
                return

        self._configure_ai()

        context = {
            "report_type": self.selected_classification.report_type if self.selected_classification else S.REPORT_UNKNOWN,
            "headers": [h.name for h in self.selected_structure.headers] if self.selected_structure else [],
            "mapping": self.current_mapping.header_to_canonical if self.current_mapping else {},
            "known_customers": self._known_customers_on_sheet(),
        }

        self._set_busy(True, "AI 正在解析需求...")

        self.ai.run_async(parse_operation, self._queue, tag="operation",
                           user_text=user_text, ai_manager=self.ai, context=context,
                           image_paths=list(self.selected_images))

    def _known_customers_on_sheet(self) -> list[str]:
        from report_handlers.customer_statement import extract_region_customer_name
        names = []
        for region in self.current_regions:
            structure, classification = self.region_analysis.get(region.region_id, (None, None))
            if structure and classification and classification.report_type == S.REPORT_CUSTOMER_STATEMENT:
                names.append(extract_region_customer_name(region, self.current_grid, structure.header_row))
        return names

    def _build_pending_item(self, plan: OperationPlan) -> dict:
        """把單一 OperationPlan 轉成可執行的 {"plan","handler","steps"}，
        並把『即將寫入的變更』附加到預覽文字框。失敗時直接拋出例外，交給
        呼叫端決定怎麼呈現（單筆指令 vs 批次指令的錯誤呈現方式不同）。
        """
        region, structure, all_regions = self._resolve_target_region(plan)
        grid = self.current_grid
        report_type = self._region_report_type(region) if structure else S.REPORT_UNKNOWN
        handler = get_handler(report_type, self.excel, grid, region, structure)
        parsed = handler.parse(plan)
        handler.validate(parsed)
        position = handler.find_insert_position(parsed)
        steps = handler.build_operation_plan(parsed, position, all_regions=all_regions)

        self._append_preview("【即將寫入 Excel 的變更】\n")
        for step in steps:
            self._append_preview(f"- {step.description}\n")
            for c in step.changes:
                formula_part = f"公式 {c.new_formula}" if c.new_formula else f"值 {c.new_value}"
                self._append_preview(
                    f"    Sheet={c.sheet} Row={c.row} Col={c.column}（{c.field_label}）"
                    f" 舊值={c.old_value!r} 舊公式={c.old_formula!r} -> 新{formula_part}\n"
                )
        return {"plan": plan, "handler": handler, "steps": steps}

    def _handle_operation_result(self, plan: OperationPlan):
        self.pending_items = []
        self._append_preview("【AI 解析出的操作計畫】\n" + json.dumps(plan.to_preview_dict(), ensure_ascii=False, indent=2))

        if plan.action == "analyze":
            self._append_preview("\n\n（此為分析類需求，不會修改 Excel，沒有東西需要確認執行。）")
            self._status("AI 分析完成", "success")
            self._set_plan_banner("ℹ️ 這是分析類需求，不會寫入 Excel（不需要按確認執行）", COLOR_INFO)
            return

        self._append_preview("\n\n")
        try:
            item = self._build_pending_item(plan)
            self.pending_items = [item]
            self.execute_btn.config(state="normal")
            self._status("AI 解析完成，請確認後執行", "success")
            self._set_plan_banner("✅ 已產生操作計畫，請檢查上面內容，確認無誤後按下方「確認執行」寫入 Excel", COLOR_SUCCESS)

        except MultipleCandidatesError as e:
            self._append_preview(f"⚠ {e}\n候選資料：\n" + json.dumps(e.candidates, ensure_ascii=False, indent=2, default=str))
            self._status("找到多筆符合資料，需要更明確條件", "warning")
            self._set_plan_banner("🟡 找到多筆符合的資料，為避免誤改不會寫入，請把指令講得更明確再重新送出", COLOR_WARNING)
        except HandlerError as e:
            self._append_preview(f"❌ {e}")
            self._status("無法建立操作計畫", "error")
            self._set_plan_banner("❌ 無法建立操作計畫，請看上面的錯誤說明", COLOR_DANGER)
        except Exception as e:  # noqa: BLE001 - 需求 #50
            self._append_preview(f"❌ 發生未預期的錯誤：{e}")
            self._status("發生錯誤", "error")
            self._set_plan_banner("❌ 發生未預期的錯誤，請看上面的錯誤說明", COLOR_DANGER)

    def _handle_batch_result(self, plans: list[OperationPlan]):
        """處理一次輸入拆出來的多筆各自獨立指令（見 try_deterministic_parse_multi）。
        每一筆分開 try/except，一筆失敗不會拖累其他筆——最後按「確認執行」
        只會處理成功產生操作計畫的那幾筆。"""
        self._append_preview(f"【偵測到 {len(plans)} 筆各自獨立的指令，將依序處理】\n")

        items = []
        for idx, plan in enumerate(plans, start=1):
            self._append_preview(
                f"\n── 第 {idx}/{len(plans)} 筆 ──\n"
                + json.dumps(plan.to_preview_dict(), ensure_ascii=False, indent=2) + "\n"
            )
            if plan.action == "analyze":
                self._append_preview("（此為分析類需求，不會修改 Excel）\n")
                continue
            try:
                items.append(self._build_pending_item(plan))
            except MultipleCandidatesError as e:
                self._append_preview(
                    f"⚠ 第 {idx} 筆找到多筆符合資料，為避免誤改，這一筆不會執行：\n{e}\n候選資料：\n"
                    + json.dumps(e.candidates, ensure_ascii=False, indent=2, default=str) + "\n"
                )
            except HandlerError as e:
                self._append_preview(f"❌ 第 {idx} 筆無法建立操作計畫：{e}\n")
            except Exception as e:  # noqa: BLE001 - 需求 #50
                self._append_preview(f"❌ 第 {idx} 筆發生未預期的錯誤：{e}\n")

        self.pending_items = items

        if not items:
            self._status("沒有可執行的操作", "error")
            self._set_plan_banner("❌ 沒有任何一筆指令成功建立操作計畫，請看上面的錯誤說明", COLOR_DANGER)
            return

        ok_count, total_count = len(items), len(plans)
        self.execute_btn.config(state="normal")
        if ok_count < total_count:
            self._status(f"{ok_count}/{total_count} 筆可以執行，其餘請看錯誤說明", "warning")
            self._set_plan_banner(
                f"🟡 {total_count} 筆指令中只有 {ok_count} 筆成功產生操作計畫，"
                f"請看上面的錯誤說明；按「確認執行」只會處理成功的這 {ok_count} 筆", COLOR_WARNING,
            )
        else:
            self._status("AI 解析完成，請確認後執行", "success")
            self._set_plan_banner(
                f"✅ 已產生 {ok_count} 筆操作計畫，請檢查上面內容，確認無誤後按下方「確認執行」一次寫入 Excel",
                COLOR_SUCCESS,
            )

    def _region_report_type(self, region: Region) -> str:
        _, classification = self.region_analysis.get(region.region_id, (None, None))
        return classification.report_type if classification else S.REPORT_UNKNOWN

    def _resolve_target_region(self, plan: OperationPlan):
        """決定這個操作要套用到哪一個 Region（不是由 LLM 指定，而是 Python 依規則判斷 —— 需求 #17 #18）。"""
        if plan.report_type == S.REPORT_CUSTOMER_STATEMENT:
            from report_handlers.customer_statement import resolve_customer_region
            candidates = []
            for region in self.current_regions:
                structure, classification = self.region_analysis.get(region.region_id, (None, None))
                if structure and classification and classification.report_type == S.REPORT_CUSTOMER_STATEMENT:
                    candidates.append((region, self.current_grid, structure))
            if not candidates:
                raise HandlerError("這張 Sheet 沒有偵測到任何客戶對帳表 Region。")
            region, grid, structure = resolve_customer_region(candidates, plan.customer)
            return region, structure, self.current_regions

        # 其他報表類型：使用目前在 Region 清單中選取的 Region
        if not self.selected_region or not self.selected_structure:
            raise HandlerError("請先到「② 格式選擇」分頁的 Region 清單選擇要操作的 Region。")
        return self.selected_region, self.selected_structure, self.current_regions

    # ==================================================================
    # 執行 / 驗證
    # ==================================================================

    def execute_pending_plan(self):
        if not self.pending_items:
            return

        multi = len(self.pending_items) > 1
        if multi:
            lines = "\n".join(
                f"{i}. {it['plan'].explanation}" for i, it in enumerate(self.pending_items, start=1)
            )
            confirm_text = f"即將依序執行 {len(self.pending_items)} 筆操作：\n{lines}"
        else:
            confirm_text = self.pending_items[0]["plan"].explanation

        if not messagebox.askyesno("確認執行", f"{confirm_text}\n\n這會真正修改目前 Excel，確定繼續？"):
            return

        total_changes = sum(len(s.changes) for it in self.pending_items for s in it["steps"]) or 1
        self.execute_btn.config(state="disabled")
        self._show_write_progress(total_changes)

        all_ok = True
        done_offset = 0
        try:
            for idx, item in enumerate(self.pending_items, start=1):
                handler, steps = item["handler"], item["steps"]
                tag = f"第 {idx}/{len(self.pending_items)} 筆　" if multi else ""
                offset = done_offset

                def _cb(done, _total, label, _offset=offset, _tag=tag):
                    self._on_write_progress(_offset + done, total_changes, f"{_tag}{label}")

                result: HandlerResult = handler.execute(steps, progress_callback=_cb)
                done_offset += sum(len(s.changes) for s in steps)

                self._append_preview(f"\n\n【{tag}執行結果】{result.message}")
                if not result.success:
                    all_ok = False
                    self._status("執行失敗", "error")
                    self._set_plan_banner(f"❌ {tag}執行失敗，請看上面的錯誤說明", COLOR_DANGER)
                    messagebox.showerror("執行失敗", f"{tag}{result.message}")
                    break

                self._set_plan_banner(f"⏳ {tag}正在驗證寫入結果...", COLOR_INFO)
                self.update_idletasks()
                verify_result: HandlerResult = handler.verify(steps)
                self._append_preview(f"\n【{tag}驗證結果】{verify_result.message}\n{verify_result.verify_details}")

                if not verify_result.verify_ok:
                    all_ok = False
                    self._status("已寫入，但驗證發現落差，請人工檢查", "warning")
                    self._set_plan_banner(f"🟡 {tag}已寫入，但驗證發現落差，請人工檢查上面內容", COLOR_WARNING)

            if all_ok:
                self._status("執行並驗證成功", "success")
                self._set_plan_banner("✅ 已成功寫入並驗證通過", COLOR_SUCCESS)

            self.pending_items = []
            self.scan_current_sheet()

        except Exception as e:  # noqa: BLE001 - 需求 #50
            messagebox.showerror("執行失敗", f"發生未預期的錯誤：\n{e}")
            self._status("執行失敗", "error")
            self._set_plan_banner("❌ 執行時發生未預期的錯誤", COLOR_DANGER)
        finally:
            self._hide_write_progress()

    # ------------------------------------------------------------------
    # 寫入進度顯示（大量修改，例如批次改名，時讓使用者看得到目前進度）
    # ------------------------------------------------------------------

    def _show_write_progress(self, total: int):
        self.progress.config(mode="determinate", maximum=total, value=0)
        self.progress.pack(fill="x", padx=10, pady=(4, 0), before=self.preview)
        self._set_plan_banner(f"⏳ 正在寫入 Excel...（0/{total}）", COLOR_INFO)
        self.update_idletasks()

    def _on_write_progress(self, done: int, total: int, label: str):
        self.progress["value"] = done
        pct = int(done * 100 / total) if total else 100
        self._set_plan_banner(f"⏳ 正在寫入 Excel...（{done}/{total}，{pct}%）{label}", COLOR_INFO)
        self.update_idletasks()

    def _hide_write_progress(self):
        self.progress.stop()
        self.progress.pack_forget()
        self.progress.config(mode="indeterminate")  # 還原成 _set_busy() 預期的模式

    def save_excel(self):
        try:
            self.excel.save()
            self._status("Excel 已儲存", "success")
        except Exception as e:  # noqa: BLE001
            messagebox.showerror("儲存失敗", str(e))
            self._status("儲存失敗", "error")

    # ==================================================================
    # Queue 輪詢（背景執行緒結果 -> 主執行緒）
    # ==================================================================

    def _poll_queue(self):
        try:
            while True:
                item = self._queue.get_nowait()
                self._set_busy(False)

                if not item["ok"]:
                    messagebox.showerror("AI 錯誤", item["error"])
                    self._status("AI 呼叫失敗", "error")
                    if item["tag"] == "operation":
                        self._set_plan_banner("❌ AI 呼叫失敗，請看下方彈出視窗的錯誤內容", COLOR_DANGER)
                    continue

                if item["tag"] == "mapping":
                    self._status("AI Mapping 回覆已收到，請於彈出視窗確認", "success")
                    self._handle_mapping_result(item["result"])
                elif item["tag"] == "operation":
                    self._handle_operation_result(item["result"])
                elif item["tag"] == "test_connection":
                    messagebox.showinfo("測試連線", item["result"])
                    self._status("連線測試完成", "success")

        except queue.Empty:
            pass
        self.after(100, self._poll_queue)

    # ==================================================================
    # 小工具
    # ==================================================================

    def _append_preview(self, text: str):
        self.preview.insert("end", text)
        self.preview.see("end")

    def _set_plan_banner(self, text: str, color: str = TEXT_MUTED):
        self.plan_status_var.set(text)
        self.plan_status_label.config(fg=color)

    def _busy_widgets(self) -> list:
        return [self.ai_mapping_btn, self.analyze_btn, self.test_conn_btn]

    def _set_busy(self, busy: bool, message: str = ""):
        self._busy = busy
        for w in self._busy_widgets():
            w.config(state="disabled" if busy else "normal")

        if busy:
            self.preview.delete("1.0", "end")
            self.execute_btn.config(state="disabled")
            self._status(message)
            self._set_plan_banner(f"⏳ {message or 'AI 處理中，請稍候...'}", COLOR_INFO)
            self.progress.pack(fill="x", padx=10, pady=(4, 0), before=self.preview)
            self.progress.start(12)
        else:
            self.progress.stop()
            self.progress.pack_forget()

    def _status(self, text: str, level: str = None):
        self.status_var.set(text)
        color = {"success": COLOR_SUCCESS, "error": COLOR_DANGER, "warning": COLOR_WARNING}.get(level, TEXT_MUTED)
        self.status_label.config(fg=color)


def main():
    pythoncom.CoInitialize()
    try:
        app = ExcelAIApp()
        app.mainloop()
    finally:
        pythoncom.CoUninitialize()


if __name__ == "__main__":
    main()
