"""便利貼資料讀寫——跟 `.ai_settings.json`／`.added_times.json` 同一套慣例，存在
`indexes/` 底下、檔名前面加點的全域 JSON（不綁定任何一份索引集），單一檔案裡
同時放筆記清單、垃圾桶、跟面板目前的展開/收合狀態。內容本身不含機密，不需要
比照 AI API Key 額外搬到本機快取目錄。"""

import base64
import json
import mimetypes
import re
from datetime import datetime
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.models import StickyNote, TrashedStickyNote
from file_search_app.repositories.atomic_io import atomic_write_text
from file_search_app.repositories.json_store import read_json, write_json
from file_search_app.repositories.sticky_note_history_repository import StickyNoteHistoryRepository

_DEFAULT_PANEL_STATE = {"visible": True}

# 便利貼插圖存放的資料夾名稱——跟 notes-web 的 noteImagesDir（同一層、同名）
# 對齊，兩邊共用同一份圖片。桌面版本身不顯示/編輯插圖，只在匯出／匯入時
# 讀寫這個資料夾，讓「搬便利貼」時圖片能一起帶走。
_IMAGES_DIRNAME = ".sticky_note_images"

# 標籤自訂顏色——獨立的小檔案，不塞進 .sticky_notes.json：這是顯示偏好，不是
# 便利貼資料本身，分開存壞掉互不牽連。跟 notes-web 的 .sticky_tag_colors.json
# 同名同格式（{"<標籤>": "#rrggbb", ...}），兩邊各自讀寫、同一份檔案。
_TAG_COLORS_FILENAME = ".sticky_tag_colors.json"

# 自訂標籤顏色只認 #rrggbb（跟 notes-web 的 HEX_COLOR_RE 同一條規則）——檔案
# 是跟 notes-web 共用、也可能被手動編輯的，格式不對的值直接當作沒設定，不然
# 拿去 tk 的 configure(bg=...) 會丟 TclError，一筆壞資料就讓整個便利貼面板
# 畫不出來。
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class StickyNoteRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.path = indexes_dir / ".sticky_notes.json"
        self._images_dir = indexes_dir / _IMAGES_DIRNAME
        self._tag_colors_path = indexes_dir / _TAG_COLORS_FILENAME
        self._history = StickyNoteHistoryRepository(indexes_dir)

    def load_tag_colors(self) -> dict:
        """標籤→自訂顏色（hex）對照表；沒有自訂過的標籤不會出現在這裡，交由
        呼叫端（StickyNoteService.color_for_tag）退回雜湊配色。檔案不存在或
        壞掉都回傳空字典，不拋例外——這是次要的顯示偏好，不該擋住便利貼本身
        的顯示。"""
        data = read_json(self._tag_colors_path, None)
        if isinstance(data, dict):
            return {
                k: v for k, v in data.items()
                if isinstance(k, str) and isinstance(v, str) and _HEX_COLOR_RE.match(v)
            }
        return {}

    def save_tag_colors(self, colors: dict) -> None:
        write_json(self._tag_colors_path, colors)

    def load_notes(self) -> list:
        return self._read_raw()["notes"]

    def load_trash(self) -> list:
        return self._read_raw()["trash"]

    def mutate(self, fn) -> None:
        """讀「目前磁碟上最新的」便利貼清單、交給 `fn` 改、再寫回——所有新增／
        編輯都走這條路（刪除／復原改走 mutate_all()，見下方），不是「先
        load_notes() 一份、慢慢改、最後整包寫回」。後者的「讀」跟「寫」中間
        隔了對話框往返、使用者打字的時間，這段期間如果同一支程式又開了第二
        個視窗、或另一個行程也動了同一個檔案，晚存的那次會把對方的變更整包
        蓋掉。這裡把讀→改→寫縮到同一個同步呼叫內，同支程式的併發完全消除，
        跨行程也只剩幾毫秒的空窗（桌面單人使用實務上夠了；真的要滴水不漏得
        上檔案鎖，不值得為這個輔助功能加相依）。

        `fn(notes)` 回傳新的清單就寫回；回傳 `None` 代表「看過了但沒有要改」
        （例如編輯時給的 id 根本不存在），直接跳過寫檔，不做無謂的 IO。
        `raw["trash"]` 原樣保留、不受影響。
        """
        raw = self._read_raw()
        result = fn(raw["notes"])
        if result is None:
            return
        raw["notes"] = result
        self._write_raw(raw)

    def mutate_all(self, fn) -> None:
        """跟 mutate() 同一個模式，但同時把 notes 跟 trash 都交給 fn 改——給
        「移到垃圾桶」「從垃圾桶復原／永久刪除」這種需要同時動兩份清單的
        操作用。`fn(notes, trash) -> (new_notes, new_trash) | None`，回傳
        `None` 代表不寫檔。"""
        raw = self._read_raw()
        result = fn(raw["notes"], raw["trash"])
        if result is None:
            return
        raw["notes"], raw["trash"] = result
        self._write_raw(raw)

    def load_panel_state(self) -> dict:
        return self._read_raw()["panel"]

    def save_panel_state(self, *, visible: bool) -> None:
        raw = self._read_raw()
        raw["panel"] = {"visible": bool(visible)}
        self._write_raw(raw)

    def remove_image_file(self, filename: str) -> None:
        """垃圾桶「永久刪除」時一併清掉對應的插圖檔——這是真的沒得救的那一刻，
        不清的話圖片會變成沒有任何便利貼指向的孤兒檔案，留在磁碟上越積越多。
        檔案不存在、刪不掉都安靜略過，不該讓這種次要清理動作擋住刪除本身。"""
        if not filename:
            return
        try:
            (self._images_dir / filename).unlink(missing_ok=True)
        except OSError:
            pass

    def serialize_notes(self, notes: list) -> str:
        """把一份便利貼清單序列化成獨立可攜的 JSON 字串——給「匯出便利貼資料」
        用，格式是 `.sticky_notes.json` 那個 `notes` 陣列本身（不含 `panel`
        狀態，那是這台機器/這個視窗自己的顯示設定，不該跟著搬到別台電腦）。
        有插圖的筆記會把圖片內容一併用 base64 內嵌成 `image_data`（見
        `_read_image_data_uri()`）——只存檔名的話，搬到別台電腦「檔名對得上
        但圖片根本沒過去」，插圖連結會整個斷掉；內嵌之後 `parse_notes()`
        才有東西可以寫回本機的插圖資料夾。跟 `parse_notes()` 成對。"""
        items = []
        for n in notes:
            item = self._serialize_note(n)
            if n.image:
                data_uri = self._read_image_data_uri(n.image)
                if data_uri:
                    item["image_data"] = data_uri
            items.append(item)
        return json.dumps({"notes": items}, ensure_ascii=False, indent=2)

    def parse_notes(self, text: str) -> list:
        """`serialize_notes()` 的反向操作——給「匯入便利貼資料」用。壞掉的
        JSON、或格式對不上（不是 `{"notes": [...]}`）直接拋 ValueError，讓
        呼叫端顯示明確的錯誤訊息；單筆格式不符的項目安靜跳過（跟 `_read_raw()`
        對主檔案的容錯一致），不會因為一筆壞資料讓整批匯入失敗。筆記帶
        `image_data`（內嵌的 base64 圖片）時，順便把圖片寫回本機的插圖資料夾
        ——目標檔名已經存在就跳過寫入（避免蓋掉剛好同名的別張圖），筆記本身
        還是照常匯入，只是插圖沿用本機既有那一張。"""
        try:
            data = json.loads(text)
        except ValueError as exc:
            raise ValueError(f"不是合法的 JSON：{exc}") from exc
        if not isinstance(data, dict) or not isinstance(data.get("notes"), list):
            raise ValueError("格式不對——找不到 notes 陣列")
        notes = []
        for item in data["notes"]:
            note = self._parse_note(item)
            if note is None:
                continue
            image_data = item.get("image_data") if isinstance(item, dict) else None
            if note.image and isinstance(image_data, str):
                self._write_image_data_uri(note.image, image_data)
            notes.append(note)
        return notes

    def _read_image_data_uri(self, filename: str) -> str:
        """讀插圖檔案、編成 `data:<mime>;base64,...`——讀不到（檔案不存在、
        權限問題）就回空字串，呼叫端當作「這筆沒有可內嵌的圖」處理，不影響
        筆記本身的匯出。"""
        path = self._images_dir / filename
        try:
            raw = path.read_bytes()
        except OSError:
            return ""
        mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"

    def _write_image_data_uri(self, filename: str, data_uri: str) -> None:
        """`_read_image_data_uri()` 的反向操作——解出 base64 內容寫回插圖
        資料夾。目標檔名已經存在，或 data URI 格式不對／解碼失敗，都安靜
        跳過（筆記本身照常匯入，只是插圖沿用本機既有的，或維持沒有圖）。"""
        path = self._images_dir / filename
        if path.exists():
            return
        try:
            _, _, b64 = data_uri.partition(",")
            raw = base64.b64decode(b64, validate=True)
        except (ValueError, TypeError):
            return
        try:
            self._images_dir.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
        except OSError:
            pass

    def _read_raw(self) -> dict:
        """檔案不存在、損毀或結構不對都回傳一份空白預設值，不拋例外——便利貼是
        可選的輔助功能，資料有問題不該連帶讓主視窗開不起來。"""
        notes = []
        trash = []
        panel = dict(_DEFAULT_PANEL_STATE)
        data = read_json(self.path, None)
        if isinstance(data, dict):
            for item in data.get("notes", []):
                note = self._parse_note(item)
                if note is not None:
                    notes.append(note)
            for item in data.get("trash", []):
                trashed = self._parse_trashed(item)
                if trashed is not None:
                    trash.append(trashed)
            panel_data = data.get("panel")
            if isinstance(panel_data, dict) and isinstance(panel_data.get("visible"), bool):
                panel["visible"] = panel_data["visible"]
        return {"notes": notes, "trash": trash, "panel": panel}

    def _write_raw(self, raw: dict) -> None:
        write_json(self.path, {
            "notes": [self._serialize_note(note) for note in raw["notes"]],
            "trash": [self._serialize_trashed(t) for t in raw["trash"]],
            "panel": raw["panel"],
        })
        self._history.snapshot(self.path)  # 每次實質變動存一份版本快照（時光機）

    # ── 版本快照（時光機）——委派給 StickyNoteHistoryRepository ───────────

    def list_snapshots(self) -> list:
        return self._history.list_snapshots()

    def restore_snapshot(self, snapshot_id: str) -> bool:
        """把某份快照的內容寫回 `.sticky_notes.json`。回傳有沒有真的還原到。
        還原前先把「現在」也存一份快照，所以還原本身可以再還原回去。"""
        content = self._history.read_snapshot(snapshot_id)
        if not content:
            return False
        try:
            data = json.loads(content)
        except ValueError:
            return False
        if not isinstance(data, dict) or not isinstance(data.get("notes"), list):
            return False
        self._history.snapshot(self.path)  # 先保住現況
        try:
            atomic_write_text(self.path, content)
        except OSError:
            return False
        self._history.snapshot(self.path)  # 還原後的狀態也記一筆
        return True

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
        due_at = item.get("due_at", "")
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
            due_at=due_at if isinstance(due_at, str) else "",
            pinned=item.get("pinned") is True,
        )

    @staticmethod
    def _serialize_note(note: StickyNote) -> dict:
        return {
            "id": note.id,
            "title": note.title,
            "body": note.body,
            "tag": note.tag,
            "image": note.image,
            "due_at": note.due_at,
            "pinned": note.pinned,
            "created_at": note.created_at.isoformat(),
        }

    @staticmethod
    def _parse_trashed(item) -> TrashedStickyNote:
        note = StickyNoteRepository._parse_note(item)
        if note is None:
            return None
        deleted_raw = item.get("deleted_at", "") if isinstance(item, dict) else ""
        try:
            deleted_at = datetime.fromisoformat(deleted_raw)
        except (TypeError, ValueError):
            deleted_at = datetime.now()
        return TrashedStickyNote(
            id=note.id, title=note.title, body=note.body, tag=note.tag,
            created_at=note.created_at, image=note.image, due_at=note.due_at,
            pinned=note.pinned, deleted_at=deleted_at,
        )

    @staticmethod
    def _serialize_trashed(t: TrashedStickyNote) -> dict:
        return {
            "id": t.id,
            "title": t.title,
            "body": t.body,
            "tag": t.tag,
            "image": t.image,
            "due_at": t.due_at,
            "pinned": t.pinned,
            "created_at": t.created_at.isoformat(),
            "deleted_at": t.deleted_at.isoformat(),
        }
