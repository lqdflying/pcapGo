import { ArrowUp, ArrowDown, Search } from "lucide-react";

export type SortDir = "asc" | "desc";

export function SortHeader<K extends string>({
  label,
  field,
  sortKey,
  sortDir,
  onSort,
  className,
}: {
  label: string;
  field: K;
  sortKey: K;
  sortDir: SortDir;
  onSort: (field: K) => void;
  className?: string;
}) {
  const active = sortKey === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      className={`flex items-center gap-0.5 hover:text-panel-text ${
        active ? "text-panel-text" : ""
      } ${className ?? ""}`}
    >
      <span>{label}</span>
      {active &&
        (sortDir === "asc" ? (
          <ArrowUp className="h-3 w-3" />
        ) : (
          <ArrowDown className="h-3 w-3" />
        ))}
    </button>
  );
}

export function FilterBox({
  value,
  onChange,
  placeholder,
  count,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  count: string;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1.5 h-3 w-3 text-panel-muted" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="w-56 rounded border border-panel-border bg-panel-bg py-1 pl-7 pr-2 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
        />
      </div>
      <span className="text-[11px] text-panel-muted">{count}</span>
    </div>
  );
}

export function PercentBar({ pct }: { pct: number }) {
  return (
    <span className="ml-2 inline-flex w-16 items-center align-middle">
      <span className="h-1.5 w-full overflow-hidden rounded bg-panel-border">
        <span
          className="block h-full rounded bg-panel-accent/60"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </span>
    </span>
  );
}

export function formatBytes(b: number) {
  if (b < 1024) return `${b.toFixed(0)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}


export function formatTimestamp(ts: number): string {
  if (!ts) return "-";
  const d = new Date(ts * 1000);
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}.${ms}`;
}
