"""背景執行緒 → queue.Queue → 主執行緒 after() 輪詢 的共用樣板。

Tkinter 只能在主執行緒碰 widget，慢的工作（AI 呼叫、轉錄、擷取文字）要丟
背景執行緒；背景端把進度／結果 put 進 queue，主執行緒用 after() 定期取出來
更新畫面。這個迴圈每個功能都手抄一次很容易出錯——少寫「啟動輪詢」那一行
就永遠不輪詢、少接某種訊息就每 100ms 空轉——集中成一個。
"""

import queue as _queue
import threading


def start_worker(work, result_queue) -> None:
    """把 `work()`（不接參數）丟到 daemon 執行緒。`work` 自己負責把進度／結果
    put 進 `result_queue`；這裡多包一層：未預期的例外也 put 成
    `("error", exc)`，不讓執行緒無聲死掉、輪詢端永遠等不到。"""
    def _runner():
        try:
            work()
        except Exception as exc:  # noqa: BLE001
            result_queue.put(("error", exc))

    threading.Thread(target=_runner, daemon=True).start()


def poll_queue(widget, result_queue, on_message, interval_ms: int = 100) -> None:
    """在 `widget` 上啟動一個 after() 迴圈，把 `result_queue` 裡累積的訊息逐一
    交給 `on_message(message)`。`on_message` 回傳 True＝收工、不再排下一次
    （通常是拿到 done／error）；回傳 falsy＝繼續輪詢。widget 已銷毀時自動停。

    每個 tick 會把佇列排空（while 迴圈），不是一次只取一則——進度訊息累積時
    才不會落後畫面好幾拍。
    """
    def _tick():
        try:
            if not widget.winfo_exists():
                return
        except Exception:  # noqa: BLE001
            return
        try:
            while True:
                if on_message(result_queue.get_nowait()):
                    return
        except _queue.Empty:
            pass
        widget.after(interval_ms, _tick)

    widget.after(interval_ms, _tick)
