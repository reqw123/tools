"""便利貼資料讀寫——跟 `.ai_settings.json`／`.added_times.json` 同一套慣例，存在
`indexes/` 底下、檔名前面加點的全域 JSON（不綁定任何一份索引集），單一檔案裡
同時放筆記清單跟面板目前的展開/收合狀態。內容本身不含機密，不需要比照
AI API Key 額外搬到本機快取目錄。"""

import json
from datetime import datetime
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.models import StickyNote
from file_search_app.repositories.atomic_io import atomic_write_text

_DEFAULT_PANEL_STATE = {"visible": True}


class StickyNoteRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.path = indexes_dir / ".sticky_notes.json"

    def load_notes(self) -> list:
        return self._read_raw()["notes"]

    def save_notes(self, notes: list) -> None:
        raw = self._read_raw()
        raw["notes"] = notes
        self._write_raw(raw)

    def load_panel_state(self) -> dict:
        return self._read_raw()["panel"]

    def save_panel_state(self, *, visible: bool) -> None:
        raw = self._read_raw()
        raw["panel"] = {"visible": bool(visible)}
        self._write_raw(raw)

    def _read_raw(self) -> dict:
        """檔案不存在、損毀或結構不對都回傳一份空白預設值，不拋例外——便利貼是
        可選的輔助功能，資料有問題不該連帶讓主視窗開不起來。"""
        notes = []
        panel = dict(_DEFAULT_PANEL_STATE)
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                data = None
            if isinstance(data, dict):
                for item in data.get("notes", []):
                    note = self._parse_note(item)
                    if note is not None:
                        notes.append(note)
                panel_data = data.get("panel")
                if isinstance(panel_data, dict) and isinstance(panel_data.get("visible"), bool):
                    panel["visible"] = panel_data["visible"]
        return {"notes": notes, "panel": panel}

    def _write_raw(self, raw: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        on_disk = {
            "notes": [self._serialize_note(note) for note in raw["notes"]],
            "panel": raw["panel"],
        }
        atomic_write_text(self.path, json.dumps(on_disk, ensure_ascii=False, indent=1))

    @staticmethod
    def _parse_note(item) -> StickyNote:
        if not isinstance(item, dict):
            return None
        note_id = item.get("id")
        title = item.get("title")
        if not isinstance(note_id, str) or not isinstance(title, str):
            return None
        body = item.get("body", "")
        tag = item.get("tag", "")
        created_raw = item.get("created_at", "")
        try:
            created_at = datetime.fromisoformat(created_raw)
        except (TypeError, ValueError):
            created_at = datetime.now()
        return StickyNote(
            id=note_id,
            title=title,
            body=body if isinstance(body, str) else "",
            tag=tag if isinstance(tag, str) else "",
            created_at=created_at,
        )

    @staticmethod
    def _serialize_note(note: StickyNote) -> dict:
        return {
            "id": note.id,
            "title": note.title,
            "body": note.body,
            "tag": note.tag,
            "created_at": note.created_at.isoformat(),
        }
