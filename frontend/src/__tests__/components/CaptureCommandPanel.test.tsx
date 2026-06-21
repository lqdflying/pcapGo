import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { CaptureCommandPanel } from "@/components/CaptureCommandPanel";

vi.mock("@/components/CaptureCommandBuilder", () => ({
  CaptureCommandBuilder: ({
    onCommandChange,
  }: {
    onCommandChange: (cmd: string) => void;
  }) => (
    <div data-testid="builder">
      <button onClick={() => onCommandChange("tcpdump -i eth0")}>
        set-cmd
      </button>
    </div>
  ),
}));

vi.mock("@/components/CaptureCommandAIGenerator", () => ({
  CaptureCommandAIGenerator: ({
    onCommandChange,
  }: {
    onCommandChange: (cmd: string) => void;
  }) => (
    <div data-testid="ai-gen">
      <button onClick={() => onCommandChange("tcpdump -i any 'port 443'")}>
        set-ai-cmd
      </button>
    </div>
  ),
}));

describe("CaptureCommandPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("renders mode toggle with Builder and AI Generate tabs", () => {
    render(<CaptureCommandPanel />);
    expect(screen.getByText("Builder")).toBeInTheDocument();
    expect(screen.getByText("AI Generate")).toBeInTheDocument();
  });

  it("defaults to Builder mode — shows builder component", () => {
    render(<CaptureCommandPanel />);
    expect(screen.getByTestId("builder")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-gen")).not.toBeInTheDocument();
  });

  it("clicking AI Generate tab switches to AI generator", () => {
    render(<CaptureCommandPanel />);
    fireEvent.click(screen.getByText("AI Generate"));
    expect(screen.getByTestId("ai-gen")).toBeInTheDocument();
    expect(screen.queryByTestId("builder")).not.toBeInTheDocument();
  });

  it("switching back to Builder shows builder again", () => {
    render(<CaptureCommandPanel />);
    fireEvent.click(screen.getByText("AI Generate"));
    expect(screen.getByTestId("ai-gen")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Builder"));
    expect(screen.getByTestId("builder")).toBeInTheDocument();
    expect(screen.queryByTestId("ai-gen")).not.toBeInTheDocument();
  });

  it("command preview area not shown when command is empty", () => {
    render(<CaptureCommandPanel />);
    expect(screen.queryByText("Generated Command")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy")).not.toBeInTheDocument();
  });

  it("when builder sets a command, the command preview area appears with the command text", () => {
    render(<CaptureCommandPanel />);
    fireEvent.click(screen.getByText("set-cmd"));

    expect(screen.getByText("Generated Command")).toBeInTheDocument();
    expect(screen.getByText("tcpdump -i eth0")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("copy button copies command to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<CaptureCommandPanel />);
    fireEvent.click(screen.getByText("set-cmd"));

    await act(async () => {
      fireEvent.click(screen.getByText("Copy"));
    });

    expect(writeText).toHaveBeenCalledWith("tcpdump -i eth0");
  });

  it("copy button shows Copied! feedback temporarily", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    render(<CaptureCommandPanel />);
    fireEvent.click(screen.getByText("set-cmd"));

    await act(async () => {
      fireEvent.click(screen.getByText("Copy"));
    });

    expect(screen.getByText("Copied!")).toBeInTheDocument();
    expect(screen.queryByText("Copy")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.queryByText("Copied!")).not.toBeInTheDocument();

    vi.useRealTimers();
  });
});
