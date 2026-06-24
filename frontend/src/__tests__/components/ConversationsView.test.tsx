import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

const mixedProtocolConvs: ConversationStats[] = [
  {
    ...groupableConvs[0],
    id: "m1",
    app_protocol: "TLS",
    packet_count: 4,
  },
  {
    ...groupableConvs[1],
    id: "m2",
    app_protocol: "HTTP",
    packet_count: 6,
  },
];

const sortingConvs: ConversationStats[] = [
  {
    ...groupableConvs[0],
    id: "low-a",
    src_ip: "10.0.0.1",
    dst_ip: "10.0.0.2",
    packet_count: 2,
  },
  {
    ...groupableConvs[1],
    id: "low-b",
    src_ip: "10.0.0.1",
    dst_ip: "10.0.0.2",
    packet_count: 3,
  },
  {
    ...groupableConvs[0],
    id: "high-a",
    src_ip: "10.0.0.5",
    dst_ip: "10.0.0.6",
    packet_count: 20,
  },
  {
    ...groupableConvs[1],
    id: "high-b",
    src_ip: "10.0.0.5",
    dst_ip: "10.0.0.6",
    packet_count: 10,
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

  it("shows group toggle button with pressed state", () => {
    render(<ConversationsView conversations={convs} />);
    const toggle = screen.getByRole("button", { name: "Group by IP pair" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("groups by IP pair when toggled", () => {
    render(<ConversationsView conversations={groupableConvs} />);
    fireEvent.click(screen.getByRole("button", { name: "Group by IP pair" }));

    expect(screen.queryByText("10.0.0.1:443")).not.toBeInTheDocument();
    expect(screen.queryByText("10.0.0.2:54321")).not.toBeInTheDocument();
    expect(screen.queryByText("10.0.0.2:54322")).not.toBeInTheDocument();

    expect(screen.getByText("10.0.0.1")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2")).toBeInTheDocument();
    expect(screen.getByText("2 flows")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.3:53")).toBeInTheDocument();
  });

  it("expands group to show children through the accessible button", async () => {
    const user = userEvent.setup();
    render(<ConversationsView conversations={groupableConvs} />);
    await user.click(screen.getByRole("button", { name: "Group by IP pair" }));

    const expandButton = screen.getByRole("button", {
      name: "Expand conversation group 10.0.0.1 to 10.0.0.2",
    });
    expect(expandButton).toHaveAttribute("aria-expanded", "false");

    expandButton.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("button", {
        name: "Collapse conversation group 10.0.0.1 to 10.0.0.2",
      })
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("10.0.0.2:54321")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2:54322")).toBeInTheDocument();
  });

  it("keeps delimiter-like endpoint strings in distinct IP-pair groups", () => {
    const collisionConvs: ConversationStats[] = [
      {
        ...groupableConvs[0],
        id: "pipe-a",
        src_ip: "a|b",
        src_port: 1111,
        dst_ip: "c",
        dst_port: 2222,
      },
      {
        ...groupableConvs[1],
        id: "pipe-b",
        src_ip: "a",
        src_port: 3333,
        dst_ip: "b|c",
        dst_port: 4444,
      },
    ];

    render(<ConversationsView conversations={collisionConvs} />);
    fireEvent.click(screen.getByRole("button", { name: "Group by IP pair" }));

    expect(screen.queryByText("2 flows")).not.toBeInTheDocument();
    expect(screen.getByText("a|b:1111")).toBeInTheDocument();
    expect(screen.getByText("c:2222")).toBeInTheDocument();
    expect(screen.getByText("a:3333")).toBeInTheDocument();
    expect(screen.getByText("b|c:4444")).toBeInTheDocument();
  });

  it("shows mixed protocol label for grouped conversations with multiple apps", () => {
    render(<ConversationsView conversations={mixedProtocolConvs} />);
    fireEvent.click(screen.getByRole("button", { name: "Group by IP pair" }));

    expect(screen.getByText("mixed (2)")).toBeInTheDocument();
  });

  it("sorts grouped rows by aggregate packet count", () => {
    render(<ConversationsView conversations={sortingConvs} />);
    fireEvent.click(screen.getByRole("button", { name: "Group by IP pair" }));

    let rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("10.0.0.5");
    expect(rows[1]).toHaveTextContent("30");

    fireEvent.click(screen.getByText("Pkts"));
    rows = screen.getAllByRole("row");
    expect(rows[1]).toHaveTextContent("10.0.0.1");
    expect(rows[1]).toHaveTextContent("5");
  });

  it("action callbacks receive expanded child rows, not aggregate group rows", async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const onFollow = vi.fn();
    render(
      <ConversationsView
        conversations={groupableConvs}
        onViewSession={onView}
        onFollowConversation={onFollow}
      />
    );
    await user.click(screen.getByRole("button", { name: "Group by IP pair" }));

    expect(screen.getAllByText("Session")).toHaveLength(1);
    expect(screen.getAllByText("Follow")).toHaveLength(1);

    await user.click(
      screen.getByRole("button", {
        name: "Expand conversation group 10.0.0.1 to 10.0.0.2",
      })
    );

    const childDestination = screen.getByText("10.0.0.2:54321");
    const childRow = childDestination.closest("tr")!;
    await user.click(within(childRow).getByText("Session"));
    await user.click(within(childRow).getByText("Follow"));

    expect(onView).toHaveBeenCalledWith(groupableConvs[0]);
    expect(onFollow).toHaveBeenCalledWith(groupableConvs[0]);
  });

  it("ungrouping restores original view", () => {
    render(<ConversationsView conversations={groupableConvs} />);

    fireEvent.click(screen.getByRole("button", { name: "Group by IP pair" }));
    expect(screen.queryByText("10.0.0.1:443")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Group by IP pair" }));
    expect(screen.getAllByText("10.0.0.1:443")).toHaveLength(2);
    expect(screen.getByText("10.0.0.2:54321")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2:54322")).toBeInTheDocument();
  });
});
