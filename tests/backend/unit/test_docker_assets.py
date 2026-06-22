from __future__ import annotations

from pathlib import Path


import pytest


@pytest.mark.unit
def test_dockerfile_bundles_geolite_country_asset():
    root = Path(__file__).resolve().parents[3]
    dockerfile = root / "Dockerfile"
    asset = root / "assets" / "GeoLite2-Country.mmdb"

    assert asset.exists(), (
        "Expected assets/GeoLite2-Country.mmdb to be present for the built-in "
        "GeoIP database copied into the production image."
    )
    text = dockerfile.read_text()
    assert "COPY assets/GeoLite2-Country.mmdb /app/data/GeoLite2-Country.mmdb" in text
