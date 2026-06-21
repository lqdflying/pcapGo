import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { CaptureCommandAIGenerator } from "@/components/CaptureCommandAIGenerator";

const streamCaptureCommandGenerate = vi.fn();
vi.mock("@/api/client", () => ({
  streamCaptureCommandGenerate: (...args: any[]) => streamCaptureCommandGenerate(...args),
}));

describe("CaptureCommandAIGenerator", () => {
  const onCommandChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders platform selector, prompt textarea, and Generate button", () => {
    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    expect(screen.getByLabelText("Platform")).toBeInTheDocument();
    expect(screen.getByLabelText("Describe capture")).toBeInTheDocument();
    expect(screen.getByLabelText("Generate")).toBeInTheDocument();
  });

  it("Generate button is disabled when textarea is empty", () => {
    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    const btn = screen.getByLabelText("Generate");
    expect(btn).toBeDisabled();
  });

  it("clicking Generate calls API with prompt text and default platform (tcpdump)", async () => {
    streamCaptureCommandGenerate.mockImplementation(async (_prompt: string, opts: any) => {
      opts.onDelta("```\ntcpdump -i eth0\n```");
    });

    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    const textarea = screen.getByLabelText("Describe capture");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Capture HTTP traffic" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Generate"));
    });

    expect(streamCaptureCommandGenerate).toHaveBeenCalledWith(
      "Capture HTTP traffic",
      expect.objectContaining({
        platform: "tcpdump",
        onDelta: expect.any(Function),
      }),
    );
  });

  it("selecting pktmon platform is reflected in the dropdown value", async () => {
    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    const select = screen.getByLabelText("Platform") as HTMLSelectElement;
    expect(select.value).toBe("tcpdump");

    await act(async () => {
      fireEvent.change(select, { target: { value: "pktmon" } });
    });

    expect(select.value).toBe("pktmon");
  });

  it("streaming response renders in result area", async () => {
    streamCaptureCommandGenerate.mockImplementation(async (_prompt: string, opts: any) => {
      opts.onDelta("```\ntcpdump -i eth0\n```");
    });

    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    const textarea = screen.getByLabelText("Describe capture");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Capture DNS" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Generate"));
    });

    expect(screen.getByText(/tcpdump -i eth0/)).toBeInTheDocument();
  });

  it("Stop button appears during streaming and aborts when clicked", async () => {
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");

    streamCaptureCommandGenerate.mockImplementation(
      (_prompt: string, opts: any) =>
        new Promise<void>((resolve) => {
          opts.onDelta("partial output");
          opts.signal?.addEventListener("abort", () => resolve());
        }),
    );

    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    const textarea = screen.getByLabelText("Describe capture");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Capture all" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Generate"));
    });

    const stopBtn = await screen.findByLabelText("Stop");
    await act(async () => {
      fireEvent.click(stopBtn);
    });

    expect(abortSpy).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Generate")).toBeInTheDocument());
    expect(screen.getByText("partial output")).toBeInTheDocument();

    abortSpy.mockRestore();
  });

  it("after streaming, extracted command is passed to onCommandChange", async () => {
    streamCaptureCommandGenerate.mockImplementation(async (_prompt: string, opts: any) => {
      opts.onDelta("```\ntcpdump -i eth0\n```");
    });

    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    const textarea = screen.getByLabelText("Describe capture");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Capture traffic" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Generate"));
    });

    await waitFor(() => {
      expect(onCommandChange).toHaveBeenCalledWith("tcpdump -i eth0");
    });
  });

  it("error state displays error message", async () => {
    streamCaptureCommandGenerate.mockImplementation(async (_prompt: string, opts: any) => {
      opts.onError("Something went wrong");
    });

    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    const textarea = screen.getByLabelText("Describe capture");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Capture packets" } });
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Generate"));
    });

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("'Use capture context' toggle is NOT visible when captureId is not provided", () => {
    render(<CaptureCommandAIGenerator onCommandChange={onCommandChange} />);

    expect(screen.queryByText("Use capture context")).not.toBeInTheDocument();
  });

  it("'Use capture context' toggle IS visible when captureId is provided", () => {
    render(<CaptureCommandAIGenerator captureId="cap-1" onCommandChange={onCommandChange} />);

    expect(screen.getByText("Use capture context")).toBeInTheDocument();
  });
});
