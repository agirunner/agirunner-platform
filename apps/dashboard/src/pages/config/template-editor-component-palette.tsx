import { useState } from 'react';
import { ChevronDown, ChevronRight, Layers, ListChecks, Bot, Eye, ShieldCheck } from 'lucide-react';

export type PaletteItemType =
  | 'phase'
  | 'task-autonomous'
  | 'task-review'
  | 'task-approval';

interface PaletteEntry {
  type: PaletteItemType;
  label: string;
  icon: React.ReactNode;
}

const PALETTE_ITEMS: PaletteEntry[] = [
  { type: 'phase', label: 'Phase', icon: <Layers className="h-4 w-4" /> },
  { type: 'task-autonomous', label: 'Autonomous Task', icon: <Bot className="h-4 w-4" /> },
  { type: 'task-review', label: 'Review Task', icon: <Eye className="h-4 w-4" /> },
  { type: 'task-approval', label: 'Approval Gate', icon: <ShieldCheck className="h-4 w-4" /> },
];

function handleDragStart(event: React.DragEvent, itemType: PaletteItemType): void {
  event.dataTransfer.setData('application/reactflow-palette', itemType);
  event.dataTransfer.effectAllowed = 'move';
}

export function ComponentPalette(): JSX.Element {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div
      className="border-r border-border bg-surface flex flex-col select-none"
      style={{ width: isCollapsed ? 40 : 180 }}
    >
      <button
        type="button"
        onClick={() => setIsCollapsed((prev) => !prev)}
        className="flex items-center gap-1 px-2 py-2 text-xs font-semibold text-muted hover:text-foreground border-b border-border w-full text-left"
        aria-label={isCollapsed ? 'Expand palette' : 'Collapse palette'}
      >
        {isCollapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <>
            <ChevronDown className="h-3 w-3" />
            <span>Components</span>
          </>
        )}
      </button>

      {!isCollapsed && (
        <div className="flex flex-col gap-1 p-2">
          <span className="text-[10px] font-medium text-muted uppercase tracking-wider px-1 mb-1">
            Drag to canvas
          </span>
          {PALETTE_ITEMS.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => handleDragStart(e, item.type)}
              className="flex items-center gap-2 px-2 py-2 rounded-md border border-border bg-background text-sm cursor-grab hover:border-accent hover:bg-accent/5 active:cursor-grabbing transition-colors"
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { type PaletteEntry };
