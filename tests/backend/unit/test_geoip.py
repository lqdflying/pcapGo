from __future__ import annotations

from pathlib import Path

import pytest

from app.config import settings
from app.services import geoip


@pytest.mark.unit
def test_private_classification_is_lan_but_documentation_range_is_not():
    assert geoip.lookup_country("10.0.0.1") == ("LAN", "Local Network")
    assert geoip.lookup_country("192.168.1.1") == ("LAN", "Local Network")
    assert geoip.lookup_country("172.16.0.1") == ("LAN", "Local Network")
    assert geoip.lookup_country("fc00::1") == ("LAN", "Local Network")
    assert geoip.lookup_country("203.0.113.1") is None
    assert geoip.lookup_country("127.0.0.1") is None
    assert geoip.lookup_country("not-an-ip") is None


@pytest.mark.unit
def test_country_code_to_flag():
    assert geoip.country_code_to_flag("US") == "\U0001F1FA\U0001F1F8"
    assert geoip.country_code_to_flag("JP") == "\U0001F1EF\U0001F1F5"
    assert geoip.country_code_to_flag("CN") == "\U0001F1E8\U0001F1F3"
    assert geoip.country_code_to_flag("us") == "\U0001F1FA\U0001F1F8"
    assert geoip.country_code_to_flag(" jp ") == "\U0001F1EF\U0001F1F5"
    assert geoip.country_code_to_flag("LAN") == ""
    assert geoip.country_code_to_flag("lan") == ""
    assert geoip.country_code_to_flag("XX") == ""
    assert geoip.country_code_to_flag("xx") == ""
    assert geoip.country_code_to_flag(None) == ""
    assert geoip.country_code_to_flag("") == ""
    assert geoip.country_code_to_flag("A") == ""
    assert geoip.country_code_to_flag("USA") == ""
    assert geoip.country_code_to_flag("U1") == ""


@pytest.mark.unit
def test_rejects_non_public_download_urls():
    for url in (
        "file:///tmp/GeoLite2-Country.mmdb",
        "http://127.0.0.1/GeoLite2-Country.mmdb",
        "http://169.254.169.254/latest/meta-data/",
        "http://localhost/GeoLite2-Country.mmdb",
        "ftp://example.com/GeoLite2-Country.mmdb",
        "https://user:pass@example.com/GeoLite2-Country.mmdb",
    ):
        with pytest.raises(geoip.GeoIPInvalidURLError):
            geoip.validate_download_url(url)


@pytest.mark.unit
def test_install_rejects_oversized_database(tmp_path, monkeypatch):
    src = tmp_path / "GeoLite2-Country.mmdb"
    src.write_bytes(b"x" * 2048)
    monkeypatch.setattr(settings, "geoip_max_db_mb", 0)
    with pytest.raises(geoip.GeoIPSizeExceededError):
        geoip.install_database_file(src, tmp_path / "active.mmdb")


@pytest.mark.unit
def test_install_rejects_invalid_database(tmp_path, monkeypatch):
    src = tmp_path / "GeoLite2-Country.mmdb"
    src.write_bytes(b"not a real maxmind database")
    monkeypatch.setattr(settings, "geoip_max_db_mb", 100)
    with pytest.raises(geoip.GeoIPValidationError):
        geoip.install_database_file(src, tmp_path / "active.mmdb")


@pytest.mark.unit
def test_real_asset_is_available_for_bundled_database_validation():
    asset = Path("/home/opc/pcapGo/assets/GeoLite2-Country.mmdb")
    assert asset.exists(), (
        "Expected /home/opc/pcapGo/assets/GeoLite2-Country.mmdb to exist. "
        "Download GeoLite2-Country in GeoIP2 Binary format, extract the .tar.gz, "
        "and place GeoLite2-Country.mmdb under assets/."
    )
    geoip.validate_database_file(asset)
