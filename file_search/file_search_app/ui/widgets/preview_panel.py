"""右側預覽區塊——依副檔名類型自動顯示圖片縮圖／文字內容（可捲動）／音樂
影片播放／圖示＋提示文字，同一時間只顯示其中一種，用 `_set_mode()` 統一
切換。實際的檔案內容擷取交給 PreviewService，圖片縮圖也是先由 PreviewService
讀好、縮放好的 PIL Image，這裡只做「轉成 Tk 看得懂的 PhotoImage 並顯示」這
一步（PhotoImage 本身就是 Tk 物件，天生不可能脫離 Tk 存在，沒辦法搬進
Service 層）。mp3/mp4 播放另外委派給 MediaPanel。

音訊／影片檔案在 media 模式下，另外多一列轉錄控制（🎙️ 轉錄／取消／進度、
轉錄好之後多一顆「查看轉錄文字」），按下去會切到獨立的 transcript 模式顯示
轉錄文字（複用跟一般文字預覽同一顆縮放字型），「回到播放器」再切回去。轉錄
本身怎麼跑、寫不寫快取都不是這裡的事，只透過建構子注入的 `on_transcribe_request`
回呼觸發、透過 `get_cached_text` 查詢目前有沒有現成的轉錄文字——實際呼叫
TranscriptionService、背景執行緒、寫入快取都是呼叫端（MainWindow）的事。"""

import threading
import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_PURPLE_ACTIVE, BTN_PURPLE_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG,
    COLOR_PREVIEW_BG, COLOR_STATUS_FG, FONT_FAMILY, IMAGE_EXTS, MEDIA_EXTS, MISSING_ICON,
    PREVIEW_TEXT_DEFAULT_SIZE, PREVIEW_TEXT_MAX_SIZE, PREVIEW_TEXT_MIN_SIZE,
)
from file_search_app.services.preview_service import HAS_PIL, PreviewService
from file_search_app.ui.styles import icon_for, styled_button
from file_search_app.ui.widgets.media_panel import MediaPanel

if HAS_PIL:
    from PIL import ImageTk


class PreviewPanel:
    def __init__(self, parent, preview_service: PreviewService, media_controller, font_label, font_hint,
                 width, on_media_entry=None, on_space_shortcut=None, on_seek_shortcut=None,
                 transcription_available=False, get_cached_text=None, on_transcribe_request=None):
        self._preview_service = preview_service
        self._width = width
        self._on_media_entry = on_media_entry
        self._current_entry = None
        self._mode = None
        self._photo = None  # 保留參照，避免縮圖被垃圾回收
        self._media_available = media_controller.available

        self._transcription_available = transcription_available
        self._get_cached_text = get_cached_text
        self._on_transcribe_request = on_transcribe_request
        self._transcribing = False
        self._transcribing_path = None
        self._transcribe_cancel_event = None
        self._transcribe_message = ""  # 目前這一筆要在狀態列顯示的文字（進度／錯誤），空字串代表不顯示

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

        # 轉錄控制列：只在音訊／影片檔案的 media／transcript 模式下顯示，見
        # _set_mode()。沒裝 faster-whisper 時改顯示一行淡灰提示，而不是整個
        # 靜默消失——跟 Pillow／pypdf 缺套件時的提示是同一種「讓使用者知道
        # 這個功能存在，只是需要另外安裝套件」的做法。
        self._transcribe_row = tk.Frame(self.frame, bg=COLOR_PREVIEW_BG)
        self._transcribe_btn = styled_button(
            self._transcribe_row, "🎙️ 轉錄", self._on_transcribe_click, BTN_PURPLE_BG, BTN_PURPLE_ACTIVE, font_hint,
        )
        self._transcribe_btn.pack(side="left")
        self._view_transcript_btn = styled_button(
            self._transcribe_row, "📝 查看轉錄文字", self._on_view_transcript_click,
            BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        )
        self._transcribe_cancel_btn = styled_button(
            self._transcribe_row, "取消", self._on_cancel_transcribe_click,
            BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        )
        self._transcribe_status_var = tk.StringVar(value="")
        self._transcribe_status_label = tk.Label(
            self._transcribe_row, textvariable=self._transcribe_status_var,
            bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG, font=font_hint, anchor="w",
        )
        self._transcribe_unavailable_label = tk.Label(
            self.frame, text="（未安裝語音辨識套件，無法轉錄音訊／影片內容；\n如需使用請安裝 faster-whisper）",
            bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG, font=font_hint, wraplength=290, justify="left",
        )

        # 轉錄文字顯示模式：跟一般文字預覽長得一樣（同一顆可縮放字型），但多一列
        # 標題＋「回到播放器」按鈕，所以用獨立的 Text 元件，不能直接借用
        # `_text`／`_text_frame`——Tkinter 元件一旦建立就固定屬於某個容器，
        # 沒辦法之後改指定到別的 parent 底下重新排版。
        self._transcript_frame = tk.Frame(self.frame, bg=COLOR_PREVIEW_BG)
        transcript_header = tk.Frame(self._transcript_frame, bg=COLOR_PREVIEW_BG)
        transcript_header.pack(fill="x")
        tk.Label(
            transcript_header, text="📝 轉錄文字（本機語音辨識，僅供搜尋／閱讀參考）",
            bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG, font=font_hint, anchor="w",
        ).pack(side="left")
        styled_button(
            transcript_header, "🎬 回到播放器", lambda: self._set_mode("media"),
            BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_hint,
        ).pack(side="right")
        transcript_body = tk.Frame(self._transcript_frame, bg=COLOR_PREVIEW_BG)
        transcript_body.pack(fill="both", expand=True, pady=(6, 0))
        self._transcript_text = tk.Text(
            transcript_body, bg=COLOR_PREVIEW_BG, fg="#2c3e50", font=self._font_text,
            wrap="word", relief="flat", state="disabled", padx=4, pady=2, highlightthickness=0, bd=0,
        )
        transcript_scroll = ttk.Scrollbar(transcript_body, orient="vertical", command=self._transcript_text.yview)
        self._transcript_text.configure(yscrollcommand=transcript_scroll.set)
        self._transcript_text.pack(side="left", fill="both", expand=True)
        transcript_scroll.pack(side="right", fill="y")
        self._transcript_text.bind("<Control-MouseWheel>", self._on_ctrl_wheel)

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
        self._transcribe_unavailable_label.configure(wraplength=wrap)
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
        """image / text / media / transcript / icon / None（尚未選取任何項目）
        六選一，每次都先把全部區塊收起來，再依照目前類型 pack 出對應的那個，
        避免疊在一起。離開 media／transcript 模式（換選取項目、切換其他類型）
        一律停止播放，不會有音樂還在背景播、畫面卻已經換成別的東西的情況。"""
        if self._mode in ("media", "transcript") and mode not in ("media", "transcript"):
            self.media_panel.stop_and_release()
        self._mode = mode
        self._image_label.pack_forget()
        self._text_frame.pack_forget()
        self.media_panel.frame.pack_forget()
        self._transcribe_row.pack_forget()
        self._transcribe_unavailable_label.pack_forget()
        self._transcript_frame.pack_forget()
        self._hint_label.pack_forget()
        if mode == "image":
            self._image_label.pack(pady=(0, 8))
            self._hint_label.pack(padx=10, pady=(0, 6))
        elif mode == "text":
            self._text_frame.pack(fill="both", expand=True, padx=8, pady=(0, 10))
        elif mode == "media":
            self._pack_transcribe_controls()
            self.media_panel.frame.pack(fill="x")
        elif mode == "transcript":
            self._pack_transcribe_controls()
            self._transcript_frame.pack(fill="both", expand=True, padx=8, pady=(0, 10))
        elif mode == "icon":
            self._image_label.pack(pady=(0, 8))
            self._hint_label.pack(padx=10, pady=(0, 6))
        else:
            self._hint_label.pack(padx=10, pady=(20, 0))

    def _pack_transcribe_controls(self):
        """media／transcript 兩個模式共用：裝了 faster-whisper 就顯示轉錄控制
        列並依目前狀態刷新內容，沒裝就顯示一行提示，不佔用轉錄控制列的位置。"""
        if self._transcription_available:
            self._transcribe_row.pack(fill="x", padx=8, pady=(0, 6))
            self._refresh_transcribe_row()
        else:
            self._transcribe_unavailable_label.pack(padx=10, pady=(0, 6))

    # ── 顯示 ─────────────────────────────────────────────────────────

    def activate_media(self, path) -> None:
        """空白鍵直接播放／暫停用：立即（不透過 show_entry() 的防彈跳排程）
        載入並切到 media 模式。"""
        self.media_panel.load_media(path)
        self._set_mode("media")

    def show_entry(self, entry) -> None:
        # 換選取項目時，除非新選到的剛好就是目前正在背景轉錄的那個檔案，否則
        # 上一筆殘留的轉錄狀態文字（進度／錯誤）不該繼續顯示在不相干的檔案上。
        if entry is None or entry.path != self._transcribing_path:
            self._transcribe_message = ""
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
        elif ext == ".7z":
            self._hint_var.set("（未安裝 py7zr 套件或無法解析，無法列出壓縮檔內容，\n按「開啟檔案」用預設程式開啟）")
        else:
            self._hint_var.set("此類型沒有內容預覽，\n按「開啟檔案」查看內容")
        self._set_mode("icon")

    # ── 轉錄 ─────────────────────────────────────────────────────────

    def _refresh_transcribe_row(self):
        """單一入口刷新轉錄控制列的全部顯示狀態（按鈕文字／狀態列／取消按鈕／
        查看轉錄文字按鈕）——`self._transcribe_message` 是唯一要不要顯示狀態列
        的依據，其餘呼叫端只需要改這個欄位再呼叫這裡，不用各自處理 pack／
        pack_forget。show_entry() 換了新的選取項目、轉錄開始／進度／完成／
        取消時都會呼叫。"""
        entry = self._current_entry
        if entry is None:
            return
        busy = self._transcribing and self._transcribing_path == entry.path
        self._transcribe_btn.configure(state="disabled" if busy else "normal")

        if self._transcribe_message:
            self._transcribe_status_var.set(self._transcribe_message)
            self._transcribe_status_label.pack(side="left", padx=(8, 0))
        else:
            self._transcribe_status_label.pack_forget()
        if busy:
            self._transcribe_cancel_btn.pack(side="left", padx=(8, 0))
        else:
            self._transcribe_cancel_btn.pack_forget()

        cached_text = self._get_cached_text(entry.path) if self._get_cached_text else None
        if cached_text:
            self._transcribe_btn.configure(text="🔁 重新轉錄")
            self._view_transcript_btn.pack(side="left", padx=(8, 0))
            self._transcript_text.configure(state="normal")
            self._transcript_text.delete("1.0", "end")
            self._transcript_text.insert("1.0", cached_text)
            self._transcript_text.configure(state="disabled")
        else:
            self._transcribe_btn.configure(text="🎙️ 轉錄")
            self._view_transcript_btn.pack_forget()

    def _on_transcribe_click(self):
        entry = self._current_entry
        if entry is None or self._transcribing or not self._on_transcribe_request:
            return
        self._transcribing = True
        self._transcribing_path = entry.path
        cancel_event = threading.Event()
        self._transcribe_cancel_event = cancel_event
        self._transcribe_message = "🎙️ 轉錄中…（第一次使用需另外下載模型，可能需要一段時間，可按取消中止）"
        self._refresh_transcribe_row()
        self._on_transcribe_request(entry, self._on_transcribe_progress, self._on_transcribe_done, cancel_event)

    def _on_cancel_transcribe_click(self):
        if self._transcribe_cancel_event:
            self._transcribe_cancel_event.set()
        self._transcribe_message = "正在取消…"
        self._refresh_transcribe_row()

    def _on_transcribe_progress(self, fraction):
        # 使用者可能已經按下取消（狀態列文字已改成「正在取消…」），此時不要
        # 再被進度覆蓋掉，避免看起來像是取消沒有生效。
        if not self._transcribing or (self._transcribe_cancel_event and self._transcribe_cancel_event.is_set()):
            return
        percent = int(max(0.0, min(1.0, fraction)) * 100)
        self._transcribe_message = f"🎙️ 轉錄中…{percent}%（可按取消中止）"
        if self._current_entry is not None and self._current_entry.path == self._transcribing_path:
            self._refresh_transcribe_row()

    def _on_transcribe_done(self, text, error, cancelled):
        self._transcribing = False
        self._transcribe_cancel_event = None
        transcribing_path = self._transcribing_path
        self._transcribing_path = None
        self._transcribe_message = f"⚠️ {error}" if error else ""
        # 轉錄跑的期間使用者可能已經切到別的檔案／類型；快取已經在 MainWindow
        # 那邊寫好了，這裡只是不去動目前實際看到的畫面，避免顯示跟目前選取
        # 對不上的狀態文字。
        if self._current_entry is None or self._current_entry.path != transcribing_path:
            return
        if self._mode not in ("media", "transcript"):
            return
        self._refresh_transcribe_row()

    def _on_view_transcript_click(self):
        self._set_mode("transcript")
