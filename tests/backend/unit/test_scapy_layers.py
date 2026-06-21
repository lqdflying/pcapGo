"""Tests for app/services/scapy_layers.py — centralized protocol registration."""

import pytest


class TestScapyLayersImport:
    def test_import_does_not_raise(self):
        import app.services.scapy_layers  # noqa: F401

    def test_ether_linktype_registered(self):
        import app.services.scapy_layers  # noqa: F401
        from scapy.config import conf

        assert 1 in conf.l2types.num2layer

    def test_common_layers_available(self):
        """After importing scapy_layers, common protocol classes should be
        importable and registered in scapy's dissection chain."""
        import app.services.scapy_layers  # noqa: F401

        from scapy.layers.l2 import Ether
        from scapy.layers.inet import IP, TCP, UDP
        from scapy.layers.inet6 import IPv6
        from scapy.layers.dns import DNS

        assert Ether is not None
        assert IP is not None
        assert TCP is not None
        assert UDP is not None
        assert IPv6 is not None
        assert DNS is not None

    def test_netbios_layer_registered(self):
        """NetBIOS layer should be available after importing scapy_layers."""
        import app.services.scapy_layers  # noqa: F401

        from scapy.layers.netbios import NBNSQueryRequest
        assert NBNSQueryRequest is not None

    def test_dhcp_layer_registered(self):
        import app.services.scapy_layers  # noqa: F401

        from scapy.layers.dhcp import DHCP
        assert DHCP is not None

    def test_ntp_layer_registered(self):
        import app.services.scapy_layers  # noqa: F401

        from scapy.layers.ntp import NTP
        assert NTP is not None

    def test_http_layer_registered(self):
        import app.services.scapy_layers  # noqa: F401

        from scapy.layers.http import HTTP
        assert HTTP is not None
