import { useRef, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { PacketDetail } from "../api/client";

interface Props {
  detail: PacketDetail | null;
  loading: boolean;
  highlight?: { offset: number; length: number } | null;
}

export function HexViewer({ detail, loading, highlight }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [detail?.idx]);

  const hexBytes = detail?.raw_hex
    ? detail.raw_hex.split(" ")
    : [];

  const rawOffset = detail?.raw_offset ?? 0;

  // 16 bytes per row
  const rows: string[][] = [];
  for (let i = 0; i < hexBytes.length; i += 16) {
    rows.push(hexBytes.slice(i, i + 16));
  }

  const toAscii = (b: string) => {
    const code = parseInt(b, 16);
    return code >= 32 && code <= 126 ? String.fromCharCode(code) : ".";
  };

  const isHighlighted = (byteIndex: number) => {
    if (!highlight) return false;
    const absOffset = rawOffset + byteIndex;
    return absOffset >= highlight.offset && absOffset < highlight.offset + highlight.length;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-panel-border bg-panel-header px-3 py-1.5 text-xs font-medium text-panel-muted">
        Hex Dump
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto font-mono">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-panel-muted" />
          </div>
        ) : hexBytes.length > 0 ? (
          <table className="w-full text-xs leading-relaxed">
            <tbody>
              {rows.map((row, rowIdx) => (
                <tr key={rowIdx} className="hover:bg-panel-accent/5">
                  <td className="whitespace-nowrap pl-2 pr-4 text-panel-muted select-none">
                    {(rowIdx * 16)
                      .toString(16)
                      .padStart(4, "0")
                      .toUpperCase()}
                  </td>
                  <td className="pr-2 text-panel-text">
                    {row.map((b, i) => (
                      <span
                        key={i}
                        className={`mr-[2px] ${
                          isHighlighted(rowIdx * 16 + i)
                            ? "rounded bg-panel-accent/30 px-[1px] text-panel-accent"
                            : ""
                        }`}
                      >
                        {b}
                      </span>
                    ))}
                  </td>
                  <td className="border-l border-panel-border pl-2 text-panel-muted/70">
                    {row.map((b, i) => (
                      <span
                        key={i}
                        className={
                          isHighlighted(rowIdx * 16 + i)
                            ? "rounded bg-panel-accent/30 text-panel-accent"
                            : ""
                        }
                      >
                        {toAscii(b)}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-xs text-panel-muted">
            Select a packet to view hex dump
          </p>
        )}
      </div>
    </div>
  );
}
