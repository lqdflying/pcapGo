import { describe, it, expect, vi, beforeEach } from "vitest";
import { useEffect } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { CaptureCommandPanel } from "@/components/CaptureCommandPanel";

// The real CaptureCommandBuilder emits its command on mount via useEffect
// (default tcpdump params → "tcpdump -i any"). The mock mirrors that so the
// panel tests exercise the realistic mount-emit + tab-switch lifecycle.
vi.mock("@/components/CaptureCommandBuilder", () => ({
  CaptureCommandBuilder: ({
    onCommandChange,
  }: {
    onCommandChange: (cmd: string) => void;
  }) => {
    useEffect(() => {
      onCommandChange("tcpdump -i any");
    }, [onCommandChange]);
    return (
      <div data-testid="builder">
        <button onClick={() => onCommandChange("tcpdump -i eth0")}>
          set-cmd
        </button>
      </div>
    );
  },
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
    // Builder emits on mount, so switch to AI mode (which clears the shared
    // command) to reach the empty-command state.
    fireEvent.click(screen.getByText("AI Generate"));
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

  // ── Stale-command regression (Finding 1) ──────────────────────────────────

  it("switching from Builder to AI clears the stale builder command and hides Copy", () => {
    render(<CaptureCommandPanel />);
    // Builder emits "tcpdump -i any" on mount → preview + Copy appear.
    expect(screen.getByText("Generated Command")).toBeInTheDocument();
    expect(screen.getByText("tcpdump -i any")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();

    // Switch to AI tab: the shared command must be cleared so the stale
    // builder command can't be copied, and the preview/Copy button must hide
    // until the AI generator produces a new command.
    fireEvent.click(screen.getByText("AI Generate"));
    expect(screen.queryByText("Generated Command")).not.toBeInTheDocument();
    expect(screen.queryByText("tcpdump -i any")).not.toBeInTheDocument();
    expect(screen.queryByText("Copy")).not.toBeInTheDocument();
  });

  it("clicking the active Builder tab preserves the current builder command", () => {
    render(<CaptureCommandPanel />);
    fireEvent.click(screen.getByText("set-cmd"));
    expect(screen.getByText("tcpdump -i eth0")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Builder"));

    expect(screen.getByText("Generated Command")).toBeInTheDocument();
    expect(screen.getByText("tcpdump -i eth0")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("clicking the active AI tab preserves the current AI command", () => {
    render(<CaptureCommandPanel />);
    fireEvent.click(screen.getByText("AI Generate"));
    fireEvent.click(screen.getByText("set-ai-cmd"));
    expect(screen.getByText("tcpdump -i any 'port 443'")).toBeInTheDocument();

    fireEvent.click(screen.getByText("AI Generate"));

    expect(screen.getByText("Generated Command")).toBeInTheDocument();
    expect(screen.getByText("tcpdump -i any 'port 443'")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("switching from AI back to Builder re-emits the builder command", () => {
    render(<CaptureCommandPanel />);
    // Move to AI (clears command), then back to Builder (re-mounts and emits).
    fireEvent.click(screen.getByText("AI Generate"));
    expect(screen.queryByText("Generated Command")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Builder"));
    expect(screen.getByText("Generated Command")).toBeInTheDocument();
    expect(screen.getByText("tcpdump -i any")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });

  it("after AI sets a command, switching to Builder clears it then Builder re-emits", () => {
    render(<CaptureCommandPanel />);
    fireEvent.click(screen.getByText("AI Generate"));
    // AI mock produces a command via the set-ai-cmd button.
    fireEvent.click(screen.getByText("set-ai-cmd"));
    expect(screen.getByText("tcpdump -i any 'port 443'")).toBeInTheDocument();

    // Switch to Builder: stale AI command must be cleared first.
    fireEvent.click(screen.getByText("Builder"));
    expect(screen.queryByText("tcpdump -i any 'port 443'")).not.toBeInTheDocument();
    // Builder re-emits its own command on mount.
    expect(screen.getByText("tcpdump -i any")).toBeInTheDocument();
  });
});
