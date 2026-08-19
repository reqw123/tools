"""AI Provider 客戶端——只負責「送出一段文字、拿回一段文字」這件事本身，
不知道索引資料長什麼樣子，也不知道 Tkinter；批次要對誰產生說明、要不要
送出、送出前的確認流程，都是 services/ai_description_service.py 與
ui/dialogs 的事。

刻意不依賴 `openai`／`ollama` 這類第三方 SDK，只用標準函式庫的
`urllib.request` 發 HTTP 請求——跟這個工具一貫「不依賴外部套件、能撐則撐」
的原則一致，使用者不用另外 `pip install` 才能用這個功能。
"""
