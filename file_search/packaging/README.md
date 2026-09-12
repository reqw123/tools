# 打包成 .exe

`python file_search.py` 的原始碼執行方式**完全不受影響**，這個資料夾只是多
提供一種「發佈成免安裝 exe」的方式。

## 怎麼打包

```
packaging\build_exe.bat
```

它會：

1. 在 `packaging\.build-venv\` 建一個打包專用的虛擬環境（**不動系統 anaconda / 全域環境**）
2. 在該 venv 裝 `pyinstaller` + 要一起打包的選用套件（Pillow、py7zr、pypdf、python-vlc、tkinterdnd2）
3. 依 `file_search.spec` 打包
4. 產出 `dist\FileSearch\FileSearch.exe`

想指定其他 Python：先 `set PY=D:\path\to\python.exe` 再跑 bat。

## 發佈

整個 `dist\FileSearch\` 資料夾一起帶走（onedir 模式）。第一次執行 `FileSearch.exe`
會在它旁邊自動建立 `indexes\`，存放 `.md` 索引、`.ai_settings.json`、
`.sticky_notes.json` 等使用者資料。

## 功能差異（打包版 vs 原始碼版）

| 功能 | 打包版 | 說明 |
|---|---|---|
| 搜尋 / 索引 / 便利貼 / AI 搜尋 / AI 批次說明 | ✅ | 完整 |
| 圖片縮圖預覽 | ✅ | Pillow 已打包 |
| .doc/.ppt/.xls 內容擷取 | ⚠️ | 需目標機器有 Microsoft Office（COM 自動化，跟原始碼版一樣） |
| 音訊 / 影片播放 | ⚠️ | 需目標機器裝有 VLC（提供 libvlc.dll，跟原始碼版一樣） |
| 語音轉錄（faster-whisper）| ❌ | **刻意不打包**（相依 ~225 MB + 首次下載 ~480 MB 模型）；App 會自動標為不可用。需要就用原始碼版。之後若要打包進去，做法與注意事項見 [`whisper-bundling.md`](whisper-bundling.md) |

## 打包相關的程式碼改動（都做過「非打包時行為不變」的驗證）

- `file_search_app/config.py` — `SCRIPT_DIR` 偵測 `sys.frozen`；非打包時走的還是原本
  `Path(__file__).resolve().parent.parent`。
- `file_search_app/worker_launch.py`（新增）— 統一子行程 worker 的啟動 argv；非打包時
  回傳跟以前一模一樣的 `[python, <worker>.py, ...]`。
- `file_search.py` — 開頭加 `_dispatch_worker_if_requested()`；沒有 `--run-worker`
  旗標時（即一般啟動）什麼都不做。
- `transcription_service.py` / `preview_service.py` — 子行程啟動改呼叫 `worker_argv()`。

## 清理

`packaging\.build-venv\`、`packaging\build\`、`dist\` 都可以安全刪除，下次跑 bat 會重建。
建議把這三者加進 `.gitignore`。
