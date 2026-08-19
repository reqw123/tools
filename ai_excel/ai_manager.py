# -*- coding: utf-8 -*-
"""
ai_manager.py
==============
AI Provider 切換（OpenAI / Ollama）與背景執行緒管理。

規則：
  - 所有 AI 呼叫都在背景 Thread 執行（需求 #26）。
  - Tkinter 只能在主執行緒更新 -> 一律透過 queue.Queue() 回傳結果，
    由 GUI 的 after() 輪詢處理（需求 #27 #28）。
  - LLM 只允許回傳結構化 JSON（需求 #31），這裡統一負責『抽取/解析』，
    但『驗證是否可執行』一律交給 operation_planner。
  - Ollama qwen2.5:3b / 7b 僅文字模式，絕不假裝可以辨識圖片（需求 #25）。
"""

from __future__ import annotations

import base64
import json
import mimetypes
import queue
import re
import threading
from pathlib import Path
from typing import Callable, Optional

from settings import (
    PROVIDER_OPENAI, PROVIDER_OLLAMA, DEFAULT_OLLAMA_HOST, SUPPORTED_IMAGE_EXT,
)

JSON_ONLY_INSTRUCTION = (
    "你是一個嚴謹的資料解析系統。你只能輸出合法的 JSON，"
    "不可以輸出任何 JSON 以外的文字、說明或 markdown code fence。"
    "如果不確定，請在 JSON 中明確標示，不要用猜測值。"
)


class AIError(RuntimeError):
    pass


def extract_json(text: str) -> dict:
    if not text:
        raise AIError("AI 模型沒有回傳任何內容。")

    text = text.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text)

    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass

    start, end = text.find("{"), text.rfind("}")
    if start >= 0 and end > start:
        try:
            result = json.loads(text[start:end + 1])
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

    raise AIError(f"AI 模型沒有回傳合法 JSON：\n{text[:500]}")


def image_to_data_url(path: str) -> str:
    p = Path(path)
    if not p.exists():
        raise AIError(f"找不到圖片檔案：{p}")
    if p.suffix.lower() not in SUPPORTED_IMAGE_EXT:
        raise AIError(f"不支援的圖片格式：{p.name}（僅支援 JPG/JPEG/PNG/WEBP/GIF）")
    mime, _ = mimetypes.guess_type(str(p))
    mime = mime or "image/png"
    encoded = base64.b64encode(p.read_bytes()).decode("utf-8")
    return f"data:{mime};base64,{encoded}"


class AIManager:
    def __init__(self):
        self.provider: str = PROVIDER_OLLAMA
        self.model: str = ""
        self.api_key: str = ""
        self.ollama_host: str = DEFAULT_OLLAMA_HOST
        self._openai_client = None
        self._ollama_client = None

    def configure(self, provider: str, model: str, api_key: str = "",
                  ollama_host: str = DEFAULT_OLLAMA_HOST):
        self.provider = provider
        self.model = model
        self.api_key = api_key or ""
        self.ollama_host = ollama_host or DEFAULT_OLLAMA_HOST
        self._openai_client = None
        self._ollama_client = None

    def supports_images(self) -> bool:
        return self.provider == PROVIDER_OPENAI

    # ------------------------------------------------------------
    # 背景執行緒包裝
    # ------------------------------------------------------------

    def run_async(self, job_fn: Callable, result_queue: "queue.Queue", tag: str, **kwargs):
        def _worker():
            try:
                result = job_fn(**kwargs)
                result_queue.put({"tag": tag, "ok": True, "result": result})
            except Exception as e:  # noqa: BLE001 - 需求 #50：任何失敗都不能讓 GUI 崩潰
                result_queue.put({"tag": tag, "ok": False, "error": str(e)})

        threading.Thread(target=_worker, daemon=True).start()

    # ------------------------------------------------------------
    # 純文字 -> JSON
    # ------------------------------------------------------------

    def text_json(self, system_prompt: str, user_prompt: str) -> dict:
        full_system = JSON_ONLY_INSTRUCTION + "\n\n" + system_prompt
        if self.provider == PROVIDER_OPENAI:
            return self._openai_text_json(full_system, user_prompt)
        if self.provider == PROVIDER_OLLAMA:
            return self._ollama_text_json(full_system, user_prompt)
        raise AIError(f"未知的 AI Provider：{self.provider}")

    # ------------------------------------------------------------
    # 文字 + 圖片 -> JSON（僅 OpenAI）
    # ------------------------------------------------------------

    def image_json(self, system_prompt: str, user_prompt: str, image_paths: list[str]) -> dict:
        if not image_paths:
            return self.text_json(system_prompt, user_prompt)

        if self.provider != PROVIDER_OPENAI:
            raise AIError(
                "目前選擇的 Ollama 模型（qwen2.5:3b / 7b）僅支援文字模式，"
                "不具備圖片辨識能力，請切換到 OpenAI 並選擇支援圖片的模型。"
            )

        full_system = JSON_ONLY_INSTRUCTION + "\n\n" + system_prompt
        return self._openai_image_json(full_system, user_prompt, image_paths)

    # ------------------------------------------------------------
    # OpenAI 實作
    # ------------------------------------------------------------

    def _get_openai_client(self):
        if self._openai_client is None:
            from openai import OpenAI
            self._openai_client = OpenAI(api_key=self.api_key) if self.api_key else OpenAI()
        return self._openai_client

    def _openai_text_json(self, system_prompt: str, user_prompt: str) -> dict:
        client = self._get_openai_client()
        response = client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": [{"type": "input_text", "text": user_prompt}]},
            ],
        )
        return extract_json(response.output_text)

    def _openai_image_json(self, system_prompt: str, user_prompt: str, image_paths: list[str]) -> dict:
        client = self._get_openai_client()
        content = [{"type": "input_text", "text": user_prompt}]
        for path in image_paths:
            content.append({
                "type": "input_image",
                "image_url": image_to_data_url(path),
                "detail": "high",
            })
        response = client.responses.create(
            model=self.model,
            input=[
                {"role": "system", "content": [{"type": "input_text", "text": system_prompt}]},
                {"role": "user", "content": content},
            ],
        )
        return extract_json(response.output_text)

    # ------------------------------------------------------------
    # Ollama 實作
    # ------------------------------------------------------------

    def _get_ollama_client(self):
        if self._ollama_client is None:
            import ollama
            self._ollama_client = ollama.Client(host=self.ollama_host)
        return self._ollama_client

    # ------------------------------------------------------------
    # 測試連線（不送任何業務資料，只確認 Provider 可以連得上）
    # ------------------------------------------------------------

    def test_connection(self) -> str:
        if self.provider == PROVIDER_OPENAI:
            return self._test_openai_connection()
        if self.provider == PROVIDER_OLLAMA:
            return self._test_ollama_connection()
        raise AIError(f"未知的 AI Provider：{self.provider}")

    def _test_openai_connection(self) -> str:
        if not self.api_key:
            raise AIError("尚未輸入 OpenAI API Key。")
        try:
            client = self._get_openai_client()
            models = client.models.list()
            names = [m.id for m in getattr(models, "data", [])]
        except Exception as e:  # noqa: BLE001
            raise AIError(f"OpenAI 連線失敗：{e}") from e

        model_hit = "✓ 找得到" if any(self.model in n or n in self.model for n in names) else "⚠ 清單中沒看到，但帳號本身可連線"
        return (
            f"OpenAI 連線成功！\n"
            f"帳號可用模型數：{len(names)}\n"
            f"目前選擇的模型「{self.model}」：{model_hit}"
        )

    def _test_ollama_connection(self) -> str:
        try:
            client = self._get_ollama_client()
            result = client.list()
        except Exception as e:  # noqa: BLE001
            raise AIError(
                f"Ollama 連線失敗（Host：{self.ollama_host}）：{e}\n"
                f"請確認 Ollama 是否已啟動（ollama serve），以及 Host 位址是否正確。"
            ) from e

        names = []
        try:
            models = result.get("models", []) if isinstance(result, dict) else getattr(result, "models", [])
            for m in models:
                name = m.get("model") or m.get("name") if isinstance(m, dict) else getattr(m, "model", None)
                if name:
                    names.append(name)
        except Exception:  # noqa: BLE001
            pass

        model_hit = "✓ 已安裝" if any(self.model in n for n in names) else "⚠ 尚未安裝，請先執行 ollama pull " + self.model
        return (
            f"Ollama 連線成功（Host：{self.ollama_host}）！\n"
            f"本機已安裝模型：{', '.join(names) if names else '（無）'}\n"
            f"目前選擇的模型「{self.model}」：{model_hit}"
        )

    def _ollama_text_json(self, system_prompt: str, user_prompt: str) -> dict:
        client = self._get_ollama_client()
        response = client.chat(
            model=self.model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            format="json",
            options={"temperature": 0.1},
        )
        try:
            text = response.message.content
        except AttributeError:
            text = response["message"]["content"]
        return extract_json(text)
