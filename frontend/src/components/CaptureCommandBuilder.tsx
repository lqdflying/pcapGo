import { useEffect, useState } from "react";
import {
  type Platform,
  type TcpdumpParams,
  type PktmonParams,
  DEFAULT_TCPDUMP_PARAMS,
  DEFAULT_PKTMON_PARAMS,
  buildCommand,
} from "../lib/captureCommandBuilder";

interface Props {
  onCommandChange: (cmd: string) => void;
}

const TCPDUMP_PROTOCOLS = [
  { value: "", label: "Any" },
  { value: "tcp", label: "TCP" },
  { value: "udp", label: "UDP" },
  { value: "icmp", label: "ICMP" },
  { value: "arp", label: "ARP" },
  { value: "ip", label: "IP" },
  { value: "ip6", label: "IPv6" },
  { value: "sctp", label: "SCTP" },
];

const HOST_DIRECTIONS = [
  { value: "host", label: "host" },
  { value: "src host", label: "src host" },
  { value: "dst host", label: "dst host" },
];

const PORT_DIRECTIONS = [
  { value: "port", label: "port" },
  { value: "src port", label: "src port" },
  { value: "dst port", label: "dst port" },
  { value: "portrange", label: "portrange" },
];

const NET_DIRECTIONS = [
  { value: "net", label: "net" },
  { value: "src net", label: "src net" },
  { value: "dst net", label: "dst net" },
];

const VERBOSE_OPTIONS = [
  { value: "", label: "Off" },
  { value: "-v", label: "-v" },
  { value: "-vv", label: "-vv" },
  { value: "-vvv", label: "-vvv" },
];

const DNS_OPTIONS = [
  { value: "", label: "Resolve" },
  { value: "-n", label: "-n (no host)" },
  { value: "-nn", label: "-nn (no host/port)" },
];

const HEX_OPTIONS = [
  { value: "", label: "Off" },
  { value: "-X", label: "-X (hex+ASCII)" },
  { value: "-XX", label: "-XX (with link header)" },
];

const TIMESTAMP_OPTIONS = [
  { value: "", label: "Default" },
  { value: "-t", label: "-t (none)" },
  { value: "-tt", label: "-tt (unix)" },
  { value: "-ttt", label: "-ttt (delta)" },
  { value: "-tttt", label: "-tttt (date+time)" },
  { value: "-ttttt", label: "-ttttt (delta from first)" },
];

const PKTMON_TRANSPORT = [
  { value: "", label: "Any" },
  { value: "TCP", label: "TCP" },
  { value: "UDP", label: "UDP" },
  { value: "ICMP", label: "ICMP" },
];

const PKTMON_TYPE = [
  { value: "", label: "All" },
  { value: "flow", label: "Flow" },
  { value: "drop", label: "Drop" },
];

const PKTMON_LOG_MODE = [
  { value: "", label: "Default" },
  { value: "circular", label: "Circular" },
  { value: "multi-file", label: "Multi-file" },
];

const inputClass =
  "w-full rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none";
const selectClass = inputClass;
const labelClass = "text-[11px] font-medium text-panel-muted";
const sectionClass = "space-y-2";
const sectionTitleClass =
  "text-xs font-medium text-panel-text border-b border-panel-border pb-1 mb-2";

function Checkbox({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-panel-muted cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-panel-border accent-[rgb(var(--panel-accent))]"
      />
      {label}
    </label>
  );
}

export function CaptureCommandBuilder({ onCommandChange }: Props) {
  const [platform, setPlatform] = useState<Platform>("tcpdump");
  const [tcpdump, setTcpdump] = useState<TcpdumpParams>(DEFAULT_TCPDUMP_PARAMS);
  const [pktmon, setPktmon] = useState<PktmonParams>(DEFAULT_PKTMON_PARAMS);

  const updateTcpdump = (patch: Partial<TcpdumpParams>) =>
    setTcpdump((prev) => ({ ...prev, ...patch }));
  const updatePktmon = (patch: Partial<PktmonParams>) =>
    setPktmon((prev) => ({ ...prev, ...patch }));

  useEffect(() => {
    const params = platform === "tcpdump" ? tcpdump : pktmon;
    onCommandChange(buildCommand(platform, params));
  }, [platform, tcpdump, pktmon, onCommandChange]);

  return (
    <div className="space-y-4 p-3">
      {/* Platform selector */}
      <div>
        <label className={labelClass}>Platform</label>
        <select
          aria-label="Platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className={selectClass}
        >
          <option value="tcpdump">tcpdump (Linux/macOS)</option>
          <option value="pktmon">pktmon (Windows)</option>
        </select>
      </div>

      {platform === "tcpdump" ? (
        <>
          {/* Capture */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>Capture</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Interface (-i)</label>
                <input
                  aria-label="Interface"
                  value={tcpdump.iface}
                  onChange={(e) => updateTcpdump({ iface: e.target.value })}
                  placeholder="any"
                  className={inputClass}
                  disabled={!!tcpdump.readFile.trim()}
                />
              </div>
              <div>
                <label className={labelClass}>Count (-c)</label>
                <input
                  aria-label="Packet count"
                  value={tcpdump.count}
                  onChange={(e) => updateTcpdump({ count: e.target.value })}
                  placeholder="unlimited"
                  type="number"
                  min="1"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Snap length (-s)</label>
                <input
                  aria-label="Snapshot length"
                  value={tcpdump.snapLen}
                  onChange={(e) => updateTcpdump({ snapLen: e.target.value })}
                  placeholder="default"
                  type="number"
                  min="0"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Buffer (-B)</label>
                <input
                  aria-label="Buffer size"
                  value={tcpdump.bufferSize}
                  onChange={(e) => updateTcpdump({ bufferSize: e.target.value })}
                  placeholder="default"
                  type="number"
                  min="1"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Write file (-w)</label>
                <input
                  aria-label="Write file"
                  value={tcpdump.writeFile}
                  onChange={(e) => updateTcpdump({ writeFile: e.target.value })}
                  placeholder="stdout"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Read file (-r)</label>
                <input
                  aria-label="Read file"
                  value={tcpdump.readFile}
                  onChange={(e) => updateTcpdump({ readFile: e.target.value })}
                  placeholder="live capture"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Display */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>Display</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Verbose</label>
                <select
                  aria-label="Verbose level"
                  value={tcpdump.verbose}
                  onChange={(e) => updateTcpdump({ verbose: e.target.value })}
                  className={selectClass}
                >
                  {VERBOSE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>DNS resolve</label>
                <select
                  aria-label="DNS resolve"
                  value={tcpdump.noDns}
                  onChange={(e) => updateTcpdump({ noDns: e.target.value })}
                  className={selectClass}
                >
                  {DNS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Hex output</label>
                <select
                  aria-label="Hex output"
                  value={tcpdump.hexMode}
                  onChange={(e) => updateTcpdump({ hexMode: e.target.value })}
                  className={selectClass}
                >
                  {HEX_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Timestamp</label>
                <select
                  aria-label="Timestamp format"
                  value={tcpdump.timestamp}
                  onChange={(e) => updateTcpdump({ timestamp: e.target.value })}
                  className={selectClass}
                >
                  {TIMESTAMP_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-4 pt-1">
              <Checkbox
                label="ASCII (-A)"
                checked={tcpdump.showAscii}
                onChange={(v) => updateTcpdump({ showAscii: v })}
              />
              <Checkbox
                label="Line buffered (-l)"
                checked={tcpdump.lineBuffered}
                onChange={(v) => updateTcpdump({ lineBuffered: v })}
              />
            </div>
          </div>

          {/* Filters */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>Filters</h3>
            <div>
              <label className={labelClass}>Protocol</label>
              <select
                aria-label="Protocol filter"
                value={tcpdump.protocol}
                onChange={(e) => updateTcpdump({ protocol: e.target.value })}
                className={selectClass}
              >
                {TCPDUMP_PROTOCOLS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <div className="w-28 shrink-0">
                <label className={labelClass}>Host dir</label>
                <select
                  aria-label="Host direction"
                  value={tcpdump.hostDirection}
                  onChange={(e) =>
                    updateTcpdump({ hostDirection: e.target.value })
                  }
                  className={selectClass}
                >
                  {HOST_DIRECTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className={labelClass}>Host</label>
                <input
                  aria-label="Host filter"
                  value={tcpdump.hostFilter}
                  onChange={(e) =>
                    updateTcpdump({ hostFilter: e.target.value })
                  }
                  placeholder="e.g. 10.0.0.1"
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="w-28 shrink-0">
                <label className={labelClass}>Port dir</label>
                <select
                  aria-label="Port direction"
                  value={tcpdump.portDirection}
                  onChange={(e) =>
                    updateTcpdump({ portDirection: e.target.value })
                  }
                  className={selectClass}
                >
                  {PORT_DIRECTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className={labelClass}>Port</label>
                <input
                  aria-label="Port filter"
                  value={tcpdump.port}
                  onChange={(e) => updateTcpdump({ port: e.target.value })}
                  placeholder="e.g. 443"
                  className={inputClass}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="w-28 shrink-0">
                <label className={labelClass}>Net dir</label>
                <select
                  aria-label="Net direction"
                  value={tcpdump.netDirection}
                  onChange={(e) =>
                    updateTcpdump({ netDirection: e.target.value })
                  }
                  className={selectClass}
                >
                  {NET_DIRECTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className={labelClass}>Network (CIDR)</label>
                <input
                  aria-label="Net filter"
                  value={tcpdump.net}
                  onChange={(e) => updateTcpdump({ net: e.target.value })}
                  placeholder="e.g. 10.0.0.0/8"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Advanced */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>Advanced</h3>
            <div>
              <label className={labelClass}>Custom BPF expression</label>
              <textarea
                aria-label="Custom BPF"
                value={tcpdump.customBpf}
                onChange={(e) => updateTcpdump({ customBpf: e.target.value })}
                placeholder="e.g. (src net 10.0.0.0/8) or (dst port 53)"
                rows={2}
                className={`${inputClass} resize-none`}
              />
            </div>
          </div>
        </>
      ) : (
        /* pktmon form */
        <>
          {/* Capture */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>Capture</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Component ID (--comp)</label>
                <input
                  aria-label="Component ID"
                  value={pktmon.compId}
                  onChange={(e) => updatePktmon({ compId: e.target.value })}
                  placeholder="all components"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Packet size (-m)</label>
                <input
                  aria-label="Packet size"
                  value={pktmon.packetSize}
                  onChange={(e) => updatePktmon({ packetSize: e.target.value })}
                  placeholder="default"
                  type="number"
                  min="1"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Output file (--file-name)</label>
                <input
                  aria-label="Output file"
                  value={pktmon.fileName}
                  onChange={(e) => updatePktmon({ fileName: e.target.value })}
                  placeholder="PktMon.etl"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Max file size MB</label>
                <input
                  aria-label="Max file size"
                  value={pktmon.fileSize}
                  onChange={(e) => updatePktmon({ fileSize: e.target.value })}
                  placeholder="default"
                  type="number"
                  min="1"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Log mode</label>
                <select
                  aria-label="Log mode"
                  value={pktmon.logMode}
                  onChange={(e) => updatePktmon({ logMode: e.target.value })}
                  className={selectClass}
                >
                  {PKTMON_LOG_MODE.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Packet type</label>
                <select
                  aria-label="Packet type"
                  value={pktmon.packetType}
                  onChange={(e) => updatePktmon({ packetType: e.target.value })}
                  className={selectClass}
                >
                  {PKTMON_TYPE.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>Filters</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelClass}>Transport (-t)</label>
                <select
                  aria-label="Transport protocol"
                  value={pktmon.transport}
                  onChange={(e) => updatePktmon({ transport: e.target.value })}
                  className={selectClass}
                >
                  {PKTMON_TRANSPORT.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>IP address (-i)</label>
                <input
                  aria-label="IP address filter"
                  value={pktmon.ipAddress}
                  onChange={(e) => updatePktmon({ ipAddress: e.target.value })}
                  placeholder="e.g. 10.0.0.1"
                  className={inputClass}
                />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Port (-p)</label>
                <input
                  aria-label="Port filter"
                  value={pktmon.port}
                  onChange={(e) => updatePktmon({ port: e.target.value })}
                  placeholder="e.g. 443"
                  className={inputClass}
                />
              </div>
            </div>
          </div>

          {/* Options */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>Options</h3>
            <div className="flex flex-wrap gap-4">
              <Checkbox
                label="Counters only"
                checked={pktmon.countersOnly}
                onChange={(v) => updatePktmon({ countersOnly: v })}
              />
              <Checkbox
                label="Drop reasons (-d)"
                checked={pktmon.dropReasons}
                onChange={(v) => updatePktmon({ dropReasons: v })}
              />
              <Checkbox
                label="Convert ETL → pcapng"
                checked={pktmon.convertToPcapng}
                onChange={(v) => updatePktmon({ convertToPcapng: v })}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
