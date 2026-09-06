"""便利貼資料讀寫——跟 `.ai_settings.json`／`.added_times.json` 同一套慣例，存在
`indexes/` 底下、檔名前面加點的全域 JSON（不綁定任何一份索引集），單一檔案裡
同時放筆記清單跟面板目前的展開/收合狀態。內容本身不含機密，不需要比照
AI API Key 額外搬到本機快取目錄。"""

import json
from datetime import datetime
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.models import StickyNote
from file_search_app.repositories.json_store import read_json, write_json

_DEFAULT_PANEL_STATE = {"visible": True}


class StickyNoteRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.path = indexes_dir / ".sticky_notes.json"

    def load_notes(self) -> list:
        return self._read_raw()["notes"]

    def mutate(self, fn) -> None:
        """讀「目前磁碟上最新的」便利貼清單、交給 `fn` 改、再寫回——所有新增／
        編輯／刪除都走這條路，不是「先 load_notes() 一份、慢慢改、最後整包
        寫回」。後者的「讀」跟「寫」中間隔了對話框往返、使用者打字的時間，
        這段期間如果同一支程式又開了第二個視窗、或另一個行程也動了同一個
        檔案，晚存的那次會把對方的變更整包蓋掉。這裡把讀→改→寫縮到同一個
        同步呼叫內，同支程式的併發完全消除，跨行程也只剩幾毫秒的空窗（桌面
        單人使用實務上夠了；真的要滴水不漏得上檔案鎖，不值得為這個輔助功能
        加相依）。

        `fn(notes)` 回傳新的清單就寫回；回傳 `None` 代表「看過了但沒有要改」
        （例如編輯時給的 id 根本不存在），直接跳過寫檔，不做無謂的 IO。
        """
        raw = self._read_raw()
        result = fn(raw["notes"])
        if result is None:
            return
        raw["notes"] = result
        self._write_raw(raw)

    def load_panel_state(self) -> dict:
        return self._read_raw()["panel"]

    def save_panel_state(self, *, visible: bool) -> None:
        raw = self._read_raw()
        raw["panel"] = {"visible": bool(visible)}
        self._write_raw(raw)

    def serialize_notes(self, notes: list) -> str:
        """把一份便利貼清單序列化成獨立可攜的 JSON 字串——給「匯出便利貼資料」
        用，格式是 `.sticky_notes.json` 那個 `notes` 陣列本身（不含 `panel`
        狀態，那是這台機器/這個視窗自己的顯示設定，不該跟著搬到別台電腦）。
        跟 `parse_notes()` 成對，之後可以在別台電腦（或同一台）讀回來。"""
        return json.dumps(
            {"notes": [self._serialize_note(n) for n in notes]},
            ensure_ascii=False, indent=2,
        )

    def parse_notes(self, text: str) -> list:
        """`serialize_notes()` 的反向操作——給「匯入便利貼資料」用。壞掉的
        JSON、或格式對不上（不是 `{"notes": [...]}`）直接拋 ValueError，讓
        呼叫端顯示明確的錯誤訊息；單筆格式不符的項目安靜跳過（跟 `_read_raw()`
        對主檔案的容錯一致），不會因為一筆壞資料讓整批匯入失敗。"""
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise ValueError(f"不是合法的 JSON：{exc}") from exc
        if not isinstance(data, dict) or not isinstance(data.get("notes"), list):
            raise ValueError("格式不對——找不到 notes 陣列")
        notes = []
        for item in data["notes"]:
            note = self._parse_note(item)
            if note is not None:
                notes.append(note)
        return notes

    def _read_raw(self) -> dict:
        """檔案不存在、損毀或結構不對都回傳一份空白預設值，不拋例外——便利貼是
        可選的輔助功能，資料有問題不該連帶讓主視窗開不起來。"""
        notes = []
        panel = dict(_DEFAULT_PANEL_STATE)
        data = read_json(self.path, None)
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
        write_json(self.path, {
            "notes": [self._serialize_note(note) for note in raw["notes"]],
            "panel": raw["panel"],
        })

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
        image = item.get("image", "")
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
            image=image if isinstance(image, str) else "",
        )

    @staticmethod
    def _serialize_note(note: StickyNote) -> dict:
        return {
            "id": note.id,
            "title": note.title,
            "body": note.body,
            "tag": note.tag,
            "image": note.image,
            "created_at": note.created_at.isoformat(),
        }
