/**
 * Variables and Lifecycle inspector panels.
 */
import { X, Plus } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Badge } from '../../components/ui/badge.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Trash2 } from 'lucide-react';
import type {
  TemplateVariableDefinition,
  LifecyclePolicy,
  RetryPolicy,
  VariableType,
  RetryBackoffStrategy,
} from './template-editor-types.js';
import { VARIABLE_TYPES, BACKOFF_STRATEGIES } from './template-editor-types.js';
import { HelpText, FieldLabel, SectionHeader, ChipArrayEditor } from './template-editor-inspector-shared.js';

// ---------------------------------------------------------------------------
// Variables inspector
// ---------------------------------------------------------------------------

function coerceDefault(type: VariableType, raw: string): unknown {
  if (!raw) return undefined;
  switch (type) {
    case 'number': { const n = Number(raw); return isNaN(n) ? raw : n; }
    case 'boolean': return raw === 'true';
    case 'json': try { return JSON.parse(raw); } catch { return raw; }
    default: return raw;
  }
}

export function VariablesInspector({
  variables,
  onUpdate,
}: {
  variables: TemplateVariableDefinition[];
  onUpdate: (vars: TemplateVariableDefinition[]) => void;
}) {
  const addVariable = () => {
    onUpdate([...variables, { name: `var_${variables.length + 1}`, type: 'string', required: true }]);
  };

  const updateVar = (index: number, updated: TemplateVariableDefinition) => {
    onUpdate(variables.map((v, i) => (i === index ? updated : v)));
  };

  const removeVar = (index: number) => {
    onUpdate(variables.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Variables"
        description="Parameters that users fill in when launching a workflow from this template."
      />

      {variables.length === 0 && (
        <p className="text-xs text-muted py-2">No variables defined. Click + to add one.</p>
      )}

      {variables.map((v, i) => (
        <div key={i} className="space-y-2 p-3 rounded-md border border-border/50 bg-background">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium font-mono">{v.name}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeVar(i)} aria-label={`Remove variable ${v.name}`}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>

          <FieldLabel label="Name">
            <Input
              value={v.name}
              onChange={(e) => updateVar(i, { ...v, name: e.target.value })}
              className="mt-1 text-xs h-7 font-mono"
            />
            <HelpText>Referenced in templates as {'{{name}}'}.</HelpText>
          </FieldLabel>

          <FieldLabel label="Type">
            <Select value={v.type} onValueChange={(val) => updateVar(i, { ...v, type: val as VariableType })}>
              <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="string">string — free text</SelectItem>
                <SelectItem value="number">number — numeric value</SelectItem>
                <SelectItem value="boolean">boolean — true/false</SelectItem>
                <SelectItem value="json">json — structured data</SelectItem>
              </SelectContent>
            </Select>
            <HelpText>Determines validation and how the default value is interpreted.</HelpText>
          </FieldLabel>

          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs">Required</span>
              <HelpText>When on, the user must provide a value at launch time.</HelpText>
            </div>
            <Switch
              checked={v.required !== false}
              onCheckedChange={(checked) => updateVar(i, { ...v, required: checked })}
            />
          </div>

          <FieldLabel label="Default Value">
            <Input
              value={v.default !== undefined ? String(v.default) : ''}
              onChange={(e) => updateVar(i, { ...v, default: coerceDefault(v.type, e.target.value) })}
              className="mt-1 text-xs h-7"
              placeholder={v.type === 'boolean' ? 'true or false' : 'Leave blank for required variables'}
            />
            <HelpText>Used if not provided at launch. Value is coerced to match the type above.</HelpText>
          </FieldLabel>

          <FieldLabel label="Description">
            <Input
              value={v.description ?? ''}
              onChange={(e) => updateVar(i, { ...v, description: e.target.value || undefined })}
              className="mt-1 text-xs h-7"
              placeholder="Shown to users in the launch form"
            />
          </FieldLabel>
        </div>
      ))}

      <Button size="sm" variant="outline" onClick={addVariable} className="w-full">
        <Plus className="h-3.5 w-3.5" />
        Add Variable
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle inspector
// ---------------------------------------------------------------------------

// Default retry categories — used only at the template level.
const DEFAULT_RETRYABLE_CATEGORIES = ['timeout', 'transient_error', 'resource_unavailable', 'network_error'];

export function LifecycleInspector({
  lifecycle,
  onUpdate,
  compact = false,
}: {
  lifecycle: LifecyclePolicy | undefined;
  onUpdate: (lc: LifecyclePolicy | undefined) => void;
  compact?: boolean;
}) {
  // In compact (task-level) mode, undefined = "inherit from template".
  // Only explicitly set fields are overrides.
  return compact
    ? <TaskLifecycleOverride lifecycle={lifecycle} onUpdate={onUpdate} />
    : <TemplateLifecycleEditor lifecycle={lifecycle ?? {}} onUpdate={onUpdate} />;
}

// ---------------------------------------------------------------------------
// Template-level: full lifecycle editor with all options + defaults
// ---------------------------------------------------------------------------

function TemplateLifecycleEditor({
  lifecycle,
  onUpdate,
}: {
  lifecycle: LifecyclePolicy;
  onUpdate: (lc: LifecyclePolicy | undefined) => void;
}) {
  const lc = lifecycle;
  const retry = lc.retry_policy;
  const rework = lc.rework;

  const updateRetry = (patch: Partial<RetryPolicy>) => {
    const current: RetryPolicy = retry ?? {
      max_attempts: 3,
      backoff_strategy: 'fixed',
      initial_backoff_seconds: 5,
      retryable_categories: DEFAULT_RETRYABLE_CATEGORIES,
    };
    onUpdate({ ...lc, retry_policy: { ...current, ...patch } });
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Lifecycle"
        description="Controls how tasks handle failure and rework across this template. Escalation is configured per role in Role Definitions."
      />

      {/* Retry */}
      <div className="space-y-3 p-3 rounded-md border border-border/50 bg-background">
        <h5 className="text-xs font-semibold">Retry Policy</h5>
        <HelpText>When a task fails with a retryable error, retry before marking it failed.</HelpText>

        <FieldLabel label="Max Attempts">
          <Input
            type="number" min={1} max={10}
            value={retry?.max_attempts ?? 3}
            onChange={(e) => updateRetry({ max_attempts: Math.max(1, Number(e.target.value)) })}
            className="mt-1 h-7 text-xs"
          />
          <HelpText>Total tries including the initial attempt (1-10).</HelpText>
        </FieldLabel>

        <FieldLabel label="Backoff Strategy">
          <Select
            value={retry?.backoff_strategy ?? 'fixed'}
            onValueChange={(v) => updateRetry({ backoff_strategy: v as RetryBackoffStrategy })}
          >
            <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed">Fixed — same delay every time</SelectItem>
              <SelectItem value="exponential">Exponential — delay doubles each retry</SelectItem>
              <SelectItem value="linear">Linear — delay increases by initial amount</SelectItem>
            </SelectContent>
          </Select>
          <HelpText>How the wait time between retries changes.</HelpText>
        </FieldLabel>

        <FieldLabel label="Initial Delay (seconds)">
          <Input
            type="number" min={0}
            value={retry?.initial_backoff_seconds ?? 5}
            onChange={(e) => updateRetry({ initial_backoff_seconds: Math.max(0, Number(e.target.value)) })}
            className="mt-1 h-7 text-xs"
          />
          <HelpText>Wait time before the first retry.</HelpText>
        </FieldLabel>

        <FieldLabel label="Retryable Error Types">
          <ChipArrayEditor
            value={retry?.retryable_categories ?? DEFAULT_RETRYABLE_CATEGORIES}
            onChange={(cats) => updateRetry({ retryable_categories: cats })}
            placeholder="e.g. timeout, transient_error"
          />
          <HelpText>Only retry on these error types. Others fail immediately.</HelpText>
        </FieldLabel>
      </div>

      {/* Rework */}
      <div className="space-y-3 p-3 rounded-md border border-border/50 bg-background">
        <h5 className="text-xs font-semibold">Rework</h5>
        <HelpText>When a reviewer rejects task output, send it back for revision.</HelpText>

        <FieldLabel label="Max Cycles">
          <Input
            type="number" min={1} max={20}
            value={rework?.max_cycles ?? 3}
            onChange={(e) => onUpdate({ ...lc, rework: { max_cycles: Math.max(1, Number(e.target.value)) } })}
            className="mt-1 h-7 text-xs"
          />
          <HelpText>Maximum revision rounds before the task fails (1-20).</HelpText>
        </FieldLabel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Task-level: override-only — empty means "inherit from template"
// ---------------------------------------------------------------------------

function TaskLifecycleOverride({
  lifecycle,
  onUpdate,
}: {
  lifecycle: LifecyclePolicy | undefined;
  onUpdate: (lc: LifecyclePolicy | undefined) => void;
}) {
  const lc = lifecycle ?? {};
  const hasRetry = lc.retry_policy != null;
  const hasRework = lc.rework != null;

  const clearIfEmpty = (next: LifecyclePolicy): LifecyclePolicy | undefined => {
    if (!next.retry_policy && !next.rework) return undefined;
    return next;
  };

  return (
    <div className="space-y-3">
      <HelpText>Only set fields you want to override. Empty sections inherit from the template-level lifecycle. Escalation is configured per role in Role Definitions.</HelpText>

      {/* Retry override */}
      <div className="space-y-2 p-3 rounded-md border border-border/50 bg-background">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold">Retry Override</h5>
          <Switch
            checked={hasRetry}
            onCheckedChange={(v) => {
              if (v) {
                onUpdate({ ...lc, retry_policy: { max_attempts: 3, backoff_strategy: 'fixed', initial_backoff_seconds: 5, retryable_categories: [] } });
              } else {
                onUpdate(clearIfEmpty({ ...lc, retry_policy: undefined }));
              }
            }}
          />
        </div>
        {!hasRetry && <HelpText>Off — inherits retry policy from template.</HelpText>}

        {hasRetry && (
          <>
            <FieldLabel label="Max Attempts">
              <Input
                type="number" min={1} max={10}
                value={lc.retry_policy!.max_attempts}
                onChange={(e) => onUpdate({ ...lc, retry_policy: { ...lc.retry_policy!, max_attempts: Math.max(1, Number(e.target.value)) } })}
                className="mt-1 h-7 text-xs"
              />
            </FieldLabel>

            <FieldLabel label="Backoff Strategy">
              <Select
                value={lc.retry_policy!.backoff_strategy}
                onValueChange={(v) => onUpdate({ ...lc, retry_policy: { ...lc.retry_policy!, backoff_strategy: v as RetryBackoffStrategy } })}
              >
                <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed</SelectItem>
                  <SelectItem value="exponential">Exponential</SelectItem>
                  <SelectItem value="linear">Linear</SelectItem>
                </SelectContent>
              </Select>
            </FieldLabel>

            <FieldLabel label="Initial Delay (seconds)">
              <Input
                type="number" min={0}
                value={lc.retry_policy!.initial_backoff_seconds}
                onChange={(e) => onUpdate({ ...lc, retry_policy: { ...lc.retry_policy!, initial_backoff_seconds: Math.max(0, Number(e.target.value)) } })}
                className="mt-1 h-7 text-xs"
              />
            </FieldLabel>
          </>
        )}
      </div>

      {/* Rework override */}
      <div className="space-y-2 p-3 rounded-md border border-border/50 bg-background">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold">Rework Override</h5>
          <Switch
            checked={hasRework}
            onCheckedChange={(v) => {
              if (v) {
                onUpdate({ ...lc, rework: { max_cycles: 3 } });
              } else {
                onUpdate(clearIfEmpty({ ...lc, rework: undefined }));
              }
            }}
          />
        </div>
        {!hasRework && <HelpText>Off — inherits rework policy from template.</HelpText>}

        {hasRework && (
          <FieldLabel label="Max Cycles">
            <Input
              type="number" min={1} max={20}
              value={lc.rework!.max_cycles}
              onChange={(e) => onUpdate({ ...lc, rework: { max_cycles: Math.max(1, Number(e.target.value)) } })}
              className="mt-1 h-7 text-xs"
            />
            <HelpText>Maximum revision rounds before the task fails.</HelpText>
          </FieldLabel>
        )}
      </div>
    </div>
  );
}
