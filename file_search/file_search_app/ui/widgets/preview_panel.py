"""右側預覽區塊——依副檔名類型自動顯示圖片縮圖／文字內容（可捲動）／音樂
影片播放／圖示＋提示文字，同一時間只顯示其中一種，用 `_set_mode()` 統一
切換。實際的檔案內容擷取交給 PreviewService，圖片縮圖也是先由 PreviewService
讀好、縮放好的 PIL Image，這裡只做「轉成 Tk 看得懂的 PhotoImage 並顯示」這
一步（PhotoImage 本身就是 Tk 物件，天生不可能脫離 Tk 存在，沒辦法搬進
Service 層）。mp3/mp4 播放另外委派給 MediaPanel。"""

import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    COLOR_PREVIEW_BG, COLOR_STATUS_FG, FONT_FAMILY, IMAGE_EXTS, MEDIA_EXTS, MISSING_ICON,
    PREVIEW_TEXT_DEFAULT_SIZE, PREVIEW_TEXT_MAX_SIZE, PREVIEW_TEXT_MIN_SIZE,
)
from file_search_app.services.preview_service import HAS_PIL, PreviewService
from file_search_app.ui.styles import icon_for
from file_search_app.ui.widgets.media_panel import MediaPanel

if HAS_PIL:
    from PIL import ImageTk


class PreviewPanel:
    def __init__(self, parent, preview_service: PreviewService, media_controller, font_label, font_hint,
                 width, on_media_entry=None, on_space_shortcut=None, on_seek_shortcut=None):
        self._preview_service = preview_service
        self._width = width
        self._on_media_entry = on_media_entry
        self._current_entry = None
        self._mode = None
        self._photo = None  # 保留參照，避免縮圖被垃圾回收
        self._media_available = media_controller.available

        self._font_text_size = PREVIEW_TEXT_DEFAULT_SIZE
        self._font_text = tkfont.Font(family=FONT_FAMILY, size=self._font_text_size)

        self.frame = tk.Frame(
            parent, bg=COLOR_PREVIEW_BG, width=width,
            highlightbackground="#c7d3dc", highlightthickness=1,
        )
        self.frame.pack_propagate(False)

        self._name_var = tk.StringVar(value="")
        self._name_label = tk.Label(
            self.frame, textvariable=self._name_var, bg=COLOR_PREVIEW_BG, font=font_label,
            wraplength=290, justify="center",
        )
        self._name_label.pack(padx=10, pady=(14, 8))

        self._image_label = tk.Label(self.frame, bg=COLOR_PREVIEW_BG)

        self._text_frame = tk.Frame(self.frame, bg=COLOR_PREVIEW_BG)
        self._text = tk.Text(
            self._text_frame, bg=COLOR_PREVIEW_BG, fg="#2c3e50", font=self._font_text,
            wrap="word", relief="flat", state="disabled", padx=4, pady=2, highlightthickness=0, bd=0,
        )
        text_scroll = ttk.Scrollbar(self._text_frame, orient="vertical", command=self._text.yview)
        self._text.configure(yscrollcommand=text_scroll.set)
        self._text.pack(side="left", fill="both", expand=True)
        text_scroll.pack(side="right", fill="y")
        # 滑鼠移到預覽文字上時，Ctrl+滾輪也能縮放字級——跟 VS Code 一樣的手感。
        self._text.bind("<Control-MouseWheel>", self._on_ctrl_wheel)

        self.media_panel = MediaPanel(
            self.frame, media_controller, font_label, font_hint,
            get_preview_width=lambda: self._width,
            on_space_shortcut=on_space_shortcut, on_seek_shortcut=on_seek_shortcut,
        )

        self._hint_var = tk.StringVar(value="選取清單中的項目\n會在這裡顯示預覽")
        self._hint_label = tk.Label(
            self.frame, textvariable=self._hint_var, bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG,
            font=font_hint, wraplength=290, justify="center",
        )
        self._set_mode(None)

    # ── 版面 ─────────────────────────────────────────────────────────

    def width(self) -> int:
        return self._width

    def resize(self, width: int) -> None:
        self._width = width
        self.frame.configure(width=width)
        wrap = max(120, width - 30)
        self._name_label.configure(wraplength=wrap)
        self._hint_label.configure(wraplength=wrap)
        self.media_panel.resize()
        if self._mode == "image":
            self.show_entry(self._current_entry)  # 重新用新的寬度算縮圖上限，圖片才會跟著變大/變小
        # media 模式不用重新呼叫 show_entry()——VLC 內嵌畫面是直接跟著 HWND
        # 目前的實際大小自動縮放，上面已經改好高度了，重新整個 show_entry()
        # 反而會打斷正在播放的內容。

    # ── 字級縮放 ─────────────────────────────────────────────────────

    def _set_font_size(self, size):
        size = max(PREVIEW_TEXT_MIN_SIZE, min(PREVIEW_TEXT_MAX_SIZE, size))
        if size == self._font_text_size:
            return
        self._font_text_size = size
        self._font_text.configure(size=size)

    def zoom_in(self, _event=None):
        self._set_font_size(self._font_text_size + 1)
        return "break"

    def zoom_out(self, _event=None):
        self._set_font_size(self._font_text_size - 1)
        return "break"

    def zoom_reset(self, _event=None):
        self._set_font_size(PREVIEW_TEXT_DEFAULT_SIZE)
        return "break"

    def _on_ctrl_wheel(self, event):
        if event.delta > 0:
            self.zoom_in()
        else:
            self.zoom_out()
        return "break"

    # ── 模式切換 ─────────────────────────────────────────────────────

    def _set_mode(self, mode):
        """image / text / media / icon / None（尚未選取任何項目）五選一，每次都
        先把全部區塊收起來，再依照目前類型 pack 出對應的那個，避免疊在一起。
        離開 media 模式（換選取項目、切換其他類型）一律停止播放，不會有音樂
        還在背景播、畫面卻已經換成別的東西的情況。"""
        if self._mode == "media" and mode != "media":
            self.media_panel.stop_and_release()
        self._mode = mode
        self._image_label.pack_forget()
        self._text_frame.pack_forget()
        self.media_panel.frame.pack_forget()
        self._hint_label.pack_forget()
        if mode == "image":
            self._image_label.pack(pady=(0, 8))
            self._hint_label.pack(padx=10, pady=(0, 6))
        elif mode == "text":
            self._text_frame.pack(fill="both", expand=True, padx=8, pady=(0, 10))
        elif mode == "media":
            self.media_panel.frame.pack(fill="x")
        elif mode == "icon":
            self._image_label.pack(pady=(0, 8))
            self._hint_label.pack(padx=10, pady=(0, 6))
        else:
            self._hint_label.pack(padx=10, pady=(20, 0))

    # ── 顯示 ─────────────────────────────────────────────────────────

    def activate_media(self, path) -> None:
        """空白鍵直接播放／暫停用：立即（不透過 show_entry() 的防彈跳排程）
        載入並切到 media 模式。"""
        self.media_panel.load_media(path)
        self._set_mode("media")

    def show_entry(self, entry) -> None:
        self._current_entry = entry
        self._image_label.configure(image="", text="")
        self._photo = None
        self._text.configure(state="normal")
        self._text.delete("1.0", "end")
        self._text.configure(state="disabled")

        if entry is None:
            self._name_var.set("")
            self._hint_var.set("選取清單中的項目\n會在這裡顯示預覽")
            self._set_mode(None)
            return
        p = entry.path_obj
        self._name_var.set(p.name)
        if not p.exists():
            self._hint_var.set("⚠️ 檔案目前找不到")
            self._image_label.configure(text=MISSING_ICON, font=("Segoe UI Emoji", 48))
            self._set_mode("icon")
            return

        if p.suffix.lower() in IMAGE_EXTS:
            # 縮圖上限跟著預覽區塊目前寬度走，拉桿拉多寬圖就能顯示多大。
            bound = max(160, min(self._width - 40, 640))
            img = self._preview_service.load_image_thumbnail(p, bound)
            if img is not None:
                self._photo = ImageTk.PhotoImage(img)
                self._image_label.configure(image=self._photo)
                self._hint_var.set("")
                self._set_mode("image")
                return
            # 讀圖失敗（損毀檔案等）就往下走文字/圖示預覽，不讓整個面板掛掉

        if p.suffix.lower() in MEDIA_EXTS:
            if self._media_available:
                if self._on_media_entry:
                    self._on_media_entry(p)
                self._set_mode("media")
                return
            self._image_label.configure(text=icon_for(str(p)), font=("Segoe UI Emoji", 48))
            self._hint_var.set("（未安裝／找不到 VLC 播放引擎，無法在此播放，\n按「開啟檔案」用預設播放器開啟）")
            self._set_mode("icon")
            return

        text = self._preview_service.extract_preview_text(p)
        if text:
            self._text.configure(state="normal")
            self._text.insert("1.0", text)
            self._text.configure(state="disabled")
            self._set_mode("text")
            return

        self._image_label.configure(text=icon_for(str(p)), font=("Segoe UI Emoji", 48))
        ext = p.suffix.lower()
        if ext in IMAGE_EXTS and not HAS_PIL:
            self._hint_var.set("（未安裝 Pillow，無法顯示縮圖）")
        elif ext == ".pdf":
            self._hint_var.set("（未安裝 PDF 讀取套件，無法預覽內文，\n按「開啟檔案」查看）")
        else:
            self._hint_var.set("此類型沒有內容預覽，\n按「開啟檔案」查看內容")
        self._set_mode("icon")
