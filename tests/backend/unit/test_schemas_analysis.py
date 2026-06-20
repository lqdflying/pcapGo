"""Tests for analysis-related Pydantic schemas."""

import json
import pytest
from pydantic import ValidationError

from app.schemas.analysis import AnalysisIssue, AnalysisEvent


class TestAnalysisIssueSchema:
    def test_valid_issue(self):
        ai = AnalysisIssue(
            type="retransmission",
            severity="medium",
            explanation="Duplicate ACK detected.",
        )
        assert ai.type == "retransmission"
        assert ai.severity == "medium"

    def test_all_severity_levels(self):
        for severity in ("low", "medium", "high", "critical"):
            ai = AnalysisIssue(type="test", severity=severity, explanation="test")
            assert ai.severity == severity

    def test_missing_fields(self):
        with pytest.raises(ValidationError):
            AnalysisIssue(type="test", severity="low")

        with pytest.raises(ValidationError):
            AnalysisIssue(type="test", explanation="test")

        with pytest.raises(ValidationError):
            AnalysisIssue(severity="low", explanation="test")


class TestAnalysisEventSchema:
    def test_valid_event(self):
        event = AnalysisEvent(
            conversation_id="conv-1",
            proto="tcp",
            src="10.0.0.1:443",
            dst="10.0.0.2:54321",
            summary_markdown="TLS handshake analysis.",
            issues=[
                AnalysisIssue(
                    type="connection_reset",
                    severity="high",
                    explanation="Connection was reset.",
                ),
            ],
        )
        assert len(event.issues) == 1
        assert event.issues[0].type == "connection_reset"

    def test_empty_issues(self):
        event = AnalysisEvent(
            conversation_id="conv-1",
            proto="udp",
            src="10.0.0.1:53",
            dst="10.0.0.2:12345",
            summary_markdown="DNS query.",
        )
        assert event.issues == []

    def test_model_dump_json(self):
        event = AnalysisEvent(
            conversation_id="conv-1",
            proto="tcp",
            src="10.0.0.1:443",
            dst="10.0.0.2:54321",
            summary_markdown="Test.",
        )
        json_str = event.model_dump_json()
        data = json.loads(json_str)
        assert data["conversation_id"] == "conv-1"
        assert data["proto"] == "tcp"
        assert data["issues"] == []

    def test_missing_fields(self):
        with pytest.raises(ValidationError):
            AnalysisEvent(
                proto="tcp",
                src="10.0.0.1:443",
                dst="10.0.0.2:54321",
                summary_markdown="Test.",
            )
