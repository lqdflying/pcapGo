import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { AIAnalysisPanel } from "@/components/AIAnalysisPanel";

describe("AIAnalysisPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders idle state with instructions", () => {
    render(<AIAnalysisPanel captureId="test-capture-id" />);
    expect(screen.getByText("AI Conversation Analysis")).toBeInTheDocument();
    expect(screen.getByText("Start Analysis")).toBeInTheDocument();
    expect(screen.getByText(/AI analysis will inspect each conversation/i)).toBeInTheDocument();
  });

  it('shows "Start Analysis" button when not running', () => {
    render(<AIAnalysisPanel captureId="test-capture-id" />);
    expect(screen.getByText("Start Analysis")).toBeInTheDocument();
  });

  it("creates EventSource on Start Analysis click", async () => {
    const mockEventSource = vi.fn();
    const originalEventSource = (global as any).EventSource;
    (global as any).EventSource = vi.fn().mockImplementation((url: string) => {
      const instance = new originalEventSource(url);
      mockEventSource(url);
      return instance;
    });

    render(<AIAnalysisPanel captureId="test-capture-id" />);

    await act(async () => {
      fireEvent.click(screen.getByText("Start Analysis"));
    });

    expect(mockEventSource).toHaveBeenCalledWith("/api/captures/test-capture-id/ai");

    (global as any).EventSource = originalEventSource;
  });

  it("renders events received from SSE stream", async () => {
    const events: any[] = [];
    const originalEventSource = (global as any).EventSource;
    (global as any).EventSource = vi.fn().mockImplementation(() => {
      return {
        url: "/api/captures/test-capture-id/ai",
        readyState: 0,
        onmessage: null as any,
        onerror: null as any,
        close: vi.fn(),
        addEventListener: vi.fn(),
      };
    });

    render(<AIAnalysisPanel captureId="test-capture-id" />);
    await act(async () => {
      fireEvent.click(screen.getByText("Start Analysis"));
    });

    // Manually fire an SSE message event
    const es = ((global as any).EventSource as any).mock.results[0].value;
    const messageEvent = new MessageEvent("message", {
      data: JSON.stringify({
        conversation_id: "conv-1",
        proto: "tcp",
        src: "10.0.0.1:443",
        dst: "10.0.0.2:54321",
        summary_markdown: "TLS handshake analysis.",
        issues: [],
      }),
      origin: "http://localhost",
    });

    await act(async () => {
      es.onmessage(messageEvent);
    });

    expect(screen.getByText(/TLS handshake analysis/)).toBeInTheDocument();

    (global as any).EventSource = originalEventSource;
  });

  it("button is disabled while running", async () => {
    const originalEventSource = (global as any).EventSource;
    (global as any).EventSource = vi.fn().mockImplementation(() => {
      return {
        url: "/api/captures/test-capture-id/ai",
        readyState: 0,
        onmessage: null as any,
        onerror: null as any,
        close: vi.fn(),
        addEventListener: vi.fn(),
      };
    });

    render(<AIAnalysisPanel captureId="test-capture-id" />);
    await act(async () => {
      fireEvent.click(screen.getByText("Start Analysis"));
    });

    expect(screen.getByText("Analyzing...")).toBeInTheDocument();

    (global as any).EventSource = originalEventSource;
  });

  it("renders LLM output as text (no XSS via dangerouslySetInnerHTML)", async () => {
    const originalEventSource = (global as any).EventSource;
    (global as any).EventSource = vi.fn().mockImplementation(() => {
      return {
        url: "/api/captures/test-capture-id/ai",
        readyState: 0,
        onmessage: null as any,
        onerror: null as any,
        close: vi.fn(),
        addEventListener: vi.fn(),
      };
    });

    render(<AIAnalysisPanel captureId="test-capture-id" />);
    await act(async () => {
      fireEvent.click(screen.getByText("Start Analysis"));
    });

    const xssPayload =
      "<img src=x onerror='fetch(\"/evil\")'> <script>alert(1)</script>";
    const es = ((global as any).EventSource as any).mock.results[0].value;
    const messageEvent = new MessageEvent("message", {
      data: JSON.stringify({
        conversation_id: "conv-xss",
        proto: "tcp",
        src: "10.0.0.1:443",
        dst: "10.0.0.2:54321",
        summary_markdown: xssPayload,
        issues: [],
      }),
      origin: "http://localhost",
    });

    await act(async () => {
      es.onmessage(messageEvent);
    });

    // The literal payload is visible as text — not executed as HTML.
    expect(screen.getByText(xssPayload)).toBeInTheDocument();
    // No <img> or <script> was injected into the DOM.
    expect(document.querySelector("img[src='x']")).toBeNull();
    expect(document.querySelector("script")).toBeNull();

    (global as any).EventSource = originalEventSource;
  });
});
