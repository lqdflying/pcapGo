import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { AIChatPanel } from "@/components/AIChatPanel";
import { useCaptureStore } from "@/lib/store";
import {
  createChatThread,
  streamChatMessage,
  listChatThreads,
  getChatThread,
  batchDeleteChatThreads,
} from "@/api/client";

vi.mock("@/api/client", () => ({
  createChatThread: vi.fn(),
  streamChatMessage: vi.fn(),
  listChatThreads: vi.fn(),
  getChatThread: vi.fn(),
  batchDeleteChatThreads: vi.fn(),
}));

const mockCreateChatThread = vi.mocked(createChatThread);
const mockStreamChatMessage = vi.mocked(streamChatMessage);
const mockListChatThreads = vi.mocked(listChatThreads);
const mockGetChatThread = vi.mocked(getChatThread);
const _mockBatchDelete = vi.mocked(batchDeleteChatThreads);

describe("AIChatPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCaptureStore.setState({
      selectedPacketIdx: null,
      selectedIndices: [],
      lastClickedIdx: null,
      filterProto: "",
    });
    mockListChatThreads.mockResolvedValue([]);
    mockCreateChatThread.mockResolvedValue({
      id: "thread-1",
      title: "New chat",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      message_count: 0,
    });
    mockStreamChatMessage.mockImplementation(async (_captureId, _threadId, _content, opts) => {
      opts.onDelta("assistant reply");
    });
    mockGetChatThread.mockResolvedValue({
      id: "thread-1",
      title: "Past chat",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
      messages: [
        { id: "m1", role: "user", content: "hello", created_at: "2026-06-21T00:00:00.000Z" },
        { id: "m2", role: "assistant", content: "hi there", created_at: "2026-06-21T00:00:01.000Z" },
      ],
    });
    _mockBatchDelete.mockResolvedValue({ deleted: 1 });
  });

  it("sends selected packet indices as chat context", async () => {
    useCaptureStore.setState({
      selectedPacketIdx: 7,
      selectedIndices: [3, 7],
      lastClickedIdx: 7,
    });
    render(<AIChatPanel captureId="cap-1" />);

    fireEvent.change(screen.getByLabelText("Ask about packets"), {
      target: { value: "What happened here?" },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    await waitFor(() => {
      expect(mockStreamChatMessage).toHaveBeenCalledWith(
        "cap-1",
        "thread-1",
        "What happened here?",
        expect.objectContaining({ packetIndices: [3, 7] }),
      );
    });
    expect(screen.getByText("assistant reply")).toBeInTheDocument();
  });

  it("surfaces backend stream errors without replacing them with a generic fallback", async () => {
    mockStreamChatMessage.mockImplementation(async (_captureId, _threadId, _content, opts) => {
      opts.onError?.("LLM is not configured on this server");
      throw new Error("aborted");
    });
    render(<AIChatPanel captureId="cap-1" />);

    fireEvent.change(screen.getByLabelText("Ask about packets"), {
      target: { value: "hi" },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    expect(
      await screen.findByText("LLM is not configured on this server"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Chat request failed.")).not.toBeInTheDocument();
  });

  it("aborts an in-flight stream when Stop is clicked", async () => {
    let signal: AbortSignal | undefined;
    mockStreamChatMessage.mockImplementation(
      async (_captureId, _threadId, _content, opts) => {
        signal = opts.signal;
        await new Promise<void>((resolve) => {
          opts.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    render(<AIChatPanel captureId="cap-1" />);

    fireEvent.change(screen.getByLabelText("Ask about packets"), {
      target: { value: "keep streaming" },
    });
    fireEvent.click(screen.getByLabelText("Send"));
    await screen.findByLabelText("Stop");
    fireEvent.click(screen.getByLabelText("Stop"));

    await waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("clears local messages and starts a new thread from New chat", async () => {
    mockCreateChatThread
      .mockResolvedValueOnce({
        id: "thread-1",
        title: "New chat",
        created_at: "2026-06-21T00:00:00.000Z",
        updated_at: "2026-06-21T00:00:00.000Z",
        message_count: 0,
      })
      .mockResolvedValueOnce({
        id: "thread-2",
        title: "New chat",
        created_at: "2026-06-21T00:00:01.000Z",
        updated_at: "2026-06-21T00:00:01.000Z",
        message_count: 0,
      });
    render(<AIChatPanel captureId="cap-1" />);

    fireEvent.change(screen.getByLabelText("Ask about packets"), {
      target: { value: "first" },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });
    await screen.findByText("assistant reply");

    fireEvent.click(screen.getByLabelText("New chat"));
    expect(screen.queryByText("first")).not.toBeInTheDocument();
    expect(screen.queryByText("assistant reply")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Ask about packets"), {
      target: { value: "second" },
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Send"));
    });

    await waitFor(() => {
      expect(mockStreamChatMessage).toHaveBeenLastCalledWith(
        "cap-1",
        "thread-2",
        "second",
        expect.any(Object),
      );
    });
  });

  it("resets chat state and aborts active streams when the capture changes", async () => {
    let signal: AbortSignal | undefined;
    mockStreamChatMessage.mockImplementation(
      async (_captureId, _threadId, _content, opts) => {
        signal = opts.signal;
        opts.onDelta("partial reply");
        await new Promise<void>((resolve) => {
          opts.signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    );
    const { rerender } = render(<AIChatPanel captureId="cap-1" />);

    fireEvent.change(screen.getByLabelText("Ask about packets"), {
      target: { value: "old capture question" },
    });
    fireEvent.click(screen.getByLabelText("Send"));
    await screen.findByText("partial reply");

    rerender(<AIChatPanel captureId="cap-2" />);

    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(screen.queryByText("old capture question")).not.toBeInTheDocument();
    expect(screen.queryByText("partial reply")).not.toBeInTheDocument();
    expect(screen.getByText(/Ask questions about/)).toBeInTheDocument();
  });

  it("loads thread list on mount", async () => {
    mockListChatThreads.mockResolvedValue([
      {
        id: "t1",
        title: "First chat",
        created_at: "2026-06-21T00:00:00.000Z",
        updated_at: "2026-06-21T00:00:00.000Z",
        message_count: 4,
      },
    ]);
    render(<AIChatPanel captureId="cap-1" />);

    await waitFor(() => {
      expect(mockListChatThreads).toHaveBeenCalledWith("cap-1");
    });
  });

  it("resumes a past session when selected from sidebar", async () => {
    mockListChatThreads.mockResolvedValue([
      {
        id: "thread-1",
        title: "Past chat",
        created_at: "2026-06-21T00:00:00.000Z",
        updated_at: "2026-06-21T00:00:00.000Z",
        message_count: 2,
      },
    ]);
    render(<AIChatPanel captureId="cap-1" />);

    await waitFor(() => {
      expect(mockListChatThreads).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByLabelText("Session history"));

    await waitFor(() => {
      expect(screen.getByText("Past chat")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Past chat"));

    await waitFor(() => {
      expect(mockGetChatThread).toHaveBeenCalledWith("cap-1", "thread-1");
    });
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.getByText("hi there")).toBeInTheDocument();
  });
});
