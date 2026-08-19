"""內容快取（全文檢索＋重複偵測共用）的讀寫層。

每份索引檔案對應一份快取 JSON：indexes/.cache/<索引檔名>.json，key 是絕對
路徑，value 是 {mtime, size, hash, hash_algo, text}。「hash」給重複偵測用
（全部類型都以串流方式計算 SHA-256，包含大型影音檔）。「text」給全文
檢索用（只有真的擷取得到文字內容的類型才有值——是不是「擷取得到」由
PreviewService 依內容判斷，不是這裡的事）。

這裡只負責 SHA-256 計算與快取檔案本身的讀寫；「用什麼內容更新快取」
（何時重算、擷取文字要呼叫哪個函式）是 CacheService 的事，Repository
不知道 PreviewService 的存在。
"""

import hashlib
import json
from pathlib import Path

from file_search_app.config import INDEXES_DIR
from file_search_app.repositories.atomic_io import atomic_write_text

HASH_ALGO = "sha256"
_HASH_CHUNK = 4 * 1024 * 1024
CACHE_TEXT_CHARS = 5000  # 快取存的擷取文字上限，比預覽面板的 3000 多一點，全文搜尋比較不容易漏比對到內容


class CacheRepository:
    def __init__(self, indexes_dir: Path = INDEXES_DIR):
        self.cache_dir = indexes_dir / ".cache"

    def cache_path_for(self, md_path: Path) -> Path:
        return self.cache_dir / f"{md_path.stem}.json"

    def load(self, md_path: Path) -> dict:
        """讀取快取 JSON；不只接住「根本不是合法 JSON」的情況，也驗證結構——最外層
        必須是 dict，每一筆項目的值也必須是 dict（正常存的是 {mtime,size,hash,...}），
        否則後續刷新快取時對它呼叫 .get() 會直接丟未接住的例外。合法 JSON 但形狀
        不對（例如手動改壞、被其他程式寫入、磁碟寫壞留下 [] 或字串）一律當作沒有
        可用快取，不拋例外。"""
        cache_path = self.cache_path_for(md_path)
        if not cache_path.exists():
            return {}
        try:
            data = json.loads(cache_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}  # 快取檔案損毀/格式不對就當作沒有快取，下次更新會重建，不影響其餘功能
        if not isinstance(data, dict):
            return {}
        return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, dict)}

    def save(self, md_path: Path, cache: dict) -> None:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        atomic_write_text(self.cache_path_for(md_path), json.dumps(cache, ensure_ascii=False, indent=1))

    def delete(self, md_path: Path) -> None:
        cache_path = self.cache_path_for(md_path)
        if cache_path.exists():
            cache_path.unlink()

    @staticmethod
    def compute_file_hash(p: Path):
        """以固定記憶體串流計算 SHA-256；不因檔案較大而排除，讀取失敗回傳 None。"""
        h = hashlib.sha256()
        try:
            with open(p, "rb") as f:
                for chunk in iter(lambda: f.read(_HASH_CHUNK), b""):
                    h.update(chunk)
        except OSError:
            return None
        return h.hexdigest()
