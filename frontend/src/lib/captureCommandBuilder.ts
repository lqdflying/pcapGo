export type Platform = "tcpdump" | "pktmon";

// ── tcpdump ──────────────────────────────────────────────────────────────

export interface TcpdumpParams {
  iface: string;
  protocol: string;
  hostFilter: string;
  hostDirection: string;
  port: string;
  portDirection: string;
  net: string;
  netDirection: string;
  count: string;
  snapLen: string;
  writeFile: string;
  readFile: string;
  verbose: string;
  noDns: string;
  showAscii: boolean;
  hexMode: string;
  timestamp: string;
  bufferSize: string;
  lineBuffered: boolean;
  customBpf: string;
}

export const DEFAULT_TCPDUMP_PARAMS: TcpdumpParams = {
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
};

export function buildTcpdumpCommand(params: TcpdumpParams): string {
  const parts: string[] = ["tcpdump"];

  if (params.readFile.trim()) {
    parts.push("-r", params.readFile.trim());
  } else {
    parts.push("-i", params.iface || "any");
  }

  if (params.count.trim()) parts.push("-c", params.count.trim());
  if (params.snapLen.trim()) parts.push("-s", params.snapLen.trim());
  if (params.writeFile.trim()) parts.push("-w", params.writeFile.trim());
  if (params.verbose) parts.push(params.verbose);
  if (params.noDns) parts.push(params.noDns);
  if (params.showAscii) parts.push("-A");
  if (params.hexMode) parts.push(params.hexMode);
  if (params.timestamp) parts.push(params.timestamp);
  if (params.bufferSize.trim()) parts.push("-B", params.bufferSize.trim());
  if (params.lineBuffered) parts.push("-l");

  const filters: string[] = [];
  if (params.protocol) filters.push(params.protocol);
  if (params.hostFilter.trim())
    filters.push(`${params.hostDirection} ${params.hostFilter.trim()}`);
  if (params.port.trim())
    filters.push(`${params.portDirection} ${params.port.trim()}`);
  if (params.net.trim())
    filters.push(`${params.netDirection} ${params.net.trim()}`);
  if (params.customBpf.trim()) filters.push(params.customBpf.trim());

  if (filters.length > 0) {
    parts.push(`'${filters.join(" and ")}'`);
  }

  return parts.join(" ");
}

// ── pktmon ───────────────────────────────────────────────────────────────

export interface PktmonParams {
  compId: string;
  transport: string;
  ipAddress: string;
  port: string;
  packetType: string;
  fileName: string;
  fileSize: string;
  logMode: string;
  packetSize: string;
  countersOnly: boolean;
  dropReasons: boolean;
  convertToPcapng: boolean;
}

export const DEFAULT_PKTMON_PARAMS: PktmonParams = {
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
};

export function buildPktmonCommand(params: PktmonParams): string {
  const lines: string[] = [];

  // Reset any previous filters
  lines.push("pktmon filter remove");

  // Filter lines
  const hasFilter =
    params.transport.trim() ||
    params.ipAddress.trim() ||
    params.port.trim();

  if (hasFilter) {
    const filterParts: string[] = ["pktmon filter add"];
    if (params.ipAddress.trim()) filterParts.push("-i", params.ipAddress.trim());
    if (params.port.trim()) filterParts.push("-p", params.port.trim());
    if (params.transport.trim()) filterParts.push("-t", params.transport.trim());
    lines.push(filterParts.join(" "));
  }

  // Start command
  const startParts: string[] = ["pktmon start", "--etw"];
  if (params.compId.trim()) startParts.push("--comp", params.compId.trim());
  if (params.fileName.trim()) startParts.push("--file-name", params.fileName.trim());
  if (params.fileSize.trim()) startParts.push("--file-size", params.fileSize.trim());
  if (params.logMode.trim()) startParts.push("--log-mode", params.logMode.trim());
  if (params.packetSize.trim()) startParts.push("-m", params.packetSize.trim());
  if (params.packetType.trim()) startParts.push("--type", params.packetType.trim());
  if (params.countersOnly) startParts.push("--counters-only");
  if (params.dropReasons) startParts.push("-d");
  lines.push(startParts.join(" "));

  lines.push("");
  lines.push("# To stop capture:");
  lines.push("# pktmon stop");

  if (params.convertToPcapng) {
    const etlFile = params.fileName.trim() || "PktMon.etl";
    const pcapFile = etlFile.replace(/\.etl$/i, ".pcapng");
    lines.push("");
    lines.push("# Convert to pcapng:");
    lines.push(`# pktmon etl2pcap ${etlFile} --out ${pcapFile}`);
  }

  return lines.join("\n");
}

// ── Dispatcher ───────────────────────────────────────────────────────────

export function buildCommand(
  platform: Platform,
  params: TcpdumpParams | PktmonParams,
): string {
  if (platform === "pktmon") {
    return buildPktmonCommand(params as PktmonParams);
  }
  return buildTcpdumpCommand(params as TcpdumpParams);
}
