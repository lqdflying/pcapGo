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

const groupableConvs: ConversationStats[] = [
  {
    id: "g1",
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
    id: "g2",
    proto: "tcp",
    src_ip: "10.0.0.1",
    src_port: 443,
    dst_ip: "10.0.0.2",
    dst_port: 54322,
    packet_count: 8,
    byte_count: 3000,
    start_ts: 0.5,
    end_ts: 2,
    app_protocol: "TLS",
    flags_summary: "SYN,ACK,FIN",
  },
  {
    id: "g3",
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

  it("shows group toggle button", () => {
    render(<ConversationsView conversations={convs} />);
    expect(screen.getByText("Group by IP pair")).toBeInTheDocument();
  });

  it("groups by IP pair when toggled", () => {
    render(<ConversationsView conversations={groupableConvs} />);
    fireEvent.click(screen.getByText("Group by IP pair"));

    // Individual port-level rows for the grouped pair should not be visible
    expect(screen.queryByText("10.0.0.1:443")).not.toBeInTheDocument();
    expect(screen.queryByText("10.0.0.2:54321")).not.toBeInTheDocument();
    expect(screen.queryByText("10.0.0.2:54322")).not.toBeInTheDocument();

    // Group header shows IP only
    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2")).toBeInTheDocument();

    // Flow count badge
    expect(screen.getByText("2 flows")).toBeInTheDocument();

    // Singleton (10.0.0.3→10.0.0.4) still renders as flat row with port
    expect(screen.getByText("10.0.0.3:53")).toBeInTheDocument();
  });

  it("expands group to show children", () => {
    render(<ConversationsView conversations={groupableConvs} />);
    fireEvent.click(screen.getByText("Group by IP pair"));

    // Click the group row to expand
    const groupRow = screen.getByText("10.0.0.1").closest("tr")!;
    fireEvent.click(groupRow);

    // Children should now be visible with full ip:port
    expect(screen.getByText("10.0.0.2:54321")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2:54322")).toBeInTheDocument();
  });

  it("action buttons appear on child rows, not group rows", () => {
    const onView = vi.fn();
    render(
      <ConversationsView conversations={groupableConvs} onViewSession={onView} />
    );
    fireEvent.click(screen.getByText("Group by IP pair"));

    // Group row should not have Session buttons (only the singleton has one)
    const sessionButtons = screen.getAllByText("Session");
    expect(sessionButtons).toHaveLength(1); // only the singleton

    // Expand the group
    const groupRow = screen.getByText("10.0.0.1").closest("tr")!;
    fireEvent.click(groupRow);

    // Now child rows should also have Session buttons
    const sessionButtonsAfter = screen.getAllByText("Session");
    expect(sessionButtonsAfter.length).toBeGreaterThan(1);
  });

  it("ungrouping restores original view", () => {
    render(<ConversationsView conversations={groupableConvs} />);

    // Toggle on
    fireEvent.click(screen.getByText("Group by IP pair"));
    expect(screen.queryByText("10.0.0.1:443")).not.toBeInTheDocument();

    // Toggle off
    fireEvent.click(screen.getByText("Group by IP pair"));
    expect(screen.getAllByText("10.0.0.1:443")).toHaveLength(2);
    expect(screen.getByText("10.0.0.2:54321")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2:54322")).toBeInTheDocument();
  });
});
