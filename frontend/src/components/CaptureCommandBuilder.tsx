import { useEffect, useState, type ReactNode } from "react";
import {
  type Platform,
  type TcpdumpParams,
  type PktmonParams,
  DEFAULT_TCPDUMP_PARAMS,
  DEFAULT_PKTMON_PARAMS,
  buildCommand,
} from "../lib/captureCommandBuilder";
import { HelpTooltip } from "./HelpTooltip";
import {
  type HelpEntry,
  TCPDUMP_HELP,
  PKTMON_HELP,
} from "../lib/captureHelpText";
import { useTranslation } from "react-i18next";

interface Props {
  onCommandChange: (cmd: string) => void;
}

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

const inputClass =
  "w-full rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none";
const selectClass = inputClass;
const labelClass = "text-[11px] font-medium text-panel-muted";
const sectionClass = "space-y-2";
const sectionTitleClass =
  "text-xs font-medium text-panel-text border-b border-panel-border pb-1 mb-2";

function FieldLabel({
  children,
  tooltip,
}: {
  children: ReactNode;
  tooltip?: HelpEntry;
}) {
  return (
    <div className={labelClass}>
      {children}
      {tooltip && (
        <HelpTooltip description={tooltip.description} usage={tooltip.usage} />
      )}
    </div>
  );
}

function Checkbox({
  label,
  checked,
  onChange,
  tooltip,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  tooltip?: HelpEntry;
}) {
  return (
    <div className="flex items-center gap-1.5 text-[11px] text-panel-muted">
      <label className="flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-panel-border accent-[rgb(var(--panel-accent))]"
        />
        {label}
      </label>
      {tooltip && (
        <HelpTooltip description={tooltip.description} usage={tooltip.usage} />
      )}
    </div>
  );
}

export function CaptureCommandBuilder({ onCommandChange }: Props) {
  const { t } = useTranslation();

  const TCPDUMP_PROTOCOLS = [
    { value: "", label: t("captureCommand.any") },
    { value: "tcp", label: "TCP" },
    { value: "udp", label: "UDP" },
    { value: "icmp", label: "ICMP" },
    { value: "arp", label: "ARP" },
    { value: "ip", label: "IP" },
    { value: "ip6", label: "IPv6" },
    { value: "sctp", label: "SCTP" },
  ];

  const VERBOSE_OPTIONS = [
    { value: "", label: t("captureCommand.off") },
    { value: "-v", label: "-v" },
    { value: "-vv", label: "-vv" },
    { value: "-vvv", label: "-vvv" },
  ];

  const DNS_OPTIONS = [
    { value: "", label: t("captureCommand.resolve") },
    { value: "-n", label: t("captureCommand.noHost") },
    { value: "-nn", label: t("captureCommand.noHostPort") },
  ];

  const HEX_OPTIONS = [
    { value: "", label: t("captureCommand.off") },
    { value: "-X", label: t("captureCommand.hexAscii") },
    { value: "-XX", label: t("captureCommand.hexLinkHeader") },
  ];

  const TIMESTAMP_OPTIONS = [
    { value: "", label: t("captureCommand.tsDefault") },
    { value: "-t", label: t("captureCommand.tsNone") },
    { value: "-tt", label: t("captureCommand.tsUnix") },
    { value: "-ttt", label: t("captureCommand.tsDelta") },
    { value: "-tttt", label: t("captureCommand.tsDateTime") },
    { value: "-ttttt", label: t("captureCommand.tsDeltaFirst") },
  ];

  const PKTMON_TRANSPORT = [
    { value: "", label: t("captureCommand.any") },
    { value: "TCP", label: "TCP" },
    { value: "UDP", label: "UDP" },
    { value: "ICMP", label: "ICMP" },
  ];

  const PKTMON_TYPE = [
    { value: "", label: t("captureCommand.any") },
    { value: "flow", label: t("captureCommand.flow") },
    { value: "drop", label: t("captureCommand.drop") },
  ];

  const PKTMON_LOG_MODE = [
    { value: "", label: t("captureCommand.default") },
    { value: "circular", label: t("captureCommand.circular") },
    { value: "multi-file", label: t("captureCommand.multiFile") },
  ];

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
        <label className={labelClass}>{t("captureCommand.platform")}</label>
        <select
          aria-label="Platform"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          className={selectClass}
        >
          <option value="tcpdump">{t("captureCommand.tcpdumpPlatform")}</option>
          <option value="pktmon">{t("captureCommand.pktmonPlatform")}</option>
        </select>
      </div>

      {platform === "tcpdump" ? (
        <>
          {/* Capture */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>{t("captureCommand.capture")}</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.iface"), usage: TCPDUMP_HELP.iface.usage }}>
                  {t("captureCommand.interface")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.count"), usage: TCPDUMP_HELP.count.usage }}>
                  {t("captureCommand.count")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.snapLen"), usage: TCPDUMP_HELP.snapLen.usage }}>
                  {t("captureCommand.snapLength")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.bufferSize"), usage: TCPDUMP_HELP.bufferSize.usage }}>
                  {t("captureCommand.buffer")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.writeFile"), usage: TCPDUMP_HELP.writeFile.usage }}>
                  {t("captureCommand.writeFile")}
                </FieldLabel>
                <input
                  aria-label="Write file"
                  value={tcpdump.writeFile}
                  onChange={(e) => updateTcpdump({ writeFile: e.target.value })}
                  placeholder="stdout"
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.readFile"), usage: TCPDUMP_HELP.readFile.usage }}>
                  {t("captureCommand.readFile")}
                </FieldLabel>
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
            <h3 className={sectionTitleClass}>{t("captureCommand.display")}</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.verbose"), usage: TCPDUMP_HELP.verbose.usage }}>
                  {t("captureCommand.verbose")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.noDns"), usage: TCPDUMP_HELP.noDns.usage }}>
                  {t("captureCommand.dnsResolve")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.hexMode"), usage: TCPDUMP_HELP.hexMode.usage }}>
                  {t("captureCommand.hexOutput")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.timestamp"), usage: TCPDUMP_HELP.timestamp.usage }}>
                  {t("captureCommand.timestamp")}
                </FieldLabel>
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
                label={t("captureCommand.ascii")}
                checked={tcpdump.showAscii}
                onChange={(v) => updateTcpdump({ showAscii: v })}
                tooltip={{ description: t("helpText.tcpdump.showAscii"), usage: TCPDUMP_HELP.showAscii.usage }}
              />
              <Checkbox
                label={t("captureCommand.lineBuffered")}
                checked={tcpdump.lineBuffered}
                onChange={(v) => updateTcpdump({ lineBuffered: v })}
                tooltip={{ description: t("helpText.tcpdump.lineBuffered"), usage: TCPDUMP_HELP.lineBuffered.usage }}
              />
            </div>
          </div>

          {/* Filters */}
          <div className={sectionClass}>
            <h3 className={sectionTitleClass}>{t("captureCommand.filters")}</h3>
            <div>
              <FieldLabel tooltip={{ description: t("helpText.tcpdump.protocol"), usage: TCPDUMP_HELP.protocol.usage }}>
                {t("captureCommand.protocolFilter")}
              </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.hostDirection"), usage: TCPDUMP_HELP.hostDirection.usage }}>
                  {t("captureCommand.hostDir")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.hostFilter"), usage: TCPDUMP_HELP.hostFilter.usage }}>
                  {t("captureCommand.host")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.portDirection"), usage: TCPDUMP_HELP.portDirection.usage }}>
                  {t("captureCommand.portDir")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.port"), usage: TCPDUMP_HELP.port.usage }}>
                  {t("captureCommand.port")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.netDirection"), usage: TCPDUMP_HELP.netDirection.usage }}>
                  {t("captureCommand.netDir")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.tcpdump.net"), usage: TCPDUMP_HELP.net.usage }}>
                  {t("captureCommand.networkCidr")}
                </FieldLabel>
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
            <h3 className={sectionTitleClass}>{t("captureCommand.advanced")}</h3>
            <div>
              <FieldLabel tooltip={{ description: t("helpText.tcpdump.customBpf"), usage: TCPDUMP_HELP.customBpf.usage }}>
                {t("captureCommand.customBpf")}
              </FieldLabel>
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
            <h3 className={sectionTitleClass}>{t("captureCommand.capture")}</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel tooltip={{ description: t("helpText.pktmon.compId"), usage: PKTMON_HELP.compId.usage }}>
                  {t("captureCommand.componentId")}
                </FieldLabel>
                <input
                  aria-label="Component ID"
                  value={pktmon.compId}
                  onChange={(e) => updatePktmon({ compId: e.target.value })}
                  placeholder="all components"
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel tooltip={{ description: t("helpText.pktmon.packetSize"), usage: PKTMON_HELP.packetSize.usage }}>
                  {t("captureCommand.packetSize")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.pktmon.fileName"), usage: PKTMON_HELP.fileName.usage }}>
                  {t("captureCommand.outputFile")}
                </FieldLabel>
                <input
                  aria-label="Output file"
                  value={pktmon.fileName}
                  onChange={(e) => updatePktmon({ fileName: e.target.value })}
                  placeholder="PktMon.etl"
                  className={inputClass}
                />
              </div>
              <div>
                <FieldLabel tooltip={{ description: t("helpText.pktmon.fileSize"), usage: PKTMON_HELP.fileSize.usage }}>
                  {t("captureCommand.maxFileSize")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.pktmon.logMode"), usage: PKTMON_HELP.logMode.usage }}>
                  {t("captureCommand.logMode")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.pktmon.packetType"), usage: PKTMON_HELP.packetType.usage }}>
                  {t("captureCommand.packetType")}
                </FieldLabel>
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
            <h3 className={sectionTitleClass}>{t("captureCommand.filters")}</h3>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <FieldLabel tooltip={{ description: t("helpText.pktmon.transport"), usage: PKTMON_HELP.transport.usage }}>
                  {t("captureCommand.transport")}
                </FieldLabel>
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
                <FieldLabel tooltip={{ description: t("helpText.pktmon.ipAddress"), usage: PKTMON_HELP.ipAddress.usage }}>
                  {t("captureCommand.ipAddress")}
                </FieldLabel>
                <input
                  aria-label="IP address filter"
                  value={pktmon.ipAddress}
                  onChange={(e) => updatePktmon({ ipAddress: e.target.value })}
                  placeholder="e.g. 10.0.0.1"
                  className={inputClass}
                />
              </div>
              <div className="col-span-2">
                <FieldLabel tooltip={{ description: t("helpText.pktmon.port"), usage: PKTMON_HELP.port.usage }}>
                  {t("captureCommand.port")}
                </FieldLabel>
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
            <h3 className={sectionTitleClass}>{t("captureCommand.options")}</h3>
            <div className="flex flex-wrap gap-4">
              <Checkbox
                label={t("captureCommand.countersOnly")}
                checked={pktmon.countersOnly}
                onChange={(v) => updatePktmon({ countersOnly: v })}
                tooltip={{ description: t("helpText.pktmon.countersOnly"), usage: PKTMON_HELP.countersOnly.usage }}
              />
              <Checkbox
                label={t("captureCommand.dropReasons")}
                checked={pktmon.dropReasons}
                onChange={(v) => updatePktmon({ dropReasons: v })}
                tooltip={{ description: t("helpText.pktmon.dropReasons"), usage: PKTMON_HELP.dropReasons.usage }}
              />
              <Checkbox
                label={t("captureCommand.convertEtl")}
                checked={pktmon.convertToPcapng}
                onChange={(v) => updatePktmon({ convertToPcapng: v })}
                tooltip={{ description: t("helpText.pktmon.convertToPcapng"), usage: PKTMON_HELP.convertToPcapng.usage }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
