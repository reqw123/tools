"""便利貼檔案的版本快照（時光機）——每次 `.sticky_notes.json` 有實質變動
（notes／trash，面板收合之類只動 panel 的不算）就在
`indexes/.sticky_notes_history/` 存一份時間戳副本，最多留 `MAX_SNAPSHOTS` 份。

給「垃圾桶救不回來」的情況用：批次改標籤改錯一批、編輯把內容整段覆蓋掉、
匯入蓋掉一堆、手動改 JSON 改壞……垃圾桶只救「被刪的單則」，救不了這些。
跟 notes-web 共用同一個資料夾與檔名慣例（`YYYYMMDDThhmmss` + 6 位微秒）。

快照是保險：寫不進去、資料夾壞掉都安靜略過，絕不擋住便利貼本身的存檔。
"""

import json
from datetime import datetime
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.repositories.atomic_io import atomic_write_text

_DIRNAME = ".sticky_notes_history"
MAX_SNAPSHOTS = 40
# 檔名：20260908T143005123456.json（日期T時間 + 6 位微秒）。用來擋路徑穿越，
# 也用來排序（字典序＝時間序）。
_STAMP_LEN = len("20260908T143005123456")


def _is_snapshot_name(name: str) -> bool:
    return (
        len(name) == _STAMP_LEN + len(".json")
        and name.endswith(".json")
        and name[8] == "T"
        and name[:8].isdigit()
        and name[9:_STAMP_LEN].isdigit()
    )


class StickyNoteHistoryRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self._dir = indexes_dir / _DIRNAME

    # ── 寫入端（由 StickyNoteRepository._write_raw 呼叫）────────────────

    def snapshot(self, source: Path) -> None:
        """把 `source`（＝剛寫好的 .sticky_notes.json）複製成一份快照。跟最新
        一份快照的 notes＋trash 完全一樣就跳過（不重複存、面板收合不算變動）。"""
        try:
            content = source.read_text(encoding="utf-8")
        except OSError:
            return
        if not self._is_new_state(content):
            return
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            name = self._free_name()
            if name is None:
                return
            atomic_write_text(self._dir / name, content)
            self._prune()
        except OSError:
            pass

    def _free_name(self):
        """`YYYYMMDDThhmmss` + 6 位「微秒」。同一微秒內連寫（測試／批次）會撞
        檔名，這裡往後找一個還沒被占用的——微秒欄位是滾動計數器，不是真的
        時間，排序仍然是時間序。"""
        now = datetime.now()
        stamp = now.strftime("%Y%m%dT%H%M%S")
        usec = now.microsecond
        for _ in range(1_000_000):
            candidate = f"{stamp}{usec:06d}.json"
            if not (self._dir / candidate).exists():
                return candidate
            usec = (usec + 1) % 1_000_000
        return None

    # ── 讀取端（給「版本記錄」對話框）──────────────────────────────────

    def list_snapshots(self) -> list:
        """`[{id, taken_at: datetime, note_count, trash_count}]`，最新在前。
        壞掉／讀不到的那份直接跳過。"""
        out = []
        for path in self._files():
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if not isinstance(data, dict):
                continue
            out.append({
                "id": path.stem,
                "taken_at": self._parse_stamp(path.stem),
                "note_count": len(data["notes"]) if isinstance(data.get("notes"), list) else 0,
                "trash_count": len(data["trash"]) if isinstance(data.get("trash"), list) else 0,
            })
        out.sort(key=lambda s: s["id"], reverse=True)
        return out

    def read_snapshot(self, snapshot_id: str) -> str:
        """回傳某份快照的完整 JSON 字串；id 不合法（擋路徑穿越）或讀不到回 ""。"""
        if not _is_snapshot_name(f"{snapshot_id}.json"):
            return ""
        try:
            return (self._dir / f"{snapshot_id}.json").read_text(encoding="utf-8")
        except OSError:
            return ""

    # ── 內部 ─────────────────────────────────────────────────────────

    def _files(self) -> list:
        if not self._dir.is_dir():
            return []
        return sorted(
            (p for p in self._dir.iterdir() if _is_snapshot_name(p.name)),
            key=lambda p: p.name,
        )

    def _is_new_state(self, content: str) -> bool:
        files = self._files()
        if not files:
            return True
        try:
            newest = json.loads(files[-1].read_text(encoding="utf-8"))
            incoming = json.loads(content)
        except (OSError, ValueError):
            return True
        return (newest.get("notes"), newest.get("trash")) != (
            incoming.get("notes"), incoming.get("trash"),
        )

    def _prune(self) -> None:
        files = self._files()
        for path in files[:-MAX_SNAPSHOTS] if len(files) > MAX_SNAPSHOTS else []:
            try:
                path.unlink()
            except OSError:
                pass

    @staticmethod
    def _parse_stamp(stem: str) -> datetime:
        try:
            return datetime.strptime(stem[:15], "%Y%m%dT%H%M%S")
        except ValueError:
            return datetime.now()
