import { useState } from "react";
import { ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import type { LayerNode, PacketDetail } from "../api/client";

interface Props {
  detail: PacketDetail | null;
  loading: boolean;
  onSelectLayer?: (layer: LayerNode) => void;
}

export function PacketTree({ detail, loading, onSelectLayer }: Props) {
  return (
    <div className="flex h-full flex-col border-r border-panel-border">
      <div className="border-b border-panel-border bg-panel-header px-3 py-1.5 text-xs font-medium text-panel-muted">
        Packet Details
      </div>
      <div className="flex-1 overflow-auto p-2">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-panel-muted" />
          </div>
        ) : detail ? (
          <div>
            <div className="mb-2 rounded border border-panel-border bg-panel-header/30 px-2 py-1">
              <div className="text-xs text-panel-muted">
                <span className="text-panel-text font-medium">
                  Frame {detail.idx}
                </span>
                {" "}· {detail.length} bytes · {detail.proto} · {detail.src} → {detail.dst}
              </div>
              <div className="mt-0.5 text-[11px] text-panel-muted/70 truncate">
                {detail.info}
              </div>
            </div>
            {detail.layers.map((layer, i) => (
              <TreeNode
                key={`${layer.name}-${i}`}
                node={layer}
                depth={0}
                defaultExpanded={i === 0}
                onSelectLayer={onSelectLayer}
              />
            ))}
          </div>
        ) : (
          <p className="p-4 text-xs text-panel-muted">
            Select a packet to view protocol details
          </p>
        )}
      </div>
    </div>
  );
}

function TreeNode({
  node,
  depth,
  defaultExpanded,
  onSelectLayer,
}: {
  node: LayerNode;
  depth: number;
  defaultExpanded: boolean;
  onSelectLayer?: (layer: LayerNode) => void;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const hasChildren = node.children.length > 0;

  const handleRowClick = () => {
    onSelectLayer?.(node);
    if (hasChildren) {
      setExpanded((prev) => !prev);
    }
  };

  const handleChevronClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  };

  return (
    <div className="mb-0.5 text-xs">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={handleRowClick}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          handleRowClick();
        }}
        className={`flex cursor-pointer items-center rounded px-1 py-0.5 transition hover:bg-panel-accent/5 ${
          depth === 0 ? "font-medium text-panel-accent" : "text-panel-text"
        }`}
        style={{ paddingLeft: 4 + depth * 16 }}
      >
        {hasChildren ? (
          expanded ? (
            <ChevronDown
              onClick={handleChevronClick}
              className="mr-1 h-3 w-3 shrink-0 text-panel-muted hover:text-panel-text"
            />
          ) : (
            <ChevronRight
              onClick={handleChevronClick}
              className="mr-1 h-3 w-3 shrink-0 text-panel-muted hover:text-panel-text"
            />
          )
        ) : (
          <span className="mr-1 w-3 shrink-0" />
        )}
        <span className="text-panel-accent">{node.name}</span>
        <span className="ml-2 truncate text-panel-muted">{node.summary}</span>
      </div>
      {expanded &&
        hasChildren &&
        node.children.map((child, i) => (
          <TreeNode
            key={`${child.name}-${i}`}
            node={child}
            depth={depth + 1}
            defaultExpanded={depth === 0}
            onSelectLayer={onSelectLayer}
          />
        ))}
    </div>
  );
}
