# AI Excel 多公司報表智慧助手（模組化版）

Windows Python + Tkinter GUI 工具，透過 `pywin32` COM 連接**目前已開啟**的 Microsoft
Excel，自動偵測工作表內的多個資料區塊（Region）、判斷報表類型、建立 Schema
Mapping，並支援用自然語言／圖片下指令新增或修改資料（目前以「客戶對帳表」為完整實作
範例）。

執行進入點是 **`main_gui.py`**（舊版單檔原型 `ai_excel.py` 仍保留在原地，未被覆蓋）。

## 安裝

```
pip install -r requirements.txt
```

若要使用 Ollama，另外需要本機安裝並啟動 Ollama（預設 `http://localhost:11434`），
並先 `ollama pull qwen2.5:7b`（或 `qwen2.5:3b`）。

## 執行

1. 先在 Excel 中開啟要處理的報表檔案。
2. 執行：
   ```
   python main_gui.py
   ```
3. 點「🔗 連接 / 重新掃描」讓工具連上目前 Excel、掃描目前 Sheet 的所有 Region。
4. 在「Region 清單」點選一個 Region，下方會顯示自動判斷的報表類型、Header Row、
   欄位、Schema Mapping。
5. 不確定的欄位可以按「🤖 AI Mapping」，AI 建議會先以勾選清單方式**預覽**，
   確認後才會真正套用。
6. 對應好之後可按「💾 儲存模板」把這家公司的版型記下來，下次同類型報表會自動比對套用。
7. 在「自然語言需求」輸入框輸入需求（例如：`幫我在谷樺 7/24 加上機器麵線 20 件`），
   或選擇圖片（僅 OpenAI 支援），按「🤖 AI 解析需求」。
8. AI／規則解析出的操作計畫會顯示在「操作預覽」，確認欄位、新舊值都正確後，
   按「✅ 確認執行」才會真正寫入 Excel；寫入後會自動重新讀取變更範圍做驗證。
9. 最後按「💾 儲存 Excel」把變更存回檔案。

## 模組結構

```
settings.py              全域設定、Canonical Schema 別名表
value_normalizer.py      金額 / 日期 / 文字正規化
excel_manager.py         唯一直接操作 Excel COM 的模組
region_detector.py       掃描 Sheet，切出多個獨立 Region 並粗分類
structure_analyzer.py    針對 table Region 做欄位/公式/分組/合併儲存格分析
report_classifier.py     判斷 Region 的報表類型
schema_mapper.py         Excel 欄位 -> Canonical 欄位（別名 -> 模板 -> LLM 預覽）
template_manager.py      公司模板 JSON 儲存與比對
ai_manager.py             OpenAI / Ollama 切換，背景執行緒 + JSON-only 呼叫
operation_planner.py     自然語言/圖片 -> 結構化 Operation Plan（含安全驗證）
report_handlers/         每種報表類型的 parse/validate/find_insert_position/
                          build_operation_plan/execute/verify
main_gui.py               Tkinter 主程式（進入點）
```

## 目前完整度

- **客戶對帳表 (`customer_statement`)**：完整實作，包含日期分組、同日期多品項、
  空白日期繼承、新增品項（自動延伸該組小計公式與總表總計公式）、修改數量/退貨
  （含多筆命中時要求更明確條件）、單價自動從參考價格表或歷史資料取得。
  已用資料夾內的真實樣本檔（谷樺／德川／晉盛／相正）驗證過核心流程。
- **人員名冊 / 多客戶結算表**：支援在表尾新增一列、修改單一欄位（含 SUM 總計公式
  自動延伸），共用 `report_handlers/generic.py` 的 `GenericAppendRowHandler`。
- **地址標籤／支票月份表／商品價格表／商品日期矩陣／公告／未知格式**：第一版為
  唯讀 + AI 分析模式（`GenericReadOnlyHandler`），架構已就緒、之後可依需求擴充
  寫入邏輯，不會因為遇到還沒支援的類型而讓程式崩潰。

## 安全限制（已在程式中落實）

- LLM 只能輸出結構化 JSON，且**不可**指定任何 Excel Cell / Row / Column / Sheet
  座標（`operation_planner.py` 會直接剔除這些欄位）。
- 所有動作都限制在白名單 `settings.ALLOWED_ACTIONS`，不含刪除 / 清空 / VBA。
- 真正寫入 Excel 一律經過對應的 Report Handler，不會有 AI 結果直接變成 COM 指令。
- Update 命中多筆資料時一律擋下，顯示候選資料並要求更明確條件。
- 每次寫入前都保留 old_value / old_formula，操作紀錄寫入 `operation_log.json`
  （Undo 所需資訊）。
- 任何解析或寫入失敗都會用清楚訊息提示，不會讓整個 GUI 崩潰。
