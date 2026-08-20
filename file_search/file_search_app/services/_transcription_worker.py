"""子行程進入點——用本地 faster-whisper 執行語音辨識，獨立成子行程執行，不在
主行程或背景執行緒裡直接呼叫（見 `_legacy_office_worker.py` 同樣的隔離理由，
這裡是實測發現的另一個真實案例）：ctranslate2（faster-whisper 底層的推論
引擎）在特定機器上載入模型時會直接讓行程 segfault（native 崩潰，不是 Python
例外，try/except 攔不住）。獨立子行程至少能讓崩潰只影響這個子行程，不會連
整個檔案快速搜尋 App 一起死掉；呼叫端也能用一般的行程終止機制安全中斷，
不像卡死或崩潰的執行緒沒辦法安全處理。

用法：python _transcription_worker.py <音訊/影片檔案路徑> <輸出文字檔路徑>

執行過程中每處理完一個語音片段，會印一行 `PROGRESS <0~1 的小數>` 到 stdout
（用已處理時間 / 檔案總長度概算，不是精確進度，faster-whisper 本身不提供），
讓呼叫端可以即時更新畫面、也知道子行程還活著。成功時把完整轉錄文字寫進輸出
檔案（UTF-8）、結束碼 0；失敗把錯誤訊息印到 stderr、結束碼非 0，不寫輸出
檔案——呼叫端（TranscriptionService）只在乎「有沒有拿到文字」，這裡不用
自己組什麼精緻的錯誤格式。"""

import sys

_MODEL_SIZE = "small"
_LANGUAGE = "zh"


def main() -> int:
    if len(sys.argv) != 3:
        print("用法：_transcription_worker.py <來源檔案> <輸出文字檔>", file=sys.stderr)
        return 2
    source_path, output_path = sys.argv[1], sys.argv[2]

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("尚未安裝 faster-whisper 套件", file=sys.stderr)
        return 2

    try:
        model = WhisperModel(_MODEL_SIZE, device="cpu", compute_type="int8")
        segments, info = model.transcribe(source_path, language=_LANGUAGE)
    except Exception as exc:
        print(f"載入模型或轉錄失敗：{exc}", file=sys.stderr)
        return 1

    duration = getattr(info, "duration", None) or 0
    parts = []
    try:
        for segment in segments:
            line = segment.text.strip()
            if line:
                parts.append(line)
            if duration:
                fraction = min(1.0, segment.end / duration)
                print(f"PROGRESS {fraction:.4f}", flush=True)
    except Exception as exc:
        print(f"轉錄過程中發生錯誤：{exc}", file=sys.stderr)
        return 1

    text = "\n".join(parts).strip()
    if not text:
        print("沒有辨識出任何文字內容（可能是靜音或沒有語音）", file=sys.stderr)
        return 1

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
