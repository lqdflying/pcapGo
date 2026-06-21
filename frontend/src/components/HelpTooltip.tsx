import { CircleHelp } from "lucide-react";

interface HelpTooltipProps {
  description: string;
  usage: string;
}

export function HelpTooltip({ description, usage }: HelpTooltipProps) {
  return (
    <span className="group/tip relative ml-1 inline-flex cursor-help align-middle">
      <CircleHelp className="h-3 w-3 text-panel-muted/60 transition-colors group-hover/tip:text-panel-accent" />
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-1.5 w-56 -translate-x-1/2 rounded border border-panel-border bg-panel-header px-2.5 py-2 text-[10px] leading-relaxed text-panel-text opacity-0 shadow-lg transition-opacity duration-150 group-hover/tip:pointer-events-auto group-hover/tip:visible group-hover/tip:opacity-100"
      >
        <span className="block font-normal text-panel-text">{description}</span>
        <span className="mt-1 block font-mono text-panel-muted">{usage}</span>
      </span>
    </span>
  );
}
