"""Unit tests for the pcap_parser evidence sampler."""

import pytest

from app.services.pcap_parser import _EvidenceSampler


class TestEvidenceSampler:
    def test_preserves_first_and_last(self):
        sampler = _EvidenceSampler(max_samples=4)
        for i in range(10):
            sampler.observe("flow-a", {"ts": float(i), "flags": "ACK"})
        samples = sampler.finalize()["flow-a"]
        assert len(samples) == 4
        assert samples[0]["ts"] == 0.0  # first
        assert samples[1]["ts"] == 9.0  # last

    def test_preserves_anomalous_packets(self):
        sampler = _EvidenceSampler(max_samples=8)
        packets = [
            {"ts": 0.0, "flags": "SYN"},      # first + anomaly
            {"ts": 1.0, "flags": "SYN,ACK"},
            {"ts": 2.0, "flags": "ACK"},
            {"ts": 3.0, "flags": "FIN,ACK"},  # anomaly
            {"ts": 4.0, "flags": "RST"},      # anomaly
            {"ts": 5.0, "flags": "ACK"},
            {"ts": 6.0, "flags": "ACK"},
            {"ts": 7.0, "flags": "ACK"},
        ]
        for p in packets:
            sampler.observe("flow-b", p)
        samples = sampler.finalize()["flow-b"]
        flags = {s["flags"] for s in samples}
        assert "SYN" in flags
        assert "FIN,ACK" in flags
        assert "RST" in flags

    def test_caps_at_max_samples(self):
        sampler = _EvidenceSampler(max_samples=3)
        for i in range(20):
            sampler.observe("flow-c", {"ts": float(i), "flags": "ACK"})
        samples = sampler.finalize()["flow-c"]
        assert len(samples) == 3

    def test_ignores_other_key(self):
        sampler = _EvidenceSampler(max_samples=4)
        sampler.observe("other", {"ts": 0.0, "flags": ""})
        assert sampler.finalize() == {}
