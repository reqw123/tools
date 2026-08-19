"""MP3／MP4 播放控制——載入、播放／暫停／停止、音量與進度、快轉倒退、播放
結束後重新播放、大視窗切換、VLC player/media 生命週期。

刻意不知道 MainWindow 或任何 Widget 的存在：
- 需要非同步等待（例如剛切檔案時 VLC 還在 Opening/Buffering，要等就緒才能
  seek）的排程能力，用建構子注入的 `schedule`/`unschedule`（通常就是 Tk root
  的 `after`/`after_cancel`，由 UI 層決定要用什麼排程機制）取得，不直接持有
  Tk 物件。
- 需要顯示內嵌影像時，只接受呼叫端算好的 Win32 HWND（一個整數），不接受
  Widget；呼叫端自己負責在傳入前 `surface.update_idletasks()` 再取
  `surface.winfo_id()`。
- 播放進度／狀態變化一律透過回呼（`on_progress` / `on_state_changed` /
  `on_ended` / `on_seek_reset` / `on_time_reset`）通知，不直接改任何 Label／
  Button／Scale；`is_seeking_check` 讓呼叫端告知「使用者是否正在拖曳進度
  滑桿」，輪詢更新進度時才不會跟使用者手上的拖曳動作互搶。

_HAS_VLC 只代表「import vlc 這個 Python 模組本身成功」，不保證系統上那份
libvlc 真的能正常初始化（例如安裝損毀、外掛快取壞掉、版本不相容）；
vlc.Instance()／media_player_new() 在這種情況下可能丟例外，這裡接住並把
`available` 降級為 False，讓呼叫端統一用這個旗標判斷整個播放功能是否可用，
不用另外散落各處補檢查。
"""

from pathlib import Path

from file_search_app.config import VIDEO_EXTS

try:
    import vlc
    _HAS_VLC = True
except (ImportError, OSError):
    # OSError（不是只有 ImportError）是因為 python-vlc 這個套件本身就算裝了也不
    # 保證能用——它只是 libvlc 的綁定，實際播放要靠系統裝好的 VLC 應用程式提供
    # libvlc.dll，沒裝 VLC 的話 import 階段就會噴 OSError 找不到 DLL。
    vlc = None
    _HAS_VLC = False


def format_ms(ms) -> str:
    """毫秒轉 MM:SS，給播放進度／時間長度顯示用；None 或負值當作 0 處理，
    避免播放器還沒真正讀到長度時（剛載入的瞬間）出現負數或例外。"""
    if not ms or ms < 0:
        ms = 0
    total_s = int(ms) // 1000
    return f"{total_s // 60:02d}:{total_s % 60:02d}"


class MediaController:
    def __init__(self, schedule, unschedule):
        """schedule(delay_ms, fn) -> token；unschedule(token) -> None。"""
        self._schedule = schedule
        self._unschedule = unschedule

        self.available = _HAS_VLC
        self._instance = None
        self._player = None
        if self.available:
            try:
                self._instance = vlc.Instance()
                self._player = self._instance.media_player_new()
            except Exception:
                self._instance = None
                self._player = None
                self.available = False

        self._media = None  # 必須保留 Python 參照，直到該次播放真正結束
        self._current_path = None
        self._active_hwnd = None  # 目前內嵌影像要綁定的 Win32 HWND（小預覽區塊或大視窗）
        self._volume = 80.0
        self._poll_token = None
        self._volume_after_token = None

        # 呼叫端（UI）自行掛上的回呼；不掛就等於沒有對應的 UI 效果，不會出錯。
        self.on_progress = None          # on_progress(time_ms, length_ms, update_seek: bool)
        self.on_state_changed = None     # on_state_changed(is_playing: bool)
        self.on_ended = None             # on_ended(length_ms)
        self.on_seek_reset = None        # on_seek_reset()
        self.on_time_reset = None        # on_time_reset()
        self.is_seeking_check = None     # () -> bool，True 代表使用者正在拖曳進度滑桿

    # ── 狀態查詢 ─────────────────────────────────────────────────────

    @property
    def current_path(self):
        return self._current_path

    @property
    def is_video(self) -> bool:
        return self._current_path is not None and Path(self._current_path).suffix.lower() in VIDEO_EXTS

    def is_playing(self) -> bool:
        return bool(self._player and self._player.is_playing())

    def get_state(self):
        return self._player.get_state() if self._player is not None else None

    def get_time(self) -> int:
        if self._player is None:
            return 0
        try:
            return max(0, self._player.get_time())
        except Exception:
            return 0

    def get_length(self) -> int:
        if self._player is None:
            return 0
        try:
            return max(0, self._player.get_length())
        except Exception:
            return 0

    # ── 生命週期 ─────────────────────────────────────────────────────

    def create_fresh_player(self, path: Path, hwnd=None) -> None:
        """釋放舊 player/media，為指定檔案建立全新解碼生命週期。"""
        self._cancel_poll()
        old_player = self._player
        old_media = self._media
        self._player = None
        self._media = None
        if old_player is not None:
            try:
                old_player.stop()
                old_player.release()
            except Exception:
                pass
        if old_media is not None:
            try:
                old_media.release()
            except Exception:
                pass

        self._player = self._instance.media_player_new()
        self._media = self._instance.media_new(str(path))
        is_video = path.suffix.lower() in VIDEO_EXTS
        if is_video:
            # D3D11VA 在 Tkinter 內嵌 HWND 切換／重建時，部分 NVIDIA 驅動會無法
            # 配置硬體解碼畫面。720p 上限使用軟體 H.264 解碼較穩定，也避免
            # hardware acceleration picture allocation failed → no frame 連鎖錯誤。
            self._media.add_option(":avcodec-hw=none")
        self._player.set_media(self._media)
        target_hwnd = hwnd if hwnd is not None else self._active_hwnd
        if is_video and target_hwnd is not None:
            self._player.set_hwnd(target_hwnd)

    def load(self, path: Path, hwnd) -> bool:
        """把檔案載入全新的播放器；播放本身不自動開始——避免瀏覽清單時意外
        連續跳出聲音，要呼叫 play_pause() 才會播。回傳這個檔案是不是影片。"""
        self._active_hwnd = hwnd
        self.create_fresh_player(path, hwnd)
        self.apply_volume()
        self._current_path = str(path)
        return self.is_video

    def release(self) -> None:
        """關閉視窗前呼叫：停掉播放器、釋放 libvlc 資源，避免留下背景播放中的
        音訊或殘留的 libvlc 執行緒。"""
        self._cancel_poll()
        if self._player is not None:
            try:
                self._player.stop()
                self._player.release()
            except Exception:
                pass
        if self._media is not None:
            try:
                self._media.release()
            except Exception:
                pass
        if self._instance is not None:
            try:
                self._instance.release()
            except Exception:
                pass

    # ── 播放控制 ─────────────────────────────────────────────────────

    def play_pause(self) -> None:
        if self._player is None:
            return
        state = self._player.get_state()
        if state in (vlc.State.Ended, vlc.State.Stopped, vlc.State.Error) and self._current_path:
            # 播放結束後 libVLC 的 player 仍留著，但 play() 不保證會重新建立
            # MP4 解碼流程。重新掛載同一份 media，讓按鈕／空白鍵可以無限重播。
            self.restart_at(0)
            return
        if self._player.is_playing():
            self._player.pause()
            self._notify_state(False)
        else:
            self._player.play()
            # libvlc 在音訊輸出裝置真正初始化前（也就是 play() 呼叫的當下）設定的
            # 音量，偶爾不會確實生效；play() 之後保險起見再設一次，並延遲補套兩次，
            # 避免滑桿已改變但影片仍沿用 VLC 舊音量。
            self.apply_volume()
            self._schedule(150, self.apply_volume)
            self._schedule(500, self.apply_volume)
            self._notify_state(True)
            self.start_poll()

    def stop(self) -> None:
        """使用者按停止：保留目前媒體路徑，下一次按播放可透過 restart_at() 重新
        建立解碼器；離開預覽才用 stop_and_release() 真正清空媒體。"""
        self._cancel_poll()
        if self._player is not None:
            self._player.stop()
        self._notify_state(False)
        self._reset_time_display()

    def stop_and_release(self) -> None:
        self._cancel_poll()
        if self._player is not None:
            try:
                self._player.stop()
            except Exception:
                pass
        self._notify_state(False)
        self._reset_time_display()
        self._current_path = None

    def restart_at(self, target_ms=0, known_length_ms=None) -> None:
        """重新掛載目前媒體並從指定時間播放，專門恢復 Ended/Stopped/Error。

        不能只 stop() 後 play()：部分 Windows VLC/MP4 組合在播完一次後不會重新
        建立解碼器，必須重新 set_media() 才能讓播放鍵和方向鍵恢復。
        """
        if self._instance is None or not self._current_path:
            return
        current_path = self._current_path
        if not Path(current_path).exists():
            return
        self.create_fresh_player(Path(current_path))
        self._player.play()
        self._notify_state(True)
        if self.on_seek_reset:
            self.on_seek_reset()

        attempts = 0

        def _finish_restart():
            nonlocal attempts
            if self._player is None or self._current_path != current_path:
                return
            state = self._player.get_state()
            if state in (vlc.State.Opening, vlc.State.Buffering, vlc.State.NothingSpecial) and attempts < 12:
                attempts += 1
                self._schedule(100, _finish_restart)
                return
            if target_ms > 0:
                self._player.set_time(int(target_ms))
            self.apply_volume()
            self.start_poll()

        # 等播放管線真正就緒後只定位一次；分成 120ms、350ms 各 set_time() 一次，
        # 容易讓某些 H.264 檔案出現 timestamp conversion / PCR too late，故只等一次。
        self._schedule(120, _finish_restart)
        if known_length_ms and known_length_ms > 0:
            if self.on_progress:
                self.on_progress(target_ms, known_length_ms, True)
        else:
            self._reset_time_display()

    def seek_by(self, delta_ms) -> None:
        """影片播放時快轉／倒退指定毫秒數；沒有可用長度就不動作。"""
        if self._player is None:
            return
        length_ms = self._player.get_length()
        now_ms = self._player.get_time()
        state = self._player.get_state()
        if not length_ms or length_ms <= 0:
            return

        # VLC 播放完會進入 Ended；此狀態下直接 set_time() 通常會被忽略，造成
        # 到結尾後快轉／倒退看似永久失效。先保留目標時間、重新啟動解碼器，再於
        # 播放管線就緒後跳轉。Stopped 也用相同方式恢復。
        if now_ms < 0:
            now_ms = length_ms if state == vlc.State.Ended else 0
        # 不落在最後一毫秒，否則 VLC 會立即再次進入 Ended，下一次跳轉仍失效。
        end_cap = max(0, length_ms - 250)
        target = max(0, min(end_cap, now_ms + delta_ms))

        if state in (vlc.State.Ended, vlc.State.Stopped, vlc.State.Error):
            self.restart_at(target, known_length_ms=length_ms)
        else:
            self._player.set_time(target)
            if self.on_progress:
                self.on_progress(target, length_ms, True)

    def set_position(self, fraction) -> None:
        """進度滑桿放開時呼叫；fraction 是 0.0～1.0。"""
        if self._player is None:
            return
        state = self._player.get_state()
        if state in (vlc.State.Ended, vlc.State.Stopped, vlc.State.Error):
            length_ms = self._player.get_length()
            if length_ms and length_ms > 0:
                target = min(max(0, int(fraction * length_ms)), max(0, length_ms - 250))
                self.restart_at(target, known_length_ms=length_ms)
        else:
            self._player.set_position(fraction)

    # ── 音量 ─────────────────────────────────────────────────────────

    def request_volume_update(self, percent) -> None:
        """滑桿拖曳中連續觸發時呼叫；小 debounce 避免 MP4 解碼／音訊初始化期間
        漏掉最後一次設定。"""
        self._volume = percent
        if self._volume_after_token is not None:
            self._unschedule(self._volume_after_token)
        self._volume_after_token = self._schedule(35, self.apply_volume)

    def apply_volume(self) -> None:
        self._volume_after_token = None
        if self._player is not None:
            volume = max(0, min(100, int(round(float(self._volume)))))
            try:
                self._player.audio_set_mute(False)
                self._player.audio_set_volume(volume)
            except Exception:
                pass

    # ── 大視窗切換 ───────────────────────────────────────────────────

    def set_active_surface(self, hwnd) -> None:
        """切換目前內嵌影像要綁定的 HWND（開啟大視窗、或切回小預覽區塊時用）；
        往後新建立的播放器（restart_at／create_fresh_player 沒指定 hwnd 時）
        也會沿用這個值。"""
        self._active_hwnd = hwnd
        if self._player is not None and self.is_video and hwnd is not None:
            try:
                self._player.set_hwnd(hwnd)
            except Exception:
                pass

    def pause_for_surface_change(self) -> bool:
        """切換播放畫面所在視窗前呼叫：跨父視窗切換 Win32 HWND 時，部分顯示卡
        驅動可能讓 libVLC 畫面凍結甚至 Access Violation，先暫停較安全。回傳
        是否真的處於播放中（呼叫端只在為 True 時才需要之後恢復播放）。"""
        was_playing = self.is_playing()
        if was_playing:
            try:
                self._player.set_pause(1)
            except Exception:
                was_playing = False
        return was_playing

    def resume_play(self) -> None:
        if self._player is not None:
            try:
                self._player.play()
            except Exception:
                pass

    def prepare_surface_change(self) -> dict:
        """切換播放畫面所在的視窗（開啟大視窗、或即將關閉大視窗銷毀 HWND）之前
        呼叫：記錄目前播放位置／播放狀態並嘗試暫停，讓 VLC 在畫面容器還存在時
        就先暫停，避免之後 render 進一個已經被銷毀的 HWND。回傳的快照原樣傳給
        resume_after_surface_change() 用。"""
        return {
            "path": self._current_path,
            "time": self.get_time(),
            "length": self.get_length(),
            "was_playing": self.pause_for_surface_change(),
        }

    def resume_after_surface_change(self, snapshot: dict, hwnd) -> None:
        """從大視窗切回小預覽區塊（或反過來）：重新建立解碼生命週期並綁定新的
        hwnd，就緒後恢復到 snapshot 記錄的時間點與播放/暫停狀態。呼叫前 UI
        應已經把不再需要的舊視窗／畫面容器處理完畢。"""
        media_path = snapshot["path"]
        current_time = snapshot["time"]
        known_length = snapshot["length"]
        was_playing = snapshot["was_playing"]
        if not media_path or not Path(media_path).exists() or self._instance is None:
            return

        self._active_hwnd = hwnd
        self.create_fresh_player(Path(media_path), hwnd)
        self._current_path = media_path
        restored_player = self._player
        restored_player.play()
        attempts = 0

        def _finish_restore():
            nonlocal attempts
            if self._player is not restored_player or self._current_path != media_path:
                return
            state = restored_player.get_state()
            if state in (vlc.State.Opening, vlc.State.Buffering, vlc.State.NothingSpecial) and attempts < 12:
                attempts += 1
                self._schedule(100, _finish_restore)
                return
            resume_time = min(current_time, max(0, known_length - 250)) if known_length else current_time
            if resume_time > 0:
                restored_player.set_time(resume_time)
            self.apply_volume()
            if was_playing:
                self._notify_state(True)
                self.start_poll()
            else:
                try:
                    restored_player.set_pause(1)
                except Exception:
                    pass
                self._notify_state(False)
                self._cancel_poll()
            if known_length > 0 and self.on_progress:
                self.on_progress(resume_time, known_length, True)

        self._schedule(120, _finish_restore)

    # ── 進度輪詢 ─────────────────────────────────────────────────────

    def start_poll(self) -> None:
        self._cancel_poll()
        self._poll_token = self._schedule(400, self._poll)

    def _cancel_poll(self) -> None:
        if self._poll_token is not None:
            self._unschedule(self._poll_token)
            self._poll_token = None

    def _poll(self) -> None:
        """每 400ms 更新一次播放進度顯示——VLC 不會主動推事件進 Tkinter，只能
        用輪詢；使用者正在拖曳進度滑桿時（is_seeking_check）不覆蓋滑桿位置，
        不然會跟使用者手上的拖曳動作互搶，滑桿會一直被拉回播放中的位置。"""
        if self._player is None:
            return
        length_ms = self._player.get_length()
        time_ms = self._player.get_time()
        if length_ms and length_ms > 0 and self.on_progress:
            seeking = bool(self.is_seeking_check and self.is_seeking_check())
            self.on_progress(time_ms, length_ms, not seeking)
        state = self._player.get_state()
        if state == vlc.State.Ended:
            self._notify_state(False)
            # 保留在進度尾端；下一次快轉／倒退會由 seek_by() 重啟播放器並正確
            # 跳轉，不再把畫面顯示成 0 秒卻實際處於 Ended。
            if self.on_ended:
                self.on_ended(length_ms)
            self._poll_token = None
            return  # 播放結束了，不用再排下一次輪詢
        if self._player.is_playing() or state == vlc.State.Paused:
            self._poll_token = self._schedule(400, self._poll)
        else:
            self._poll_token = None

    # ── 內部小工具 ───────────────────────────────────────────────────

    def _notify_state(self, is_playing: bool) -> None:
        if self.on_state_changed:
            self.on_state_changed(is_playing)

    def _reset_time_display(self) -> None:
        if self.on_time_reset:
            self.on_time_reset()
        if self.on_seek_reset:
            self.on_seek_reset()
