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

import ctypes
import json
import os
import queue
import subprocess
import threading
import tkinter as tk
from datetime import date
from tkinter import ttk, messagebox, filedialog, simpledialog
from tkinter.scrolledtext import ScrolledText

import pythoncom
import ttkbootstrap as ttkb

import settings as S
import item_catalog
from value_normalizer import normalize_header_text, format_date_like
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
from report_handlers.customer_statement import (
    CustomerStatementHandler, extract_region_customer_name, list_known_dates, list_known_items,
)

FONT = "Microsoft JhengHei"
FONT_MONO = "Consolas"

# ----------------------------------------------------------------------
# 色彩系統：每個大區塊有自己的強調色，整個 App 共用同一套底色 / 字色，
# 讓使用者一眼就能分辨「現在在哪個階段」。這組色票是跟 _setup_style()
# 套用的 ttkbootstrap "bootstrap-light" 主題實際色票（primary/success/
# danger 等）協調過的，純 tk 元件（Frame/Label/自訂按鈕）沒辦法被
# ttkbootstrap 自動接管，所以用這組常數手動對齊，避免新舊風格混雜。
# ----------------------------------------------------------------------
BG_APP = "#eef2f7"
BG_PANEL = "#ffffff"
BG_HEADER = "#1e293b"
FG_HEADER_SUB = "#94a3b8"

TEXT_MUTED = "#686d71"
TEXT_DARK = "#212529"

COLOR_SUCCESS = "#146c43"
COLOR_WARNING = "#b45309"
COLOR_DANGER = "#b02a37"
COLOR_INFO = "#0a58ca"

ACCENT_SETTINGS = "#6f42c1"   # ① 設定 —— 紫
ACCENT_FORMAT = "#0f766e"     # ② 格式選擇 —— 青綠
ACCENT_AI = "#c2410c"         # ③ AI 需求與套用 —— 橘
ACCENT_MANUAL = "#0e7490"     # ④ 半人工輸入 —— 藍綠

BTN_NEUTRAL = "#686d71"


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

        # 半人工輸入（④ 分頁）狀態：待加入 Excel 的列，以及目前選定客戶對應的
        # 暫時 Handler（只拿來查欄位/單價，不會拿去寫入）。
        self.manual_rows: list[dict] = []
        self._manual_handler: CustomerStatementHandler | None = None
        # 「本次待加入清單」裡還沒填的儲存格（數量／單價），用蓋在 Treeview
        # 上面的小 Label 個別標示，key 是 (row_iid, col_name)，見
        # _draw_manual_cell_markers。ttk.Treeview 本身只能整列上色，沒辦法
        # 只標單一儲存格，所以才用這個土法煉鋼的疊圖做法。
        self._manual_cell_markers: dict[tuple[str, str], tk.Label] = {}
        # 品名清單（本機存檔，跨客戶/跨 Sheet 共用，見 item_catalog.py）。
        self.item_catalog: list[str] = item_catalog.load_items()

        self._build_ui()
        self.after(100, self._poll_queue)

    # ==================================================================
    # UI 組裝
    # ==================================================================

    def _setup_style(self):
        try:
            style = ttkb.Style(theme="bootstrap-light")
        except Exception:
            # ttkbootstrap 主題找不到之類的意外狀況，退回原本能動的 clam，
            # 不要讓整個 GUI 因為套版失敗而開不起來。
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
        tab_manual = tk.Frame(self.notebook, bg=BG_APP)

        self.notebook.add(tab_settings, text="① 設定")
        self.notebook.add(tab_format, text="② 格式選擇")
        self.notebook.add(tab_ai, text="③ AI 需求與套用")
        self.notebook.add(tab_manual, text="④ 半人工輸入")
        self._tab_ai_index = 2
        self._tab_manual_index = 3

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

        manual_scroll = self._build_scrollable_tab(tab_manual)
        self._build_section_header(
            manual_scroll, "④", "半人工輸入（下拉選單逐筆新增）",
            "選客戶 → 選/新增貨單日期與品項 → 輸入數量/單價/退貨 → 逐筆加入清單 → 一次寫入 Excel"
            "（只能對已偵測到的客戶對帳表新增資料，不能建立全新表格；這一頁內容較長，"
            "視窗太小時可在頁面上滾動滑鼠滾輪往下看）",
            ACCENT_MANUAL,
        )
        self._build_manual_entry_panel(manual_scroll)

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
        if self.notebook.index("current") == self._tab_manual_index:
            self._refresh_manual_customers()
            self._resync_manual_handler()

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
        self.provider_var = tk.StringVar(value=saved.get("provider") or "Ollama")
        provider_combo = ttk.Combobox(frame, textvariable=self.provider_var,
                                       values=["Ollama", "OpenAI"], state="readonly", width=12)
        provider_combo.grid(row=0, column=1, padx=5, sticky="w")
        provider_combo.bind("<<ComboboxSelected>>", self._on_provider_changed)

        tk.Label(frame, text="Model", bg=BG_PANEL).grid(row=0, column=2, padx=(20, 5))
        self.model_var = tk.StringVar(value=saved.get("model") or S.DEFAULT_OLLAMA_MODEL)
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
        self._merge_save_user_settings({
            "provider": self.provider_var.get(),
            "model": self.model_var.get(),
            "openai_api_key": self.api_key_var.get(),
            "ollama_host": self.ollama_host_var.get(),
        })
        self._update_ai_settings_hint()

    @staticmethod
    def _merge_save_user_settings(patch: dict):
        """S.save_user_settings() 是整份覆寫，這裡先讀出現有設定再更新指定
        欄位、整份存回去，避免不同功能各自存檔時互相蓋掉對方的欄位
        （例如 AI 設定 vs 半人工輸入記住的上次客戶）。"""
        data = S.load_user_settings()
        data.update(patch)
        S.save_user_settings(data)

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

    def _build_scrollable_tab(self, parent) -> tk.Frame:
        """把整個分頁內容包進可垂直捲動的 Canvas。④分頁內容偏長（客戶列 +
        整張表預覽 / 新增品項 / 待加入清單三塊），視窗開得不夠高、或是螢幕
        用了 Windows 顯示縮放時，最下面的『產生操作計畫』『儲存 Excel』按鈕
        會被擠到視窗看不到、也點不到的地方。包一層可捲動內容，不管視窗多小
        都還是滾得到、按得到。"""
        outer = tk.Frame(parent, bg=BG_APP)
        outer.pack(fill="both", expand=True)
        canvas = tk.Canvas(outer, bg=BG_APP, highlightthickness=0)
        scrollbar = ttk.Scrollbar(outer, orient="vertical", command=canvas.yview)
        inner = tk.Frame(canvas, bg=BG_APP)
        inner.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas_window = canvas.create_window((0, 0), window=inner, anchor="nw")
        canvas.bind("<Configure>", lambda e: canvas.itemconfigure(canvas_window, width=e.width))
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        def _wheel(evt):
            canvas.yview_scroll(int(-1 * (evt.delta / 120)), "units")
        # 內層品項清單自己也有滾輪捲動（見下方 checklist_canvas），滑鼠移進
        # 去時要暫時把滾輪讓給它，移出來再還給這一整頁，兩層各自 Enter/Leave
        # 切換，不要互相搶走。
        self._manual_tab_wheel = _wheel
        canvas.bind("<Enter>", lambda _e: canvas.bind_all("<MouseWheel>", _wheel))
        canvas.bind("<Leave>", lambda _e: canvas.unbind_all("<MouseWheel>"))
        return inner

    # ------------------------------------------------------------------
    # ④ 半人工輸入：下拉選單逐筆新增
    # ------------------------------------------------------------------

    def _build_manual_entry_panel(self, parent):
        top = tk.LabelFrame(parent, text="客戶", font=(FONT, 12, "bold"), bg=BG_PANEL, fg=TEXT_DARK)
        top.pack(fill="x", padx=12, pady=(0, 8))

        tk.Label(top, text="客戶：", bg=BG_PANEL).pack(side="left", padx=(10, 4), pady=8)
        self.manual_customer_var = tk.StringVar()
        self.manual_customer_combo = ttk.Combobox(top, textvariable=self.manual_customer_var,
                                                    state="readonly", width=22)
        self.manual_customer_combo.pack(side="left", padx=4)
        self.manual_customer_combo.bind("<<ComboboxSelected>>", self._on_manual_customer_selected)
        make_button(top, "🔄 重新整理客戶清單", self._refresh_manual_customers, bg=BTN_NEUTRAL).pack(
            side="left", padx=8)
        make_button(top, "🗂 品名清單管理", self.open_item_catalog_manager, bg=BTN_NEUTRAL).pack(
            side="left", padx=4)

        self.manual_return_hint_var = tk.StringVar()
        tk.Label(top, textvariable=self.manual_return_hint_var, fg=TEXT_MUTED, bg=BG_PANEL,
                  font=(FONT, 9)).pack(side="left", padx=10)

        # 「整張表預覽」「新增品項」「本次待加入清單」三塊左右兩欄分開放，
        # 不然全部垂直硬疊在一起畫面會很擠、預覽表格也沒有足夠高度可以看。
        paned = ttk.PanedWindow(parent, orient="horizontal")
        paned.pack(fill="both", expand=True, padx=12, pady=(0, 8))
        left_col = tk.Frame(paned, bg=BG_APP)
        right_col = tk.Frame(paned, bg=BG_APP)
        paned.add(left_col, weight=1)
        paned.add(right_col, weight=1)

        preview_frame = tk.LabelFrame(left_col, text="整張表預覽（選取後可刪除，新增請用右邊表單）",
                                       font=(FONT, 12, "bold"), bg=BG_PANEL, fg=TEXT_DARK)
        preview_frame.pack(fill="both", expand=True)

        preview_columns = ("date", "item", "quantity", "unit_price", "return_quantity", "subtotal", "total")
        self.manual_preview_tree = ttk.Treeview(preview_frame, columns=preview_columns, show="headings")
        for col, label, width in [("date", "貨單日期", 90), ("item", "貨單名稱", 130),
                                   ("quantity", "數量", 70), ("unit_price", "單價", 70),
                                   ("return_quantity", "退貨 元", 70), ("subtotal", "合計", 90),
                                   ("total", "總計金額", 90)]:
            self.manual_preview_tree.heading(col, text=label)
            self.manual_preview_tree.column(col, width=width, anchor="w")
        self.manual_preview_tree.pack(fill="both", expand=True, padx=10, pady=(8, 4))

        preview_btn_row = tk.Frame(preview_frame, bg=BG_PANEL)
        preview_btn_row.pack(fill="x", padx=10, pady=(0, 10))
        make_button(preview_btn_row, "🗑 刪除選取列", self._delete_selected_manual_preview_rows,
                    bg=COLOR_DANGER).pack(side="left")

        entry_frame = tk.LabelFrame(right_col, text="新增品項（多選後統一加入，數量／單價到下面表格填）",
                                     font=(FONT, 12, "bold"), bg=BG_PANEL, fg=TEXT_DARK)
        entry_frame.pack(fill="x", padx=12, pady=(0, 8))

        date_row = tk.Frame(entry_frame, bg=BG_PANEL)
        date_row.pack(fill="x", padx=10, pady=(8, 4))
        tk.Label(date_row, text="貨單日期（這批要加入的品項都算這一天）：", bg=BG_PANEL).pack(side="left")
        self.manual_date_var = tk.StringVar()
        self.manual_date_combo = ttk.Combobox(date_row, textvariable=self.manual_date_var, width=14)
        self.manual_date_combo.pack(side="left", padx=4)

        select_row = tk.Frame(entry_frame, bg=BG_PANEL)
        select_row.pack(fill="x", padx=10)
        make_button(select_row, "全選", self._select_all_manual_items, bg=BTN_NEUTRAL, font_size=9).pack(side="left")
        make_button(select_row, "取消全選", self._deselect_all_manual_items, bg=BTN_NEUTRAL, font_size=9).pack(
            side="left", padx=6)

        checklist_container = tk.Frame(entry_frame, bg=BG_PANEL)
        checklist_container.pack(fill="x", padx=10, pady=4)
        checklist_canvas = tk.Canvas(checklist_container, bg=BG_PANEL, height=150, highlightthickness=0)
        checklist_scrollbar = ttk.Scrollbar(checklist_container, orient="vertical", command=checklist_canvas.yview)
        self.manual_item_checks_frame = tk.Frame(checklist_canvas, bg=BG_PANEL)
        self.manual_item_checks_frame.bind(
            "<Configure>", lambda _e: checklist_canvas.configure(scrollregion=checklist_canvas.bbox("all")))
        checklist_canvas.create_window((0, 0), window=self.manual_item_checks_frame, anchor="nw")
        checklist_canvas.configure(yscrollcommand=checklist_scrollbar.set)
        checklist_canvas.pack(side="left", fill="x", expand=True)
        checklist_scrollbar.pack(side="right", fill="y")
        self._manual_item_check_vars: dict[str, tk.BooleanVar] = {}

        def _on_wheel(evt):
            checklist_canvas.yview_scroll(int(-1 * (evt.delta / 120)), "units")

        def _restore_outer_wheel(_evt):
            # 離開這個小清單時，把滾輪還給外層整頁的捲動（見
            # _build_scrollable_tab），而不是整個解除掉，不然滑到清單上
            # 之後，這一頁其他地方（含下面的按鈕）就再也滾不動了。
            checklist_canvas.unbind_all("<MouseWheel>")
            outer_wheel = getattr(self, "_manual_tab_wheel", None)
            if outer_wheel is not None:
                checklist_canvas.bind_all("<MouseWheel>", outer_wheel)
        # 這個清單是內嵌在分頁裡（不是彈出視窗），滑鼠滾輪不能整個綁死，
        # 只在游標『真的在這個小清單上面』時才暫時接管滾輪，移出去就還給
        # 其他元件（例如下面的待加入清單表格）。
        checklist_canvas.bind("<Enter>", lambda _e: checklist_canvas.bind_all("<MouseWheel>", _on_wheel))
        checklist_canvas.bind("<Leave>", _restore_outer_wheel)

        add_new_row = tk.Frame(entry_frame, bg=BG_PANEL)
        add_new_row.pack(fill="x", padx=10, pady=(0, 4))
        tk.Label(add_new_row, text="清單沒有想要的品項？新增：", bg=BG_PANEL).pack(side="left")
        self.manual_new_item_var = tk.StringVar()
        ttk.Entry(add_new_row, textvariable=self.manual_new_item_var, width=16).pack(side="left", padx=4)
        make_button(add_new_row, "新增並勾選", self._add_new_manual_item_choice, bg=BTN_NEUTRAL, font_size=9).pack(
            side="left")

        add_checked_row = tk.Frame(entry_frame, bg=BG_PANEL)
        add_checked_row.pack(fill="x", padx=10, pady=(4, 10))
        make_button(add_checked_row, "➕ 加入勾選項目到下面清單", self._add_checked_manual_items,
                    bg=ACCENT_MANUAL, font_size=11).pack(fill="x", expand=True, ipady=4)

        list_frame = tk.LabelFrame(right_col, text="本次待加入清單（雙擊數量／單價／退貨儲存格可直接填）",
                                    font=(FONT, 12, "bold"), bg=BG_PANEL, fg=TEXT_DARK)
        list_frame.pack(fill="both", expand=True, padx=12, pady=(0, 8))

        columns = ("date", "item", "quantity", "unit_price", "return_quantity")
        self.manual_tree = ttk.Treeview(list_frame, columns=columns, show="headings", height=8)
        for col, label, width in [("date", "貨單日期", 100), ("item", "貨單名稱", 140),
                                   ("quantity", "數量", 80), ("unit_price", "單價", 80),
                                   ("return_quantity", "退貨 元", 80)]:
            self.manual_tree.heading(col, text=label)
            self.manual_tree.column(col, width=width, anchor="w")
        # 沒填的數量／單價儲存格用蓋在上面的小 Label 個別標黃（見
        # _draw_manual_cell_markers），不是整列上色——ttk.Treeview 本身只能
        # 整列套色，做不到只標一個儲存格。
        self.manual_tree.pack(fill="both", expand=True, padx=10, pady=(8, 4))
        self.manual_tree.bind("<Double-1>", self._on_manual_tree_double_click)
        self.manual_tree.bind("<Configure>", lambda _e: self._draw_manual_cell_markers())

        list_btn_row = tk.Frame(list_frame, bg=BG_PANEL)
        list_btn_row.pack(fill="x", padx=10, pady=(0, 10))
        make_button(list_btn_row, "🗑 移除選取列", self._remove_manual_row, bg=COLOR_DANGER).pack(side="left")
        make_button(list_btn_row, "✅ 產生操作計畫（前往③確認寫入）", self._generate_manual_plan,
                    bg=ACCENT_MANUAL, font_size=11).pack(side="right")

    def _refresh_manual_customers(self, _evt=None):
        customers = self._known_customers_on_sheet()
        self.manual_customer_combo.config(values=customers)
        if self.manual_customer_var.get() not in customers:
            self.manual_customer_var.set("")
            self._manual_handler = None
            self.manual_date_combo.config(values=[])
            self._rebuild_manual_item_checklist()

        if self.manual_rows:
            return  # 填到一半，不要自動切換客戶把清單弄丟

        # 自動猜客戶：優先看使用者目前在 Excel 選取的儲存格屬於哪個客戶對帳表，
        # 猜不到才退而求其次用上次記住的客戶；都猜不到就維持空白，不硬選。
        suggested = self._detect_customer_from_active_cell()
        if suggested not in customers:
            suggested = None
        if suggested is None:
            saved = S.load_user_settings().get("last_manual_customer")
            if saved in customers:
                suggested = saved

        if suggested and suggested != self.manual_customer_var.get():
            self.manual_customer_var.set(suggested)
            self._on_manual_customer_selected()

    def _detect_customer_from_active_cell(self) -> str | None:
        """猜使用者目前在 Excel 選的儲存格屬於哪個客戶對帳表，猜不到（包含
        COM 讀取失敗、選到還沒掃描過的 Sheet、座標不在任何客戶對帳表 Region
        內）一律回傳 None，靜默略過，這只是體驗優化，不是關鍵路徑。"""
        if self.current_grid is None:
            return None
        try:
            info = self.excel.get_active_cell()
        except Exception:
            return None
        if info["sheet"] != self.current_grid.sheet_name:
            return None
        for region in self.current_regions:
            structure, classification = self.region_analysis.get(region.region_id, (None, None))
            if not structure or not classification:
                continue
            if classification.report_type != S.REPORT_CUSTOMER_STATEMENT:
                continue
            if region.top <= info["row"] <= region.bottom and region.left <= info["col"] <= region.right:
                return extract_region_customer_name(region, self.current_grid, structure.header_row)
        return None

    def _today_in_sheet_style(self) -> str:
        """新增資料通常就是今天送出的貨單，日期欄先幫忙帶入今天，依這張表
        既有的日期樣式格式化（例如轉成 115.8.20），使用者仍可自行覆蓋。"""
        today_iso = date.today().isoformat()
        if self._manual_handler is None:
            return today_iso
        sample = self._manual_handler.sample_date_text()
        return format_date_like(today_iso, sample) if sample else today_iso

    def _find_customer_statement_region(self, customer_name: str):
        for region in self.current_regions:
            structure, classification = self.region_analysis.get(region.region_id, (None, None))
            if not structure or not classification:
                continue
            if classification.report_type != S.REPORT_CUSTOMER_STATEMENT:
                continue
            if extract_region_customer_name(region, self.current_grid, structure.header_row) == customer_name:
                return region, structure
        return None, None

    def _on_manual_customer_selected(self, _evt=None):
        customer = self.manual_customer_var.get()
        if self.manual_rows and self._manual_handler is not None:
            if not messagebox.askyesno("切換客戶", "目前待加入清單裡還有尚未寫入的資料，切換客戶會清空這份清單，確定繼續？"):
                return

        region, structure = self._find_customer_statement_region(customer)
        if region is None:
            messagebox.showwarning("半人工輸入", f"在目前這張 Sheet 找不到客戶『{customer}』的客戶對帳表。")
            self._manual_handler = None
            self._refresh_manual_preview()
            return

        try:
            self._manual_handler = CustomerStatementHandler(self.excel, self.current_grid, region, structure)
        except HandlerError as e:
            messagebox.showwarning("半人工輸入", str(e))
            self._manual_handler = None
            self._refresh_manual_preview()
            return

        self.manual_rows = []
        self._refresh_manual_tree()
        self.manual_date_combo.config(values=list_known_dates(structure, self.current_grid))
        self.manual_date_var.set(self._today_in_sheet_style())
        self._rebuild_manual_item_checklist()

        self._merge_save_user_settings({"last_manual_customer": customer})

        if self._manual_handler.return_col is None:
            self.manual_return_hint_var.set("此表沒有『退貨』欄位，新增資料不會有退貨（填了也不會生效）。")
        else:
            self.manual_return_hint_var.set("")

        self._refresh_manual_preview()

    def _refresh_manual_preview(self):
        for row in self.manual_preview_tree.get_children():
            self.manual_preview_tree.delete(row)
        if self._manual_handler is None:
            return
        for r in self._manual_handler.list_rows_for_preview():
            self.manual_preview_tree.insert("", "end", iid=str(r["row"]), values=(
                r["date"], r["item"], r["quantity"], r["unit_price"],
                r["return_quantity"] if r["return_quantity"] is not None else "",
                r["subtotal"] if r["subtotal"] is not None else "",
                r["total"] if r["total"] is not None else "",
            ))

    def _resync_manual_handler(self):
        """切回④分頁、或這裡剛執行完刪除之後呼叫：用最新掃描到的 Excel
        狀態重新對齊目前選定客戶的 handler（列號可能已經變動），但**不**
        清空『本次待加入清單』——那是使用者還沒送出的新資料，不該被
        單純的畫面刷新動作清掉。"""
        customer = self.manual_customer_var.get()
        if not customer:
            return
        region, structure = self._find_customer_statement_region(customer)
        if region is None:
            self._manual_handler = None
            self._refresh_manual_preview()
            return
        try:
            self._manual_handler = CustomerStatementHandler(self.excel, self.current_grid, region, structure)
        except HandlerError:
            self._manual_handler = None
        self._refresh_manual_preview()

    def _delete_selected_manual_preview_rows(self):
        if self._manual_handler is None:
            messagebox.showwarning("刪除資料", "請先選擇客戶。")
            return
        sel = self.manual_preview_tree.selection()
        if not sel:
            messagebox.showwarning("刪除資料", "請先在上面的表格選取要刪除的列（可用 Ctrl/Shift 多選）。")
            return

        rows = sorted(int(iid) for iid in sel)
        detail_lines = "\n".join(
            f"　{v[0]}　{v[1]}　數量 {v[2]}"
            for v in (self.manual_preview_tree.item(iid, "values") for iid in sel)
        )
        if not messagebox.askyesno(
            "刪除資料",
            f"確定要從 Excel 永久刪除這 {len(rows)} 筆資料嗎？\n\n{detail_lines}\n\n"
            f"這個動作會直接修改 Excel 內容，無法自動復原（成功後會自動儲存到檔案）"
            f"（操作紀錄會留在 operation_log.json，但不會自動救回，請先確認沒有選錯）。",
        ):
            return

        self._status(f"⏳ 正在刪除 {len(rows)} 筆並寫回 Excel...")
        self.update_idletasks()

        result = self._manual_handler.delete_rows(rows)
        if not result.success:
            messagebox.showerror("刪除失敗", result.message)
            self._status("刪除失敗", "error")
            return

        try:
            self._status("⏳ 正在儲存 Excel...")
            self.update_idletasks()
            self.excel.save()
            self._status(f"{result.message}（已儲存）", "success")
            messagebox.showinfo("刪除完成", f"{result.message}\n已自動儲存到檔案。")
        except Exception as e:  # noqa: BLE001 - 需求 #50
            self._status(f"{result.message}（自動儲存失敗）", "warning")
            messagebox.showwarning(
                "自動儲存失敗",
                f"{result.message}\n但自動儲存到檔案時發生錯誤：\n{e}\n\n請手動按左下角「💾 儲存 Excel」。",
            )

        self.scan_current_sheet()
        self._resync_manual_handler()

    def _rebuild_manual_item_checklist(self):
        for w in self.manual_item_checks_frame.winfo_children():
            w.destroy()
        self._manual_item_check_vars = {}
        if self._manual_handler is None:
            return
        region_items = list_known_items(self._manual_handler.structure, self.current_grid)
        for name in item_catalog.merge_items(region_items, self.item_catalog):
            var = tk.BooleanVar(value=False)
            self._manual_item_check_vars[name] = var
            tk.Checkbutton(self.manual_item_checks_frame, text=name, variable=var, bg=BG_PANEL,
                            anchor="w").pack(fill="x", padx=4, pady=1)

    def _select_all_manual_items(self):
        for var in self._manual_item_check_vars.values():
            var.set(True)

    def _deselect_all_manual_items(self):
        for var in self._manual_item_check_vars.values():
            var.set(False)

    def _add_new_manual_item_choice(self):
        """在勾選清單裡快速新增一個目前沒有的品名並直接勾選——跟品名清單
        管理對話框、④分頁新增資料共用同一套 item_catalog 去重規則。"""
        text = self.manual_new_item_var.get().strip()
        if not text:
            return
        if not any(normalize_header_text(i) == normalize_header_text(text) for i in self.item_catalog):
            self.item_catalog = item_catalog.merge_items(self.item_catalog, [text])
            item_catalog.save_items(self.item_catalog)
        self.manual_new_item_var.set("")
        self._rebuild_manual_item_checklist()
        for name, var in self._manual_item_check_vars.items():
            if normalize_header_text(name) == normalize_header_text(text):
                var.set(True)
                break

    def _add_checked_manual_items(self):
        """把目前勾選的品項一次加進『本次待加入清單』。單價能查到就先帶，
        查不到留空；數量固定留空，這是使用者一定要自己在下面表格填的。"""
        if self._manual_handler is None:
            messagebox.showwarning("半人工輸入", "請先選擇客戶。")
            return
        date_text = self.manual_date_var.get().strip()
        if not date_text:
            messagebox.showwarning("半人工輸入", "請輸入或選擇貨單日期。")
            return
        checked = [name for name, var in self._manual_item_check_vars.items() if var.get()]
        if not checked:
            messagebox.showwarning("半人工輸入", "請至少勾選一個品項。")
            return

        for item in checked:
            unit_price = self._manual_handler.lookup_unit_price(item, self.current_regions)
            self.manual_rows.append({
                "date": date_text, "item": item, "quantity": None,
                "unit_price": unit_price, "return_quantity": 0,
            })
        self._refresh_manual_tree()
        self._deselect_all_manual_items()
        self._status(f"已加入 {len(checked)} 個品項，請在下面表格雙擊儲存格填入數量／確認單價", "success")

    def _refresh_manual_tree(self):
        self._clear_manual_cell_markers()
        for row in self.manual_tree.get_children():
            self.manual_tree.delete(row)
        for r in self.manual_rows:
            self.manual_tree.insert("", "end", values=(
                r["date"], r["item"],
                r["quantity"] if r["quantity"] is not None else "",
                r["unit_price"] if r["unit_price"] is not None else "",
                r["return_quantity"] if r["return_quantity"] is not None else "",
            ))
        self.manual_tree.update_idletasks()
        self._draw_manual_cell_markers()

    _MANUAL_TREE_EDITABLE_COLS = ("quantity", "unit_price", "return_quantity")
    _MANUAL_TREE_COL_LABELS = {"quantity": "數量", "unit_price": "單價", "return_quantity": "退貨"}
    # 這兩欄新加進清單時常常是空的（數量要人工填、單價查不到目錄價才會是
    # None），需要提醒使用者去填；退貨預設就有值（0），不用標。
    _MANUAL_MARK_NEEDED_COLS = ("quantity", "unit_price")

    def _clear_manual_cell_markers(self):
        for marker in self._manual_cell_markers.values():
            marker.destroy()
        self._manual_cell_markers = {}

    def _draw_manual_cell_markers(self):
        children = self.manual_tree.get_children()
        for idx, r in enumerate(self.manual_rows):
            if idx >= len(children):
                break
            row_iid = children[idx]
            for col_name in self._MANUAL_MARK_NEEDED_COLS:
                key = (row_iid, col_name)
                if r[col_name] is not None:
                    if key in self._manual_cell_markers:
                        self._manual_cell_markers.pop(key).destroy()
                    continue
                if key not in self._manual_cell_markers:
                    self._place_manual_cell_marker(row_iid, col_name)

    def _place_manual_cell_marker(self, row_iid: str, col_name: str):
        col_index = ("date", "item", "quantity", "unit_price", "return_quantity").index(col_name)
        col_id = f"#{col_index + 1}"
        bbox = self.manual_tree.bbox(row_iid, col_id)
        if not bbox:
            return  # 該列目前捲動到看不見，先不畫；下次刷新／捲動時會再補畫
        x, y, width, height = bbox
        marker = tk.Label(self.manual_tree, text="請雙擊輸入", bg="#fef3c7", fg="#92400e",
                           font=(FONT, 9), anchor="w")
        marker.place(x=x, y=y, width=width, height=height)
        marker.bind("<Double-1>", lambda _e, iid=row_iid, col=col_name: self._start_edit_manual_cell(iid, col))
        self._manual_cell_markers[(row_iid, col_name)] = marker

    def _on_manual_tree_double_click(self, event):
        if self.manual_tree.identify("region", event.x, event.y) != "cell":
            return
        row_iid = self.manual_tree.identify_row(event.y)
        col_id = self.manual_tree.identify_column(event.x)
        if not row_iid or not col_id:
            return
        columns = ("date", "item", "quantity", "unit_price", "return_quantity")
        col_name = columns[int(col_id.replace("#", "")) - 1]
        if col_name not in self._MANUAL_TREE_EDITABLE_COLS:
            return
        self._start_edit_manual_cell(row_iid, col_name)

    def _start_edit_manual_cell(self, row_iid: str, col_name: str):
        col_index = ("date", "item", "quantity", "unit_price", "return_quantity").index(col_name)
        col_id = f"#{col_index + 1}"
        self.manual_tree.see(row_iid)
        bbox = self.manual_tree.bbox(row_iid, col_id)
        if not bbox:
            return
        x, y, width, height = bbox

        marker = self._manual_cell_markers.pop((row_iid, col_name), None)
        if marker is not None:
            marker.destroy()

        current = self.manual_tree.set(row_iid, col_name)
        var = tk.StringVar(value=current)
        editor = ttk.Entry(self.manual_tree, textvariable=var)
        editor.place(x=x, y=y, width=width, height=height)
        editor.focus_set()
        editor.select_range(0, "end")

        state = {"committed": False}

        def commit(advance: bool):
            if state["committed"]:
                return
            text = var.get().strip()
            label = self._MANUAL_TREE_COL_LABELS[col_name]
            try:
                if col_name == "quantity":
                    value = int(text)
                    if value <= 0:
                        raise ValueError
                elif col_name == "unit_price":
                    value = float(text)
                    if value < 0:
                        raise ValueError
                    if value.is_integer():
                        value = int(value)
                else:  # return_quantity
                    value = int(text) if text else 0
                    if value < 0:
                        raise ValueError
            except ValueError:
                messagebox.showwarning("半人工輸入", f"「{label}」的值不正確：{text!r}")
                return

            state["committed"] = True
            idx = self.manual_tree.index(row_iid)
            self.manual_rows[idx][col_name] = value
            self._refresh_manual_tree()
            editor.destroy()
            if advance:
                self._advance_manual_cell_edit(idx, col_name)

        def on_return(_evt):
            commit(advance=True)
            return "break"

        def on_focus_out(_evt):
            commit(advance=False)

        def on_escape(_evt):
            state["committed"] = True
            editor.destroy()
            idx = self.manual_tree.index(row_iid)
            if self.manual_rows[idx][col_name] is None:
                self._place_manual_cell_marker(row_iid, col_name)

        editor.bind("<Return>", on_return)
        editor.bind("<FocusOut>", on_focus_out)
        editor.bind("<Escape>", on_escape)

    def _advance_manual_cell_edit(self, row_idx: int, col_name: str):
        cols = self._MANUAL_TREE_EDITABLE_COLS
        pos = cols.index(col_name)
        if pos + 1 < len(cols):
            next_row_idx, next_col = row_idx, cols[pos + 1]
        elif row_idx + 1 < len(self.manual_rows):
            next_row_idx, next_col = row_idx + 1, cols[0]
        else:
            return
        children = self.manual_tree.get_children()
        if next_row_idx >= len(children):
            return
        self._start_edit_manual_cell(children[next_row_idx], next_col)

    def _remove_manual_row(self):
        sel = self.manual_tree.selection()
        if not sel:
            messagebox.showwarning("半人工輸入", "請先在下面的清單選取要移除的列（可用 Ctrl/Shift 多選）。")
            return
        indices = sorted((self.manual_tree.index(iid) for iid in sel), reverse=True)
        for idx in indices:
            del self.manual_rows[idx]
        self._refresh_manual_tree()
        self._status(f"已從待加入清單移除 {len(indices)} 筆（尚未寫入 Excel）", "success")

    def _generate_manual_plan(self):
        if not self.manual_rows:
            messagebox.showwarning("半人工輸入", "目前待加入清單是空的，請先加入至少一筆。")
            return

        incomplete = [
            r for r in self.manual_rows
            if not isinstance(r["quantity"], int) or r["quantity"] <= 0
            or not isinstance(r["unit_price"], (int, float)) or r["unit_price"] < 0
        ]
        if incomplete:
            lines = "\n".join(f"　{r['date']}　{r['item']}" for r in incomplete[:10])
            more = "\n…" if len(incomplete) > 10 else ""
            messagebox.showwarning(
                "半人工輸入",
                f"以下 {len(incomplete)} 筆還沒填好數量／單價，請在表格裡雙擊儲存格填入後再產生操作計畫：\n"
                f"{lines}{more}",
            )
            return

        self._status("⏳ 正在產生操作計畫...")
        self.update_idletasks()

        customer = self.manual_customer_var.get()
        groups: dict[str, list[dict]] = {}
        for r in self.manual_rows:
            groups.setdefault(r["date"], []).append(r)

        plans = []
        for date_text, rows in groups.items():
            entries = [
                {"item": r["item"], "quantity": r["quantity"], "unit_price": r["unit_price"],
                 "return_quantity": r["return_quantity"]}
                for r in rows
            ]
            plans.append(OperationPlan(
                report_type=S.REPORT_CUSTOMER_STATEMENT,
                action="import_from_image",
                customer=customer,
                data={"date": date_text, "entries": entries},
                explanation=f"半人工輸入：{customer} {date_text} 新增 {len(entries)} 筆品項",
                source="manual",
            ))

        self.manual_rows = []
        self._refresh_manual_tree()

        self.pending_items = []
        self.execute_btn.config(state="disabled")
        self.preview.delete("1.0", "end")
        self.notebook.select(self._tab_ai_index)
        # 結果確認交給 _handle_batch_result 統一處理（它會依成功/部分成功/
        # 全部失敗設定正確的狀態列文字與③分頁的 banner，這裡不要再蓋一次，
        # 不然全部失敗時反而會顯示成功訊息）。
        self._handle_batch_result(plans)

    # ------------------------------------------------------------------
    # 品名清單管理（掃描整個活頁簿 / 多選刪除 / 新增，見 item_catalog.py）
    # ------------------------------------------------------------------

    def _scan_workbook_items(self) -> list[str]:
        """掃描目前連接的活頁簿裡『所有 Sheet』的客戶對帳表 Region，彙整貨單
        名稱，依跨活頁簿總出現次數由多到少排序回傳。只讀取，不寫入任何東西
        （寫進 item_catalog.json 是呼叫端的事）。單一 Sheet／Region 讀取或
        分析失敗就跳過，不讓一個壞掉的 Sheet 擋住整個掃描。"""
        counts: dict[str, int] = {}
        order: list[str] = []

        try:
            sheet_names = self.excel.list_sheets()
        except Exception as e:  # noqa: BLE001
            messagebox.showerror("掃描整個活頁簿", f"讀取 Sheet 清單失敗：{e}")
            return []

        for sheet_name in sheet_names:
            try:
                grid = self.excel.read_sheet_grid(sheet_name)
                regions = detect_regions(grid)
            except Exception:
                continue
            for region in regions:
                if region.kind != "table" or not region.header_row:
                    continue
                try:
                    structure = analyze_region(region, grid, regions)
                    classification = classify_structure(structure, grid)
                except Exception:
                    continue
                if classification.report_type != S.REPORT_CUSTOMER_STATEMENT:
                    continue
                for item in list_known_items(structure, grid):
                    key = normalize_header_text(item)
                    if key not in counts:
                        order.append(item)
                    counts[key] = counts.get(key, 0) + 1

        return sorted(order, key=lambda t: -counts[normalize_header_text(t)])

    def open_item_catalog_manager(self):
        dlg = tk.Toplevel(self)
        dlg.title("品名清單管理")
        dlg.geometry("480x560")
        dlg.configure(bg=BG_PANEL)
        dlg.transient(self)
        dlg.grab_set()

        top = tk.Frame(dlg, bg=BG_PANEL)
        top.pack(fill="x", padx=10, pady=10)
        scan_btn = make_button(top, "🔍 掃描整個活頁簿品名", None, bg=ACCENT_MANUAL)
        scan_btn.pack(side="left")

        select_row = tk.Frame(dlg, bg=BG_PANEL)
        select_row.pack(fill="x", padx=10)
        select_all_btn = make_button(select_row, "全選", None, bg=BTN_NEUTRAL, font_size=9)
        select_all_btn.pack(side="left")
        deselect_all_btn = make_button(select_row, "取消全選", None, bg=BTN_NEUTRAL, font_size=9)
        deselect_all_btn.pack(side="left", padx=6)

        list_container = tk.Frame(dlg, bg=BG_PANEL)
        list_container.pack(fill="both", expand=True, padx=10, pady=6)
        canvas = tk.Canvas(list_container, bg=BG_PANEL, highlightthickness=0)
        scrollbar = ttk.Scrollbar(list_container, orient="vertical", command=canvas.yview)
        checks_frame = tk.Frame(canvas, bg=BG_PANEL)
        checks_frame.bind("<Configure>", lambda _e: canvas.configure(scrollregion=canvas.bbox("all")))
        canvas.create_window((0, 0), window=checks_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        def _on_wheel(evt):
            canvas.yview_scroll(int(-1 * (evt.delta / 120)), "units")
        canvas.bind_all("<MouseWheel>", _on_wheel)
        dlg.bind("<Destroy>", lambda _e: canvas.unbind_all("<MouseWheel>"))

        check_vars: dict[str, tk.BooleanVar] = {}

        def _rebuild_checklist():
            for w in checks_frame.winfo_children():
                w.destroy()
            check_vars.clear()
            for name in self.item_catalog:
                var = tk.BooleanVar(value=False)
                check_vars[name] = var
                tk.Checkbutton(checks_frame, text=name, variable=var, bg=BG_PANEL,
                                anchor="w").pack(fill="x", padx=4, pady=1)

        def _select_all():
            for var in check_vars.values():
                var.set(True)

        def _deselect_all():
            for var in check_vars.values():
                var.set(False)

        def _do_scan():
            scan_btn.config(state="disabled", text="⏳ 掃描中...")
            dlg.update_idletasks()
            try:
                found = self._scan_workbook_items()
            finally:
                scan_btn.config(state="normal", text="🔍 掃描整個活頁簿品名")
            before = len(self.item_catalog)
            self.item_catalog = item_catalog.merge_items(self.item_catalog, found)
            item_catalog.save_items(self.item_catalog)
            added = len(self.item_catalog) - before
            _rebuild_checklist()
            self._refresh_manual_item_dropdown()
            messagebox.showinfo("掃描整個活頁簿", f"掃描到 {len(found)} 個品名，新增 {added} 個到品名清單。", parent=dlg)

        scan_btn.config(command=_do_scan)
        select_all_btn.config(command=_select_all)
        deselect_all_btn.config(command=_deselect_all)

        add_row = tk.Frame(dlg, bg=BG_PANEL)
        add_row.pack(fill="x", padx=10, pady=(0, 6))
        tk.Label(add_row, text="➕ 新增品名：", bg=BG_PANEL).pack(side="left")
        new_item_var = tk.StringVar()
        ttk.Entry(add_row, textvariable=new_item_var, width=20).pack(side="left", padx=4)

        def _add_new():
            text = new_item_var.get().strip()
            if not text:
                return
            before = len(self.item_catalog)
            self.item_catalog = item_catalog.merge_items(self.item_catalog, [text])
            if len(self.item_catalog) == before:
                self._status(f"『{text}』已存在於品名清單，未重複新增", "warning")
            else:
                item_catalog.save_items(self.item_catalog)
                _rebuild_checklist()
                self._refresh_manual_item_dropdown()
                self._status(f"已新增品名『{text}』", "success")
            new_item_var.set("")

        make_button(add_row, "新增", _add_new, bg=ACCENT_MANUAL, font_size=9).pack(side="left")

        def _delete_checked():
            to_delete = {name for name, var in check_vars.items() if var.get()}
            if not to_delete:
                messagebox.showwarning("刪除已勾選", "請先勾選要刪除的品名。", parent=dlg)
                return
            if not messagebox.askyesno(
                "刪除已勾選",
                f"確定要從『品名清單』移除這 {len(to_delete)} 個品名嗎？\n\n"
                f"這只會影響下拉選單用的品名清單，不會動到 Excel 裡任何一筆資料。",
                parent=dlg,
            ):
                return
            self.item_catalog = [n for n in self.item_catalog if n not in to_delete]
            item_catalog.save_items(self.item_catalog)
            _rebuild_checklist()
            self._refresh_manual_item_dropdown()
            self._status(f"已刪除 {len(to_delete)} 個品名（僅品名清單，Excel 資料未變動）", "success")

        bottom = tk.Frame(dlg, bg=BG_PANEL)
        bottom.pack(fill="x", padx=10, pady=10)
        make_button(bottom, "🗑 刪除已勾選", _delete_checked, bg=COLOR_DANGER).pack(side="left")
        make_button(bottom, "關閉", dlg.destroy, bg=BTN_NEUTRAL).pack(side="right")

        _rebuild_checklist()

    def _refresh_manual_item_dropdown(self):
        """品名清單有異動時，同步刷新④分頁目前顯示的品項勾選清單。"""
        self._rebuild_manual_item_checklist()

    # ------------------------------------------------------------------
    # 常駐底部列
    # ------------------------------------------------------------------

    def _build_bottom_bar(self):
        frame = tk.Frame(self, bg=BG_APP)
        # side="bottom"：不管上面的分頁內容多高，這條列永遠釘在視窗最下面，
        # 不會被撐爆版面擠到看不見（④分頁內容長，這條是常駐的存檔按鈕）。
        frame.pack(side="bottom", fill="x", padx=10, pady=8)

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

        if not messagebox.askyesno(
            "確認執行",
            f"{confirm_text}\n\n這會真正修改目前 Excel，驗證通過後會自動儲存到檔案，確定繼續？",
        ):
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
                self._set_plan_banner("⏳ 已成功寫入並驗證通過，正在儲存 Excel...", COLOR_INFO)
                self.update_idletasks()
                try:
                    self.excel.save()
                    self._status("執行、驗證、儲存皆成功", "success")
                    self._set_plan_banner("✅ 已成功寫入、驗證通過，並已儲存至 Excel 檔案", COLOR_SUCCESS)
                    messagebox.showinfo("完成", "已成功寫入 Excel、驗證通過，並已自動儲存到檔案。")
                except Exception as e:  # noqa: BLE001 - 需求 #50
                    self._status("已寫入但自動儲存失敗", "warning")
                    self._set_plan_banner("🟡 已寫入並驗證通過，但自動儲存失敗，請手動按左下角「💾 儲存 Excel」", COLOR_WARNING)
                    messagebox.showwarning(
                        "自動儲存失敗",
                        f"資料已寫入並驗證通過，但自動儲存到檔案時發生錯誤：\n{e}\n\n"
                        f"請手動按左下角「💾 儲存 Excel」。",
                    )

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


def _make_process_dpi_aware():
    """在建立 Tk 視窗之前先告訴 Windows 這個程式自己會處理 DPI 縮放。

    沒宣告的話，開了顯示器縮放（例如筆電常見的 125%/150%）時 Windows 會
    整個視窗點陣圖硬拉伸來顯示，但不會告訴 Tk 這件事——結果滑鼠點擊座標
    跟 Tk 認知的元件座標對不起來（雙擊儲存格『完全沒反應』，其實是
    identify_row/identify_column/bbox 對到了錯的座標，靜靜地提早 return），
    視窗實際需要的高度也會超出螢幕，把下面的按鈕擠到看不到的地方。"""
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # PROCESS_SYSTEM_DPI_AWARE
    except (AttributeError, OSError):
        try:
            ctypes.windll.user32.SetProcessDPIAware()  # Windows Vista/7 相容
        except (AttributeError, OSError):
            pass


def main():
    _make_process_dpi_aware()
    pythoncom.CoInitialize()
    try:
        app = ExcelAIApp()
        app.mainloop()
    finally:
        pythoncom.CoUninitialize()


if __name__ == "__main__":
    main()
