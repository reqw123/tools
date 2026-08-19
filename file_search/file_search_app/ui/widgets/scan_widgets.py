"""掃描相關的共用 UI 元件——「匯入資料夾...」與「找出未收錄檔案...」兩個
對話框共用同一套掃描進度視窗（含軟／硬上限詢問）與類別數量顯示格線。"""

import tkinter as tk
from tkinter import font as tkfont, messagebox, ttk

from file_search_app.config import COLOR_BG, COLOR_STATUS_FG, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE
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


def run_scan_with_progress(parent, scan_service: ScanService, jobs, on_done):
    """依序掃描 jobs（每項是 (folder, recursive, extensions) 一組條件），跳出一個
    小進度視窗即時顯示已找到的筆數／進度百分比（相對硬上限），「取消」鈕可隨時
    中止。用 after() 把掃描切成一小批一小批處理，每批處理完才把控制權交還事件
    迴圈再排下一批，不是整個掃描迴圈一次跑完卡住介面。

    掃描筆數一旦超過軟上限（原本可以直接匯入的安全筆數），會先暫停掃描、跳出
    對話框問使用者要不要繼續看下去——不管答案是哪個，這次掃描結果都不會拿去
    寫入索引檔案，呼叫端要依 ScanResult.write_blocked 鎖住確認鈕。

    on_done(scan_result: ScanResult) 會在掃描結束時（正常掃完／撞到硬上限／
    使用者取消／使用者選擇不繼續，四種都算）呼叫一次。
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

    state = {"cancelled": False, "declined": False, "asked": False, "write_blocked": False, "hit_hard_cap": False}
    found = []
    seen = set()

    iterator = scan_service.iter_jobs(jobs)

    def _cancel():
        state["cancelled"] = True

    btn_row = tk.Frame(pad, bg=COLOR_BG)
    btn_row.pack(fill="x", pady=(12, 0))
    styled_button(btn_row, "取消", _cancel, BTN_SECONDARY_BG, BTN_SECONDARY_ACTIVE, font_label).pack(side="right")
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
            write_blocked=state["write_blocked"] or state["cancelled"],
            stopped_early=state["cancelled"] or state["declined"],
            hit_hard_limit=state["hit_hard_cap"],
        ))

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
                state["write_blocked"] = True
                _finish()
                return
            seen.add(key)
            found.append(p)
            if len(found) == soft_limit + 1 and not state["asked"]:
                state["asked"] = True
                state["write_blocked"] = True
                _update_progress()
                proceed = messagebox.askyesno(
                    "掃描筆數過多",
                    f"已經找到超過 {soft_limit} 個檔案。這次掃描結果不會用來寫入索引檔案"
                    f"（不管接下來選繼續還是停止都一樣，只能看筆數／瀏覽）。\n\n"
                    f"要繼續掃描到上限 {hard_limit:,} 筆，看看資料夾裡總共有多少個檔案嗎？\n"
                    f"選「否」會停在目前找到的 {len(found)} 筆，不再繼續掃描。",
                    parent=dlg,
                )
                if not proceed:
                    state["declined"] = True
                    _finish()
                    return
        _update_progress()
        dlg.after(1, _step)

    dlg.after(1, _step)
