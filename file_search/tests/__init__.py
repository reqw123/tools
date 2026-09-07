"""讓 `tests/` 成為一個真正的套件，測試裡的 `from tests.conftest import ...`
才有穩定的解析根。

背景：某些第三方套件的 wheel 打包有誤，會把自己的 `tests/` 目錄當成頂層
套件裝進 site-packages（實際遇過 ultralytics 8.2.42）。那份是「有 __init__.py
的正規套件」，會蓋過我們這個沒有 __init__.py 的目錄，於是 `import tests`
指到別人的測試套件、`from tests.conftest import entry` 直接 ImportError。
補上這個檔案 + pytest.ini 的 `pythonpath = .`（把專案根排在 sys.path 最前）
之後，本地這份一定先被找到，不受全域環境污染影響。
"""
