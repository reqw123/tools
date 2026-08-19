"""應用程式組裝——建立 Repository／Service，注入給 MainWindow。

MediaController 是唯一的例外：它需要 Tk root 的 `after`／`after_cancel` 才能
排程，這兩個原語只有 Tk 實例真正建構完成後才存在，所以改成把類別本身傳給
MainWindow，由它在 `__init__` 裡用自己的 `after`／`after_cancel` 建立實例
（詳見 `ui/main_window.py` 的說明）。
"""

from file_search_app.media.media_controller import MediaController
from file_search_app.repositories.ai_settings_repository import AISettingsRepository
from file_search_app.repositories.cache_repository import CacheRepository
from file_search_app.repositories.index_repository import IndexRepository
from file_search_app.repositories.metadata_repository import MetadataRepository
from file_search_app.services.ai_description_service import AIDescriptionService
from file_search_app.services.cache_service import CacheService
from file_search_app.services.description_service import DescriptionService
from file_search_app.services.duplicate_service import DuplicateService
from file_search_app.services.import_service import ImportService
from file_search_app.services.index_service import IndexService
from file_search_app.services.preview_service import PreviewService
from file_search_app.services.scan_service import ScanService
from file_search_app.services.search_service import SearchService
from file_search_app.ui.main_window import MainWindow


def build_app() -> MainWindow:
    index_repo = IndexRepository()
    cache_repo = CacheRepository()
    metadata_repo = MetadataRepository()
    ai_settings_repo = AISettingsRepository()

    preview_service = PreviewService()
    cache_service = CacheService(index_repo, cache_repo, preview_service)
    index_service = IndexService(index_repo, cache_repo, metadata_repo)
    search_service = SearchService()
    scan_service = ScanService()
    import_service = ImportService(index_service)
    duplicate_service = DuplicateService(index_repo, cache_repo, cache_service, index_service)
    description_service = DescriptionService(preview_service, index_service)
    ai_description_service = AIDescriptionService(ai_settings_repo, preview_service)

    return MainWindow(
        index_service=index_service,
        search_service=search_service,
        import_service=import_service,
        scan_service=scan_service,
        duplicate_service=duplicate_service,
        description_service=description_service,
        cache_service=cache_service,
        preview_service=preview_service,
        metadata_repo=metadata_repo,
        ai_description_service=ai_description_service,
        ai_settings_repo=ai_settings_repo,
        media_controller_cls=MediaController,
    )


def run() -> None:
    build_app().mainloop()
