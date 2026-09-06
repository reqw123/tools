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


def preview_text(body: str, max_lines: int = 2) -> str:
    """卡片／清單列上顯示的內容摘要——取前 `max_lines` 行非空白內容，超出的
    行數用「 …」帶過。面板卡片跟批次刪除對話框共用同一個函式，同一則便利貼
    在兩個畫面看到的摘要才會長一樣（先前面板取 2 行、批次刪除把整份內容用
    「／」串一行又各自截字，屬於同一份資料兩種呈現）。純字串處理，不碰
    Tkinter。"""
    lines = [line for line in body.splitlines() if line.strip()]
    if not lines:
        return ""
    text = "\n".join(lines[:max_lines])
    if len(lines) > max_lines:
        text += " …"
    return text


class StickyNoteService:
    def __init__(self, repo: StickyNoteRepository):
        self._repo = repo

    def list_notes(self) -> list:
        """全部便利貼，最新在上。"""
        return sorted(self._repo.load_notes(), key=lambda n: n.created_at, reverse=True)

    def search(self, notes: list, query: str, tag_filter: str) -> list:
        """query 比對標題／內容／標籤——在搜尋框直接打標籤名稱（或一部分）就能
        找到該標籤的便利貼，不用非得改用下拉選單。`tag_filter`（來自標籤下拉
        選單）是另一層精確篩選，為空字串代表不額外限定標籤；兩者可疊加。"""
        typed = query.strip().lower()
        result = notes
        if tag_filter:
            result = [n for n in result if n.tag == tag_filter]
        if typed:
            result = [
                n for n in result
                if typed in n.title.lower()
                or typed in n.body.lower()
                or typed in n.tag.lower()
            ]
        return result

    def known_tags(self, notes: list = None) -> list:
        """既有標籤清單（排序、去重、去空字串）。呼叫端如果手邊已經有一份
        便利貼清單（例如面板 `_refresh()` 剛 `list_notes()` 過），就傳進來
        直接算，不用為了列標籤再讀一次檔；沒傳就自己讀。"""
        source = notes if notes is not None else self._repo.load_notes()
        return sorted({n.tag for n in source if n.tag})

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
        note = StickyNote(
            id=uuid.uuid4().hex, title=title.strip(), body=body.strip(), tag=tag.strip(),
            created_at=datetime.now(),
        )
        self._repo.mutate(lambda notes: notes + [note])
        return note

    def update_note(self, note_id: str, title: str, body: str, tag: str) -> bool:
        """回傳有沒有真的改到——`note_id` 不在清單裡（例如卡片在別的視窗剛被
        刪掉）就回 False 且完全不寫檔，不會白白重寫一份一模一樣的內容。

        編輯視同「重新建立」：`created_at` 一併更新成現在。便利貼沒有另外的
        「最後修改時間」欄位，這樣 list_notes() 依 created_at 由新到舊排時，
        剛動過的便利貼就會浮到最上面（跟網頁版行為一致，也讓共用同一份
        .sticky_notes.json 時不用多存一個欄位）。"""
        found = False

        def apply(notes):
            nonlocal found
            for note in notes:
                if note.id == note_id:
                    note.title = title.strip()
                    note.body = body.strip()
                    note.tag = tag.strip()
                    note.created_at = datetime.now()
                    found = True
                    return notes
            return None  # 沒找到 → 交給 repo.mutate() 跳過寫檔

        self._repo.mutate(apply)
        return found

    def delete_note(self, note_id: str) -> None:
        self._repo.mutate(lambda notes: [n for n in notes if n.id != note_id])

    def delete_notes(self, note_ids) -> int:
        """批次刪除——一次讀寫，不是逐筆呼叫 delete_note()（逐筆呼叫等於重複
        讀寫同一份檔案 N 次，數量一多沒必要）。回傳實際刪掉幾筆。"""
        wanted = set(note_ids)
        removed = 0

        def apply(notes):
            nonlocal removed
            remaining = [n for n in notes if n.id not in wanted]
            removed = len(notes) - len(remaining)
            return remaining

        self._repo.mutate(apply)
        return removed

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
            fence = self._code_fence_for(note.body)
            lines.append(fence)
            lines.append(note.body)
            lines.append(fence)
            lines.append("")
            lines.append("---")
            lines.append("")
        return "\n".join(lines).rstrip() + "\n"

    def export_json(self, notes: list) -> str:
        """匯出成可攜 JSON——跟 `export_markdown()` 不同，這份是給程式讀回去
        用的資料格式（原封不動的 id/title/body/tag/created_at/image），不是
        給人看的文件。用 `import_json()` 讀回來就是同一批便利貼，包括 id，
        搬去另一台電腦匯入也認得出「這幾則已經匯入過」。"""
        return self._repo.serialize_notes(notes)

    def import_json(self, text: str) -> dict:
        """匯入之前用 `export_json()` 匯出的便利貼——依 id 判斷是否已存在，
        已經存在的直接跳過（同一份備份重複匯入、或兩台電腦的資料剛好有
        重疊都不會產生重複筆），只新增真的沒有的。回傳
        `{"added": int, "skipped": int}`。`text` 格式不對會讓
        `StickyNoteRepository.parse_notes()` 拋 ValueError，交給呼叫端顯示
        錯誤訊息。"""
        incoming = self._repo.parse_notes(text)
        added = 0
        skipped = 0

        def apply(notes):
            nonlocal added, skipped
            existing_ids = {n.id for n in notes}
            new_notes = []
            for note in incoming:
                if note.id in existing_ids:
                    skipped += 1
                    continue
                new_notes.append(note)
                existing_ids.add(note.id)
            added = len(new_notes)
            if not new_notes:
                return None  # 全部跳過，不用寫檔
            return notes + new_notes

        self._repo.mutate(apply)
        return {"added": added, "skipped": skipped}

    @staticmethod
    def _code_fence_for(body: str) -> str:
        """圍住內容用的 backtick 圍欄——一般是三個，但內容本身若含有 ``` 之類
        的連續 backtick，固定用三個會被 Markdown 提早收掉程式碼區塊、後面的
        內容跑到區塊外。CommonMark 的規則是圍欄的 backtick 數要比內容裡最長
        的一段還多，這裡就照最長那段 +1。"""
        longest = max((len(m) for m in re.findall(r"`+", body)), default=0)
        return "`" * max(3, longest + 1)

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

    def build_document_to_note_prompt(self, entry, text: str) -> str:
        """從檔案內容生成一則便利貼草稿（標題／標籤／內容）——跟
        `build_ai_search_prompt` 一樣走 JSON 契約，但方向相反：那個是「從
        便利貼找答案」，這個是「從文件生出一則新便利貼」。標籤請模型優先
        從既有 `known_tags()` 挑，不是自由生成，避免批次跑幾十筆一次冒出
        幾十個新標籤、標籤清單迅速失控。

        簽章刻意跟 `AIDescriptionService.build_prompt(entry, text)` 一致，
        才能原封不動當那邊 `generate_suggestions()` 的 `prompt_builder`
        參數傳進去，共用同一套內容擷取／逐筆呼叫／計次／錯誤處理，不用
        重寫一份幾乎一樣的迴圈。"""
        known = self.known_tags()
        tag_hint = "、".join(known) if known else "（目前沒有任何既有標籤）"
        return (
            "你是一個便利貼小助手。以下是這份文件擷取到的部分內容，請幫忙"
            "生成一則便利貼草稿，摘要成方便之後快速回顧的筆記。\n\n"
            "請只回覆一個 JSON 物件，不要加任何其他文字、不要用 Markdown "
            "程式碼區塊（不要加 ```），格式如下（title／tag／body 都是"
            "字串，三個欄位都要出現）：\n"
            '{"title": "<適合當便利貼標題的主題，一句話，不要加引號>", '
            f'"tag": "<單一分類標籤；請優先從既有標籤挑一個最合適的：{tag_hint}；'
            '真的沒有合適的才自己創一個簡短新標籤；判斷不需要分類就給空字串>", '
            '"body": "<這份文件內容的摘要，適合直接當便利貼正文的一段文字；'
            '純文字，不要用 Markdown 符號，需要分項時用換行字元分隔>"}\n\n'
            f"檔名：{entry.name}\n內容節錄：\n{text}"
        )

    def build_document_to_note_image_prompt(self, entry) -> str:
        """圖片版——簽章對齊 `AIDescriptionService.build_image_prompt(entry)`，
        理由同上。"""
        known = self.known_tags()
        tag_hint = "、".join(known) if known else "（目前沒有任何既有標籤）"
        return (
            "你是一個便利貼小助手。這是一張圖片，請幫忙生成一則便利貼草稿，"
            "摘要成方便之後快速回顧的筆記。\n\n"
            "請只回覆一個 JSON 物件，不要加任何其他文字、不要用 Markdown "
            "程式碼區塊（不要加 ```），格式如下（title／tag／body 都是"
            "字串，三個欄位都要出現）：\n"
            '{"title": "<適合當便利貼標題的主題，一句話，不要加引號>", '
            f'"tag": "<單一分類標籤；請優先從既有標籤挑一個最合適的：{tag_hint}；'
            '真的沒有合適的才自己創一個簡短新標籤；判斷不需要分類就給空字串>", '
            '"body": "<描述圖片內容，適合直接當便利貼正文的一段文字；純文字，'
            '不要用 Markdown 符號>"}\n\n'
            f"檔名：{entry.name}"
        )

    def parse_document_to_note_response(self, response: str):
        """回傳 `{"title", "tag", "body"}` 或 `None`（解析失敗，或缺少
        title／body 這兩個必要欄位）。

        跟 `parse_ai_search_response` 共用同一套「先整段當 JSON、失敗再抓
        第一個大括號片段」的兩層 fallback（`_try_parse_json`），但**沒有
        第三層舊格式備援**——這裡的 JSON 契約是新設計的，沒有「先前用純
        文字格式」的歷史包袱，解析不出來就是這一筆失敗，呼叫端當成失敗
        處理（不套用、不生成便利貼），不硬湊一則內容怪異的草稿。"""
        data = self._try_parse_json(response.strip())
        if not isinstance(data, dict):
            return None
        title = str(data.get("title", "")).strip()
        body = str(data.get("body", "")).strip()
        tag = str(data.get("tag", "")).strip()
        if not title or not body:
            return None
        return {"title": title, "tag": tag, "body": body}

    def load_panel_visible(self) -> bool:
        return self._repo.load_panel_state()["visible"]

    def save_panel_visible(self, visible: bool) -> None:
        self._repo.save_panel_state(visible=visible)

    def get_file_path(self):
        """底層 `.sticky_notes.json` 的路徑——只給「編輯便利貼檔案」這種需要
        直接開檔案的功能用，一般 CRUD 都不該繞過 Service／Repository 自己
        兜路徑。"""
        return self._repo.path

