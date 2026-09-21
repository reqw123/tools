#!/usr/bin/env python3
"""清掉 run.ps1 展示時新增的資料。

只動「這次展示產生、而且精確比對得到」的東西，比對不到就整個中止，不猜：
  1. indexes/.sticky_notes.json 裡「這次執行期間新增、且帶展示特徵（完整標題／標籤「展示」／內文開頭句）」的便利貼
     （其餘便利貼、垃圾桶都不動）——不只認完整標題，因為打字偶發掉字時標題會殘缺
  2. indexes/.sticky_notes_history/ 裡「內含展示便利貼、且是這次執行之後才產生」的快照
  3. indexes/<index>.md——只在裡面所有資料列的路徑都落在 --import-dir 底下時才刪
  4. %APPDATA%/wallpaper-app/settings.json 裡這張便利貼與這個索引集的懸浮視窗紀錄，
     並把 wall 還原成執行前的值

為什麼用 Python 而不是 PowerShell：這兩個 JSON 檔要「原樣寫回」（縮排、非 ASCII 不跳脫、
結尾換行），Windows PowerShell 5.1 的 ConvertTo-Json 會整份重新排版。這裡先驗證
「讀進來再寫出去」跟原檔位元組完全相同才動手，不同就中止。

動手前會把兩個 JSON 備份到 demo/out/backup/。桌面版還開著時拒絕執行（它會覆蓋這些檔案）。
"""
import argparse
from datetime import datetime
import glob
import json
import os
import shutil
import socket
import sys
import time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
IDX = os.path.join(ROOT, 'indexes')
APPDATA = os.environ.get('APPDATA', '')
SETTINGS = os.path.join(APPDATA, 'wallpaper-app', 'settings.json')
BODY_MARK = '這張便利貼是 AI 用真實滑鼠與鍵盤'   # run.ps1 展示便利貼內文的開頭，用來認出殘缺標題的展示便利貼


def load(path, indent):
    raw = open(path, encoding='utf-8').read()
    data = json.loads(raw)
    eol = '\n' if json.dumps(data, ensure_ascii=False, indent=indent) + '\n' == raw else ''
    if json.dumps(data, ensure_ascii=False, indent=indent) + eol != raw:
        sys.exit(f'中止：{path} 讀進來再寫出去跟原檔不一致，不敢動它。')
    return data, eol


def save(path, data, indent, eol):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=indent) + eol)


def port_open(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(('127.0.0.1', port)) == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--title', required=True, help='展示便利貼的標題')
    ap.add_argument('--index', required=True, help='展示時新建的索引集名稱（不含 .md）')
    ap.add_argument('--import-dir', required=True, help='匯入的資料夾（用來確認索引集裡只有這次匯入的東西）')
    ap.add_argument('--restore-wall', default='sticky', choices=['sticky', 'index'], help='執行前的 wall 設定')
    ap.add_argument('--since', type=int, required=True,
                    help='這次執行開始的 Unix 時間（秒）；只清這之後新增的便利貼／產生的歷史快照。'
                         '必填：不給的話比對範圍會變成所有時間，可能誤刪你自己標籤剛好叫「展示」的舊便利貼')
    a = ap.parse_args()

    if port_open(8787) or port_open(8788):
        sys.exit('中止：桌面牆還開著（8787/8788 有人在聽），請先結束它再清理。')

    notes_p = os.path.join(IDX, '.sticky_notes.json')
    backup_dir = os.path.join(os.path.dirname(__file__), 'out', 'backup', time.strftime('%Y%m%d-%H%M%S'))
    os.makedirs(backup_dir, exist_ok=True)
    for p in (notes_p, SETTINGS):
        if os.path.exists(p):
            shutil.copy2(p, backup_dir)

    # 1) 展示便利貼：「這次執行期間新增的」＋「帶展示特徵」（完整標題／標籤「展示」／內文開頭的固定句子）
    #    不只認完整標題——打字偶發掉字時標題會殘缺（實際發生過：少了最後一個「示」），只認完整標題就漏掉了。
    since_local = datetime.fromtimestamp(a.since).isoformat()
    def is_demo(n):
        return (n.get('title') == a.title or n.get('tag') == '展示' or n.get('body', '').startswith(BODY_MARK))
    notes, eol = load(notes_p, 1)
    hit = [n for n in notes['notes'] if n.get('created_at', '') >= since_local and is_demo(n)]
    if len(hit) > 3:
        sys.exit(f'中止：這次執行期間有 {len(hit)} 張符合展示特徵的便利貼，太多了，不確定是不是都是展示產生的。')
    ids = {n['id'] for n in hit}
    if hit:
        before = len(notes['notes'])
        notes['notes'] = [n for n in notes['notes'] if n['id'] not in ids]
        save(notes_p, notes, 1, eol)
        print(f'便利貼：{before} → {len(notes["notes"])}（移除 {len(hit)} 張：{[n["title"] for n in hit]}；垃圾桶 {len(notes.get("trash", []))} 筆未動）')
    else:
        print('便利貼：這次執行期間沒有符合的展示便利貼（可能已清過），略過')

    # 2) 這次產生的歷史快照（內含展示便利貼的內文特徵或完整標題）
    removed = 0
    for f in glob.glob(os.path.join(IDX, '.sticky_notes_history', '*.json')):
        if os.path.getmtime(f) >= a.since - 2:
            txt = open(f, encoding='utf-8').read()
            if BODY_MARK in txt or a.title in txt:
                os.remove(f)
                removed += 1
    print(f'歷史快照：刪除 {removed} 份（這次執行期間產生、內含展示便利貼）')

    # 3) 索引集（確認裡面只有這次匯入的東西才刪）
    idx_p = os.path.join(IDX, a.index + '.md')
    if os.path.exists(idx_p):
        rows = [l for l in open(idx_p, encoding='utf-8') if l.startswith('|') and ':\\' in l]
        outside = [l for l in rows if a.import_dir.lower() not in l.lower()]
        if outside:
            sys.exit(f'中止：{a.index}.md 裡有 {len(outside)} 列不在 {a.import_dir} 底下，不像是純展示資料，沒有刪。')
        os.remove(idx_p)
        print(f'索引集：刪除 {a.index}.md（{len(rows)} 筆資料列，全部都在匯入的資料夾底下）')
    else:
        print('索引集：不存在（可能已清過），略過')

    # 4) 桌面版設定：懸浮視窗紀錄與 wall
    if os.path.exists(SETTINGS):
        s, eol = load(SETTINGS, 2)
        for nid in ids:
            s.get('pinnedNotes', {}).pop(nid, None)
        prefix = a.index + '.md::'
        for k in [k for k in s.get('pinnedEntries', {}) if k.startswith(prefix)]:
            del s['pinnedEntries'][k]
        s['wall'] = a.restore_wall
        save(SETTINGS, s, 2, eol)
        print(f'設定：懸浮便利貼 {len(s.get("pinnedNotes", {}))} 個、懸浮索引項目 {len(s.get("pinnedEntries", {}))} 個，wall={s["wall"]}')
    print(f'備份在：{backup_dir}')


if __name__ == '__main__':
    main()
