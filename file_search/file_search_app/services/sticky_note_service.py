"""便利貼業務邏輯——新增／編輯／刪除、關鍵字＋標籤篩選、標籤自動配色、既有
標籤清單（給新增/編輯對話框跟篩選下拉選單做自動完成用）。不依賴 Tkinter。"""

import colorsys
import hashlib
import json
import re
import uuid
from datetime import datetime

from file_search_app.config import STICKY_NEUTRAL_COLOR, STICKY_TAG_LIGHTNESS, STICKY_TAG_SATURATION
from file_search_app.models import StickyNote
from file_search_app.repositories.sticky_note_repository import StickyNoteRepository

# AI 搜尋一則便利貼內容送給模型時最多帶這麼多字——便利貼本來就是短筆記，
# 不像批次補說明那種要摘要整份文件，不需要照 CACHE_TEXT_CHARS 那個等級的
# 長度；便利貼數量一多，每則太長反而讓整個 prompt 暴增、變慢又燒 token。
AI_SEARCH_BODY_SNIPPET_CHARS = 200


class StickyNoteService:
    def __init__(self, repo: StickyNoteRepository):
        self._repo = repo

    def list_notes(self) -> list:
        """全部便利貼，最新在上。"""
        return sorted(self._repo.load_notes(), key=lambda n: n.created_at, reverse=True)

    def search(self, notes: list, query: str, tag_filter: str) -> list:
        """query 同時比對標題與內容（不比對標籤，標籤篩選另外用 tag_filter）；
        tag_filter 為空字串代表不篩選標籤。"""
        typed = query.strip().lower()
        result = notes
        if tag_filter:
            result = [n for n in result if n.tag == tag_filter]
        if typed:
            result = [n for n in result if typed in n.title.lower() or typed in n.body.lower()]
        return result

    def known_tags(self) -> list:
        tags = {n.tag for n in self._repo.load_notes() if n.tag}
        return sorted(tags)

    def color_for_tag(self, tag: str) -> str:
        """同一個標籤要跨次啟動、跨行程都對到同一個顏色——不能用內建 hash()，
        字串的雜湊值每次啟動 Python 都會換一組隨機種子（雜湊隨機化），同一個
        標籤在這次跟下次啟動會配到不同顏色。

        色相（hue）直接連續取自雜湊值、算在 0~359 度的色環上，不是從一組
        固定的幾種顏色裡挑一個——固定色盤（例如只有 8 種）一旦標籤數量超過
        色盤大小，等於一定會有兩個不同標籤撞色（鴿籠原理），色環有 360 個
        可能值，撞色機率低很多；但終究是有限的桶數，標籤多到一定程度（人眼
        本來就分不清楚十幾種以上顏色的差異）還是可能出現顏色很像的情況——
        這時候標籤文字本身（卡片上的「# 標籤」）才是真正用來分辨的依據，
        顏色只是方便一眼分群的輔助。"""
        if not tag:
            return STICKY_NEUTRAL_COLOR
        digest = hashlib.md5(tag.encode("utf-8")).hexdigest()
        hue = (int(digest, 16) % 360) / 360.0
        r, g, b = colorsys.hls_to_rgb(hue, STICKY_TAG_LIGHTNESS, STICKY_TAG_SATURATION)
        return f"#{int(r * 255):02x}{int(g * 255):02x}{int(b * 255):02x}"

    def add_note(self, title: str, body: str, tag: str) -> StickyNote:
        notes = self._repo.load_notes()
        note = StickyNote(
            id=uuid.uuid4().hex, title=title.strip(), body=body.strip(), tag=tag.strip(),
            created_at=datetime.now(),
        )
        notes.append(note)
        self._repo.save_notes(notes)
        return note

    def update_note(self, note_id: str, title: str, body: str, tag: str) -> None:
        notes = self._repo.load_notes()
        for note in notes:
            if note.id == note_id:
                note.title = title.strip()
                note.body = body.strip()
                note.tag = tag.strip()
                break
        self._repo.save_notes(notes)

    def delete_note(self, note_id: str) -> None:
        notes = [n for n in self._repo.load_notes() if n.id != note_id]
        self._repo.save_notes(notes)

    def delete_notes(self, note_ids) -> int:
        """批次刪除——一次讀寫，不是逐筆呼叫 delete_note()（逐筆呼叫等於重複
        讀寫同一份檔案 N 次，數量一多沒必要）。回傳實際刪掉幾筆。"""
        wanted = set(note_ids)
        notes = self._repo.load_notes()
        remaining = [n for n in notes if n.id not in wanted]
        self._repo.save_notes(remaining)
        return len(notes) - len(remaining)

    def export_markdown(self, notes: list) -> str:
        """把便利貼組成一份可讀的 Markdown 文件——標題當二級標題、有標籤就用
        「🏷️ 標籤」標出來、內容放進程式碼區塊（多行指令步驟這樣輸出到別的
        地方還能保留原本的換行/縮排，直接複製貼上就能用，不會被 Markdown
        當成一般段落重新排版）。純文字組字串，不碰 Tkinter、不碰檔案 IO，
        呼叫端（面板）負責決定要匯出哪些筆、存到哪裡。"""
        lines = [
            "# 📌 便利貼匯出",
            "",
            f"匯出時間：{datetime.now():%Y-%m-%d %H:%M}　｜　共 {len(notes)} 則",
            "",
        ]
        for note in notes:
            lines.append(f"## {note.title}")
            if note.tag:
                lines.append(f"🏷️ {note.tag}")
            lines.append("")
            lines.append("```")
            lines.append(note.body)
            lines.append("```")
            lines.append("")
            lines.append("---")
            lines.append("")
        return "\n".join(lines).rstrip() + "\n"

    def build_ai_search_prompt(self, notes: list, query: str) -> str:
        """把便利貼清單編號、連同使用者的問題一起組成 prompt。

        使用者的問題不會只有「找出符合描述的便利貼」這一種——實際觀察到的
        提問方式還有「某個分類底下實際有哪些事項」（例如「每日必做有哪些
        事項？」，這種要把找到的便利貼『內容』統整寫成答案，不是只回編號）、
        「數量」（例如「YouTube 相關的有幾個？」，答案裡要有正確數字）、
        「目前有哪些分類/標籤，全部列出來」（這種通常跟全部便利貼都有關，
        編號可以全部列出）。所以固定要求回覆同時包含「答案」（一段完整回答
        問題的自然語言文字）跟「編號」（給 UI 拿去篩選卡片清單用）兩部分，
        不是只回編號——只回編號沒辦法回答「有幾個」「有哪些事項」這種需要
        統整內容或計數的問題。"""
        lines = [
            "你是一個便利貼助手，回答使用者關於便利貼的各種問題。可能的問題"
            "類型包括：①找出符合某個描述的便利貼、②某個分類/主題底下實際有"
            "哪些事項或內容（要把相關便利貼的內容重點統整寫進答案，不能只回"
            "「有」）、③數量（答案要包含正確的數字）、④目前有哪些分類/標籤"
            "（把便利貼清單裡出現過的標籤都列出來）。",
            "",
            "請只回覆一個 JSON 物件，不要加任何其他文字、不要用 Markdown 程式"
            "碼區塊（不要加 ```），格式如下（answer 是字串，ids 是數字陣列，"
            "list_tags 是布林值，一定要出現這三個欄位）：",
            '{"answer": "<用繁體中文完整回答使用者的問題，具體列出項目/數字/'
            "分類名稱；純文字，需要分項時用換行字元分隔，不要用 Markdown 符號"
            '（*、-、#）>", "ids": [<跟這個問題相關的便利貼編號；問題如果跟'
            "特定便利貼無關（例如純粹問分類清單），列出全部便利貼的編號；"
            '真的沒有相關的便利貼就給空陣列 []>], "list_tags": <如果問題是④'
            "「目前有哪些分類/標籤」這種要求列出全部標籤清單的問題就給 true，"
            "其餘情況一律給 false——是 true 的話 answer 只要簡短帶一句話就好"
            "（例如「目前的標籤如下：」），不用自己在 answer 裡把標籤一個一個"
            "條列出來，程式會自動接上正確、有編號的完整清單>}",
            "",
            f"使用者的問題：{query}",
            "",
            "便利貼清單：",
        ]
        for i, note in enumerate(notes, start=1):
            tag_part = f"／標籤：{note.tag}" if note.tag else ""
            snippet = note.body[:AI_SEARCH_BODY_SNIPPET_CHARS]
            lines.append(f"{i}. 標題：{note.title}{tag_part}\n內容：{snippet}")
        return "\n".join(lines)

    def parse_ai_search_response(self, response: str, notes: list) -> tuple:
        """回傳 (answer_text, matched_notes)，1-based 編號對應 notes 裡第幾筆
        （跟 build_ai_search_prompt() 的編號一致）。

        優先當 JSON 解析（{"answer": "...", "ids": [...], "list_tags": bool}）
        ——實測發現舊版純文字「答案：.../編號：...」標籤格式時好時壞：模型
        偶爾會用別的標點、換行方式，或整段用一般口語回覆完全不提「編號」
        兩個字，這時候正規表達式抓不到任何編號，就會被當成「沒有相關的
        便利貼」，即使 answer 本身其實已經正確找到內容——這正是「有時候
        搜得到、有時候搜不到」的成因。JSON 是模型對「只回覆這個格式」這種
        指示遵從度普遍比較高、比較穩定的格式；就算 JSON 解析也失敗，才退回
        舊版標籤格式當最後一層備援，兩種都試過比只認一種耐用，也不會讓已經
        穩定運作的情況變差。

        `list_tags` 為 true 時，answer 裡的標籤清單不採信模型自己排版的
        結果——實測模型列標籤常常擠成一行、逗號分隔，沒有換行也沒有編號，
        讀起來很吃力。這裡改成程式自己用迴圈從 1 開始對 known_tags() 編號、
        每個標籤各自一行，保證格式一致，也保證清單內容跟便利貼實際的標籤
        100% 一致（不會因為模型自己複述而漏字或看錯）；新增/刪除標籤後
        known_tags() 本來就是即時從資料重新算，不需要另外維護快取或名單。"""
        response = response.strip()
        data = self._try_parse_json(response)
        if data is not None and isinstance(data, dict):
            # 注意：answer 是空字串時不能整個退回 response（原始 JSON 文字）——
            # list_tags=true 時模型本來就被要求把 answer 寫得很簡短（甚至留
            # 空也合理，反正真正的清單是程式自己接上去的），空字串在這裡是
            # 正常情況，不是「JSON 解析失敗」，退回原始 JSON 字串反而會讓
            # 使用者看到一整包沒排版過的 JSON。只有 list_tags 是 false 又真的
            # 拿不到任何文字時，才用一句通用訊息頂著。
            answer = str(data.get("answer", "")).strip()
            if data.get("list_tags"):
                answer = self._append_numbered_tag_list(answer)
            elif not answer:
                answer = "（AI 沒有提供文字說明）"
            # ids 型別不對（模型偶爾給 null、或給一串逗號分隔的字串而不是陣列）
            # 也要留在這個分支內處理完、直接 return——不能讓它掉到下面的舊版
            # 格式解析去重新解析「這一整包 JSON 原始文字」，那樣只會把上面
            # 已經處理好的 answer（可能還包含標籤清單）整個丟掉，改成顯示
            # 一坨沒排版過的 JSON。ids 格式不對就當作「這次沒有可篩選的编號」
            # 處理（matched 給空清單），answer 本身不受影響。
            raw_ids = data.get("ids", [])
            if not isinstance(raw_ids, list):
                raw_ids = []
            wanted_indices = {
                int(i) for i in raw_ids
                if isinstance(i, int) or (isinstance(i, str) and i.strip().isdigit())
            }
            matched = [note for i, note in enumerate(notes, start=1) if i in wanted_indices]
            return answer, matched

        answer_match = re.search(r"答案[：:]\s*(.+?)(?=\n\s*編號[：:]|\Z)", response, re.S)
        answer = answer_match.group(1).strip() if answer_match else response
        number_match = re.search(r"編號[：:]\s*(.+)", response, re.S)
        number_text = number_match.group(1) if number_match else ""
        wanted_indices = {int(n) for n in re.findall(r"\d+", number_text)}
        matched = [note for i, note in enumerate(notes, start=1) if i in wanted_indices]
        return answer, matched

    def _append_numbered_tag_list(self, lead_in: str) -> str:
        """從 1 開始逐一編號、每個標籤各自換行——不是把整份清單塞給模型
        排版，這裡直接用迴圈自己組字串，格式保證一致，內容也保證跟目前
        便利貼實際的標籤完全一致。"""
        tags = self.known_tags()
        if not tags:
            body = "目前沒有任何便利貼標籤。"
        else:
            numbered = [f"{i}. {tag}" for i, tag in enumerate(tags, start=1)]
            body = f"目前共有 {len(tags)} 個標籤：\n" + "\n".join(numbered)
        return f"{lead_in}\n\n{body}" if lead_in else body

    @staticmethod
    def _try_parse_json(text: str):
        """先試整段直接解析；模型有時候還是會不聽話包一層 ```json 圍欄或加
        前後綴文字，退而求其次抓出第一個大括號到最後一個大括號之間的內容
        再試一次。兩次都失敗回傳 None，交給呼叫端退回舊版格式解析。"""
        try:
            return json.loads(text)
        except ValueError:
            pass
        match = re.search(r"\{.*\}", text, re.S)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except ValueError:
            return None

    def load_panel_visible(self) -> bool:
        return self._repo.load_panel_state()["visible"]

    def save_panel_visible(self, visible: bool) -> None:
        self._repo.save_panel_state(visible=visible)

    def get_file_path(self):
        """底層 `.sticky_notes.json` 的路徑——只給「編輯便利貼檔案」這種需要
        直接開檔案的功能用，一般 CRUD 都不該繞過 Service／Repository 自己
        兜路徑。"""
        return self._repo.path

