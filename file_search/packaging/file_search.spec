# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller 打包設定 —— 產出 dist/FileSearch/FileSearch.exe（onedir）。

打包只影響「多一種發佈方式」，不改變 `python file_search.py` 的行為：
  * 進入點是專案根目錄的 file_search.py，裡面的 _dispatch_worker_if_requested()
    讓打包後的 exe 能用 `FileSearch.exe --run-worker <name> ...` 自我 re-exec
    成子行程 worker（原始碼直接跑時該函式什麼都不做）。
  * config.SCRIPT_DIR 會偵測 sys.frozen：打包版把使用者資料（indexes/ 等）
    放在 exe 旁邊，不放進 exe 內部。

刻意排除 faster-whisper / ctranslate2 那一整串：語音轉錄套件體積是主程式的
好幾倍，打包版預設不含，App 會自動偵測、把「轉錄」功能顯示成不可用。需要的
話另外用原始碼版本執行。

用法（見 build_exe.bat，它會建獨立 venv 再呼叫這支）：
    pyinstaller packaging/file_search.spec --noconfirm
"""

from pathlib import Path

from PyInstaller.utils.hooks import collect_all

SPEC_DIR = Path(SPECPATH).resolve()
PROJECT_ROOT = SPEC_DIR.parent

datas = []
binaries = []
hiddenimports = [
    # file_search.py 的 --run-worker 分派是動態 import，明列出來保險
    "file_search_app.services._transcription_worker",
    "file_search_app.services._legacy_office_worker",
]

# --- 選用套件：裝了就一起打包，沒裝就跳過（跟 App 內 try/except ImportError
#     的容錯設計一致，打包環境缺哪個，該功能就在 exe 裡顯示為不可用） ---
for _pkg in ("PIL", "tkinterdnd2", "vlc", "py7zr", "pypdf", "PyPDF2"):
    try:
        _d, _b, _h = collect_all(_pkg)
        datas += _d
        binaries += _b
        hiddenimports += _h
    except Exception:
        pass

# pywin32（舊版 .doc/.ppt/.xls 的 COM 擷取子行程會用到）
for _mod in ("win32com", "win32com.client", "pythoncom", "pywintypes", "win32timezone"):
    hiddenimports.append(_mod)

# 明確排除語音轉錄那一串重量級相依（含間接相依），避免被 PIL/py7zr 等順帶拉進來
excludes = [
    "faster_whisper", "ctranslate2", "torch", "torchaudio", "torchvision",
    "transformers", "tokenizers", "onnxruntime", "av", "numpy.f2py",
    "tensorflow", "scipy", "pandas", "matplotlib", "IPython", "notebook",
]

a = Analysis(
    [str(PROJECT_ROOT / "file_search.py")],
    pathex=[str(PROJECT_ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="FileSearch",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,          # GUI 程式，不開主控台視窗
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="FileSearch",
)
