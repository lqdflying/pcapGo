export type Platform = "tcpdump" | "pktmon";

// ── Shell quoting ─────────────────────────────────────────────────────────

// Characters that are safe unquoted in a POSIX shell argument. Values made
// only of these (e.g. "eth0", "443", "192.168.1.1", "10.0.0.0/8") are left
// alone so the generated command reads naturally; anything with whitespace,
// quotes, or shell metacharacters is single-quote-escaped.
const _POSIX_SAFE_RE = /^[A-Za-z0-9\-_.\/:+,%@]+$/;

// pktmon commands target PowerShell on Windows. Backslash and drive-colon
// paths are safe unquoted there, but embedded single quotes must use
// PowerShell's doubled single-quote escape.
const _POWERSHELL_SAFE_RE = /^[A-Za-z0-9\-_.\\/:+,%@]+$/;

// Always single-quote-wrap a value for safe shell use, escaping embedded
// single quotes as '\''. Used for the tcpdump BPF filter expression, which is
// always exactly one shell argument and must stay quoted even when it is a
// single bare word like "tcp".
export function shellQuote(value: string): string {
  const v = value.trim();
  if (v === "") return "''";
  return `'${v.replace(/'/g, "'\\''")}'`;
}

// Quote a shell argument only when it contains characters that would break
// the command or change its parsing. Returns "" for empty input so callers
// can push the result directly into an args array.
export function shellQuoteIfNeeded(value: string): string {
  const v = value.trim();
  if (v === "") return "";
  if (_POSIX_SAFE_RE.test(v)) return v;
  return shellQuote(v);
}

export function powershellQuote(value: string): string {
  const v = value.trim();
  if (v === "") return "''";
  return `'${v.replace(/'/g, "''")}'`;
}

export function powershellQuoteIfNeeded(value: string): string {
  const v = value.trim();
  if (v === "") return "";
  if (_POWERSHELL_SAFE_RE.test(v)) return v;
  return powershellQuote(v);
}

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
    parts.push("-r", shellQuoteIfNeeded(params.readFile));
  } else {
    parts.push("-i", shellQuoteIfNeeded(params.iface || "any"));
  }

  if (params.count.trim()) parts.push("-c", shellQuoteIfNeeded(params.count));
  if (params.snapLen.trim()) parts.push("-s", shellQuoteIfNeeded(params.snapLen));
  if (params.writeFile.trim()) parts.push("-w", shellQuoteIfNeeded(params.writeFile));
  if (params.verbose) parts.push(params.verbose);
  if (params.noDns) parts.push(params.noDns);
  if (params.showAscii) parts.push("-A");
  if (params.hexMode) parts.push(params.hexMode);
  if (params.timestamp) parts.push(params.timestamp);
  if (params.bufferSize.trim()) parts.push("-B", shellQuoteIfNeeded(params.bufferSize));
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
    // The whole BPF expression is one shell argument; always single-quote it
    // (with embedded quotes escaped) so values containing spaces or quotes
    // can't break out of the quoting.
    parts.push(shellQuote(filters.join(" and ")));
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
    if (params.ipAddress.trim()) filterParts.push("-i", powershellQuoteIfNeeded(params.ipAddress));
    if (params.port.trim()) filterParts.push("-p", powershellQuoteIfNeeded(params.port));
    if (params.transport.trim()) filterParts.push("-t", powershellQuoteIfNeeded(params.transport));
    lines.push(filterParts.join(" "));
  }

  // Start command
  const startParts: string[] = ["pktmon start", "--etw"];
  if (params.compId.trim()) startParts.push("--comp", powershellQuoteIfNeeded(params.compId));
  if (params.fileName.trim()) startParts.push("--file-name", powershellQuoteIfNeeded(params.fileName));
  if (params.fileSize.trim()) startParts.push("--file-size", powershellQuoteIfNeeded(params.fileSize));
  if (params.logMode.trim()) startParts.push("--log-mode", powershellQuoteIfNeeded(params.logMode));
  if (params.packetSize.trim()) startParts.push("-m", powershellQuoteIfNeeded(params.packetSize));
  if (params.packetType.trim()) startParts.push("--type", powershellQuoteIfNeeded(params.packetType));
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
    lines.push(`# pktmon etl2pcap ${powershellQuoteIfNeeded(etlFile)} --out ${powershellQuoteIfNeeded(pcapFile)}`);
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
