import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { CircleHelp } from "lucide-react";

interface HelpTooltipProps {
  description: string;
  usage: string;
}

export function HelpTooltip({ description, usage }: HelpTooltipProps) {
  const tooltipId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [placement, setPlacement] = useState<"above" | "below">("above");
  const open = hovered || persistent;

  useLayoutEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const tooltipWidth = 224;
      const tooltipHeight = 72;
      const margin = 8;
      const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin);
      const left = Math.min(
        Math.max(rect.left + rect.width / 2 - tooltipWidth / 2, margin),
        maxLeft,
      );
      const nextPlacement =
        rect.top > tooltipHeight + margin ? "above" : "below";

      setPosition({
        left,
        top: nextPlacement === "above" ? rect.top - 6 : rect.bottom + 6,
      });
      setPlacement(nextPlacement);
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (
        triggerRef.current &&
        event.target instanceof Node &&
        !triggerRef.current.contains(event.target)
      ) {
        setHovered(false);
        setPersistent(false);
      }
    };

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setHovered(false);
      setPersistent(false);
      triggerRef.current?.blur();
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Show parameter help"
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        className="ml-1 inline-flex cursor-help align-middle text-panel-muted/60 transition-colors hover:text-panel-accent focus:text-panel-accent focus:outline-none"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setPersistent(true);
        }}
        onFocus={() => setPersistent(true)}
        onBlur={() => setPersistent(false)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onKeyDown={handleKeyDown}
      >
        <CircleHelp className="h-3 w-3" aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <span
            id={tooltipId}
            role="tooltip"
            className={`pointer-events-none fixed z-50 w-56 rounded border border-panel-border bg-panel-header px-2.5 py-2 text-[10px] leading-relaxed text-panel-text opacity-100 shadow-lg ${
              placement === "above" ? "-translate-y-full" : ""
            }`}
            style={{ left: position.left, top: position.top }}
          >
            <span className="block font-normal text-panel-text">
              {description}
            </span>
            <span className="mt-1 block font-mono text-panel-muted">
              {usage}
            </span>
          </span>,
          document.body,
        )}
    </>
  );
}
