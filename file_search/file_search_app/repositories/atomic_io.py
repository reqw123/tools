"""原子寫檔工具——index_repository／cache_repository／metadata_repository
三個 Repository 共用的最底層 IO 原語。"""

import os
import tempfile
from pathlib import Path


def atomic_write_text(path: Path, text: str, encoding: str = "utf-8") -> None:
    """先寫到同一層資料夾底下的暫存檔，成功後用 os.replace() 原子換掉目標檔案，
    取代直接 write_text()（那個等同「truncate 舊內容→重新寫入」，寫到一半若
    程式崩潰／斷電／磁碟滿了，會留下一個內容殘缺的檔案，索引或快取就壞掉了）。
    os.replace() 在同一個磁碟區內是原子操作（Windows／POSIX 皆是），暫存檔刻意
    建在跟目標檔案同一層資料夾，避免萬一目標在不同磁碟區時，替換動作退化成
    「複製＋刪除」而失去原子性。寫入失敗時清掉暫存檔，不留垃圾檔案。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding=encoding) as f:
            f.write(text)
        os.replace(tmp_name, str(path))
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
