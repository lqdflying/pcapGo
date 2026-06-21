import { useState, useCallback } from "react";
import { Copy, Check } from "lucide-react";
import { CaptureCommandBuilder } from "./CaptureCommandBuilder";
import { CaptureCommandAIGenerator } from "./CaptureCommandAIGenerator";

interface Props {
  captureId?: string;
}

type Mode = "builder" | "ai";

export function CaptureCommandPanel({ captureId }: Props) {
  const [mode, setMode] = useState<Mode>("builder");
  const [command, setCommand] = useState("");
  const [copied, setCopied] = useState(false);

  const switchMode = useCallback((m: Mode) => {
    if (m === mode) return;
    setMode(m);
    // Clear the shared command so a stale value from the other mode can't be
    // copied. Each mode re-populates it via onCommandChange as appropriate
    // (Builder re-emits on mount; AI only on a successful generation).
    setCommand("");
    setCopied(false);
  }, [mode]);

  const handleCopy = useCallback(async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API may not be available
    }
  }, [command]);

  return (
    <div className="flex h-full flex-col">
      {/* Mode tabs */}
      <div className="flex border-b border-panel-border bg-panel-header/40 px-3 py-1.5">
        <div className="flex rounded-lg border border-panel-border overflow-hidden">
          {(["builder", "ai"] as const).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`px-3 py-1 text-xs font-medium transition ${
                mode === m
                  ? "bg-panel-accent text-panel-header"
                  : "text-panel-muted hover:bg-panel-border"
              }`}
            >
              {m === "builder" ? "Builder" : "AI Generate"}
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-auto">
        {mode === "builder" ? (
          <CaptureCommandBuilder onCommandChange={setCommand} />
        ) : (
          <CaptureCommandAIGenerator
            captureId={captureId}
            onCommandChange={setCommand}
          />
        )}
      </div>

      {/* Command preview + copy */}
      {command && (
        <div className="border-t border-panel-border bg-panel-header/40">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] font-medium text-panel-muted">
              Generated Command
            </span>
            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition bg-panel-accent/20 text-panel-accent hover:bg-panel-accent/30"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3" /> Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy
                </>
              )}
            </button>
          </div>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all bg-panel-bg px-3 py-2 font-mono text-xs text-panel-text">
            {command}
          </pre>
        </div>
      )}
    </div>
  );
}
