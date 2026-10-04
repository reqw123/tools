# -*- coding: utf-8 -*-

from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import mimetypes
import os


PORT = 8000
HOST = "0.0.0.0"


class UTF8FileServer(SimpleHTTPRequestHandler):
    """
    解決 python -m http.server 顯示 .py 中文亂碼問題
    會針對文字檔案補上 charset=utf-8
    """

    UTF8_EXTENSIONS = {
        ".py",
        ".txt",
        ".md",
        ".json",
        ".yaml",
        ".yml",
        ".csv",
        ".html",
        ".htm",
        ".css",
        ".js",
        ".xml",
        ".log",
    }

    def guess_type(self, path):
        ext = Path(path).suffix.lower()

        if ext in self.UTF8_EXTENSIONS:
            mime, _ = mimetypes.guess_type(path)

            if mime is None:
                mime = "text/plain"

            if mime.startswith("text/") or ext in {
                ".py", ".json", ".yaml", ".yml", ".md", ".csv", ".log"
            }:
                return f"{mime}; charset=utf-8"

        return super().guess_type(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


def main():
    folder = Path.cwd()

    print("=" * 60)
    print("UTF-8 HTTP Server 已啟動")
    print(f"分享資料夾：{folder}")
    print(f"本機網址：http://localhost:{PORT}")
    print(f"區網網址：http://reqw.local:{PORT}")
    print("停止伺服器：Ctrl + C")
    print("=" * 60)

    server = HTTPServer((HOST, PORT), UTF8FileServer)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n伺服器已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()