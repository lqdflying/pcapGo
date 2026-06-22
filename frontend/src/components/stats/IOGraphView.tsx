import { useTranslation } from "react-i18next";
import type { IOBucket } from "../../api/client";

const BUCKET_OPTIONS = [
  { value: 1, label: "1s" },
  { value: 10, label: "10s" },
  { value: 30, label: "30s" },
  { value: 60, label: "1min" },
];

export function IOGraphView({
  buckets,
  duration,
  bucketSeconds,
  metric,
  onChange,
}: {
  buckets: IOBucket[];
  duration: number;
  bucketSeconds: number;
  metric: "packets" | "bytes";
  onChange?: (bucketSeconds: number, metric: "packets" | "bytes") => void;
}) {
  const { t } = useTranslation();
  const values = buckets.map((b) => (metric === "bytes" ? b.byte_count : b.packet_count));
  const maxVal = Math.max(...values, 1);
  const peak = values.length ? Math.max(...values) : 0;
  const avg = values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;
  const unit = metric === "bytes" ? "B" : "pkts";

  const W = 720;
  const H = 160;
  const n = buckets.length;
  const gap = n > 0 ? Math.min(4, W / n / 4) : 0;
  const barW = n > 0 ? Math.max(1, W / n - gap) : 0;
  const avgY = H - (avg / maxVal) * H;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between text-xs">
        <p className="text-panel-muted">
          {t("stats.ioGraphInfo", {
            buckets: buckets.length,
            duration: (duration * 1000).toFixed(0),
          })}
          {n > 0 && (
            <span className="ml-2">
              {t("stats.ioGraphPeakAvg", {
                peak,
                unit,
                avg: avg.toFixed(1),
              })}
            </span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <select
            aria-label="Bucket size"
            value={bucketSeconds}
            onChange={(e) => onChange?.(Number(e.target.value), metric)}
            className="rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
          >
            {BUCKET_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Metric"
            value={metric}
            onChange={(e) =>
              onChange?.(bucketSeconds, e.target.value as "packets" | "bytes")
            }
            className="rounded border border-panel-border bg-panel-bg px-2 py-1 text-xs text-panel-text focus:border-panel-accent focus:outline-none"
          >
            <option value="packets">{t("capture.packetsLabel")}</option>
            <option value="bytes">{t("common.bytes")}</option>
          </select>
        </div>
      </div>

      {n === 0 ? (
        <p className="text-xs text-panel-muted">{t("stats.noIoData")}</p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="h-44 w-full"
            role="img"
            aria-label={t("stats.ioGraphLabel")}
          >
            {buckets.map((b, i) => {
              const val = metric === "bytes" ? b.byte_count : b.packet_count;
              const h = Math.max((val / maxVal) * H, 1);
              const x = i * (barW + gap);
              const tEnd = b.ts_start + bucketSeconds;
              return (
                <rect
                  key={i}
                  x={x}
                  y={H - h}
                  width={barW}
                  height={h}
                  className="fill-panel-accent/50 hover:fill-panel-accent"
                >
                  <title>
                    {b.ts_start.toFixed(3)}s-{tEnd.toFixed(3)}s: {val} {unit}
                  </title>
                </rect>
              );
            })}
            <line
              x1={0}
              x2={W}
              y1={avgY}
              y2={avgY}
              className="stroke-panel-warning/60"
              strokeWidth={1}
              strokeDasharray="4 4"
            />
          </svg>
          <div className="mt-1 flex justify-between">
            <span className="text-[10px] text-panel-muted">0s</span>
            <span className="text-[10px] text-panel-muted">
              {(duration * 1000).toFixed(0)}ms
            </span>
          </div>
        </>
      )}
    </div>
  );
}
