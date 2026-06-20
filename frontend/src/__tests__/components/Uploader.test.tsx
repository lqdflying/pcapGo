import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Uploader } from "@/components/Uploader";

describe("Uploader", () => {
  const mockOnUpload = vi.fn();

  beforeEach(() => {
    mockOnUpload.mockReset();
  });

  it("renders the upload component", () => {
    const { container } = render(<Uploader onUpload={mockOnUpload} uploading={false} />);
    // The Upload icon is used (lucide-react)
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("renders uploading state", () => {
    render(<Uploader onUpload={mockOnUpload} uploading={true} />);
    expect(screen.getByText(/uploading and parsing/i)).toBeInTheDocument();
  });

  it("shows max file size note", () => {
    render(<Uploader onUpload={mockOnUpload} uploading={false} />);
    expect(screen.getByText(/100 MB/i)).toBeInTheDocument();
  });

  it("calls onUpload when valid .pcap file is dropped", () => {
    const { container } = render(<Uploader onUpload={mockOnUpload} uploading={false} />);
    // Find the div with onDrop handler; it's the outermost clickable div
    const dropZone = container.querySelector("div")!;

    const file = new File([new ArrayBuffer(100)], "test.pcap", {
      type: "application/octet-stream",
    });
    const dataTransfer = { files: [file], items: [], types: [] };

    fireEvent.drop(dropZone, { dataTransfer });
    expect(mockOnUpload).toHaveBeenCalledWith(file);
  });

  it("does NOT call onUpload for invalid extension", () => {
    const { container } = render(<Uploader onUpload={mockOnUpload} uploading={false} />);
    const dropZone = container.querySelector("div")!;

    const file = new File([new ArrayBuffer(100)], "test.txt", {
      type: "text/plain",
    });
    const dataTransfer = { files: [file], items: [], types: [] };

    fireEvent.drop(dropZone, { dataTransfer });
    expect(mockOnUpload).not.toHaveBeenCalled();
  });
});
