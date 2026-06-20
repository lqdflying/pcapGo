import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { AIAnalysisPanel } from "@/components/AIAnalysisPanel";

const listChatThreads = vi.fn();
const createChatThread = vi.fn();
const getChatThread = vi.fn();
const deleteChatThread = vi.fn();
const streamChatMessage = vi.fn();

vi.mock("@/api/client", () => ({
  listChatThreads: (...a: any[]) => listChatThreads(...a),
  createChatThread: (...a: any[]) => createChatThread(...a),
  getChatThread: (...a: any[]) => getChatThread(...a),
  deleteChatThread: (...a: any[]) => deleteChatThread(...a),
  streamChatMessage: (...a: any[]) => streamChatMessage(...a),
}));

describe("AIAnalysisPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listChatThreads.mockResolvedValue([]);
    getChatThread.mockResolvedValue({ id: "t1", title: "t", created_at: "", messages: [] });
    createChatThread.mockResolvedValue({
      id: "t1",
      title: "q",
      created_at: "",
      message_count: 0,
    });
  });

  it("renders the empty chat state and an input", async () => {
    render(<AIAnalysisPanel captureId="cap-1" />);
    expect(await screen.findByLabelText("Ask a question")).toBeInTheDocument();
    expect(screen.getByText(/Ask a question about this capture/i)).toBeInTheDocument();
    expect(screen.getByText("Run full analysis")).toBeInTheDocument();
  });

  it("sends a question and renders the streamed assistant reply", async () => {
    streamChatMessage.mockImplementation(async (_c, _t, _q, opts) => {
      opts.onDelta("DNS traffic looks healthy.");
    });

    render(<AIAnalysisPanel captureId="cap-1" />);
    const input = await screen.findByLabelText("Ask a question");

    await act(async () => {
      fireEvent.change(input, { target: { value: "Summarize the DNS traffic" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    expect(createChatThread).toHaveBeenCalled();
    expect(await screen.findByText("Summarize the DNS traffic")).toBeInTheDocument();
    expect(await screen.findByText("DNS traffic looks healthy.")).toBeInTheDocument();
  });

  it("stops an in-progress stream when Stop is clicked", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    // Never resolves until the signal aborts.
    streamChatMessage.mockImplementation(
      (_c: any, _t: any, _q: any, opts: any) =>
        new Promise<void>((resolve) => {
          opts.onDelta("partial answer");
          opts.signal?.addEventListener("abort", () => resolve());
        })
    );

    render(<AIAnalysisPanel captureId="cap-1" />);
    const input = await screen.findByLabelText("Ask a question");
    await act(async () => {
      fireEvent.change(input, { target: { value: "hi" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    // Streaming → Stop button is shown.
    const stopBtn = await screen.findByLabelText("Stop");
    await act(async () => {
      fireEvent.click(stopBtn);
    });

    expect(abortSpy).toHaveBeenCalled();
    // After stopping, the Send button returns and partial text is kept.
    await waitFor(() => expect(screen.getByLabelText("Send")).toBeInTheDocument());
    expect(screen.getByText("partial answer")).toBeInTheDocument();
    abortSpy.mockRestore();
  });

  it("creates an EventSource on Run full analysis and renders events as text", async () => {
    const originalEventSource = (global as any).EventSource;
    const created: any[] = [];
    (global as any).EventSource = vi.fn().mockImplementation((url: string) => {
      const inst = {
        url,
        onmessage: null as any,
        onerror: null as any,
        close: vi.fn(),
      };
      created.push(inst);
      return inst;
    });

    render(<AIAnalysisPanel captureId="cap-1" />);
    await screen.findByText("Run full analysis");
    await act(async () => {
      fireEvent.click(screen.getByText("Run full analysis"));
    });

    expect((global as any).EventSource).toHaveBeenCalledWith("/api/captures/cap-1/ai");

    const xss = "<img src=x onerror='alert(1)'>";
    await act(async () => {
      created[0].onmessage({
        data: JSON.stringify({
          conversation_id: "c1",
          proto: "tcp",
          src: "10.0.0.1:443",
          dst: "10.0.0.2:5",
          summary_markdown: xss,
          issues: [],
        }),
      });
    });

    expect(screen.getByText(xss)).toBeInTheDocument();
    expect(document.querySelector("img[src='x']")).toBeNull();

    (global as any).EventSource = originalEventSource;
  });

  it("lists existing threads and allows deleting one", async () => {
    listChatThreads.mockResolvedValue([
      { id: "t1", title: "Why reset?", created_at: "", message_count: 2 },
    ]);
    deleteChatThread.mockResolvedValue(undefined);

    render(<AIAnalysisPanel captureId="cap-1" />);
    expect(await screen.findByText("Why reset?")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByLabelText("Delete chat"));
    });
    expect(deleteChatThread).toHaveBeenCalledWith("cap-1", "t1");
  });
});
