import { describe, it, expect } from "vitest";
import {
  buildTcpdumpCommand,
  buildPktmonCommand,
  buildCommand,
  DEFAULT_TCPDUMP_PARAMS,
  DEFAULT_PKTMON_PARAMS,
  type TcpdumpParams,
  type PktmonParams,
} from "@/lib/captureCommandBuilder";

// ── Helpers ─────────────────────────────────────────────────────────────────

function tcpdump(overrides: Partial<TcpdumpParams> = {}): string {
  return buildTcpdumpCommand({ ...DEFAULT_TCPDUMP_PARAMS, ...overrides });
}

function pktmon(overrides: Partial<PktmonParams> = {}): string {
  return buildPktmonCommand({ ...DEFAULT_PKTMON_PARAMS, ...overrides });
}

// ── buildTcpdumpCommand ────────────────────────────────────────────────────

describe("buildTcpdumpCommand", () => {
  // -- basic invocation --

  it("default params produce 'tcpdump -i any'", () => {
    expect(tcpdump()).toBe("tcpdump -i any");
  });

  it("interface eth0 produces 'tcpdump -i eth0'", () => {
    expect(tcpdump({ iface: "eth0" })).toBe("tcpdump -i eth0");
  });

  // -- BPF filter: protocol --

  it("protocol tcp appears in the BPF filter", () => {
    const cmd = tcpdump({ protocol: "tcp" });
    expect(cmd).toBe("tcpdump -i any 'tcp'");
  });

  // -- BPF filter: host --

  it("host filter with src direction produces 'src host 192.168.1.1'", () => {
    const cmd = tcpdump({
      hostFilter: "192.168.1.1",
      hostDirection: "src host",
    });
    expect(cmd).toBe("tcpdump -i any 'src host 192.168.1.1'");
  });

  it("host filter with default direction produces 'host <ip>'", () => {
    const cmd = tcpdump({ hostFilter: "10.0.0.1" });
    expect(cmd).toBe("tcpdump -i any 'host 10.0.0.1'");
  });

  it("empty host filter value is ignored", () => {
    expect(tcpdump({ hostFilter: "" })).toBe("tcpdump -i any");
  });

  it("whitespace-only host filter is ignored", () => {
    expect(tcpdump({ hostFilter: "   " })).toBe("tcpdump -i any");
  });

  // -- BPF filter: port --

  it("port filter produces 'port 443'", () => {
    const cmd = tcpdump({ port: "443" });
    expect(cmd).toBe("tcpdump -i any 'port 443'");
  });

  it("port filter with dst direction produces 'dst port 80'", () => {
    const cmd = tcpdump({ port: "80", portDirection: "dst port" });
    expect(cmd).toBe("tcpdump -i any 'dst port 80'");
  });

  it("empty port value is ignored", () => {
    expect(tcpdump({ port: "" })).toBe("tcpdump -i any");
  });

  // -- BPF filter: net --

  it("net filter with dst direction produces 'dst net 10.0.0.0/8'", () => {
    const cmd = tcpdump({ net: "10.0.0.0/8", netDirection: "dst net" });
    expect(cmd).toBe("tcpdump -i any 'dst net 10.0.0.0/8'");
  });

  it("empty net value is ignored", () => {
    expect(tcpdump({ net: "" })).toBe("tcpdump -i any");
  });

  // -- combined BPF filters --

  it("multiple filters are joined with 'and'", () => {
    const cmd = tcpdump({
      protocol: "tcp",
      hostFilter: "192.168.1.1",
      hostDirection: "src host",
      port: "443",
    });
    expect(cmd).toBe(
      "tcpdump -i any 'tcp and src host 192.168.1.1 and port 443'",
    );
  });

  it("all four filter parts combine with 'and'", () => {
    const cmd = tcpdump({
      protocol: "udp",
      hostFilter: "10.0.0.1",
      port: "53",
      net: "10.0.0.0/24",
    });
    expect(cmd).toBe(
      "tcpdump -i any 'udp and host 10.0.0.1 and port 53 and net 10.0.0.0/24'",
    );
  });

  // -- custom BPF --

  it("custom BPF is appended to the filter", () => {
    const cmd = tcpdump({
      protocol: "tcp",
      customBpf: "len > 100",
    });
    expect(cmd).toBe("tcpdump -i any 'tcp and len > 100'");
  });

  it("custom BPF alone appears as the sole filter", () => {
    const cmd = tcpdump({ customBpf: "ether host aa:bb:cc:dd:ee:ff" });
    expect(cmd).toBe("tcpdump -i any 'ether host aa:bb:cc:dd:ee:ff'");
  });

  it("empty custom BPF is ignored", () => {
    expect(tcpdump({ customBpf: "" })).toBe("tcpdump -i any");
  });

  it("whitespace-only custom BPF is ignored", () => {
    expect(tcpdump({ customBpf: "   " })).toBe("tcpdump -i any");
  });

  // -- flags: count --

  it("count flag produces -c 100", () => {
    const cmd = tcpdump({ count: "100" });
    expect(cmd).toBe("tcpdump -i any -c 100");
  });

  // -- flags: snapshot length --

  it("snapshot length produces -s 1500", () => {
    const cmd = tcpdump({ snapLen: "1500" });
    expect(cmd).toBe("tcpdump -i any -s 1500");
  });

  // -- flags: write file --

  it("write file produces -w capture.pcap", () => {
    const cmd = tcpdump({ writeFile: "capture.pcap" });
    expect(cmd).toBe("tcpdump -i any -w capture.pcap");
  });

  // -- flags: read file --

  it("read file produces -r input.pcap and omits -i", () => {
    const cmd = tcpdump({ readFile: "input.pcap" });
    expect(cmd).toBe("tcpdump -r input.pcap");
    expect(cmd).not.toContain("-i");
  });

  it("read file with other flags and filters", () => {
    const cmd = tcpdump({
      readFile: "dump.pcap",
      protocol: "tcp",
      count: "50",
    });
    expect(cmd).toBe("tcpdump -r dump.pcap -c 50 'tcp'");
    expect(cmd).not.toContain("-i");
  });

  // -- flags: verbose --

  it("verbose -v", () => {
    expect(tcpdump({ verbose: "-v" })).toBe("tcpdump -i any -v");
  });

  it("verbose -vv", () => {
    expect(tcpdump({ verbose: "-vv" })).toBe("tcpdump -i any -vv");
  });

  it("verbose -vvv", () => {
    expect(tcpdump({ verbose: "-vvv" })).toBe("tcpdump -i any -vvv");
  });

  // -- flags: no DNS --

  it("noDns -n", () => {
    expect(tcpdump({ noDns: "-n" })).toBe("tcpdump -i any -n");
  });

  it("noDns -nn", () => {
    expect(tcpdump({ noDns: "-nn" })).toBe("tcpdump -i any -nn");
  });

  // -- flags: ASCII --

  it("showAscii true adds -A", () => {
    expect(tcpdump({ showAscii: true })).toBe("tcpdump -i any -A");
  });

  it("showAscii false omits -A", () => {
    expect(tcpdump({ showAscii: false })).toBe("tcpdump -i any");
  });

  // -- flags: hex mode --

  it("hexMode -X", () => {
    expect(tcpdump({ hexMode: "-X" })).toBe("tcpdump -i any -X");
  });

  it("hexMode -XX", () => {
    expect(tcpdump({ hexMode: "-XX" })).toBe("tcpdump -i any -XX");
  });

  // -- flags: timestamp --

  it("timestamp -t", () => {
    expect(tcpdump({ timestamp: "-t" })).toBe("tcpdump -i any -t");
  });

  it("timestamp -tt", () => {
    expect(tcpdump({ timestamp: "-tt" })).toBe("tcpdump -i any -tt");
  });

  it("timestamp -ttt", () => {
    expect(tcpdump({ timestamp: "-ttt" })).toBe("tcpdump -i any -ttt");
  });

  it("timestamp -tttt", () => {
    expect(tcpdump({ timestamp: "-tttt" })).toBe("tcpdump -i any -tttt");
  });

  it("timestamp -ttttt", () => {
    expect(tcpdump({ timestamp: "-ttttt" })).toBe("tcpdump -i any -ttttt");
  });

  // -- flags: buffer size --

  it("buffer size produces -B 4096", () => {
    expect(tcpdump({ bufferSize: "4096" })).toBe("tcpdump -i any -B 4096");
  });

  // -- flags: line buffered --

  it("lineBuffered true adds -l", () => {
    expect(tcpdump({ lineBuffered: true })).toBe("tcpdump -i any -l");
  });

  it("lineBuffered false omits -l", () => {
    expect(tcpdump({ lineBuffered: false })).toBe("tcpdump -i any");
  });

  // -- flag ordering --

  it("flags appear before BPF filter", () => {
    const cmd = tcpdump({
      count: "10",
      snapLen: "128",
      writeFile: "out.pcap",
      verbose: "-v",
      noDns: "-n",
      showAscii: true,
      hexMode: "-X",
      timestamp: "-tt",
      bufferSize: "2048",
      lineBuffered: true,
      protocol: "tcp",
      port: "80",
    });
    expect(cmd).toBe(
      "tcpdump -i any -c 10 -s 128 -w out.pcap -v -n -A -X -tt -B 2048 -l 'tcp and port 80'",
    );
  });
});

// ── buildPktmonCommand ─────────────────────────────────────────────────────

describe("buildPktmonCommand", () => {
  // -- basic invocation --

  it("default params contain 'pktmon start --etw'", () => {
    const cmd = pktmon();
    expect(cmd).toContain("pktmon start --etw");
  });

  it("default params begin with 'pktmon filter remove'", () => {
    const cmd = pktmon();
    expect(cmd.startsWith("pktmon filter remove")).toBe(true);
  });

  it("default params include pktmon stop comment", () => {
    expect(pktmon()).toContain("# pktmon stop");
  });

  it("default params do not include filter add when no filters set", () => {
    expect(pktmon()).not.toContain("pktmon filter add");
  });

  // -- filters --

  it("IP filter adds 'pktmon filter add -i 10.0.0.1'", () => {
    const cmd = pktmon({ ipAddress: "10.0.0.1" });
    expect(cmd).toContain("pktmon filter add -i 10.0.0.1");
  });

  it("port filter adds 'pktmon filter add' with '-p 443'", () => {
    const cmd = pktmon({ port: "443" });
    expect(cmd).toContain("pktmon filter add");
    expect(cmd).toContain("-p 443");
  });

  it("transport filter adds '-t TCP'", () => {
    const cmd = pktmon({ transport: "TCP" });
    expect(cmd).toContain("pktmon filter add");
    expect(cmd).toContain("-t TCP");
  });

  it("combined filters appear on a single filter add line", () => {
    const cmd = pktmon({
      ipAddress: "10.0.0.1",
      port: "443",
      transport: "TCP",
    });
    const lines = cmd.split("\n");
    const filterLine = lines.find((l) => l.startsWith("pktmon filter add"));
    expect(filterLine).toBeDefined();
    expect(filterLine).toContain("-i 10.0.0.1");
    expect(filterLine).toContain("-p 443");
    expect(filterLine).toContain("-t TCP");
  });

  it("empty filter values do not trigger filter add", () => {
    const cmd = pktmon({ ipAddress: "", port: "", transport: "" });
    expect(cmd).not.toContain("pktmon filter add");
  });

  // -- start options --

  it("component ID produces --comp 5", () => {
    const cmd = pktmon({ compId: "5" });
    expect(cmd).toContain("--comp 5");
  });

  it("output file produces --file-name capture.etl", () => {
    const cmd = pktmon({ fileName: "capture.etl" });
    expect(cmd).toContain("--file-name capture.etl");
  });

  it("max file size produces --file-size 512", () => {
    const cmd = pktmon({ fileSize: "512" });
    expect(cmd).toContain("--file-size 512");
  });

  it("packet size produces -m 128", () => {
    const cmd = pktmon({ packetSize: "128" });
    expect(cmd).toContain("-m 128");
  });

  it("log mode produces --log-mode circular", () => {
    const cmd = pktmon({ logMode: "circular" });
    expect(cmd).toContain("--log-mode circular");
  });

  it("packet type produces --type drop", () => {
    const cmd = pktmon({ packetType: "drop" });
    expect(cmd).toContain("--type drop");
  });

  it("drop reasons adds -d", () => {
    const cmd = pktmon({ dropReasons: true });
    expect(cmd).toContain(" -d");
  });

  it("drop reasons false omits -d on start line", () => {
    const cmd = pktmon({ dropReasons: false });
    const startLine = cmd
      .split("\n")
      .find((l) => l.startsWith("pktmon start"));
    expect(startLine).not.toContain(" -d");
  });

  it("counters only adds --counters-only", () => {
    const cmd = pktmon({ countersOnly: true });
    expect(cmd).toContain("--counters-only");
  });

  it("counters only false omits --counters-only", () => {
    const cmd = pktmon({ countersOnly: false });
    expect(cmd).not.toContain("--counters-only");
  });

  // -- ETL to pcapng conversion --

  it("convertToPcapng true includes etl2pcap comment", () => {
    const cmd = pktmon({ convertToPcapng: true });
    expect(cmd).toContain("# Convert to pcapng:");
    expect(cmd).toContain("# pktmon etl2pcap");
  });

  it("convertToPcapng false omits etl2pcap comment", () => {
    const cmd = pktmon({ convertToPcapng: false });
    expect(cmd).not.toContain("etl2pcap");
    expect(cmd).not.toContain("Convert to pcapng");
  });

  it("conversion line uses custom fileName", () => {
    const cmd = pktmon({
      fileName: "capture.etl",
      convertToPcapng: true,
    });
    expect(cmd).toContain("# pktmon etl2pcap capture.etl --out capture.pcapng");
  });

  it("conversion line uses default PktMon.etl when no fileName", () => {
    const cmd = pktmon({ convertToPcapng: true });
    expect(cmd).toContain("# pktmon etl2pcap PktMon.etl --out PktMon.pcapng");
  });

  // -- empty values ignored --

  it("empty compId is ignored", () => {
    expect(pktmon({ compId: "" })).not.toContain("--comp");
  });

  it("empty fileName is ignored in start command", () => {
    const startLine = pktmon({ fileName: "" })
      .split("\n")
      .find((l) => l.startsWith("pktmon start"));
    expect(startLine).not.toContain("--file-name");
  });

  it("empty fileSize is ignored", () => {
    expect(pktmon({ fileSize: "" })).not.toContain("--file-size");
  });

  it("empty logMode is ignored", () => {
    expect(pktmon({ logMode: "" })).not.toContain("--log-mode");
  });

  it("empty packetSize is ignored", () => {
    expect(pktmon({ packetSize: "" })).not.toContain("-m ");
  });

  it("empty packetType is ignored", () => {
    expect(pktmon({ packetType: "" })).not.toContain("--type");
  });

  // -- structure --

  it("pktmon filter remove appears before start", () => {
    const cmd = pktmon();
    const removeIdx = cmd.indexOf("pktmon filter remove");
    const startIdx = cmd.indexOf("pktmon start");
    expect(removeIdx).toBeLessThan(startIdx);
  });

  it("stop comment appears after start", () => {
    const cmd = pktmon();
    const startIdx = cmd.indexOf("pktmon start");
    const stopIdx = cmd.indexOf("# pktmon stop");
    expect(stopIdx).toBeGreaterThan(startIdx);
  });
});

// ── buildCommand dispatcher ────────────────────────────────────────────────

describe("buildCommand", () => {
  it("delegates to buildTcpdumpCommand for platform 'tcpdump'", () => {
    const params: TcpdumpParams = { ...DEFAULT_TCPDUMP_PARAMS, iface: "lo" };
    const result = buildCommand("tcpdump", params);
    expect(result).toBe(buildTcpdumpCommand(params));
    expect(result).toContain("tcpdump -i lo");
  });

  it("delegates to buildPktmonCommand for platform 'pktmon'", () => {
    const params: PktmonParams = { ...DEFAULT_PKTMON_PARAMS, compId: "3" };
    const result = buildCommand("pktmon", params);
    expect(result).toBe(buildPktmonCommand(params));
    expect(result).toContain("pktmon start --etw --comp 3");
  });
});
