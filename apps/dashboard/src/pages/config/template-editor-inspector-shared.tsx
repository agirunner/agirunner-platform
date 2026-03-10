/**
 * Shared UI components for template inspector panels.
 */
import { useState } from 'react';
import { X, Plus, ChevronDown, ChevronRight } from 'lucide-react';
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
// JSON object editor — for unstructured Record<string, unknown> fields
// ---------------------------------------------------------------------------

export function JsonObjectEditor({
  value,
  onChange,
  rows = 3,
  placeholder,
}: {
  value: Record<string, unknown> | undefined;
  onChange: (v: Record<string, unknown> | undefined) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const text = value ? JSON.stringify(value, null, 2) : '';

  return (
    <>
      <Textarea
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          if (!raw.trim()) {
            setError(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed = JSON.parse(raw);
            setError(null);
            onChange(parsed);
          } catch {
            setError('Invalid JSON');
          }
        }}
        rows={rows}
        className="mt-1 font-mono text-xs"
        placeholder={placeholder ?? '{}'}
      />
      {error && <p className="text-[10px] text-red-500 mt-0.5">{error}</p>}
    </>
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
