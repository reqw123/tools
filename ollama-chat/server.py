"""Ollama 聊天室——獨立小專案，跟 file_search 完全無關。

單一 Flask process：
  - 靜態頁面（static/）
  - /api/models   讀本機 Ollama 已安裝的模型清單 + 是否支援圖片
  - /api/chat     串流代理到 Ollama 的 /api/chat（SSE）
  - /api/extract  上傳文件（pdf/docx/純文字）→ 抽出文字，讓使用者當附加內容送進對話

一律不寫檔、不留對話紀錄在伺服器端——對話歷史整個由瀏覽器 fetch 時帶著送，
server 純轉發，重開瀏覽器分頁歷史就重新開始（前端會用 localStorage 記一份
方便重新整理不遺失，見 static/app.js）。
"""

from __future__ import annotations

import atexit
import base64
import io
import json
import os
import secrets
import shutil
import socket
import subprocess
import time

import requests
from flask import Blueprint, Flask, Response, jsonify, redirect, request, send_from_directory, session

OLLAMA_BASE = os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434").rstrip("/")
PORT = int(os.environ.get("OLLAMA_CHAT_PORT", "8795"))
# 掛在這個路徑下，不是網站根目錄——這樣同一個 ngrok 網域之後想再加別的服務
# 也有位置放（例如 /ollama、/notes 分開路徑）。所有路由、靜態檔、前端抓
# API 都要在這個前綴下，整段網址（含 /ollama）才會正確指到這個聊天室，不是
# 只有網域根目錄有反應。
BASE_PATH = "/ollama"
# .bat 的「區網＋公網」啟動器才會設這個——沒設就是舊的本機限定行為（127.0.0.1），
# 完全不用密碼，跟直接 `python server.py` 手動跑起來的情境一樣。
SHARE_MODE = os.environ.get("SHARE_MODE", "")
HOST = "0.0.0.0" if SHARE_MODE == "lan" else "127.0.0.1"
SHARE_TOKEN = os.environ.get("SHARE_TOKEN", "").strip()
SHARE_PUBLIC = os.environ.get("SHARE_PUBLIC") == "on"

# 文件抽出的文字上限（字元數，不是精確 token 數）——避免超長文件把整個
# context window 塞爆，超過的部分截斷並在結尾註明。中文常見 ~1-2 字元一個
# token，40000 字元很容易單一則訊息就換算上萬 token、遠超過下面的 NUM_CTX
# 預設值，導致回應生成到一半就被截斷（看起來像卡住，見 /api/chat 的註解）。
# 調低到給對話歷史／回應留空間的量，真的需要分析更長文件就調大 OLLAMA_NUM_CTX。
MAX_EXTRACT_CHARS = 12_000
MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # 25MB
# Ollama 沒帶 num_ctx 時預設 4096——這些模型實際支援到 32768，這裡抓一個
# 對 6-8GB VRAM 顯卡還算合理的中間值。太大會讓 KV cache 吃更多顯存，顯存
# 不夠時 Ollama 會把更多層落回 CPU 算，反而更慢，所以不直接拉到 32768。
NUM_CTX = int(os.environ.get("OLLAMA_NUM_CTX", "8192"))

app = Flask(__name__)
# 每次啟動重新產生——重開 server 舊 session 全部失效，逼所有人（含本機留著
# 分頁沒關的）重新輸入密碼，是刻意的「session cookie」模型，跟 file_search
# 那幾面牆的 share_session 同一套精神。
app.secret_key = secrets.token_hex(32)

# 網站本體全部掛在這個 blueprint 上，url_prefix 讓所有路由（含靜態檔）自動
# 變成 /ollama/xxx；static_url_path="" 讓靜態檔直接是 /ollama/app.js，不是
# 多一層 /ollama/static/app.js。
bp = Blueprint("chat", __name__, url_prefix=BASE_PATH, static_folder="static", static_url_path="")


@app.get("/")
def root_redirect():
    return redirect(f"{BASE_PATH}/")

# 模型是否支援看圖（來自 /api/show 的 capabilities）——同一個模型清單通常整個
# process 生命週期都不太會變，查過一次就快取，避免每次開對話框都重打一輪。
_vision_cache: dict[str, bool | None] = {}


def _vision_support(model: str) -> bool | None:
    if model in _vision_cache:
        return _vision_cache[model]
    try:
        r = requests.post(f"{OLLAMA_BASE}/api/show", json={"name": model}, timeout=10)
        r.raise_for_status()
        caps = r.json().get("capabilities")
        result = ("vision" in caps) if isinstance(caps, list) else None
    except requests.RequestException:
        result = None
    _vision_cache[model] = result
    return result


def is_loopback(req) -> bool:
    """是不是主機本人。跟 file_search 那幾面牆同一個坑：ngrok 隧道把公網
    請求轉發進來時，這支 Flask process 看到的 remote_addr 一樣是
    127.0.0.1（ngrok agent 本身跑在這台機器、轉發到本機 port）——單看
    IP 會把「公網進來的陌生人」誤判成本機。要多看有沒有
    `X-Forwarded-For`（ngrok／任何反向代理都會加這個），有帶就不算
    loopback，不管 remote_addr 長怎樣。區網對等直連（沒有反向代理）本來
    remote_addr 就是對方真正的區網 IP，不會落入這個誤判。"""
    return req.remote_addr in ("127.0.0.1", "::1") and not req.headers.get("X-Forwarded-For")


def is_authed(req) -> bool:
    if not SHARE_TOKEN:
        return True
    if is_loopback(req):
        return True
    return bool(session.get("authed"))


def _login_page(error: str | None = None) -> str:
    err_html = f'<p class="hint" style="color:var(--danger)">{error}</p>' if error else ""
    return f"""<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Ollama 聊天室 · 登入</title>
<link rel="stylesheet" href="style.css" />
<style>
  body {{ display: flex; align-items: center; justify-content: center; }}
  .login-box {{ background: var(--panel); border: 1px solid var(--border); border-radius: 12px;
                padding: 28px; width: 280px; display: flex; flex-direction: column; gap: 12px; }}
  .login-box h1 {{ font-size: 16px; margin: 0; }}
  .login-box input {{ width: 100%; }}
</style>
</head><body>
  <form class="login-box" method="post" action="login">
    <h1>🦙 Ollama 聊天室</h1>
    <p class="hint">這台主機開了共用密碼保護，輸入密碼才能使用。</p>
    {err_html}
    <input type="password" name="password" placeholder="共用密碼" autofocus required />
    <button class="send-btn" type="submit">登入</button>
  </form>
</body></html>"""


@bp.before_request
def _guard_api():
    if request.path.startswith(f"{BASE_PATH}/api/") and not is_authed(request):
        return jsonify({"error": "需要密碼才能使用，請重新整理頁面登入"}), 401


@bp.post("/login")
def login():
    pw = (request.form.get("password") or "").strip()
    if SHARE_TOKEN and pw == SHARE_TOKEN:
        session["authed"] = True
        return redirect(f"{BASE_PATH}/")
    return _login_page("密碼錯誤"), 401


@bp.get("/")
def index():
    if is_authed(request):
        return send_from_directory(bp.static_folder, "index.html")
    return _login_page()


@bp.get("/api/models")
def api_models():
    try:
        r = requests.get(f"{OLLAMA_BASE}/api/tags", timeout=10)
        r.raise_for_status()
    except requests.RequestException as e:
        return jsonify({"models": [], "error": f"連不上 Ollama（{OLLAMA_BASE}）：{e}"}), 200
    names = [m["name"] for m in r.json().get("models", [])]
    models = [{"name": n, "vision": _vision_support(n)} for n in names]
    return jsonify({"models": models, "error": None})


@bp.post("/api/chat")
def api_chat():
    body = request.get_json(force=True, silent=True) or {}
    model = (body.get("model") or "").strip()
    messages = body.get("messages") or []
    temperature = body.get("temperature")
    if not model:
        return jsonify({"error": "沒有指定模型"}), 400
    if not isinstance(messages, list) or not messages:
        return jsonify({"error": "沒有訊息內容"}), 400

    # Ollama 沒收到 num_ctx 時預設只用 4096 token 的上下文視窗（遠小於這些
    # 模型實際支援的 32K）——對話一長，或貼了長文件，很容易在生成到一半時
    # 撞到這個上限，Ollama 直接停止（done_reason: "length"），前端看起來就
    # 像「回應到一半卡住」。明確帶大一點的 num_ctx 過去；OLLAMA_NUM_CTX 可
    # 調（更大的視窗吃更多 VRAM/RAM，GPU 記憶體不夠時可能連帶更慢，要權衡）。
    options = {"num_ctx": NUM_CTX}
    if isinstance(temperature, (int, float)):
        options["temperature"] = temperature
    payload = {"model": model, "messages": messages, "stream": True, "options": options}

    def stream():
        try:
            with requests.post(
                f"{OLLAMA_BASE}/api/chat", json=payload, stream=True, timeout=300
            ) as resp:
                if resp.status_code != 200:
                    detail = resp.text[:500]
                    yield f"data: {json.dumps({'error': f'Ollama 回傳 HTTP {resp.status_code}：{detail}'}, ensure_ascii=False)}\n\n"
                    return
                for line in resp.iter_lines():
                    if not line:
                        continue
                    try:
                        chunk = json.loads(line)
                    except ValueError:
                        continue
                    if chunk.get("error"):
                        yield f"data: {json.dumps({'error': chunk['error']}, ensure_ascii=False)}\n\n"
                        return
                    content = (chunk.get("message") or {}).get("content", "")
                    if content:
                        yield f"data: {json.dumps({'content': content}, ensure_ascii=False)}\n\n"
                    if chunk.get("done"):
                        truncated = chunk.get("done_reason") == "length"
                        yield f"data: {json.dumps({'done': True, 'truncated': truncated})}\n\n"
                        return
        except requests.RequestException as e:
            yield f"data: {json.dumps({'error': f'連線失敗：{e}'}, ensure_ascii=False)}\n\n"

    return Response(stream(), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    parts = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n\n".join(parts).strip()


def _extract_docx(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return "\n".join(parts).strip()


# 文字抽取（上面那幾個 _extract_*）永遠都做，不管有沒有視覺模型——那是給任何
# 模型看的。這裡另外抽「圖片」給支援看圖的模型用，純文字格式（txt/json/csv/
# md/log）沒有版面可言，重新畫成圖片只會比原始文字更難辨識，所以只有
# pdf／docx 這種有版面/表格/嵌入圖的格式才做，前端只有選到支援看圖的模型才會
# 真的把這些圖片送出去（跟手動貼圖走同一套判斷），純文字模型不受影響。
MAX_DOC_IMAGES = 6
DOC_IMAGE_MAX_WIDTH = 1280
DOC_IMAGE_JPEG_QUALITY = 78


def _pil_to_jpeg_b64(img) -> str:
    from PIL import Image

    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    if img.width > DOC_IMAGE_MAX_WIDTH:
        h = int(img.height * DOC_IMAGE_MAX_WIDTH / img.width)
        img = img.resize((DOC_IMAGE_MAX_WIDTH, h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=DOC_IMAGE_JPEG_QUALITY)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _pdf_page_images(data: bytes) -> tuple[list[str], int]:
    """PDF 每頁整頁渲染成圖——給視覺模型看版面/表格/掃描頁用，跟
    `_extract_pdf()` 的純文字抽取是兩條獨立路徑，掃描版 PDF（沒有文字層）
    只有這條路徑抽得到內容。只轉前 MAX_DOC_IMAGES 頁，避免大文件一次送出
    一堆圖片把請求塞爆、也把視覺模型的算力榨乾（這台機器 GPU 本來就吃緊）。"""
    import pymupdf
    from PIL import Image

    doc = pymupdf.open(stream=data, filetype="pdf")
    try:
        total = doc.page_count
        images = []
        # 2x 縮放大約等於 144 DPI——比預設 72 DPI 清楚到看得清小字，
        # 又不會產生巨大到沒必要的原始點陣圖（反正下面還會再縮到
        # DOC_IMAGE_MAX_WIDTH）。
        matrix = pymupdf.Matrix(2, 2)
        for i in range(min(total, MAX_DOC_IMAGES)):
            pix = doc[i].get_pixmap(matrix=matrix)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            images.append(_pil_to_jpeg_b64(img))
        return images, total
    finally:
        doc.close()


def _docx_images(data: bytes) -> tuple[list[str], int]:
    """docx 本質是 zip，嵌入的圖片（照片/截圖/圖表）直接躺在
    word/media/ 底下——`_extract_docx()` 的純文字抽取完全不會碰到這些，
    圖表/截圖那種訊息只存在圖片裡，純文字模式看不到。只回前 MAX_DOC_IMAGES
    張，原因同 `_pdf_page_images()`。"""
    import zipfile

    from PIL import Image

    images = []
    names = []
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        names = sorted(
            n for n in z.namelist()
            if n.startswith("word/media/") and n.lower().rsplit(".", 1)[-1] in ("png", "jpg", "jpeg", "gif", "bmp", "webp")
        )
        for n in names[:MAX_DOC_IMAGES]:
            try:
                img = Image.open(io.BytesIO(z.read(n)))
                img.load()
            except Exception:  # noqa: BLE001 — 壞掉的單張圖不該讓整個上傳失敗
                continue
            images.append(_pil_to_jpeg_b64(img))
    return images, len(names)


def _extract_plain(data: bytes) -> str:
    for enc in ("utf-8", "utf-16", "big5", "latin-1"):
        try:
            return data.decode(enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="replace")


@bp.post("/api/extract")
def api_extract():
    f = request.files.get("file")
    if not f or not f.filename:
        return jsonify({"error": "沒有收到檔案"}), 400
    data = f.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return jsonify({"error": f"檔案超過 {MAX_UPLOAD_BYTES // (1024 * 1024)}MB 上限"}), 400

    ext = (f.filename.rsplit(".", 1)[-1] if "." in f.filename else "").lower()
    images: list[str] = []
    images_total = 0
    try:
        if ext == "pdf":
            text = _extract_pdf(data)
            images, images_total = _pdf_page_images(data)
        elif ext == "docx":
            text = _extract_docx(data)
            images, images_total = _docx_images(data)
        else:
            text = _extract_plain(data)
    except Exception as e:  # noqa: BLE001 — 抽取失敗一律當成一般錯誤回前端
        return jsonify({"error": f"讀取「{f.filename}」失敗：{type(e).__name__}: {e}"}), 200

    truncated = len(text) > MAX_EXTRACT_CHARS
    if truncated:
        text = text[:MAX_EXTRACT_CHARS]

    return jsonify({
        "filename": f.filename,
        "text": text,
        "truncated": truncated,
        "images": images,
        "images_total": images_total,
        "error": None,
    })


app.register_blueprint(bp)


def _guess_lan_ip() -> str | None:
    """猜這台機器對外的區網 IP——UDP connect 不會真的送封包，純粹借作業系統
    的路由表問「如果要送到外面，會用哪張網卡」，比列舉所有網卡介面簡單。"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


def _start_ngrok(port: int):
    """起一條 `ngrok http <port>` 隧道，輪詢 ngrok 本機 API（127.0.0.1:4040）
    最多 ~20 秒拿公網 https 網址。找不到 ngrok 或抓不到網址都回
    (None, None)，呼叫端退回純區網，不擋啟動——跟 notes-web 的
    share-serve.mjs 同一套邏輯。"""
    path = shutil.which("ngrok")
    if not path:
        print("[ngrok] not found on PATH - continuing LAN-only.")
        return None, None
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proc = subprocess.Popen(
        [path, "http", str(port)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creationflags,
    )
    url = None
    for _ in range(40):
        try:
            r = requests.get("http://127.0.0.1:4040/api/tunnels", timeout=2)
            if r.ok:
                for t in r.json().get("tunnels", []):
                    if str(t.get("public_url", "")).startswith("https://"):
                        url = t["public_url"]
                        break
        except requests.RequestException:
            pass
        if url:
            break
        time.sleep(0.5)
    if not url:
        print("[ngrok] could not get a public URL - continuing LAN-only.")
        try:
            proc.terminate()
        except OSError:
            pass
        return None, None
    return proc, url


if __name__ == "__main__":
    ngrok_proc = None
    public_url = None
    if SHARE_PUBLIC:
        print("[ngrok] starting public tunnel ...")
        ngrok_proc, public_url = _start_ngrok(PORT)
        if public_url:
            print(f"[ngrok] public URL: {public_url}")

    def _cleanup():
        if ngrok_proc is not None:
            try:
                ngrok_proc.terminate()
            except OSError:
                pass

    atexit.register(_cleanup)

    lines = ["", "=" * 60, "  Ollama Chat"]
    if HOST == "0.0.0.0":
        ip = _guess_lan_ip()
        lines.append(f"  You (this PC):  http://localhost:{PORT}{BASE_PATH}   (no password)")
        lines.append(
            f"  Same Wi-Fi/LAN: http://{ip}:{PORT}{BASE_PATH}" if ip else "  LAN: (no address found)"
        )
        if SHARE_TOKEN:
            lines.append("  Everyone except this PC needs the shared password.")
    else:
        lines.append(f"  http://localhost:{PORT}{BASE_PATH}   (local only)")
    if public_url:
        lines.append(f"  Public:         {public_url}{BASE_PATH}")
        lines.append('      ^ first visit on each device: click "Visit Site" on the ngrok page')
    elif SHARE_PUBLIC:
        lines.append("  Public: NOT active (ngrok unavailable) - LAN only this run")
    lines.append(f"  (Ollama: {OLLAMA_BASE})")
    lines.append("  Close this window to stop everything.")
    lines.append("=" * 60)
    print("\n".join(lines))

    try:
        app.run(host=HOST, port=PORT, threaded=True)
    finally:
        _cleanup()
