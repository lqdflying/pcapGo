from __future__ import annotations

from pydantic import BaseModel


class AnalysisIssue(BaseModel):
    type: str  # e.g. "retransmission", "handshake_failure", "high_latency", "reset"
    severity: str  # "low", "medium", "high", "critical"
    explanation: str


class AnalysisEvent(BaseModel):
    conversation_id: str
    proto: str
    src: str
    dst: str
    summary_markdown: str
    issues: list[AnalysisIssue] = []
