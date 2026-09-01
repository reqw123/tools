"""統一的「怎麼啟動某個子行程 worker」入口。

背景：轉錄（`services/_transcription_worker.py`）跟舊版 Office COM 擷取
（`services/_legacy_office_worker.py`）都刻意獨立成子行程執行，呼叫端原本用
`[sys.executable, <worker.py 的絕對路徑>, *args]` 啟動。

直接跑原始碼時這樣沒問題；但被 PyInstaller 打包成 .exe 後：
  * `sys.executable` 是打包出來的 exe，不是 python 直譯器
  * worker 的 .py 檔不在磁碟上（被包進 exe）
所以那個 argv 會啟動失敗。

這個模組把差異收斂成一個函式：
  * 沒打包（一般情形）→ 回傳跟以前一模一樣的 argv，行為完全不變
  * 有打包（sys.frozen）→ 回傳 `[exe, "--run-worker", <name>, *args]`，
    由 `file_search.py` 開頭的 dispatch 接手，re-exec 進對應 worker 的 main()

呼叫端不需要判斷有沒有打包，只要 `worker_argv("transcription", a, b)`。
"""

import sys
from pathlib import Path

_SERVICES_DIR = Path(__file__).resolve().parent / "services"

# name -> 對應 worker 原始碼路徑（非打包情形用）
_WORKER_SCRIPTS = {
    "transcription": _SERVICES_DIR / "_transcription_worker.py",
    "legacy_office": _SERVICES_DIR / "_legacy_office_worker.py",
}


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def worker_argv(name: str, *args: str) -> list:
    """組出啟動指定 worker 的 subprocess argv。args 一律是字串。"""
    if name not in _WORKER_SCRIPTS:
        raise KeyError(f"未知的 worker：{name}")
    if is_frozen():
        return [sys.executable, "--run-worker", name, *args]
    return [sys.executable, str(_WORKER_SCRIPTS[name]), *args]


def worker_available(name: str) -> bool:
    """這個 worker 是否可被啟動——打包版一律 True（已內建進 exe）；非打包版
    要實體 .py 檔存在才算（沿用 preview_service 原本對舊版 Office worker 的
    `.exists()` 前置檢查語意）。"""
    if is_frozen():
        return True
    script = _WORKER_SCRIPTS.get(name)
    return bool(script and script.exists())
