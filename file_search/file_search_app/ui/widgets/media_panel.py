"""mp3/mp4 播放控制介面——黑底 surface 給 VLC 內嵌影像用，音樂類沒有影像軌，
疊一個音符圖示上去代替；下面是播放/停止/大視窗/時間/拖曳進度/音量。所有
實際的播放邏輯都委派給注入的 MediaController，這裡只做兩件事：把 Tkinter
事件轉呼叫成 Controller 的方法，以及把 Controller 回呼的資料寫進 Label／
Scale——不自己保存播放狀態（播放中/暫停/目前秒數這些以 Controller 為準）。"""

import tkinter as tk
from pathlib import Path
from tkinter import ttk

from file_search_app.config import COLOR_HEADER_BG, COLOR_HEADER_FG, COLOR_PREVIEW_BG, COLOR_STATUS_FG
from file_search_app.media.media_controller import MediaController, format_ms


class MediaPanel:
    def __init__(self, parent, controller: MediaController, font_label, font_hint,
                 get_preview_width, on_space_shortcut=None, on_seek_shortcut=None):
        self._controller = controller
        self._get_preview_width = get_preview_width
        self._font_hint = font_hint
        self._on_space_shortcut = on_space_shortcut
        self._on_seek_shortcut = on_seek_shortcut
        self._seeking = False
        self._large_window = None

        self.frame = tk.Frame(parent, bg=COLOR_PREVIEW_BG)
        self._surface = tk.Frame(self.frame, bg="#000000", height=180)
        self._surface.pack(fill="x")
        self._surface.pack_propagate(False)
        self._icon_label = tk.Label(
            self._surface, text="🎵", font=("Segoe UI Emoji", 40), bg="#000000", fg="#ffffff",
        )

        ctrl_row = tk.Frame(self.frame, bg=COLOR_PREVIEW_BG)
        ctrl_row.pack(fill="x", padx=6, pady=(6, 2))
        self._play_btn = tk.Button(
            ctrl_row, text="▶", command=self.play_pause, width=3, relief="flat",
            bg=COLOR_PREVIEW_BG, activebackground=COLOR_PREVIEW_BG, cursor="hand2", font=font_label,
        )
        self._play_btn.pack(side="left")
        tk.Button(
            ctrl_row, text="⏹", command=self.stop, width=3, relief="flat",
            bg=COLOR_PREVIEW_BG, activebackground=COLOR_PREVIEW_BG, cursor="hand2", font=font_label,
        ).pack(side="left", padx=(2, 0))
        self._large_btn = tk.Button(
            ctrl_row, text="⛶ 大視窗", command=self.open_large_video, relief="flat",
            bg=COLOR_PREVIEW_BG, activebackground=COLOR_PREVIEW_BG, cursor="hand2", font=font_hint,
        )
        self._large_btn.pack(side="left", padx=(5, 0))
        self._time_var = tk.StringVar(value="00:00 / 00:00")
        tk.Label(
            ctrl_row, textvariable=self._time_var, bg=COLOR_PREVIEW_BG, fg=COLOR_STATUS_FG, font=font_hint,
        ).pack(side="left", padx=(8, 0))

        self._seek_var = tk.DoubleVar(value=0.0)
        seek_row = tk.Frame(self.frame, bg=COLOR_PREVIEW_BG)
        seek_row.pack(fill="x", padx=6, pady=(0, 4))
        self._seek_scale = ttk.Scale(
            seek_row, from_=0, to=1000, orient="horizontal", variable=self._seek_var,
            command=self._on_seek_drag,
        )
        self._seek_scale.pack(fill="x")
        self._seek_scale.bind("<ButtonRelease-1>", self._on_seek_release)

        vol_row = tk.Frame(self.frame, bg=COLOR_PREVIEW_BG)
        vol_row.pack(fill="x", padx=6, pady=(0, 8))
        tk.Label(vol_row, text="🔊", bg=COLOR_PREVIEW_BG, font=font_hint).pack(side="left")
        self._volume_var = tk.DoubleVar(value=80.0)
        self._volume_scale = ttk.Scale(
            vol_row, from_=0, to=100, orient="horizontal", variable=self._volume_var,
            command=self._on_volume_change,
        )
        self._volume_scale.pack(side="left", fill="x", expand=True, padx=(4, 0))

        controller.on_progress = self._handle_progress
        controller.on_state_changed = self._handle_state_changed
        controller.on_ended = self._handle_ended
        controller.on_seek_reset = lambda: self._seek_var.set(0)
        controller.on_time_reset = lambda: self._time_var.set("00:00 / 00:00")
        controller.is_seeking_check = lambda: self._seeking

    # ── Controller 回呼 ──────────────────────────────────────────────

    def _handle_progress(self, time_ms, length_ms, update_seek):
        if update_seek:
            self._seek_var.set(max(0, min(1000, time_ms / length_ms * 1000)))
        self._time_var.set(f"{format_ms(time_ms)} / {format_ms(length_ms)}")

    def _handle_state_changed(self, is_playing):
        self._play_btn.config(text="⏸" if is_playing else "▶")

    def _handle_ended(self, length_ms):
        self._play_btn.config(text="▶")
        # 保留在進度尾端；下一次快轉／倒退會由 Controller 重啟播放器並正確
        # 跳轉，不再把畫面顯示成 0 秒卻實際處於 Ended。
        self._seek_var.set(1000)
        if length_ms and length_ms > 0:
            self._time_var.set(f"{format_ms(length_ms)} / {format_ms(length_ms)}")

    # ── 高度／寬度 ───────────────────────────────────────────────────

    def surface_height(self) -> int:
        # 16:9 比例跟著預覽區塊目前寬度走，夾在 [120, 400] 之間，避免拉桿拉到
        # 很窄/很寬時，播放區域整個消失或大到蓋掉底下的播放控制列。
        return int(max(120, min(self._get_preview_width() * 9 // 16, 400)))

    def resize(self) -> None:
        self._surface.configure(height=self.surface_height())

    # ── 載入／播放控制 ───────────────────────────────────────────────

    def load_media(self, p: Path) -> None:
        """把檔案載入全新的播放器；播放本身不自動開始——避免瀏覽清單時意外
        連續跳出聲音，要按 ▶ 才會播。"""
        self._surface.update_idletasks()
        hwnd = self._surface.winfo_id()
        is_video = self._controller.load(p, hwnd)
        self._large_btn.configure(state="normal" if is_video else "disabled")
        if is_video:
            self._icon_label.place_forget()
        else:
            self._icon_label.place(relx=0.5, rely=0.5, anchor="center")
        self._surface.configure(height=self.surface_height())
        self._play_btn.config(text="▶")
        self._time_var.set("00:00 / 00:00")
        self._seek_var.set(0)

    def play_pause(self) -> None:
        self._controller.play_pause()

    def stop(self) -> None:
        self._controller.stop()

    def stop_and_release(self) -> None:
        self._controller.stop_and_release()

    def _on_seek_drag(self, _value):
        self._seeking = True  # 拖曳中先標記，輪詢那邊才不會跟拖曳互搶覆蓋滑桿位置

    def _on_seek_release(self, _event):
        self._controller.set_position(self._seek_var.get() / 1000.0)
        self._seeking = False

    def _on_volume_change(self, value):
        self._controller.request_volume_update(float(value))

    # ── 大視窗 ───────────────────────────────────────────────────────

    def open_large_video(self) -> None:
        """在獨立視窗播放目前 MP4/影片；播放畫面上限 1280×720。"""
        path = self._controller.current_path
        if not path or not self._controller.is_video or not Path(path).exists():
            return
        if self._large_window is not None and self._large_window.winfo_exists():
            self._large_window.lift()
            self._large_window.focus_force()
            return

        root = self.frame.winfo_toplevel()
        win = tk.Toplevel(root)
        win.title(f"影片播放 — {Path(path).name}")
        win.configure(bg="#000000")
        win.geometry("1100x680")
        win.minsize(640, 400)
        win.maxsize(1280, 760)  # 720p 畫面 + 下方控制提示列
        surface = tk.Frame(win, bg="#000000")
        surface.pack(fill="both", expand=True)
        hint = tk.Label(
            win, text="空白鍵：播放／暫停　←：倒退 5 秒　→：快轉 5 秒　Esc：關閉",
            bg=COLOR_HEADER_BG, fg=COLOR_HEADER_FG, font=self._font_hint, pady=7,
        )
        hint.pack(fill="x")
        self._large_window = win
        win.update_idletasks()

        # 播放中直接跨父視窗切換 Win32 HWND，部分顯示卡驅動可能讓 libVLC
        # 畫面凍結甚至 Access Violation；先暫停、綁定後再恢復播放。
        was_playing = self._controller.pause_for_surface_change()
        surface.update_idletasks()
        self._controller.set_active_surface(surface.winfo_id())
        if was_playing:
            root.after(80, self._controller.resume_play)

        if self._on_space_shortcut:
            win.bind("<space>", self._on_space_shortcut)
        if self._on_seek_shortcut:
            win.bind("<Left>", lambda e: self._on_seek_shortcut(e, -5000))
            win.bind("<Right>", lambda e: self._on_seek_shortcut(e, 5000))
        win.bind("<Escape>", lambda _e: self.close_large_video())
        win.protocol("WM_DELETE_WINDOW", self.close_large_video)
        win.focus_force()

    def close_large_video(self) -> None:
        # 不再把仍綁著已銷毀 HWND 的同一個 player 搬回小視窗；重新建立解碼生命
        # 週期，確保關閉大視窗後播放鍵、空白鍵與方向鍵仍可正常使用。快照要在
        # 銷毀視窗「之前」取，讓 VLC 在畫面容器還存在時就先暫停。
        snapshot = self._controller.prepare_surface_change()
        win = self._large_window
        if win is not None:
            try:
                win.destroy()
            except Exception:
                pass
        self._large_window = None
        self._surface.update_idletasks()
        self._controller.resume_after_surface_change(snapshot, self._surface.winfo_id())

    def has_open_large_window(self) -> bool:
        return self._large_window is not None and self._large_window.winfo_exists()
