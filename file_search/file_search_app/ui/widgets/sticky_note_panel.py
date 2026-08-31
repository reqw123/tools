"""左側常駐便利貼面板——顯示彩色小卡片清單（依標籤自動配色），提供關鍵字＋
標籤篩選、AI 自然語言搜尋、單擊複製、右鍵選單編輯／刪除，頂端「➕新增」
「📤匯出」「🗑️批次刪除」按鈕跟空白處右鍵「新增便利貼」。面板本身只管畫面與
使用者互動，資料的存取／篩選／配色規則都委派給建構子注入的
StickyNoteService，不在這裡碰 JSON 或檔案路徑；呼叫 AI 的設定/連線邏輯則
委派給建構子注入的 AIDescriptionService（跟「AI 批次說明」共用同一套設定，
不用另外設定一次）。

展開/收合、寬度調整都由 MainWindow 統一管理（跟 PreviewPanel 同一套模式）：
這裡只提供 `.frame`（給 MainWindow pack/pack_forget）跟 `.resize(width)`，
收合按鈕透過建構子傳入的 `on_collapse` 回呼，實際切換交還給呼叫端。"""

import queue
import threading
import tkinter as tk
from datetime import datetime
from tkinter import filedialog, font as tkfont, messagebox, ttk

from file_search_app.ai.base import AIProviderError
from file_search_app.config import (
    BTN_BLUE_ACTIVE, BTN_BLUE_BG, BTN_DANGER_ACTIVE, BTN_DANGER_BG, BTN_INDIGO_ACTIVE,
    BTN_INDIGO_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, BTN_TEAL_ACTIVE, BTN_TEAL_BG,
    COLOR_PREVIEW_BG, COLOR_PREVIEW_BORDER, COLOR_STATUS_FG, FONT_FAMILY,
    STICKY_AI_SEARCH_LARGE_NOTE_COUNT, STICKY_CARD_BORDER_DARKEN, STICKY_CARD_FOLD_DARKEN,
    STICKY_CARD_FOLD_SIZE, STICKY_CARD_HOVER_DARKEN, STICKY_CARD_TEXT_COLOR,
    STICKY_FILTER_BOX_BG, STICKY_FILTER_BOX_BORDER, STICKY_FILTER_BOX_FG,
    STICKY_ICON_BUTTON_SIZE, STICKY_TOAST_BG, STICKY_TOAST_FG, STICKY_TOGGLE_SHORTCUT,
    STICKY_TOOLTIP_BG, STICKY_TOOLTIP_FG,
)
from file_search_app.platform import file_actions
from file_search_app.ui.dialogs.ai_confirm_dialog import ask_ai_confirm
from file_search_app.ui.dialogs.sticky_note_bulk_delete_dialog import StickyNoteBulkDeleteDialog
from file_search_app.ui.dialogs.sticky_note_dialog import StickyNoteDialog
from file_search_app.ui.styles import bind_wheel_recursive, darken, styled_button

_ALL_TAGS_LABEL = "全部標籤"


class _Tooltip:
    """滑鼠移到圖示按鈕（➕／◀）上方短暫顯示的文字說明——這兩顆按鈕只有圖示
    沒有文字，不是每個人都看得出「➕」是新增而不是其他動作，補一個 tooltip
    比硬把按鈕改成有文字更省面板寬度。用 overrideredirect 的小 Toplevel 實作，
    是 Tk 沒有內建 tooltip 元件時最通用的做法。"""

    def __init__(self, widget, text, font):
        self._widget = widget
        self._text = text
        self._font = font
        self._tip = None
        widget.bind("<Enter>", self._show, add="+")
        widget.bind("<Leave>", self._hide, add="+")
        widget.bind("<ButtonPress>", self._hide, add="+")

    def _show(self, _event=None):
        if self._tip is not None or not self._widget.winfo_ismapped():
            return
        x = self._widget.winfo_rootx() + self._widget.winfo_width() // 2
        y = self._widget.winfo_rooty() + self._widget.winfo_height() + 4
        self._tip = tk.Toplevel(self._widget)
        self._tip.wm_overrideredirect(True)
        self._tip.wm_geometry(f"+{x}+{y}")
        tk.Label(
            self._tip, text=self._text, bg=STICKY_TOOLTIP_BG, fg=STICKY_TOOLTIP_FG,
            font=self._font, padx=6, pady=3,
        ).pack()

    def _hide(self, _event=None):
        if self._tip is not None:
            self._tip.destroy()
            self._tip = None


def _icon_button(parent, icon, command, bg, active_bg, font):
    """固定正方形容器＋置中圖示的按鈕——不是直接用 styled_button()（那個是
    tk.Button，寬度照文字/emoji 的實際字寬走）。標題列這四顆按鈕的 emoji
    有的帶 variation selector（例如 🗑️ 其實是兩個 code point），字寬跟
    ➕／◀ 這種單一 code point 的差很多，用 Button 原生寬度四顆會大小不一；
    改成固定像素邊長的 Frame，裡面用 Label 的 place() 置中文字，不管 emoji
    本身多寬，容器大小都固定一樣。"""
    frame = tk.Frame(
        parent, bg=bg, width=STICKY_ICON_BUTTON_SIZE, height=STICKY_ICON_BUTTON_SIZE, cursor="hand2",
    )
    frame.pack_propagate(False)
    label = tk.Label(frame, text=icon, bg=bg, fg="#ffffff", font=font, cursor="hand2")
    label.place(relx=0.5, rely=0.5, anchor="center")

    def _invoke(_e=None):
        command()

    def _hover_on(_e=None):
        frame.configure(bg=active_bg)
        label.configure(bg=active_bg)

    def _hover_off(_e=None):
        frame.configure(bg=bg)
        label.configure(bg=bg)

    for widget in (frame, label):
        widget.bind("<Button-1>", _invoke, add="+")
        widget.bind("<Enter>", _hover_on, add="+")
        widget.bind("<Leave>", _hover_off, add="+")
    return frame


class StickyNotePanel:
    def __init__(self, parent, service, ai_description_service, on_open_ai_settings, font_hint, width, on_collapse):
        self._service = service
        self._ai_description = ai_description_service
        self._on_open_ai_settings = on_open_ai_settings
        self._on_collapse = on_collapse
        self._font_hint = font_hint
        self._font_title = tkfont.Font(family=FONT_FAMILY, size=12, weight="bold")
        self._font_icon = tkfont.Font(family=FONT_FAMILY, size=13)
        self._toast_after_id = None
        # AI 搜尋結果是「暫時覆蓋一般關鍵字搜尋」的狀態，不是永久模式：只要
        # 搜尋框的文字被改過（不等於送出當下那句問題），_refresh() 會自動
        # 判斷失效、退回一般的關鍵字比對，不需要另外一顆「清除 AI 搜尋」按鈕。
        self._ai_result_ids = None
        self._ai_query_snapshot = None

        self.frame = tk.Frame(
            parent, bg=COLOR_PREVIEW_BG, width=width,
            highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        self.frame.pack_propagate(False)

        header = tk.Frame(self.frame, bg=COLOR_PREVIEW_BG)
        header.pack(fill="x", padx=8, pady=(10, 4))
        tk.Label(
            header, text="📌 便利貼", bg=COLOR_PREVIEW_BG, font=self._font_title, anchor="w",
        ).pack(side="left")
        add_btn = _icon_button(header, "➕", self._on_add, BTN_BLUE_BG, BTN_BLUE_ACTIVE, self._font_icon)
        add_btn.pack(side="right")
        _Tooltip(add_btn, "新增便利貼", font_hint)
        collapse_btn = _icon_button(
            header, "◀", lambda: self._on_collapse(), BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, self._font_icon,
        )
        collapse_btn.pack(side="right", padx=(0, 4))
        _Tooltip(collapse_btn, f"收合面板（快捷鍵 {STICKY_TOGGLE_SHORTCUT}）", font_hint)
        bulk_delete_btn = _icon_button(
            # 特別注意：這裡故意只用垃圾桶本體「🗑」（U+1F5D1），不加後面常見的
            # variation selector「️」（U+FE0F）——實測那個看不見的字元會讓
            # Label 的版面寬度多出 23px（52px vs 29px，其他三顆圖示都是 29px），
            # place() 置中的是「整個 Label 的版面框」，框變寬但看得到的圖案還是
            # 一樣大，圖案就會被擠到框的左側、視覺上偏移中心。
            header, "🗑", self._on_bulk_delete, BTN_DANGER_BG, BTN_DANGER_ACTIVE, self._font_icon,
        )
        bulk_delete_btn.pack(side="right", padx=(0, 4))
        _Tooltip(bulk_delete_btn, "批次刪除便利貼", font_hint)
        export_btn = _icon_button(header, "📤", self._on_export, BTN_TEAL_BG, BTN_TEAL_ACTIVE, self._font_icon)
        export_btn.pack(side="right", padx=(0, 4))
        _Tooltip(export_btn, "匯出成 Markdown 文件（目前篩選出的清單）", font_hint)
        edit_file_btn = _icon_button(
            header, "📝", self._on_edit_file, BTN_INDIGO_BG, BTN_INDIGO_ACTIVE, self._font_icon,
        )
        edit_file_btn.pack(side="right", padx=(0, 4))
        _Tooltip(edit_file_btn, "編輯便利貼檔案（原始 JSON，進階用途）", font_hint)

        tk.Label(
            self.frame, text="🖱️ 單擊卡片複製・右鍵編輯/刪除", bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG,
            font=font_hint, anchor="w",
        ).pack(fill="x", padx=8, pady=(0, 8))

        filter_box = tk.Frame(
            self.frame, bg=STICKY_FILTER_BOX_BG,
            highlightbackground=STICKY_FILTER_BOX_BORDER, highlightthickness=1,
        )
        filter_box.pack(fill="x", padx=8, pady=(0, 8))

        search_row = tk.Frame(filter_box, bg=STICKY_FILTER_BOX_BG)
        search_row.pack(fill="x", padx=8, pady=(8, 4))
        tk.Label(search_row, text="🔍", bg=STICKY_FILTER_BOX_BG, font=font_hint).pack(side="left")
        self._search_var = tk.StringVar()
        search_entry = tk.Entry(search_row, textvariable=self._search_var, font=font_hint, relief="flat")
        search_entry.pack(side="left", fill="x", expand=True, padx=(4, 4), ipady=3)
        self._search_var.trace_add("write", lambda *_a: self._refresh())
        self._ai_search_btn = styled_button(
            search_row, "🤖", self._on_ai_search, BTN_INDIGO_BG, BTN_INDIGO_ACTIVE, font_hint,
        )
        self._ai_search_btn.pack(side="left")
        _Tooltip(
            self._ai_search_btn,
            "AI 搜尋——可以問「有哪些跟○○有關的」「○○有幾個」"
            "「目前有哪些分類」，不用打精確關鍵字",
            font_hint,
        )

        tag_row = tk.Frame(filter_box, bg=STICKY_FILTER_BOX_BG)
        tag_row.pack(fill="x", padx=8, pady=(0, 4))
        tk.Label(tag_row, text="標籤：", bg=STICKY_FILTER_BOX_BG, fg=STICKY_FILTER_BOX_FG, font=font_hint).pack(side="left")
        self._tag_filter_var = tk.StringVar(value=_ALL_TAGS_LABEL)
        self._tag_filter_combo = ttk.Combobox(
            tag_row, textvariable=self._tag_filter_var, state="readonly", font=font_hint,
        )
        self._tag_filter_combo.pack(side="left", fill="x", expand=True, padx=(4, 0))
        self._tag_filter_combo.bind("<<ComboboxSelected>>", lambda _e: self._refresh())

        self._count_var = tk.StringVar(value="")
        tk.Label(
            filter_box, textvariable=self._count_var, bg=STICKY_FILTER_BOX_BG, fg=STICKY_FILTER_BOX_FG,
            font=font_hint, anchor="w",
        ).pack(fill="x", padx=8, pady=(0, 8))

        self._list_outer = tk.Frame(
            self.frame, bg=COLOR_PREVIEW_BG, highlightbackground=COLOR_PREVIEW_BORDER, highlightthickness=1,
        )
        self._list_outer.pack(fill="both", expand=True, padx=8, pady=(0, 4))
        self._canvas = tk.Canvas(self._list_outer, bg=COLOR_PREVIEW_BG, highlightthickness=0)
        scroll = ttk.Scrollbar(self._list_outer, orient="vertical", command=self._canvas.yview)
        self._canvas.configure(yscrollcommand=scroll.set)
        self._canvas.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")
        self._inner = tk.Frame(self._canvas, bg=COLOR_PREVIEW_BG)
        self._inner_id = self._canvas.create_window((0, 0), window=self._inner, anchor="nw")
        self._inner.bind("<Configure>", lambda _e: self._canvas.configure(scrollregion=self._canvas.bbox("all")))
        self._canvas.bind("<Configure>", lambda e: self._canvas.itemconfig(self._inner_id, width=e.width))
        self._canvas.bind("<Button-3>", lambda e: self._popup_empty_menu(e))
        self._inner.bind("<Button-3>", lambda e: self._popup_empty_menu(e))

        # 「已複製」提示做成只在有內容時才佔位的小色塊 toast（不是常駐但空白
        # 的文字列），平常收起來不浪費面板高度，複製當下才彈出來再自動收掉。
        self._toast_label = tk.Label(
            self.frame, bg=STICKY_TOAST_BG, fg=STICKY_TOAST_FG, font=font_hint, pady=4,
        )

        self._refresh()

    def resize(self, width: int) -> None:
        self.frame.configure(width=width)

    # ── 清單重繪 ─────────────────────────────────────────────────────

    def _refresh(self):
        notes = self._service.list_notes()
        known_tags = self._service.known_tags()
        values = [_ALL_TAGS_LABEL] + known_tags
        self._tag_filter_combo["values"] = values
        if self._tag_filter_var.get() not in values:
            self._tag_filter_var.set(_ALL_TAGS_LABEL)
        tag_filter = "" if self._tag_filter_var.get() == _ALL_TAGS_LABEL else self._tag_filter_var.get()

        query_text = self._search_var.get()
        # AI 搜尋結果只在「搜尋框文字沒被改過」的期間有效——一旦文字跟送出
        # 當下的問題不一樣了，代表使用者已經在打別的東西，AI 那批結果不再
        # 對應目前的輸入，自動失效退回一般的關鍵字比對，不用另外一顆
        # 「清除 AI 搜尋」按鈕。標籤篩選則是在 AI 結果之上再篩一層，兩者
        # 疊加使用。
        if self._ai_result_ids is not None and query_text == self._ai_query_snapshot:
            shown = [n for n in notes if n.id in self._ai_result_ids]
            if tag_filter:
                shown = [n for n in shown if n.tag == tag_filter]
            ai_mode = True
        else:
            self._ai_result_ids = None
            shown = self._service.search(notes, query_text, tag_filter)
            ai_mode = False
        self._last_shown = shown  # 匯出功能沿用「目前篩選出的清單」，見 _on_export()

        if ai_mode:
            self._count_var.set(f"🤖 AI 搜尋結果：{len(shown)} 則")
        elif query_text.strip() or tag_filter:
            self._count_var.set(f"符合條件：{len(shown)} / {len(notes)} 則")
        else:
            self._count_var.set(f"共 {len(notes)} 則")

        for child in self._inner.winfo_children():
            child.destroy()

        if not shown:
            hint = "尚無符合條件的便利貼。" if notes else "尚無便利貼，點右上角「➕」新增一則。"
            tk.Label(
                self._inner, text=hint, bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG, font=self._font_hint,
                anchor="w", justify="left", wraplength=200,
            ).pack(fill="x", padx=8, pady=10)
        else:
            for note in shown:
                self._build_card(note)

        bind_wheel_recursive(self._inner, lambda e: self._canvas.yview_scroll(int(-e.delta / 120), "units"))

    def _build_card(self, note):
        color = self._service.color_for_tag(note.tag)
        border_color = darken(color, STICKY_CARD_BORDER_DARKEN)
        hover_color = darken(color, STICKY_CARD_HOVER_DARKEN)
        fold_color = darken(color, STICKY_CARD_FOLD_DARKEN)

        card = tk.Frame(
            self._inner, bg=color, cursor="hand2",
            highlightbackground=border_color, highlightthickness=1,
        )
        card.pack(fill="x", padx=4, pady=4)

        # 右上角摺角裝飾：純視覺上模擬便利貼被撕下一小角的樣子，不影響點擊
        # 範圍（三角形本身也綁了跟卡片一樣的單擊/右鍵事件）。
        fold = tk.Canvas(
            card, width=STICKY_CARD_FOLD_SIZE, height=STICKY_CARD_FOLD_SIZE,
            bg=color, highlightthickness=0, cursor="hand2",
        )
        fold.create_polygon(
            0, 0, STICKY_CARD_FOLD_SIZE, 0, STICKY_CARD_FOLD_SIZE, STICKY_CARD_FOLD_SIZE,
            fill=fold_color, outline="",
        )
        fold.place(relx=1.0, x=-STICKY_CARD_FOLD_SIZE, y=0, anchor="nw")

        title_label = tk.Label(
            card, text=note.title, bg=color, fg=STICKY_CARD_TEXT_COLOR, font=self._font_title,
            anchor="w", justify="left", cursor="hand2",
        )
        title_label.pack(fill="x", padx=8, pady=(8, 2))

        labels_to_wrap = [title_label]
        preview = self._preview_text(note.body)
        if preview:
            body_label = tk.Label(
                card, text=preview, bg=color, fg=STICKY_CARD_TEXT_COLOR, font=self._font_hint,
                anchor="w", justify="left", cursor="hand2",
            )
            body_label.pack(fill="x", padx=8, pady=(0, 4))
            labels_to_wrap.append(body_label)

        if note.tag:
            tag_label = tk.Label(
                card, text=f"# {note.tag}", bg=color, fg=STICKY_CARD_TEXT_COLOR, font=self._font_hint,
                anchor="w", cursor="hand2",
            )
            tag_label.pack(fill="x", padx=8, pady=(0, 8))
        else:
            tk.Frame(card, bg=color, height=6).pack()

        card.bind(
            "<Configure>",
            lambda e: [lbl.configure(wraplength=max(60, e.width - 16)) for lbl in labels_to_wrap],
        )

        # 滑鼠移到卡片任何一塊子元件上，整張卡片的邊框都要一起變深/變粗，
        # 提示「這張卡片可以點」——邊框顏色跟著卡片自己的色相走，不是固定色。
        def _hover_on(_e=None):
            card.configure(highlightbackground=hover_color, highlightthickness=2)

        def _hover_off(_e=None):
            card.configure(highlightbackground=border_color, highlightthickness=1)

        clickable = [card, fold, title_label] + labels_to_wrap
        for widget in clickable:
            widget.bind("<Button-1>", lambda _e, n=note: self._copy(n))
            widget.bind("<Button-3>", lambda e, n=note: self._popup_card_menu(e, n))
            widget.bind("<Enter>", _hover_on)
            widget.bind("<Leave>", _hover_off)

    @staticmethod
    def _preview_text(body: str) -> str:
        lines = [line for line in body.splitlines() if line.strip()]
        if not lines:
            return ""
        text = "\n".join(lines[:2])
        if len(lines) > 2:
            text += " …"
        return text

    # ── 互動 ─────────────────────────────────────────────────────────

    def _copy(self, note):
        file_actions.copy_to_clipboard(self.frame, note.body)
        if self._toast_after_id is not None:
            self.frame.after_cancel(self._toast_after_id)
        self._toast_label.configure(text="✅ 已複製到剪貼簿")
        # side="bottom" 決定「貼齊面板最下緣」；before=self._list_outer 決定
        # 「在版面配置的處理順序上排在 list_outer 前面」——list_outer 是
        # expand=True，如果 toast 排在它後面才處理，會被它先吃光剩餘空間，
        # 不管 toast 自己是不是 side="bottom" 都一樣會被擠成看不見（就是稍早
        # 新增便利貼對話框「按鈕被擠不見」那個成因，這裡换了個地方一樣會發生）。
        self._toast_label.pack(side="bottom", fill="x", padx=8, pady=(0, 8), before=self._list_outer)
        self._toast_after_id = self.frame.after(1500, self._hide_toast)

    def _hide_toast(self):
        self._toast_after_id = None
        self._toast_label.pack_forget()

    def _popup_card_menu(self, event, note):
        menu = tk.Menu(self.frame, tearoff=0, font=self._font_hint)
        menu.add_command(label="📋 複製", command=lambda: self._copy(note))
        menu.add_separator()
        menu.add_command(label="✏️ 編輯", command=lambda: self._on_edit(note))
        menu.add_command(label="🗑️ 刪除", command=lambda: self._on_delete(note))
        menu.tk_popup(event.x_root, event.y_root)

    def _popup_empty_menu(self, event):
        menu = tk.Menu(self.frame, tearoff=0, font=self._font_hint)
        menu.add_command(label="➕ 新增便利貼", command=self._on_add)
        menu.tk_popup(event.x_root, event.y_root)

    def _on_add(self):
        StickyNoteDialog(self.frame, self._service.known_tags(), self._confirm_add)

    def _confirm_add(self, title, body, tag):
        self._service.add_note(title, body, tag)
        self._refresh()

    def _on_edit(self, note):
        StickyNoteDialog(
            self.frame, self._service.known_tags(),
            lambda title, body, tag: self._confirm_edit(note.id, title, body, tag),
            title="編輯便利貼", confirm_text="儲存",
            initial_title=note.title, initial_body=note.body, initial_tag=note.tag,
        )

    def _confirm_edit(self, note_id, title, body, tag):
        self._service.update_note(note_id, title, body, tag)
        self._refresh()

    def _on_delete(self, note):
        if not messagebox.askyesno("刪除便利貼", f"確定要刪除「{note.title}」嗎？此動作無法復原。"):
            return
        self._service.delete_note(note.id)
        self._refresh()

    def _on_bulk_delete(self):
        notes = self._service.list_notes()
        if not notes:
            messagebox.showinfo("批次刪除便利貼", "目前沒有任何便利貼。")
            return
        StickyNoteBulkDeleteDialog(
            self.frame, notes, self._service.color_for_tag, self._confirm_bulk_delete,
        )

    def _confirm_bulk_delete(self, note_ids):
        self._service.delete_notes(note_ids)
        self._refresh()

    def _on_export(self):
        """匯出「目前篩選出的清單」，不是永遠固定匯出全部——先用標籤/關鍵字
        篩出想要的子集合（例如只留某個標籤）再按匯出，就能只匯出那幾筆；
        什麼都不篩就是全部，行為跟畫面上看到的清單一致，不會讓人意外。"""
        notes = self._last_shown
        if not notes:
            messagebox.showinfo("匯出便利貼", "目前沒有符合條件的便利貼可以匯出。")
            return
        path = filedialog.asksaveasfilename(
            parent=self.frame,
            title="匯出便利貼",
            defaultextension=".md",
            initialfile=f"便利貼_{datetime.now():%Y%m%d_%H%M}.md",
            filetypes=[("Markdown", "*.md"), ("純文字", "*.txt"), ("所有檔案", "*.*")],
        )
        if not path:
            return
        content = self._service.export_markdown(notes)
        try:
            with open(path, "w", encoding="utf-8") as f:
                f.write(content)
        except OSError as exc:
            messagebox.showerror("匯出便利貼", f"寫入檔案失敗：\n{exc}")
            return
        messagebox.showinfo("匯出便利貼", f"已匯出 {len(notes)} 則便利貼到：\n{path}")

    def _on_edit_file(self):
        """直接打開底層 `.sticky_notes.json` 讓使用者用文字編輯器手動改——
        跟主視窗「編輯索引檔案」同一套做法（優先開 VS Code，找不到退回記事
        本）。這是原始 JSON、不是給人手動維護的表格格式，跟索引 .md 檔不
        一樣，按鈕跟提示文字都有標「進階用途」，設定使用者的預期。開檔案
        當下不會知道使用者改完存檔後有沒有把 JSON 弄壞，等下次面板要
        重新整理（或重啟 app）讀到損毀內容時，Repository 本來就會安靜退回
        空白預設值，不會讓程式壞掉，但改壞的內容就真的救不回來了。"""
        try:
            file_actions.open_in_text_editor(self._service.get_file_path())
        except OSError as exc:
            messagebox.showerror("編輯便利貼檔案", f"開啟失敗：\n{exc}")

    # ── AI 搜尋 ───────────────────────────────────────────────────────

    def _on_ai_search(self):
        """跟「AI 批次說明」共用同一份 AI 設定（同一個 AIDescriptionService），
        不用另外設定一次。搜尋框目前打的文字就是問題本身，不是額外跳對話框
        再問一次——搜尋框已經是這個用途最自然的輸入位置。呼叫本身在背景
        執行緒跑，避免整個面板在等網路回應時卡住。

        這不只是「篩選卡片」的搜尋——使用者實際會問的問題還包括「某分類
        有哪些事項」「有幾個」「目前有哪些分類」這幾種需要統整內容或計數
        才能回答的問題，只篩選卡片沒辦法回答這些，所以除了拿編號篩選清單
        以外，還會跳出一個對話框顯示 AI 用自然語言寫的完整答案。

        用量／花費是使用者完全看不到的東西：便利貼數量一多，每次呼叫送出
        的內容量就跟著變大，使用者不會自己算 token，也不知道自己已經呼叫
        過幾次。這裡做三件事降低這個風險：①送出前先套用目前的標籤篩選
        （呼應畫面上看得到的範圍，不是不管有沒有篩選都送全部）；②不管是
        雲端還是本機 Provider，送出前一律跳出視窗顯示「這次會送幾則、大約
        多少字元、這是第幾次呼叫」，本機 Provider 之前完全沒有這個提示；
        ③真的送出後才把累計次數存檔，取消或被防呆擋下來的都不算數，次數
        才會忠實反映「真的呼叫過幾次」。"""
        query = self._search_var.get().strip()
        if not query:
            messagebox.showinfo("AI 搜尋", "請先在搜尋框輸入想找的內容，可以用一般語句描述，不用打精確關鍵字。")
            return
        all_notes = self._service.list_notes()
        if not all_notes:
            messagebox.showinfo("AI 搜尋", "目前沒有任何便利貼可以搜尋。")
            return
        tag_filter = "" if self._tag_filter_var.get() == _ALL_TAGS_LABEL else self._tag_filter_var.get()
        notes = [n for n in all_notes if not tag_filter or n.tag == tag_filter]
        if not notes:
            messagebox.showinfo("AI 搜尋", "目前的標籤篩選底下沒有任何便利貼，換一個標籤或選「全部標籤」再試一次。")
            return
        ok, reason = self._ai_description.is_configured()
        if not ok:
            messagebox.showwarning("AI 搜尋", f"{reason}，請先設定好 AI 再試一次。")
            self._on_open_ai_settings(None)
            return

        prompt = self._service.build_ai_search_prompt(notes, query)
        size_estimate = self._ai_description.estimate_prompt_size(prompt)
        call_count = self._ai_description.get_call_count()
        scope_note = f"（已套用標籤篩選「{tag_filter}」，未篩選還有 {len(all_notes)} 則）" if tag_filter else ""
        large_batch_hint = (
            "\n\n💡 便利貼數量較多，若不需要搜尋全部，可以先用標籤篩選縮小範圍再送出，減少每次呼叫的內容量。"
            if len(notes) > STICKY_AI_SEARCH_LARGE_NOTE_COUNT else ""
        )
        cloud_hint = "\n\n內容會離開這台電腦，送到 OpenAI 分析，且每次呼叫可能計費。" if self._ai_description.is_cloud_provider() else ""
        confirm_title = "確認送出到 OpenAI" if self._ai_description.is_cloud_provider() else "確認送出 AI 搜尋"
        proceed = ask_ai_confirm(
            # 用整個主視窗（不是 self.frame，那只是便利貼這塊窄面板本身）來
            # 置中——不然這個確認視窗會貼著左側窄面板的範圍置中，偏到畫面
            # 左邊，跟「AI 批次說明」那邊用整個視窗置中的觀感不一致。
            self.frame.winfo_toplevel(),
            confirm_title,
            f"即將把 {len(notes)} 則便利貼的標題／標籤／內容片段送給 AI 分析。{scope_note}\n"
            f"預估大小：{size_estimate}\n"
            f"這是全部 AI 功能（AI 搜尋＋AI 批次說明共用）累計第 {call_count + 1} 次呼叫"
            f"（僅供參考，實際費用/額度以 Provider 帳單為準）。"
            f"{cloud_hint}{large_batch_hint}",
        )
        if not proceed:
            return

        self._ai_search_btn.config(state="disabled", text="⏳")
        self._count_var.set("🤖 AI 搜尋中…")
        result_queue = queue.Queue()

        def _worker():
            try:
                provider = self._ai_description.build_provider()
                # 記帳的時間點要在 build_provider() 成功「之後」、真的呼叫
                # generate_description() 之前——跟 AI 批次說明（_generate_one()）
                # 同一個時機點，如果 build_provider() 本身就失敗（設定不完整），
                # 代表根本沒有送出任何請求，不該算一次呼叫。
                self._ai_description.record_call()
                response = provider.generate_description(prompt)
                result_queue.put(("done", response))
            except AIProviderError as exc:
                result_queue.put(("error", str(exc)))

        threading.Thread(target=_worker, daemon=True).start()

        def _poll():
            try:
                kind, payload = result_queue.get_nowait()
            except queue.Empty:
                self.frame.after(100, _poll)
                return
            self._ai_search_btn.config(state="normal", text="🤖")
            if kind == "error":
                self._refresh()  # 先把「AI 搜尋中…」的暫時字樣復原成正常的計數文字
                messagebox.showerror("AI 搜尋", f"呼叫 AI 失敗：\n{payload}")
                return
            answer, matched = self._service.parse_ai_search_response(payload, notes)
            self._ai_result_ids = {note.id for note in matched}
            self._ai_query_snapshot = query
            self._refresh()  # 先把卡片清單篩選好，再跳答案視窗，關掉視窗後畫面已經是篩選好的樣子
            messagebox.showinfo("🤖 AI 回答", answer)

        self.frame.after(100, _poll)
