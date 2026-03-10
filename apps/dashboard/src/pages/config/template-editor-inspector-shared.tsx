/**
 * Shared UI components for template inspector panels.
 */
import { useState, useEffect, useRef } from 'react';
import { X, Plus, ChevronDown, ChevronRight, Maximize2, Minimize2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Badge } from '../../components/ui/badge.js';

// ---------------------------------------------------------------------------
// Typography helpers
// ---------------------------------------------------------------------------

export function HelpText({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted mt-0.5 leading-tight">{children}</p>;
}

export function FieldLabel({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="pt-3 pb-1">
      <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">{title}</h4>
      {description && <HelpText>{description}</HelpText>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

export function CollapsibleSection({
  title,
  description,
  defaultOpen = true,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="pt-2">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 py-1 group"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3 text-muted" /> : <ChevronRight className="h-3 w-3 text-muted" />}
        <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">{title}</h4>
      </button>
      {description && !open && <HelpText>{description}</HelpText>}
      {open && (
        <div className="space-y-3 pt-1">
          {description && <HelpText>{description}</HelpText>}
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expandable textarea — inline textarea with pop-out modal for long text
// ---------------------------------------------------------------------------

export function ExpandableTextarea({
  value,
  onChange,
  placeholder,
  label,
  rows = 4,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  rows?: number;
}) {
  const [expanded, setExpanded] = useState(false);

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8" onClick={() => setExpanded(false)}>
        <div className="w-full max-w-3xl rounded-lg border border-border bg-surface shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-sm font-medium">{label ?? 'Edit'}</span>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              <Minimize2 className="h-3.5 w-3.5" />
              Close
            </Button>
          </div>
          <textarea
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="flex-1 min-h-[400px] w-full resize-none bg-background px-4 py-3 text-sm font-mono focus:outline-none"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-md border border-border bg-transparent px-3 py-2 pr-8 text-sm resize-y focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(true); }}
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted hover:bg-border/50 hover:text-foreground"
        title="Expand editor"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON object editor — for unstructured Record<string, unknown> fields
// ---------------------------------------------------------------------------

export function JsonObjectEditor({
  value,
  onChange,
  rows = 3,
  placeholder,
  label,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown> | undefined) => void;
  rows?: number;
  placeholder?: string;
  label?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState(() => value ? JSON.stringify(value, null, 2) : '');
  const lastExternalRef = useRef(value);

  // Sync from parent when value changes externally (not from our own edits)
  useEffect(() => {
    const serialized = value ? JSON.stringify(value, null, 2) : '';
    const lastSerialized = lastExternalRef.current ? JSON.stringify(lastExternalRef.current, null, 2) : '';
    if (serialized !== lastSerialized) {
      setText(serialized);
      lastExternalRef.current = value;
      setError(null);
    }
  }, [value]);

  const handleChange = (raw: string) => {
    setText(raw);
    if (!raw.trim()) {
      setError(null);
      lastExternalRef.current = undefined;
      onChange(undefined);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setError(null);
      lastExternalRef.current = parsed;
      onChange(parsed);
    } catch {
      setError('Invalid JSON');
    }
  };

  if (expanded) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8" onClick={() => setExpanded(false)}>
        <div className="w-full max-w-3xl rounded-lg border border-border bg-surface shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="text-sm font-medium">{label ?? 'Edit JSON'}</span>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              <Minimize2 className="h-3.5 w-3.5" />
              Close
            </Button>
          </div>
          <textarea
            autoFocus
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={placeholder ?? '{}'}
            className="flex-1 min-h-[400px] w-full resize-none bg-transparent px-4 py-3 text-sm font-mono focus:outline-none"
          />
          {error && <p className="text-xs text-red-500 px-4 py-1 border-t border-border">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-1">
      <Textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        rows={rows}
        className="font-mono text-xs pr-8"
        placeholder={placeholder ?? '{}'}
      />
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setExpanded(true); }}
        className="absolute right-1.5 top-1.5 rounded p-1 text-muted hover:bg-border/50 hover:text-foreground"
        title="Expand editor"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>
      {error && <p className="text-[10px] text-red-500 mt-0.5">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip array editor — for string[] fields
// ---------------------------------------------------------------------------

export function ChipArrayEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setInput('');
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((item, i) => (
          <Badge key={item} variant="outline" className="text-[10px] gap-1">
            {item}
            <button onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X className="h-2.5 w-2.5" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="flex gap-1">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          placeholder={placeholder ?? 'Type and press Enter'}
          className="flex-1 text-xs h-7"
        />
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={add}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Key-value editor — for Record<string, string> style fields
// ---------------------------------------------------------------------------

export function KeyValueEditor({
  entries,
  onChange,
  keyPlaceholder = 'KEY',
  valuePlaceholder = 'value',
}: {
  entries: Record<string, unknown>;
  onChange: (entries: Record<string, unknown>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
}) {
  return (
    <div className="space-y-1">
      {Object.entries(entries).map(([key, val]) => (
        <div key={key} className="flex items-center gap-1">
          <Input
            value={key}
            className="flex-1 text-xs h-7 font-mono"
            onChange={(e) => {
              const newKey = e.target.value;
              if (newKey === key) return;
              const next: Record<string, unknown> = {};
              for (const [k, v] of Object.entries(entries)) {
                next[k === key ? newKey : k] = v;
              }
              onChange(next);
            }}
            placeholder={keyPlaceholder}
          />
          <Input
            value={String(val ?? '')}
            className="flex-1 text-xs h-7"
            placeholder={valuePlaceholder}
            onChange={(e) => onChange({ ...entries, [key]: e.target.value })}
          />
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 shrink-0"
            onClick={() => {
              const next = { ...entries };
              delete next[key];
              onChange(next);
            }}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="text-xs h-7"
        onClick={() => {
          const key = `${keyPlaceholder}_${Object.keys(entries).length + 1}`;
          onChange({ ...entries, [key]: '' });
        }}
      >
        <Plus className="h-3 w-3" />
        Add entry
      </Button>
    </div>
  );
}
