import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionSequenceDiagram } from "@/components/SessionSequenceDiagram";
import { createMockPacketSummary } from "../test-setup";
import type { GeoInfo } from "@/api/client";

const geo: GeoInfo = {
  country: "LAN",
  country_code: "LAN",
  country_flag: "",
};

const fallbackGeo: GeoInfo = {
  country: "Unknown",
  country_code: "XX",
  country_flag: "🏳",
};

const packets = [
  createMockPacketSummary({
    idx: 0,
    ts: 1.0,
    src: "10.0.0.1",
    dst: "10.0.0.2",
    length: 66,
    info: "443 > 54321 [SYN]",
  }),
  createMockPacketSummary({
    idx: 1,
    ts: 1.05,
    src: "10.0.0.2",
    dst: "10.0.0.1",
    length: 66,
    info: "54321 > 443 [SYN ACK]",
  }),
  createMockPacketSummary({
    idx: 2,
    ts: 1.051,
    src: "10.0.0.1",
    dst: "10.0.0.2",
    length: 54,
    info: "443 > 54321 [ACK]",
  }),
];

describe("SessionSequenceDiagram", () => {
  it("renders the virtual list container", () => {
    render(
      <SessionSequenceDiagram
        packets={packets}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={geo}
        dstGeo={geo}
        proto="tcp"
        appProtocol="TLS"
      />
    );
    // The column header "#" is rendered (for packet index column)
    expect(screen.getByText("#")).toBeInTheDocument();
    // Stats show total packets count in header
    expect(screen.getByText(/Total Packets/)).toBeInTheDocument();
  });

  it("shows summary stats with duration", () => {
    render(
      <SessionSequenceDiagram
        packets={packets}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={geo}
        dstGeo={geo}
        proto="tcp"
        appProtocol={null}
      />
    );
    // Duration: (1.051 - 1.0) * 1000 = 51 ms
    expect(screen.getByText(/51 ms/)).toBeInTheDocument();
  });

  it("shows empty state when no packets", () => {
    render(
      <SessionSequenceDiagram
        packets={[]}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={geo}
        dstGeo={geo}
        proto="tcp"
        appProtocol={null}
      />
    );
    expect(
      screen.getByText("No packets found for this session")
    ).toBeInTheDocument();
  });

  it("shows column headers for the packet list", () => {
    render(
      <SessionSequenceDiagram
        packets={packets}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={geo}
        dstGeo={geo}
        proto="tcp"
        appProtocol={null}
      />
    );
    expect(screen.getByText("Time")).toBeInTheDocument();
    expect(screen.getByText("Direction")).toBeInTheDocument();
    expect(screen.getByText("Size")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("shows protocol badge with appProtocol when provided", () => {
    render(
      <SessionSequenceDiagram
        packets={packets}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={geo}
        dstGeo={geo}
        proto="tcp"
        appProtocol="TLS"
      />
    );
    expect(screen.getByText("TLS")).toBeInTheDocument();
  });

  it("shows uppercased proto when no appProtocol", () => {
    render(
      <SessionSequenceDiagram
        packets={packets}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={geo}
        dstGeo={geo}
        proto="tcp"
        appProtocol={null}
      />
    );
    expect(screen.getByText("TCP")).toBeInTheDocument();
  });

  it("shows endpoint addresses in header", () => {
    render(
      <SessionSequenceDiagram
        packets={packets}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={geo}
        dstGeo={geo}
        proto="tcp"
        appProtocol={null}
      />
    );
    expect(screen.getByText("10.0.0.1:443")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.2:54321")).toBeInTheDocument();
  });

  it("shows footer legend with forward and reverse labels", () => {
    render(
      <SessionSequenceDiagram
        packets={packets}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={geo}
        dstGeo={geo}
        proto="tcp"
        appProtocol={null}
      />
    );
    expect(screen.getByText(/Forward/)).toBeInTheDocument();
    expect(screen.getByText(/Reverse/)).toBeInTheDocument();
  });

  it("renders backend flag fallback when no SVG codepoint is available", () => {
    render(
      <SessionSequenceDiagram
        packets={packets}
        srcIp="10.0.0.1"
        srcPort={443}
        dstIp="10.0.0.2"
        dstPort={54321}
        srcGeo={fallbackGeo}
        dstGeo={{ ...fallbackGeo, country_flag: "🏴" }}
        proto="tcp"
        appProtocol={null}
      />
    );
    expect(screen.getByText("🏳")).toBeInTheDocument();
    expect(screen.getByText("🏴")).toBeInTheDocument();
  });
});
