/**
 * Config-related inspector panels: ConfigPolicy, Config, DefaultInstructionConfig, Metadata.
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { SectionHeader, HelpText, JsonObjectEditor } from './template-editor-inspector-shared.js';
import type { OverrideLevel } from './template-editor-types.js';

// ---------------------------------------------------------------------------
// Config Policy inspector — 3-level override model (locked | per-run | per-task)
// ---------------------------------------------------------------------------

interface PolicyEntry {
  field: string;
  default_value: unknown;
  override_level: OverrideLevel;
}

function parsePolicyEntries(policy: Record<string, unknown> | undefined): PolicyEntry[] {
  if (!policy) return [];
  return Object.entries(policy).map(([field, val]) => {
    if (val && typeof val === 'object') {
      const obj = val as Record<string, unknown>;
      if ('override_level' in obj) {
        return { field, default_value: obj.default_value ?? '', override_level: obj.override_level as OverrideLevel };
      }
      // Migrate from old locked/override boolean model
      if ('locked' in obj) {
        const locked = Boolean(obj.locked);
        const override = Boolean(obj.override);
        const level: OverrideLevel = locked ? 'locked' : override ? 'per-run' : 'locked';
        return { field, default_value: obj.default_value ?? '', override_level: level };
      }
    }
    return { field, default_value: val, override_level: 'per-run' as OverrideLevel };
  });
}

function entriesToPolicy(entries: PolicyEntry[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const e of entries) {
    result[e.field] = {
      default_value: e.default_value,
      override_level: e.override_level,
    };
  }
  return result;
}

const OVERRIDE_LEVEL_LABELS: Record<OverrideLevel, string> = {
  locked: 'Locked',
  'per-run': 'Per-run',
  'per-task': 'Per-task',
};

export function ConfigPolicyInspector({
  configPolicy,
  onUpdate,
}: {
  configPolicy: Record<string, unknown> | undefined;
  onUpdate: (policy: Record<string, unknown>) => void;
}) {
  const entries = parsePolicyEntries(configPolicy);

  const update = (index: number, patch: Partial<PolicyEntry>) => {
    const next = entries.map((e, i) => (i === index ? { ...e, ...patch } : e));
    onUpdate(entriesToPolicy(next));
  };

  const remove = (index: number) => {
    onUpdate(entriesToPolicy(entries.filter((_, i) => i !== index)));
  };

  const add = () => {
    const newField = `field_${entries.length + 1}`;
    onUpdate(entriesToPolicy([...entries, { field: newField, default_value: '', override_level: 'per-run' }]));
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Config Policy"
        description="Control which template settings can be overridden when launching a workflow."
      />

      {entries.length === 0 && (
        <p className="text-xs text-muted py-2">No policy fields defined.</p>
      )}

      {entries.length > 0 && (
        <div className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 px-1 text-[10px] text-muted font-medium uppercase">
          <span>Field</span>
          <span>Default</span>
          <span>Level</span>
          <span />
        </div>
      )}

      {entries.map((entry, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
          <Input
            value={entry.field}
            onChange={(e) => update(i, { field: e.target.value })}
            className="text-xs h-7 font-mono"
          />
          <Input
            value={typeof entry.default_value === 'string' ? entry.default_value : JSON.stringify(entry.default_value)}
            onChange={(e) => {
              let val: unknown = e.target.value;
              try { val = JSON.parse(e.target.value); } catch { /* keep string */ }
              update(i, { default_value: val });
            }}
            className="text-xs h-7"
          />
          <Select value={entry.override_level} onValueChange={(v) => update(i, { override_level: v as OverrideLevel })}>
            <SelectTrigger className="h-7 text-[10px] w-[90px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="locked">Locked</SelectItem>
              <SelectItem value="per-run">Per-run</SelectItem>
              <SelectItem value="per-task">Per-task</SelectItem>
            </SelectContent>
          </Select>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ))}

      <HelpText>
        Locked: uses template default, no override. Per-run: overridable at workflow launch. Per-task: overridable per task at runtime.
      </HelpText>

      <Button size="sm" variant="outline" className="w-full" onClick={add}>
        <Plus className="h-3.5 w-3.5" />
        Add Policy Field
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config inspector (schema.config)
// ---------------------------------------------------------------------------

export function ConfigInspector({
  config,
  onUpdate,
}: {
  config: Record<string, unknown> | undefined;
  onUpdate: (c: Record<string, unknown> | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Config"
        description="Top-level configuration object for this template. Available to all tasks at runtime."
      />
      <JsonObjectEditor
        value={config}
        onChange={onUpdate}
        rows={6}
        placeholder='{\n  "max_file_size": 10000,\n  "language": "typescript"\n}'
      />
      <HelpText>
        Arbitrary JSON configuration. Tasks can read these values to control their behavior.
      </HelpText>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default Instruction Config inspector
// ---------------------------------------------------------------------------

export function DefaultInstructionConfigInspector({
  instructionConfig,
  onUpdate,
}: {
  instructionConfig: Record<string, unknown> | undefined;
  onUpdate: (c: Record<string, unknown> | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Default Instructions"
        description="Default instruction configuration applied to all tasks unless overridden at the task level."
      />
      <JsonObjectEditor
        value={instructionConfig}
        onChange={onUpdate}
        rows={6}
        placeholder='{\n  "system_prompt": "You are a senior engineer...",\n  "temperature": 0.3\n}'
      />
      <HelpText>
        Common instruction settings (system prompts, model parameters, tool configs) shared by all tasks.
        Individual tasks can override via their role_config.
      </HelpText>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Template Metadata inspector
// ---------------------------------------------------------------------------

export function MetadataInspector({
  metadata,
  onUpdate,
}: {
  metadata: Record<string, unknown> | undefined;
  onUpdate: (m: Record<string, unknown> | undefined) => void;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Metadata"
        description="Arbitrary metadata attached to this template. Not used by the runtime — for organizational purposes."
      />
      <JsonObjectEditor
        value={metadata}
        onChange={onUpdate}
        rows={4}
        placeholder='{\n  "team": "platform",\n  "category": "ci-cd"\n}'
      />
      <HelpText>
        Tags, categories, team ownership, or any other data you want to track.
        Metadata is preserved through version updates.
      </HelpText>
    </div>
  );
}
