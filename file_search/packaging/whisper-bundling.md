# 把 Whisper 語音轉錄打進 exe（待辦，尚未實作）

> 狀態：**未做**。目前 `file_search.spec` 刻意排除 faster-whisper 那一串，打包版
> 的「轉錄」功能會自動標為不可用。這份文件記錄「要做的時候怎麼做、要注意什麼」。
> 決定日期：2026-09-01。

## 背景

`file_search_app/services/transcription_service.py` +
`_transcription_worker.py` 用 **faster-whisper**（本機語音辨識）把音訊／影片
轉成文字，供「AI 批次說明」與預覽面板的轉錄功能使用。原始碼版只要
`pip install faster-whisper` 就能用；打包版目前不含。

## 尺寸（已實測，未壓縮，PyInstaller onedir 不太會再壓）

| 項目 | 大小 | 性質 |
|---|---|---|
| `ctranslate2`（`ctranslate2.dll` 就 57 MB）| ~63 MB | 打進 exe，常駐硬碟 |
| `av.libs`（PyAV 帶的 FFmpeg DLL）| ~63 MB | 打進 exe |
| `onnxruntime`（Silero VAD，硬相依）| ~45 MB | 打進 exe |
| `numpy`（目前 build 有排除，加 whisper 要放回）| ~33 MB | 打進 exe |
| `tokenizers` + `huggingface_hub` + `av`(py) + `faster_whisper` | ~20 MB | 打進 exe |
| **打包增量小計** | **≈ 225 MB** | exe 從 ~62 MB → ~280 MB |
| `small` 模型權重 | ~480 MB | **不在 exe**，第一次轉錄才從 HuggingFace 下載到 `~/.cache/huggingface/`，之後快取重用、可離線 |

首次使用後常駐 ≈ **760 MB**。使用者已確認尺寸可接受（2026-09-01）。

## 已知風險

- **ctranslate2 在少數機器載入模型時會 native segfault**（不是 Python 例外，
  try/except 攔不住）——見 `_transcription_worker.py` 檔頭。已隔離在子行程，
  壞掉只讓「轉錄」失敗，App 其他功能照常。打包後這風險散給每個使用者，
  但降級行為是安全的。
- 第一次轉錄需要**連網**下載模型；離線環境要嘛預先放好快取、要嘛改成一起
  打包模型（+480 MB）。
- FFmpeg DLL 一堆（x265 13 MB、avcodec 19 MB…），防毒偶爾會對這類未簽章的
  大量原生 DLL 反應。onedir 比 onefile 好一點。

## 實作步驟（要做時照這個走）

### 1. `packaging/build_exe.bat`

pip install 那行加上 `faster-whisper`：

```bat
"%VPY%" -m pip install pyinstaller pillow py7zr pypdf python-vlc tkinterdnd2 pywin32 faster-whisper
```

### 2. `packaging/file_search.spec`

- 從 `excludes` 拿掉：`faster_whisper`, `ctranslate2`, `av`, `onnxruntime`,
  `numpy.f2py`（`numpy` 整包本來就不該排，確認 excludes 裡沒有它）
- 選用套件迴圈 `for _pkg in (...)` 加入：`faster_whisper`, `ctranslate2`,
  `av`, `onnxruntime`
  （`collect_all` 會一起收 ctranslate2.dll / av.libs / onnxruntime 的
  原生檔；pyinstaller-hooks-contrib 對這三個都有 hook，通常不用手動加
  `binaries`，但打完要驗，見步驟 4）
- 若仍缺原生檔，補：
  ```python
  from PyInstaller.utils.hooks import collect_dynamic_libs
  binaries += collect_dynamic_libs("ctranslate2")
  binaries += collect_dynamic_libs("av")
  ```

### 3. worker 路徑（應該不用改，確認即可）

`file_search.py` 的 `_dispatch_worker_if_requested()` 已經有
`--run-worker transcription` 分派、`worker_launch.worker_argv()` 在凍結時
回傳 `[exe, "--run-worker", "transcription", ...]`。這條路徑本身不用動。

### 4. 驗證（一定要做，光 import OK 不夠）

```bash
# 凍結後真的能載入 CT2 並轉錄
dist/FileSearch/FileSearch.exe --run-worker transcription <某個.mp3> <輸出.txt>
# exit 0 + 輸出檔有內容 = 成功
# exit 1 且 stderr 提到 ctranslate2 / DLL = 原生檔沒收齊，回步驟 2
# 直接 segfault = 這台機器踩到 CT2 的已知崩潰，換台機器再測
```

再從 GUI 實走一次：選一個有旁白的影片 →「AI 批次說明」→ 應看到該筆走
「需要轉錄、較慢」→ 完成後有轉錄文字。

### 5. 模型要不要一起打包

- **不打包（建議）**：exe 維持 ~280 MB，第一次轉錄下載 `small`。程式已有
  「模型下載失敗會回報」的處理。
- **打包 `small`**：離線可用但 +480 MB。做法是先在 build 機器跑一次轉錄讓
  `~/.cache/huggingface/` 有快取，再在 spec 用 `datas` 把該快取資料夾收進
  `_internal/`，並在 `_transcription_worker.py` 設
  `os.environ["HF_HOME"]` 指向凍結後的路徑（`sys._MEIPASS` 或 exe 旁）。

### 6. 文件

- `packaging/README.md` 的功能差異表把「語音轉錄」從 ❌ 改成 ✅（註明首次需
  連網下載模型）。
- CLAUDE.md 不用改（那是原始碼層的說明，不受打包影響）。

## 相關檔案

- `file_search_app/services/transcription_service.py` — 服務層，`available`
  靠 `import faster_whisper` 判斷
- `file_search_app/services/_transcription_worker.py` — 子行程進入點，
  `_MODEL_SIZE = "small"`、`_LANGUAGE = "zh"`
- `file_search_app/worker_launch.py` — 凍結／非凍結的 worker 啟動 argv
- `file_search.py` — `--run-worker` 分派
- `packaging/file_search.spec` / `packaging/build_exe.bat`
