import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConversationsView } from "@/components/stats/ConversationsView";
import type { ConversationStats } from "@/api/client";

const convs: ConversationStats[] = [
  {
    id: "c1",
    proto: "tcp",
    src_ip: "10.0.0.1",
    src_port: 443,
    dst_ip: "10.0.0.2",
    dst_port: 54321,
    packet_count: 10,
    byte_count: 5000,
    start_ts: 0,
    end_ts: 1,
    app_protocol: "TLS",
    flags_summary: "SYN,ACK",
  },
  {
    id: "c2",
    proto: "udp",
    src_ip: "10.0.0.3",
    src_port: 53,
    dst_ip: "10.0.0.4",
    dst_port: 50164,
    packet_count: 2,
    byte_count: 200,
    start_ts: 0.5,
    end_ts: 0.6,
    app_protocol: "DNS",
    flags_summary: null,
  },
];

describe("ConversationsView", () => {
  it("renders conversation table", () => {
    render(<ConversationsView conversations={convs} />);
    expect(screen.getByText("10.0.0.1:443")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2:54321")).toBeInTheDocument();
  });

  it("shows protocol badges", () => {
    render(<ConversationsView conversations={convs} />);
    expect(screen.getByText("TLS")).toBeInTheDocument();
    expect(screen.getByText("DNS")).toBeInTheDocument();
  });

  it("filters conversations", () => {
    render(<ConversationsView conversations={convs} />);
    const input = screen.getByPlaceholderText("Filter conversations");
    fireEvent.change(input, { target: { value: "10.0.0.3" } });
    expect(screen.queryByText("10.0.0.1:443")).not.toBeInTheDocument();
    expect(screen.getByText("10.0.0.3:53")).toBeInTheDocument();
  });

  it("calls onViewSession when Session button clicked", () => {
    const onView = vi.fn();
    render(
      <ConversationsView conversations={convs} onViewSession={onView} />
    );
    const buttons = screen.getAllByText("Session");
    fireEvent.click(buttons[0]);
    expect(onView).toHaveBeenCalledWith(convs[0]);
  });

  it("calls onFollowConversation when Follow button clicked", () => {
    const onFollow = vi.fn();
    render(
      <ConversationsView
        conversations={convs}
        onFollowConversation={onFollow}
      />
    );
    const buttons = screen.getAllByText("Follow");
    fireEvent.click(buttons[0]);
    expect(onFollow).toHaveBeenCalledWith(convs[0]);
  });

  it("shows empty state", () => {
    render(<ConversationsView conversations={[]} />);
    expect(screen.getByText("No conversations")).toBeInTheDocument();
  });

  it("shows both source and destination endpoints", () => {
    render(<ConversationsView conversations={convs} />);
    expect(screen.getByText("10.0.0.3:53")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.4:50164")).toBeInTheDocument();
  });

  it("shows flags summary when present", () => {
    render(<ConversationsView conversations={convs} />);
    expect(screen.getByText("SYN,ACK")).toBeInTheDocument();
  });
});
