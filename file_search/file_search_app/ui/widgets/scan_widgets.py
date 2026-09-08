"""掃描相關的共用 UI 元件——「匯入資料夾...」與「找出未收錄檔案...」兩個
對話框共用同一套掃描進度視窗（含硬上限保護）與類別數量顯示格線。"""

import tkinter as tk
from tkinter import font as tkfont, ttk

from file_search_app.config import (
    BTN_DETECT_ACTIVE, BTN_DETECT_BG, BTN_SECONDARY_ACTIVE, BTN_SECONDARY_BG, COLOR_BG, COLOR_STATUS_FG,
)
from file_search_app.config import CATEGORY_COLOR, FONT_FAMILY
from file_search_app.models import ScanResult
from file_search_app.services.scan_service import ScanService
from file_search_app.ui.styles import styled_button


def render_category_counts(parent, files, font, scan_service: ScanService = None):
    """把 files 依九個類別（含「其他」）的數量畫成一個 3 欄的小格線，排進
    parent 底下——呼叫端要自己在重新掃描前先清空 parent 底下的舊內容
    （destroy 掉 winfo_children()），不然新舊兩批標籤會疊在一起。有找到
    （數量 > 0）的用該類別自己的顏色標出來，跟畫面上類型篩選按鈕的顏色對得
    起來；數量是 0 的用中性灰淡化，避免一堆「0 筆」搶了真正有內容的類別的
    注意力。"""
    scan_service = scan_service or ScanService
    cols = 3
    for idx, (label, icon, count) in enumerate(scan_service.categorize_counts(files)):
        row, col = divmod(idx, cols)
        color = CATEGORY_COLOR.get(label, COLOR_STATUS_FG) if count else COLOR_STATUS_FG
        tk.Label(
            parent, text=f"{icon} {label}：{count:,} 筆", bg=COLOR_BG, fg=color,
            font=font, anchor="w",
        ).grid(row=row, column=col, padx=(0, 18), pady=2, sticky="w")


_EXT_COLS = 5           # 副檔名細目一行排幾格
_EXT_NUM_BG = "#dbe4ec"  # 數量小色塊底色（跟 COLOR_BG 有區隔，凸顯數字）
_EXT_NUM_FG = "#1e3a5f"


def render_ext_breakdown(parent, files, font):
    """在類別數量格線底下畫一個「副檔名 → 數量」的對齊小格線——「文字」「其他」
    這種含多種副檔名的類別，光看類別數量不知道實際是哪些檔案類型。每格左邊
    是副檔名（淡色）、右邊是數量（深色小色塊），一行 _EXT_COLS 格、欄寬固定
    對齊。呼叫端負責清空 parent。沒有檔案就不畫。"""
    if not files:
        return
    from pathlib import Path

    counts = {}
    for path in files:
        ext = Path(path).suffix.lower()
        counts[ext] = counts.get(ext, 0) + 1
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))

    box = tk.Frame(parent, bg=COLOR_BG)
    box.grid(row=99, column=0, columnspan=3, sticky="ew", pady=(6, 0))
    tk.Label(
        box, text="副檔名細目", bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font, anchor="w",
    ).grid(row=0, column=0, columnspan=_EXT_COLS, sticky="w", pady=(0, 2))
    for col in range(_EXT_COLS):
        box.grid_columnconfigure(col, weight=1, uniform="ext")

    num_font = tkfont.Font(font=font)
    num_font.configure(weight="bold")
    for idx, (ext, n) in enumerate(ordered):
        r, c = divmod(idx, _EXT_COLS)
        cell = tk.Frame(box, bg=COLOR_BG)
        cell.grid(row=r + 1, column=c, sticky="w", padx=(0, 14), pady=1)
        tk.Label(
            cell, text=ext or "（無）", bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font, anchor="w",
        ).pack(side="left")
        tk.Label(
            cell, text=f" {n:,} ", bg=_EXT_NUM_BG, fg=_EXT_NUM_FG, font=num_font, anchor="e",
        ).pack(side="left", padx=(5, 0))


def run_scan_with_progress(parent, scan_service: ScanService, jobs, on_done):
    """依序掃描 jobs（每項是 (folder, recursive, extensions) 一組條件），跳出一個
    小進度視窗即時顯示已找到的筆數／進度百分比（相對硬上限），「取消」鈕可隨時
    中止。用 after() 把掃描切成一小批一小批處理，每批處理完才把控制權交還事件
    迴圈再排下一批，不是整個掃描迴圈一次跑完卡住介面。

    掃描筆數一旦超過軟上限（原本可以直接匯入／寫入的安全筆數），會先暫停掃描，
    在這個視窗裡多冒出一顆「繼續掃描」鈕（不是另外跳出擋住畫面的訊息框）——
    按下去才會接著掃到底或撞到硬上限；不管按不按，這次結果都超過安全筆數了，
    呼叫端一律依 ScanResult.write_blocked 鎖住確認鈕，不能拿去寫入／匯入，
    「繼續掃描」單純是讓使用者能看看這個資料夾裡總共有多少個檔案。

    on_done(scan_result: ScanResult) 會在掃描結束時（正常掃完／撞到硬上限／
    使用者取消，三種都算）呼叫一次。
    """
    soft_limit = scan_service.soft_limit
    hard_limit = scan_service.hard_limit

    dlg = tk.Toplevel(parent)
    dlg.title("掃描中")
    dlg.configure(bg=COLOR_BG)
    dlg.transient(parent)
    dlg.resizable(False, False)
    dlg.grab_set()

    font_label = tkfont.Font(family=FONT_FAMILY, size=12)
    pad = tk.Frame(dlg, bg=COLOR_BG)
    pad.pack(fill="both", expand=True, padx=20, pady=16)

    status_var = tk.StringVar(value="掃描中…")
    tk.Label(
        pad, textvariable=status_var, bg=COLOR_BG, font=font_label,
        anchor="w", wraplength=360, justify="left",
    ).pack(fill="x")

    progress = ttk.Progressbar(pad, orient="horizontal", length=360, mode="determinate", maximum=hard_limit)
    progress.pack(fill="x", pady=(10, 4))
    percent_var = tk.StringVar(value="0%")
    tk.Label(pad, textvariable=percent_var, bg=COLOR_BG, fg=COLOR_STATUS_FG, font=font_label).pack(anchor="e")

    state = {"cancelled": False, "hit_hard_cap": False, "over_soft": False, "paused": False}
    found = []
    seen = set()

    iterator = scan_service.iter_jobs(jobs)

    def _cancel():
        state["cancelled"] = True
        if state["paused"]:  # 暫停中沒有排程中的 _step()，取消要自己收尾
            _finish()

    btn_row = tk.Frame(pad, bg=COLOR_BG)
    btn_row.pack(fill="x", pady=(12, 0))
    styled_button(btn_row, "取消", _cancel, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
    continue_btn = styled_button(btn_row, "繼續掃描", lambda: _resume(), BTN_DETECT_BG, BTN_DETECT_ACTIVE, font_label)
    # 一開始不需要「繼續掃描」——只在暫停（超過軟上限）時才 pack 出來。
    dlg.protocol("WM_DELETE_WINDOW", _cancel)  # 掃描中關視窗也當「取消」，狀態才會乾淨收尾

    def _update_progress():
        n = len(found)
        capped = min(n, hard_limit)
        progress["value"] = capped
        percent_var.set(f"{int(capped / hard_limit * 100)}%")
        status_var.set(f"掃描中… 已找到 {n} 個檔案")

    def _finish():
        dlg.grab_release()
        dlg.destroy()
        on_done(ScanResult(
            files=sorted(found),
            write_blocked=state["cancelled"] or state["hit_hard_cap"] or state["over_soft"],
            stopped_early=state["cancelled"],
            hit_hard_limit=state["hit_hard_cap"],
        ))

    def _resume():
        state["paused"] = False
        continue_btn.pack_forget()
        dlg.after(1, _step)

    def _step():
        if state["cancelled"]:
            _finish()
            return
        CHUNK = 300  # 一次只吃一小批就把控制權交還事件迴圈，取消鈕才按得下去
        for _ in range(CHUNK):
            try:
                p = next(iterator)
            except StopIteration:
                _finish()
                return
            key = str(p)
            if key in seen:
                continue
            if len(found) >= hard_limit:
                # 撞到硬上限就直接停在目前累積的筆數，這一筆新找到的檔案不計入
                # found（先判斷再加入，避免 found 實際筆數比硬上限多 1）。
                state["hit_hard_cap"] = True
                _finish()
                return
            seen.add(key)
            found.append(p)
            if len(found) == soft_limit + 1 and not state["over_soft"]:
                state["over_soft"] = True
                state["paused"] = True
                _update_progress()
                status_var.set(
                    f"已找到超過 {soft_limit} 個檔案，超過安全上限——這次結果不能拿去寫入／匯入，"
                    f"但可以按「繼續掃描」看看這個資料夾裡總共有多少個檔案。"
                )
                continue_btn.pack(side="left")
                return
        _update_progress()
        dlg.after(1, _step)

    dlg.after(1, _step)
