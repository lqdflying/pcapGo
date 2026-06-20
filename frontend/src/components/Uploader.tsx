import { useCallback, useRef, useState } from "react";
import { Upload, Loader2 } from "lucide-react";

interface Props {
  onUpload: (file: File) => void;
  uploading: boolean;
}

// Accept .pcap/.pcapng/.cap plus tcpdump rotated suffixes (e.g. capture.pcap0,
// dump.pcap-01, x.cap2). Mirrors the server-side guardrail; the backend's
// magic-byte check is the authoritative validation.
const CAPTURE_NAME_RE = /\.(pcapng|pcap|cap)[-_.]?\d*$/i;

export function Uploader({ onUpload, uploading }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file && CAPTURE_NAME_RE.test(file.name)) {
        onUpload(file);
      }
    },
    [onUpload]
  );

  const handleClick = () => inputRef.current?.click();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload packet capture"
      onDrop={handleDrop}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        handleClick();
      }}
      className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-8 text-center transition ${
        dragOver
          ? "border-panel-accent bg-panel-accent/5"
          : "border-panel-border hover:border-panel-muted"
      } ${uploading ? "pointer-events-none opacity-70" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        onChange={handleChange}
        className="hidden"
        aria-label="Choose pcap file"
      />
      {uploading ? (
        <div className="flex items-center justify-center gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-panel-accent" />
          <span className="text-sm text-panel-muted">Uploading and parsing...</span>
        </div>
      ) : (
        <>
          <Upload className="mx-auto mb-2 h-8 w-8 text-panel-muted" />
          <p className="text-sm text-panel-muted">
            Drop a <span className="text-panel-accent">.pcap</span> or{" "}
            <span className="text-panel-accent">.pcapng</span> file here, or click to browse
          </p>
          <p className="mt-1 text-xs text-panel-muted/60">Max file size: 100 MB</p>
        </>
      )}
    </div>
  );
}
