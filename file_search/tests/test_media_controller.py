from file_search_app.media.media_controller import MediaController, format_ms


def test_format_ms():
    assert format_ms(0) == "00:00"
    assert format_ms(None) == "00:00"
    assert format_ms(-5) == "00:00"
    assert format_ms(65_000) == "01:05"
    assert format_ms(3_600_000) == "60:00"


def test_controller_without_vlc_is_safe(monkeypatch):
    import file_search_app.media.media_controller as mc
    monkeypatch.setattr(mc, "_HAS_VLC", False)
    monkeypatch.setattr(mc, "vlc", None)
    c = MediaController(schedule=lambda ms, fn: None, unschedule=lambda t: None)
    assert c.available is False
    # 這些在沒有 player 時都不該炸
    c.play_pause()
    c.stop()
    c.seek_by(1000)
    c.set_position(0.5)
    c.release()
    assert c.current_path is None
    assert c.is_playing() is False
    assert c.get_time() == 0 and c.get_length() == 0
