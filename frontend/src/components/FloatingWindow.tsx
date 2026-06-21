import { useRef, useCallback, type ReactNode } from "react";
import { PanelRight, X } from "lucide-react";

interface Geom {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Props {
  geom: Geom;
  onChange: (g: Geom) => void;
  onDock: () => void;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}

const MIN_W = 320;
const MIN_H = 240;

export function FloatingWindow({ geom, onChange, onDock, onClose, title = "AI Tools", children }: Props) {
  const dragOrigin = useRef<{ sx: number; sy: number; gx: number; gy: number } | null>(null);
  const resizeOrigin = useRef<{ sx: number; sy: number; gw: number; gh: number } | null>(null);

  const onDragStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      dragOrigin.current = { sx: e.clientX, sy: e.clientY, gx: geom.x, gy: geom.y };

      const onMove = (ev: PointerEvent) => {
        if (!dragOrigin.current) return;
        const dx = ev.clientX - dragOrigin.current.sx;
        const dy = ev.clientY - dragOrigin.current.sy;
        const nx = Math.max(0, Math.min(window.innerWidth - 100, dragOrigin.current.gx + dx));
        const ny = Math.max(0, Math.min(window.innerHeight - 40, dragOrigin.current.gy + dy));
        onChange({ ...geom, x: nx, y: ny });
      };

      const onUp = () => {
        dragOrigin.current = null;
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
    },
    [geom, onChange]
  );

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const el = e.currentTarget as HTMLElement;
      el.setPointerCapture(e.pointerId);
      resizeOrigin.current = { sx: e.clientX, sy: e.clientY, gw: geom.w, gh: geom.h };

      const onMove = (ev: PointerEvent) => {
        if (!resizeOrigin.current) return;
        const dw = ev.clientX - resizeOrigin.current.sx;
        const dh = ev.clientY - resizeOrigin.current.sy;
        onChange({
          ...geom,
          w: Math.max(MIN_W, resizeOrigin.current.gw + dw),
          h: Math.max(MIN_H, resizeOrigin.current.gh + dh),
        });
      };

      const onUp = () => {
        resizeOrigin.current = null;
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
      };

      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
    },
    [geom, onChange]
  );

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-panel-border shadow-2xl"
      style={{
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.h,
        background: "rgb(var(--panel-bg))",
      }}
    >
      {/* Drag header */}
      <div
        className="flex shrink-0 cursor-grab items-center justify-between border-b border-panel-border bg-panel-header px-3 py-1.5 active:cursor-grabbing"
        onPointerDown={onDragStart}
      >
        <span className="text-xs font-medium text-panel-muted">{title}</span>
        <div className="flex items-center gap-1">
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onDock}
            title="Dock panel"
            className="rounded p-1 text-panel-muted hover:bg-panel-border hover:text-panel-text"
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            title="Close"
            className="rounded p-1 text-panel-muted hover:bg-panel-error/20 hover:text-panel-error"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">{children}</div>

      {/* Resize grip */}
      <div
        className="absolute bottom-0 right-0 h-4 w-4 cursor-se-resize"
        onPointerDown={onResizeStart}
      >
        <svg
          className="h-full w-full text-panel-muted/40"
          viewBox="0 0 16 16"
          fill="currentColor"
        >
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="8" cy="12" r="1.5" />
          <circle cx="12" cy="8" r="1.5" />
        </svg>
      </div>
    </div>
  );
}
