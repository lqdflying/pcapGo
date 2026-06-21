export interface HelpEntry {
  description: string;
  usage: string;
}

export const TCPDUMP_HELP: Record<string, HelpEntry> = {
  iface: {
    description:
      "Network interface to capture packets on. Use 'any' to capture on all interfaces.",
    usage: "-i eth0",
  },
  count: {
    description:
      "Stop after capturing this many packets. Omit for unlimited capture.",
    usage: "-c 1000",
  },
  snapLen: {
    description:
      "Bytes to capture per packet. 0 means full packet. Default varies by version (often 262144).",
    usage: "-s 96",
  },
  bufferSize: {
    description:
      "Kernel buffer size in KiB. Increase for high-traffic captures to avoid drops.",
    usage: "-B 4096",
  },
  writeFile: {
    description:
      "Write raw packets to a file instead of printing to stdout. Creates a pcap file.",
    usage: "-w capture.pcap",
  },
  readFile: {
    description:
      "Read packets from a previously saved capture file instead of live capture.",
    usage: "-r capture.pcap",
  },
  verbose: {
    description:
      "Increase output verbosity. Each level adds more protocol detail to the output.",
    usage: "-v | -vv | -vvv",
  },
  noDns: {
    description:
      "Control DNS resolution. -n skips host lookup, -nn also skips port name lookup.",
    usage: "-n or -nn",
  },
  hexMode: {
    description:
      "Print each packet as hex dump. -X includes ASCII, -XX adds link-level header.",
    usage: "-X or -XX",
  },
  timestamp: {
    description:
      "Control timestamp format. Options range from no timestamp to high-resolution delta times.",
    usage: "-tttt (date+time)",
  },
  showAscii: {
    description:
      "Print each packet in ASCII. Useful for capturing text-based protocols like HTTP.",
    usage: "-A",
  },
  lineBuffered: {
    description:
      "Use line-buffered output. Useful when piping tcpdump to another program like grep.",
    usage: "-l",
  },
  protocol: {
    description:
      "Filter by protocol. Only packets matching this protocol will be captured.",
    usage: "tcp, udp, icmp, arp",
  },
  hostFilter: {
    description:
      "Filter by host IP address or hostname. Combine with direction (src/dst) for one-way filtering.",
    usage: "host 10.0.0.1",
  },
  hostDirection: {
    description:
      "Direction qualifier for host filter: match source, destination, or both.",
    usage: "src host | dst host | host",
  },
  port: {
    description:
      "Filter by port number. Use 'portrange' direction for a range like 80-443.",
    usage: "port 443",
  },
  portDirection: {
    description:
      "Direction qualifier for port filter: match source port, destination port, or both.",
    usage: "src port | dst port | port",
  },
  net: {
    description:
      "Filter by network using CIDR notation. Captures all traffic to/from that subnet.",
    usage: "net 10.0.0.0/8",
  },
  netDirection: {
    description:
      "Direction qualifier for network filter: match source, destination, or both.",
    usage: "src net | dst net | net",
  },
  customBpf: {
    description:
      "Raw BPF (Berkeley Packet Filter) expression. Combined with other filters using 'and'.",
    usage: "(src net 10.0.0.0/8) or (dst port 53)",
  },
};

export const PKTMON_HELP: Record<string, HelpEntry> = {
  compId: {
    description:
      "Select networking components to monitor by ID. Use 'pktmon list' to see available components.",
    usage: "--comp 4",
  },
  packetSize: {
    description:
      "Maximum bytes to log per packet. Omit to log full packet content.",
    usage: "-m 128",
  },
  fileName: {
    description:
      "Output ETL file name. Default is PktMon.etl in the current directory.",
    usage: "--file-name capture.etl",
  },
  fileSize: {
    description:
      "Maximum log file size in megabytes. The capture stops when this limit is reached.",
    usage: "--file-size 512",
  },
  logMode: {
    description:
      "Logging mode: 'circular' overwrites oldest data; 'multi-file' creates new files at size limit.",
    usage: "--log-mode circular",
  },
  packetType: {
    description:
      "Filter by packet type: 'flow' for normal traffic, 'drop' for dropped packets only.",
    usage: "--type flow",
  },
  transport: {
    description:
      "Filter by transport protocol. Only matching packets are captured.",
    usage: "-t TCP",
  },
  ipAddress: {
    description:
      "Filter by IP address. Only packets with this source or destination IP are captured.",
    usage: "-i 10.0.0.1",
  },
  port: {
    description:
      "Filter by port number. Only packets on this port are captured.",
    usage: "-p 443",
  },
  countersOnly: {
    description:
      "Log packet counters only, not packet contents. Lightweight monitoring mode.",
    usage: "--counters-only",
  },
  dropReasons: {
    description:
      "Include the reason why each packet was dropped by the networking stack.",
    usage: "-d",
  },
  convertToPcapng: {
    description:
      "Append a command to convert the ETL output to pcapng format for use in Wireshark.",
    usage: "pktmon etl2pcap PktMon.etl",
  },
};
