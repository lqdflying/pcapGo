import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const buildCommandMock = vi.fn().mockReturnValue("tcpdump -i any");
vi.mock("@/lib/captureCommandBuilder", () => ({
  DEFAULT_TCPDUMP_PARAMS: {
    iface: "any",
    protocol: "",
    hostFilter: "",
    hostDirection: "host",
    port: "",
    portDirection: "port",
    net: "",
    netDirection: "net",
    count: "",
    snapLen: "",
    writeFile: "",
    readFile: "",
    verbose: "",
    noDns: "",
    showAscii: false,
    hexMode: "",
    timestamp: "",
    bufferSize: "",
    lineBuffered: false,
    customBpf: "",
  },
  DEFAULT_PKTMON_PARAMS: {
    compId: "",
    transport: "",
    ipAddress: "",
    port: "",
    packetType: "",
    fileName: "",
    fileSize: "",
    logMode: "",
    packetSize: "",
    countersOnly: false,
    dropReasons: false,
    convertToPcapng: true,
  },
  buildCommand: (...args: any[]) => buildCommandMock(...args),
}));

import { CaptureCommandBuilder } from "@/components/CaptureCommandBuilder";

describe("CaptureCommandBuilder", () => {
  const mockOnCommandChange = vi.fn();

  beforeEach(() => {
    mockOnCommandChange.mockReset();
    buildCommandMock.mockClear();
    buildCommandMock.mockReturnValue("tcpdump -i any");
  });

  it("renders platform selector with tcpdump and pktmon options", () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    const select = screen.getByLabelText("Platform");
    expect(select).toBeInTheDocument();

    const options = select.querySelectorAll("option");
    const values = Array.from(options).map((o) => o.textContent);
    expect(values).toContain("tcpdump (Linux/macOS)");
    expect(values).toContain("pktmon (Windows)");
  });

  it("defaults to tcpdump and shows interface input field", () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    const platformSelect = screen.getByLabelText("Platform") as HTMLSelectElement;
    expect(platformSelect.value).toBe("tcpdump");

    expect(screen.getByLabelText("Interface")).toBeInTheDocument();
  });

  it("changing interface input calls onCommandChange via buildCommand", async () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    // Clear the initial render calls
    mockOnCommandChange.mockClear();
    buildCommandMock.mockClear();
    buildCommandMock.mockReturnValue("tcpdump -i eth0");

    const ifaceInput = screen.getByLabelText("Interface");
    fireEvent.change(ifaceInput, { target: { value: "eth0" } });

    await waitFor(() => {
      expect(buildCommandMock).toHaveBeenCalled();
      expect(mockOnCommandChange).toHaveBeenCalledWith("tcpdump -i eth0");
    });
  });

  it("has protocol dropdown in tcpdump mode", () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    const protocolSelect = screen.getByLabelText("Protocol filter");
    expect(protocolSelect).toBeInTheDocument();

    const options = protocolSelect.querySelectorAll("option");
    const labels = Array.from(options).map((o) => o.textContent);
    expect(labels).toContain("Any");
    expect(labels).toContain("TCP");
    expect(labels).toContain("UDP");
  });

  it("has host filter input in tcpdump mode", () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    expect(screen.getByLabelText("Host filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Host direction")).toBeInTheDocument();
  });

  it("has port filter input in tcpdump mode", () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    expect(screen.getByLabelText("Port filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Port direction")).toBeInTheDocument();
  });

  it("has custom BPF textarea in tcpdump mode", () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    const textarea = screen.getByLabelText("Custom BPF");
    expect(textarea).toBeInTheDocument();
    expect(textarea.tagName.toLowerCase()).toBe("textarea");
  });

  it("switching platform to pktmon shows pktmon fields", () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    const platformSelect = screen.getByLabelText("Platform");
    fireEvent.change(platformSelect, { target: { value: "pktmon" } });

    expect(screen.getByLabelText("IP address filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Port filter")).toBeInTheDocument();
    expect(screen.getByLabelText("Transport protocol")).toBeInTheDocument();

    // tcpdump-specific fields should be gone
    expect(screen.queryByLabelText("Interface")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Custom BPF")).not.toBeInTheDocument();
  });

  it("switching back to tcpdump shows tcpdump fields again", () => {
    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    const platformSelect = screen.getByLabelText("Platform");

    // Switch to pktmon
    fireEvent.change(platformSelect, { target: { value: "pktmon" } });
    expect(screen.queryByLabelText("Interface")).not.toBeInTheDocument();

    // Switch back to tcpdump
    fireEvent.change(platformSelect, { target: { value: "tcpdump" } });
    expect(screen.getByLabelText("Interface")).toBeInTheDocument();
    expect(screen.getByLabelText("Custom BPF")).toBeInTheDocument();
    expect(screen.getByLabelText("Protocol filter")).toBeInTheDocument();
  });

  it("onCommandChange is called with buildCommand result on initial render", async () => {
    buildCommandMock.mockReturnValue("tcpdump -i any");

    render(<CaptureCommandBuilder onCommandChange={mockOnCommandChange} />);

    await waitFor(() => {
      expect(buildCommandMock).toHaveBeenCalledWith("tcpdump", expect.any(Object));
      expect(mockOnCommandChange).toHaveBeenCalledWith("tcpdump -i any");
    });
  });
});
