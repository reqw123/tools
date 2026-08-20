"""本地語音辨識（faster-whisper）——把音訊／影片轉成文字，寫入內容快取後即可
被全文搜尋命中、也能在預覽面板直接閱讀。跟 `ai_description_service.py` 的雲端
AI 摘要是兩件事：這裡純粹「聽寫」，不做任何摘要或歸納，也不需要設定任何
API Key、不會把檔案內容送到外部服務，全部在本機執行。

固定使用 small 模型、固定辨識中文（language="zh"）——這個工具的使用情境本來
就是中文使用者的個人媒體索引，固定下來省得每次都要另外選語言/設定，需要
支援其他語言再回頭做成設定即可。

實際的模型載入與轉錄丟給獨立子行程 `_transcription_worker.py` 執行，不在這裡
（呼叫端的背景執行緒）直接呼叫 faster-whisper：實測發現 ctranslate2（
faster-whisper 底層的推論引擎）在部分機器上載入模型時會直接讓行程 segfault
（native 崩潰，Python 的 try/except 完全攔不住）。子行程一旦崩潰，只有那個
子行程死掉，這個方法會偵測到非正常結束並回傳成一般的錯誤訊息，不會把整個
檔案快速搜尋 App 一起拖死——跟 `preview_service.py` 用子行程隔離 Office COM
自動化（`_legacy_office_worker.py`）是同一種防禦手段，只是這裡多了進度回報
與可即時中斷（COM 那邊只能整段等或用逾時強制殺掉，這裡有子行程主動配合，
可以做到「馬上」回應取消）。

跟 CacheService／AIDescriptionService 一樣：可在背景執行緒安全呼叫，不接觸
任何 Tkinter 物件。progress_cb(fraction) 是子行程用已處理的音訊時間 / 檔案
總長度概算出來、逐行印給這裡解析的進度；cancel_check() 讓呼叫端可以在轉錄
過程中取消——這裡用一個短間隔的輪詢迴圈讀子行程輸出，取消時直接終止子
行程，比等它自己跑到下一個檢查點快得多。"""

import queue
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

_MODEL_SIZE = "small"
_WORKER_SCRIPT = Path(__file__).with_name("_transcription_worker.py")
_POLL_INTERVAL = 0.2


class TranscriptionService:
    @property
    def available(self) -> bool:
        """只代表「faster-whisper 這個套件裝了沒」，不保證模型下載／載入一定
        成功（要第一次真的轉錄時才知道，例如網路不通導致模型下載失敗，或是
        這台機器的 ctranslate2 原生函式庫不相容）——跟 MediaController 的
        `available` 是同一種「先讓功能可以顯示出來，真正失敗再回報」的設計，
        不在這裡預先判斷太多可能失敗的原因。"""
        try:
            import faster_whisper  # noqa: F401
        except ImportError:
            return False
        return True

    def transcribe(self, path: Path, progress_cb=None, cancel_check=None):
        """回傳 (text_or_None, error_or_None, cancelled)。

        text 是 None 且 error 是 None、cancelled 是 True → 使用者取消。
        text 是 None 且 error 有值 → 子行程失敗（找不到 faster-whisper、模型
          下載失敗、崩潰、檔案沒有聲音軌、格式無法解碼等，見錯誤文字）。
        text 有值 → 轉錄成功，已去除頭尾空白。
        """
        if not self.available:
            return None, "尚未安裝 faster-whisper 套件", False

        with tempfile.TemporaryDirectory(prefix="file_search_transcribe_") as tmpdir:
            output_path = Path(tmpdir) / "transcript.txt"
            try:
                proc = subprocess.Popen(
                    [sys.executable, str(_WORKER_SCRIPT), str(path), str(output_path)],
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True, encoding="utf-8", errors="replace",
                )
            except OSError as exc:
                return None, f"無法啟動轉錄子程序：{exc}", False

            line_queue = queue.Queue()

            def _read_stdout():
                try:
                    for line in proc.stdout:
                        line_queue.put(line)
                except Exception:
                    pass
                line_queue.put(None)  # 子行程 stdout 已關閉（結束或崩潰）的結束訊號

            threading.Thread(target=_read_stdout, daemon=True).start()

            cancelled = False
            while True:
                if cancel_check and cancel_check():
                    cancelled = True
                    proc.terminate()
                    break
                try:
                    line = line_queue.get(timeout=_POLL_INTERVAL)
                except queue.Empty:
                    continue
                if line is None:
                    break
                line = line.strip()
                if line.startswith("PROGRESS ") and progress_cb:
                    try:
                        progress_cb(float(line[len("PROGRESS "):]))
                    except ValueError:
                        pass

            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=10)

            if cancelled:
                return None, None, True

            stderr_text = ""
            if proc.stderr:
                try:
                    stderr_text = proc.stderr.read().strip()
                except Exception:
                    stderr_text = ""

            if proc.returncode == 0 and output_path.exists():
                text = output_path.read_text(encoding="utf-8").strip()
                if not text:
                    return None, "沒有辨識出任何文字內容（可能是靜音或沒有語音）", False
                return text, None, False

            # _transcription_worker.py 自己只會回傳 0（成功）／1（處理中失敗，
            # 已印錯誤訊息到 stderr）／2（參數錯誤或缺套件）。任何其他結束碼都
            # 代表子行程被作業系統強制終止（實測發現 ctranslate2 在部分機器上
            # 載入模型會 segfault，Windows 上這種原生崩潰的結束碼通常是一個巨大
            # 的正整數即 STATUS_ACCESS_VIOLATION 之類 NTSTATUS 的無號表示法，
            # POSIX 上則是負數代表被訊號殺掉——這兩種都不是 stderr 已經有清楚
            # 錯誤訊息的正常失敗路徑，不能只看 stderr 有沒有內容判斷。
            if proc.returncode in (1, 2):
                return None, stderr_text or "轉錄失敗（未知錯誤）", False
            return None, (
                f"轉錄子程序異常結束（可能是語音辨識套件跟這台機器的相容性問題），結束碼 {proc.returncode}。"
            ), False
