"""Unit tests for session-related schemas."""
from app.schemas.capture import GeoInfo, SessionPacketsResponse, PacketSummary


class TestGeoInfoDefaults:
    def test_defaults(self):
        g = GeoInfo()
        assert g.country is None
        assert g.country_code is None
        assert g.country_flag is None


class TestSessionPacketsResponse:
    def test_model_serialization(self):
        resp = SessionPacketsResponse(
            items=[PacketSummary(idx=0, ts=1.0, src="1.1.1.1", dst="2.2.2.2", proto="TCP", length=66, info="443 > 80 [SYN]")],
            total=1, offset=0, limit=200,
            src_geo=GeoInfo(country="US", country_code="US", country_flag="\U0001f1fa\U0001f1f8"),
            dst_geo=GeoInfo(),
        )
        d = resp.model_dump()
        assert d["total"] == 1
        assert d["src_geo"]["country"] == "US"
        assert d["dst_geo"]["country"] is None
        assert len(d["items"]) == 1
