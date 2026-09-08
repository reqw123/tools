"""notes-web/server/ai_bridge.py 的「研究生模式：從專案生成」草稿解析器。

只測純解析（JSON 契約 + 小模型不聽指示回 Markdown 大綱時的退路），不碰 AI。
"""
import sys
from pathlib import Path

import pytest

_BRIDGE_DIR = Path(__file__).resolve().parents[1] / "notes-web" / "server"
sys.path.insert(0, str(_BRIDGE_DIR))

ai_bridge = pytest.importorskip("ai_bridge")


def test_parse_thesis_seed_json_array():
    raw = (
        '前面亂講\n[{"title": "補寫 3.4 SQA", "tag": "研究方法", "body": "- 說明門檻"}, '
        '{"title": "無效", "tag": "亂填", "body": ""}, '
        '{"title": "", "tag": "緒論", "body": "沒標題要丟掉"}]\n收尾'
    )
    out = ai_bridge._parse_thesis_seed(raw)
    assert [d["title"] for d in out] == ["補寫 3.4 SQA", "無效"]
    assert out[0]["tag"] == "研究方法"
    assert out[1]["tag"] == "其他"  # 不在白名單 → 其他


def test_parse_thesis_seed_falls_back_to_markdown():
    raw = """\
### 第三章 研究方法
1. 資料收集與處理
   - 資料來源
   - 影片批次測試
2. 個體化行為基線建立
   - 收集個體歷史資料
### 第五章 討論與未來
- SQA 門檻擴大驗證
"""
    out = ai_bridge._parse_thesis_seed(raw)
    titles = [d["title"] for d in out]
    assert "資料收集與處理" in titles
    assert "個體化行為基線建立" in titles
    assert "SQA 門檻擴大驗證" in titles
    assert "第三章 研究方法" not in titles  # 純章節標題被丟掉
    # tag 從最近的章節標題推
    row = next(d for d in out if d["title"] == "資料收集與處理")
    assert row["tag"] == "研究方法"
    assert "- 資料來源" in row["body"]


def test_parse_thesis_seed_empty_on_garbage():
    assert ai_bridge._parse_thesis_seed("完全沒有結構的一段話。") == []


def test_tag_from_context_maps_known_terms():
    assert ai_bridge._tag_from_context("第二章 文獻回顧") == "文獻探討"
    assert ai_bridge._tag_from_context("消融實驗設計") == "實驗"
    assert ai_bridge._tag_from_context("未來工作方向") == "未來工作"
    assert ai_bridge._tag_from_context("隨便一句") == "其他"


# ── _collect_seed_docs：自選資料夾 / .zip ──────────────────────────

def test_collect_seed_docs_from_folder_prioritises_docs(tmp_path):
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "0_overview.md").write_text("# 總覽\n" + "貓咪行為辨識研究。" * 20, encoding="utf-8")
    (tmp_path / "docs" / "dataset.md").write_text("# 資料\n" + "500 段影片待標註。" * 20, encoding="utf-8")
    (tmp_path / "main.py").write_text("print('code, 不該被挑')" * 5, encoding="utf-8")
    (tmp_path / "node_modules").mkdir()
    (tmp_path / "node_modules" / "junk.md").write_text("套件的 readme" * 30, encoding="utf-8")

    text, used = ai_bridge._collect_seed_docs(str(tmp_path))
    assert "0_overview.md" in " ".join(used)
    assert "dataset.md" in " ".join(used)
    assert not any("main.py" in u for u in used)          # .py 不在候選副檔名
    assert not any("node_modules" in u for u in used)     # skip dir
    assert "貓咪行為辨識研究" in text


def test_collect_seed_docs_from_zip(tmp_path):
    import zipfile

    zp = tmp_path / "proj.zip"
    with zipfile.ZipFile(zp, "w") as z:
        z.writestr("docs/0_進度.md", "# 進度\n" + "第三章方法要補寫。" * 20)
        z.writestr("README.md", "# 專案\n" + "個體化基線 30 天。" * 20)
        z.writestr("src/x.py", "code" * 50)
    text, used = ai_bridge._collect_seed_docs(str(zp))
    assert any("0_進度.md" in u for u in used)
    assert any("README.md" in u for u in used)
    assert not any(u.endswith(".py") for u in used)
    assert "第三章方法要補寫" in text


def test_collect_seed_docs_missing_source():
    assert ai_bridge._collect_seed_docs("C:/nope/not/here") == ("", [])


def test_seed_score_ranks_overview_over_random():
    assert ai_bridge._seed_score("docs/0_overview.md", 2000) > ai_bridge._seed_score("src/util.md", 2000)
    assert ai_bridge._seed_score("paper/CONTEXT.md", 1000) > ai_bridge._seed_score("changelog.md", 1000)
