/**
 * Variables and Lifecycle inspector panels.
 */
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
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
import { HelpText, FieldLabel, SectionHeader } from './template-editor-inspector-shared.js';

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

function validateDefault(type: VariableType, raw: string): string | null {
  if (!raw) return null;
  switch (type) {
    case 'number':
      return isNaN(Number(raw)) ? 'Must be a valid number' : null;
    case 'boolean':
      return raw !== 'true' && raw !== 'false' ? 'Must be "true" or "false"' : null;
    case 'json':
      try { JSON.parse(raw); return null; } catch { return 'Must be valid JSON'; }
    default:
      return null;
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
            {(() => {
              const rawDefault = v.default !== undefined ? String(v.default) : '';
              const error = validateDefault(v.type, rawDefault);
              return (
                <>
                  <Input
                    value={rawDefault}
                    onChange={(e) => updateVar(i, { ...v, default: coerceDefault(v.type, e.target.value) })}
                    className={`mt-1 text-xs h-7 ${error ? 'border-red-500' : ''}`}
                    placeholder={v.type === 'boolean' ? 'true or false' : 'Leave blank for required variables'}
                  />
                  {error
                    ? <p className="text-[11px] text-red-500 mt-0.5">{error}</p>
                    : <HelpText>Used if not provided at launch. Value is coerced to match the type above.</HelpText>
                  }
                </>
              );
            })()}
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

// Known retryable error categories — must match classifyFailure() in task-lifecycle-service.
const RETRYABLE_CATEGORIES = ['timeout', 'transient_error', 'resource_unavailable', 'network_error'] as const;
const DEFAULT_RETRYABLE_CATEGORIES = [...RETRYABLE_CATEGORIES];

const DEFAULT_LIFECYCLE: LifecyclePolicy = {
  retry_policy: {
    max_attempts: 3,
    backoff_strategy: 'fixed',
    initial_backoff_seconds: 5,
    retryable_categories: DEFAULT_RETRYABLE_CATEGORIES,
  },
  rework: { max_cycles: 10 },
};

export function LifecycleInspector({
  lifecycle,
  onUpdate,
  compact = false,
  roles,
}: {
  lifecycle: LifecyclePolicy | undefined;
  onUpdate: (lc: LifecyclePolicy | undefined) => void;
  compact?: boolean;
  roles?: Array<{ name: string }>;
}) {
  // In compact (task-level) mode, undefined = "inherit from template".
  // Only explicitly set fields are overrides.
  return compact
    ? <TaskLifecycleOverride lifecycle={lifecycle} onUpdate={onUpdate} />
    : <TemplateLifecycleEditor lifecycle={lifecycle ?? DEFAULT_LIFECYCLE} onUpdate={onUpdate} roles={roles} />;
}

// ---------------------------------------------------------------------------
// Template-level: full lifecycle editor with all options + defaults
// ---------------------------------------------------------------------------

function RetryableCategoryCheckboxes({
  value,
  onChange,
}: {
  value: string[];
  onChange: (categories: string[]) => void;
}) {
  const selected = new Set(value);
  const toggle = (cat: string) => {
    const next = new Set(selected);
    if (next.has(cat)) next.delete(cat); else next.add(cat);
    onChange([...next]);
  };

  return (
    <div className="space-y-1.5 mt-1">
      {RETRYABLE_CATEGORIES.map((cat) => (
        <label key={cat} className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={selected.has(cat)}
            onChange={() => toggle(cat)}
            className="rounded border-border"
          />
          <span className="font-mono">{cat}</span>
        </label>
      ))}
    </div>
  );
}

function TemplateLifecycleEditor({
  lifecycle,
  onUpdate,
  roles,
}: {
  lifecycle: LifecyclePolicy;
  onUpdate: (lc: LifecyclePolicy | undefined) => void;
  roles?: Array<{ name: string }>;
}) {
  const lc = lifecycle;
  const retry = lc.retry_policy;
  const escalation = lc.escalation;
  const rework = lc.rework;
  const hasRetry = retry != null;
  const hasEscalation = escalation != null;
  const hasRework = rework != null;

  const updateRetry = (patch: Partial<RetryPolicy>) => {
    const current: RetryPolicy = retry ?? {
      max_attempts: 3,
      backoff_strategy: 'fixed',
      initial_backoff_seconds: 5,
      retryable_categories: DEFAULT_RETRYABLE_CATEGORIES,
    };
    onUpdate({ ...lc, retry_policy: { ...current, ...patch } });
  };

  const clearIfEmpty = (next: LifecyclePolicy): LifecyclePolicy | undefined => {
    if (!next.retry_policy && !next.escalation && !next.rework) return undefined;
    return next;
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Lifecycle"
        description="Controls retry, escalation, and rework for all tasks in this template. Tasks can override these settings individually."
      />

      {/* Retry */}
      <div className="space-y-3 p-3 rounded-md border border-border/50 bg-background">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold">Retry Policy</h5>
          <Switch
            checked={hasRetry}
            onCheckedChange={(v) => {
              if (v) {
                onUpdate({ ...lc, retry_policy: { max_attempts: 3, backoff_strategy: 'fixed', initial_backoff_seconds: 5, retryable_categories: DEFAULT_RETRYABLE_CATEGORIES } });
              } else {
                onUpdate(clearIfEmpty({ ...lc, retry_policy: undefined }));
              }
            }}
          />
        </div>
        {!hasRetry && <HelpText>Off — tasks will not be retried on failure.</HelpText>}

        {hasRetry && (
          <>
            <HelpText>When a task fails with a retryable error, retry before marking it failed.</HelpText>

            <FieldLabel label="Max Attempts">
              <Input
                type="number" min={1} max={10}
                value={retry.max_attempts}
                onChange={(e) => updateRetry({ max_attempts: Math.max(1, Number(e.target.value)) })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Total tries including the initial attempt (1-10).</HelpText>
            </FieldLabel>

            <FieldLabel label="Backoff Strategy">
              <Select
                value={retry.backoff_strategy}
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
                value={retry.initial_backoff_seconds}
                onChange={(e) => updateRetry({ initial_backoff_seconds: Math.max(0, Number(e.target.value)) })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Wait time before the first retry.</HelpText>
            </FieldLabel>

            <FieldLabel label="Retryable Error Categories">
              <RetryableCategoryCheckboxes
                value={retry.retryable_categories}
                onChange={(cats) => updateRetry({ retryable_categories: cats })}
              />
              <HelpText>Only retry on these error categories. Others fail immediately.</HelpText>
            </FieldLabel>
          </>
        )}
      </div>

      {/* Escalation */}
      <div className="space-y-3 p-3 rounded-md border border-border/50 bg-background">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold">Escalation</h5>
          <Switch
            checked={hasEscalation}
            onCheckedChange={(v) => {
              if (v) {
                onUpdate({ ...lc, escalation: { enabled: true, role: 'orchestrator', title_template: 'Escalation: {{task_title}}' } });
              } else {
                onUpdate(clearIfEmpty({ ...lc, escalation: undefined }));
              }
            }}
          />
        </div>
        {!hasEscalation && <HelpText>Off — agents cannot escalate tasks.</HelpText>}

        {hasEscalation && (
          <>
            <HelpText>When an agent calls the escalate tool, create an escalation task for the target role. The agent provides context and instructions via the tool call.</HelpText>

            <FieldLabel label="Target Role">
              <Select
                value={escalation.role}
                onValueChange={(v) => onUpdate({ ...lc, escalation: { ...escalation, role: v } })}
              >
                <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue placeholder="Select role..." /></SelectTrigger>
                <SelectContent>
                  {(roles ?? []).map((r) => (
                    <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <HelpText>Role that receives the escalation task.</HelpText>
            </FieldLabel>

            <FieldLabel label="Title Template">
              <Input
                value={escalation.title_template}
                onChange={(e) => onUpdate({ ...lc, escalation: { ...escalation, title_template: e.target.value } })}
                className="mt-1 text-xs h-7"
                placeholder="Escalation: {{task_title}}"
              />
              <HelpText>Title for the escalation task. Use {'{{task_title}}'} for the original task title.</HelpText>
            </FieldLabel>
          </>
        )}
      </div>

      {/* Rework */}
      <div className="space-y-3 p-3 rounded-md border border-border/50 bg-background">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold">Rework</h5>
          <Switch
            checked={hasRework}
            onCheckedChange={(v) => {
              if (v) {
                onUpdate({ ...lc, rework: { max_cycles: 10 } });
              } else {
                onUpdate(clearIfEmpty({ ...lc, rework: undefined }));
              }
            }}
          />
        </div>
        {!hasRework && <HelpText>Off — rejected tasks fail instead of being sent back for revision.</HelpText>}

        {hasRework && (
          <>
            <HelpText>When a reviewer rejects task output, send it back for revision.</HelpText>

            <FieldLabel label="Max Cycles">
              <Input
                type="number" min={1} max={20}
                value={rework.max_cycles}
                onChange={(e) => onUpdate({ ...lc, rework: { max_cycles: Math.max(1, Number(e.target.value)) } })}
                className="mt-1 h-7 text-xs"
              />
              <HelpText>Maximum revision rounds before the task fails (1-20).</HelpText>
            </FieldLabel>
          </>
        )}
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
      <HelpText>Only set fields you want to override. Empty sections inherit from the template-level lifecycle. Escalation is configured at the template level.</HelpText>

      {/* Retry override */}
      <div className="space-y-2 p-3 rounded-md border border-border/50 bg-background">
        <div className="flex items-center justify-between">
          <h5 className="text-xs font-semibold">Retry Override</h5>
          <Switch
            checked={hasRetry}
            onCheckedChange={(v) => {
              if (v) {
                onUpdate({ ...lc, retry_policy: { max_attempts: 3, backoff_strategy: 'fixed', initial_backoff_seconds: 5, retryable_categories: DEFAULT_RETRYABLE_CATEGORIES } });
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

            <FieldLabel label="Retryable Error Categories">
              <RetryableCategoryCheckboxes
                value={lc.retry_policy!.retryable_categories}
                onChange={(cats) => onUpdate({ ...lc, retry_policy: { ...lc.retry_policy!, retryable_categories: cats } })}
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
