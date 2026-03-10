/**
 * Task inspector panel — all task-level fields including P0 missing ones.
 */
import { X, Plus, Copy } from 'lucide-react';
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
  TemplateTaskDefinition,
  LifecyclePolicy,
  TaskType,
  OutputStateDeclaration,
  OutputStorageMode,
} from './template-editor-types.js';
import { TASK_TYPES, OUTPUT_STORAGE_MODES } from './template-editor-types.js';
import {
  HelpText,
  FieldLabel,
  SectionHeader,
  CollapsibleSection,
  JsonObjectEditor,
  ChipArrayEditor,
  KeyValueEditor,
} from './template-editor-inspector-shared.js';
import { LifecycleInspector } from './template-editor-inspector-settings.js';

// ---------------------------------------------------------------------------
// Task inspector
// ---------------------------------------------------------------------------

export function TaskInspector({
  task,
  allTasks,
  onUpdate,
  onDelete,
  onDuplicate,
}: {
  task: TemplateTaskDefinition;
  allTasks: TemplateTaskDefinition[];
  onUpdate: (updated: TemplateTaskDefinition) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const otherTasks = allTasks.filter((t) => t.id !== task.id);

  return (
    <div className="space-y-4">
      <SectionHeader title="Task" description="Configure this task's identity, inputs, and behavior." />

      {/* Identity */}
      <FieldLabel label="ID">
        <Input
          value={task.id}
          onChange={(e) => onUpdate({ ...task, id: e.target.value })}
          className="mt-1 font-mono text-xs"
        />
        <HelpText>
          Unique identifier. Changing this updates all dependency references automatically.
        </HelpText>
      </FieldLabel>

      <FieldLabel label="Title">
        <Input
          value={task.title_template}
          onChange={(e) => onUpdate({ ...task, title_template: e.target.value })}
          className="mt-1"
        />
        <HelpText>Display name. Supports {'{{variable}}'} substitution from template variables.</HelpText>
      </FieldLabel>

      <FieldLabel label="Type">
        <Select value={task.type} onValueChange={(v) => onUpdate({ ...task, type: v as TaskType })}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {TASK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <HelpText>Determines which agent capabilities are used: analysis, code, review, test, docs, orchestration, or custom.</HelpText>
      </FieldLabel>

      <FieldLabel label="Role">
        <Input
          value={task.role ?? ''}
          onChange={(e) => onUpdate({ ...task, role: e.target.value || undefined })}
          placeholder="e.g. developer"
          className="mt-1"
        />
        <HelpText>Agent role assigned to execute this task (e.g. developer, architect, reviewer).</HelpText>
      </FieldLabel>

      {/* Dependencies */}
      <CollapsibleSection title="Dependencies" description="Tasks that must complete before this one starts.">
      <div className="space-y-1">
        {(task.depends_on ?? []).map((dep, i) => (
          <div key={dep} className="flex items-center gap-1">
            <Badge variant="outline" className="text-[10px] flex-1 justify-start font-mono">{dep}</Badge>
            <Button
              size="icon" variant="ghost" className="h-6 w-6"
              onClick={() => onUpdate({ ...task, depends_on: (task.depends_on ?? []).filter((_, j) => j !== i) })}
              aria-label={`Remove dependency ${dep}`}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ))}
        {otherTasks.length > 0 && (
          <Select
            value=""
            onValueChange={(v) => onUpdate({ ...task, depends_on: [...new Set([...(task.depends_on ?? []), v])] })}
          >
            <SelectTrigger className="mt-1 text-xs h-8"><SelectValue placeholder="+ Add dependency" /></SelectTrigger>
            <SelectContent>
              {otherTasks
                .filter((t) => !(task.depends_on ?? []).includes(t.id))
                .map((t) => <SelectItem key={t.id} value={t.id}>{t.title_template || t.id}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      </CollapsibleSection>

      {/* Input & Context */}
      <CollapsibleSection title="Input & Context" description="Data injected into the agent when this task runs.">

      <FieldLabel label="Input Template (JSON)">
        <JsonObjectEditor
          value={task.input_template}
          onChange={(v) => onUpdate({ ...task, input_template: v })}
          placeholder='{"goal": "{{goal}}"}'
        />
        <HelpText>JSON object passed to the agent. Use {'{{variable}}'} for template variable substitution.</HelpText>
      </FieldLabel>

      <FieldLabel label="Context Template (JSON)">
        <JsonObjectEditor
          value={task.context_template}
          onChange={(v) => onUpdate({ ...task, context_template: v })}
          placeholder='{"repo": "{{repository_url}}"}'
        />
        <HelpText>Additional context injected alongside the input. Useful for repo URLs, branch info, etc.</HelpText>
      </FieldLabel>

      </CollapsibleSection>

      {/* Output */}
      <CollapsibleSection title="Output" description="How this task's output is stored and surfaced." defaultOpen={false}>

      {Object.entries(task.output_state ?? {}).map(([key, decl]) => (
        <div key={key} className="p-3 rounded-md border border-border/50 bg-background space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono font-medium">{key}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" aria-label={`Remove output ${key}`} onClick={() => {
              const next = { ...(task.output_state ?? {}) };
              delete next[key];
              onUpdate({ ...task, output_state: Object.keys(next).length ? next : undefined });
            }}>
              <X className="h-3 w-3" />
            </Button>
          </div>
          <FieldLabel label="Storage Mode">
            <Select
              value={(decl as OutputStateDeclaration).mode}
              onValueChange={(v) => onUpdate({
                ...task,
                output_state: { ...task.output_state, [key]: { ...(decl as OutputStateDeclaration), mode: v as OutputStorageMode } },
              })}
            >
              <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {OUTPUT_STORAGE_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m === 'inline' ? 'inline — in task record' :
                     m === 'artifact' ? 'artifact — in artifact storage' :
                     m === 'git' ? 'git — committed to repository' :
                     'diff — as diff patch'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FieldLabel>
          <FieldLabel label="Path">
            <Input
              value={(decl as OutputStateDeclaration).path ?? ''}
              onChange={(e) => onUpdate({
                ...task,
                output_state: { ...task.output_state, [key]: { ...(decl as OutputStateDeclaration), path: e.target.value || undefined } },
              })}
              placeholder="e.g. src/output/"
              className="mt-1 text-xs h-7 font-mono"
            />
          </FieldLabel>
          <FieldLabel label="Media Type">
            <Input
              value={(decl as OutputStateDeclaration).media_type ?? ''}
              onChange={(e) => onUpdate({
                ...task,
                output_state: { ...task.output_state, [key]: { ...(decl as OutputStateDeclaration), media_type: e.target.value || undefined } },
              })}
              placeholder="e.g. application/json"
              className="mt-1 text-xs h-7"
            />
          </FieldLabel>
          <FieldLabel label="Summary">
            <Input
              value={(decl as OutputStateDeclaration).summary ?? ''}
              onChange={(e) => onUpdate({
                ...task,
                output_state: { ...task.output_state, [key]: { ...(decl as OutputStateDeclaration), summary: e.target.value || undefined } },
              })}
              placeholder="Brief description of this output"
              className="mt-1 text-xs h-7"
            />
          </FieldLabel>
        </div>
      ))}
      <Button
        size="sm" variant="outline" className="w-full"
        onClick={() => {
          const key = `output_${Object.keys(task.output_state ?? {}).length + 1}`;
          onUpdate({
            ...task,
            output_state: { ...(task.output_state ?? {}), [key]: { mode: 'inline' as OutputStorageMode } },
          });
        }}
      >
        <Plus className="h-3.5 w-3.5" />
        Add Output
      </Button>
      <HelpText>
        Each output declares a storage mode, optional path, media type, and summary.
      </HelpText>

      </CollapsibleSection>

      {/* Capabilities */}
      <CollapsibleSection title="Capabilities" description="Required agent capabilities and role-specific configuration." defaultOpen={false}>

      <FieldLabel label="Required Capabilities">
        <ChipArrayEditor
          value={task.capabilities_required ?? []}
          onChange={(v) => onUpdate({ ...task, capabilities_required: v.length ? v : undefined })}
          placeholder="e.g. shell_exec, git, docker"
        />
        <HelpText>Agent must have all listed capabilities to execute this task.</HelpText>
      </FieldLabel>

      <FieldLabel label="Role Config (JSON)">
        <JsonObjectEditor
          value={task.role_config}
          onChange={(v) => onUpdate({ ...task, role_config: v })}
          placeholder='{"model": "claude-opus", "temperature": 0.2}'
        />
        <HelpText>Per-task overrides for the assigned role (model, temperature, tools, etc.).</HelpText>
      </FieldLabel>

      </CollapsibleSection>

      {/* Environment */}
      <CollapsibleSection title="Environment" description="Key-value pairs injected into the task container." defaultOpen={false}>

      <FieldLabel label="Repository URL">
        <Input
          value={String((task.environment as Record<string, string> | undefined)?.REPOSITORY_URL ?? '')}
          onChange={(e) => {
            const env = { ...(task.environment ?? {}) } as Record<string, unknown>;
            if (e.target.value) env.REPOSITORY_URL = e.target.value; else delete env.REPOSITORY_URL;
            onUpdate({ ...task, environment: Object.keys(env).length ? env : undefined });
          }}
          placeholder="https://github.com/org/repo.git"
          className="mt-1 text-xs font-mono"
        />
        <HelpText>Git repository to clone into the task container. Supports {'{{variable}}'} substitution.</HelpText>
      </FieldLabel>

      <FieldLabel label="Branch">
        <Input
          value={String((task.environment as Record<string, string> | undefined)?.BRANCH ?? '')}
          onChange={(e) => {
            const env = { ...(task.environment ?? {}) } as Record<string, unknown>;
            if (e.target.value) env.BRANCH = e.target.value; else delete env.BRANCH;
            onUpdate({ ...task, environment: Object.keys(env).length ? env : undefined });
          }}
          placeholder="main"
          className="mt-1 text-xs font-mono"
        />
        <HelpText>Branch to check out after cloning.</HelpText>
      </FieldLabel>

      <FieldLabel label="Container Image">
        <Input
          value={String((task.environment as Record<string, string> | undefined)?.IMAGE ?? '')}
          onChange={(e) => {
            const env = { ...(task.environment ?? {}) } as Record<string, unknown>;
            if (e.target.value) env.IMAGE = e.target.value; else delete env.IMAGE;
            onUpdate({ ...task, environment: Object.keys(env).length ? env : undefined });
          }}
          placeholder="Default (alpine/git)"
          className="mt-1 text-xs font-mono"
        />
        <HelpText>Override the container image for this task. Leave blank to use the default.</HelpText>
      </FieldLabel>

      <FieldLabel label="Setup Commands">
        <Input
          value={String((task.environment as Record<string, string> | undefined)?.SETUP_COMMANDS ?? '')}
          onChange={(e) => {
            const env = { ...(task.environment ?? {}) } as Record<string, unknown>;
            if (e.target.value) env.SETUP_COMMANDS = e.target.value; else delete env.SETUP_COMMANDS;
            onUpdate({ ...task, environment: Object.keys(env).length ? env : undefined });
          }}
          placeholder="e.g. npm install, pip install -r requirements.txt"
          className="mt-1 text-xs font-mono"
        />
        <HelpText>Shell commands run after clone, before the agent starts.</HelpText>
      </FieldLabel>

      <div className="pt-2 border-t border-border/30">
        <span className="text-[10px] text-muted uppercase tracking-wide font-medium">Additional Variables</span>
      </div>
      <KeyValueEditor
        entries={(() => {
          const env = { ...(task.environment ?? {}) } as Record<string, unknown>;
          delete env.REPOSITORY_URL; delete env.BRANCH; delete env.IMAGE; delete env.SETUP_COMMANDS;
          return env;
        })()}
        onChange={(extra) => {
          const structured: Record<string, unknown> = {};
          const curr = (task.environment ?? {}) as Record<string, unknown>;
          if (curr.REPOSITORY_URL) structured.REPOSITORY_URL = curr.REPOSITORY_URL;
          if (curr.BRANCH) structured.BRANCH = curr.BRANCH;
          if (curr.IMAGE) structured.IMAGE = curr.IMAGE;
          if (curr.SETUP_COMMANDS) structured.SETUP_COMMANDS = curr.SETUP_COMMANDS;
          const merged = { ...structured, ...extra };
          onUpdate({ ...task, environment: Object.keys(merged).length ? merged : undefined });
        }}
        keyPlaceholder="VAR"
      />

      </CollapsibleSection>

      {/* Execution */}
      <CollapsibleSection title="Execution">

      <FieldLabel label="Timeout (minutes)">
        <Input
          type="number" min={0}
          value={task.timeout_minutes ?? ''}
          onChange={(e) => onUpdate({ ...task, timeout_minutes: e.target.value ? Math.max(0, Number(e.target.value)) : undefined })}
          className="mt-1" placeholder="No limit"
        />
        <HelpText>Maximum time this task can run before being killed. 0 = no limit.</HelpText>
      </FieldLabel>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-medium">Requires Approval</span>
          <HelpText>Human must approve before this task starts.</HelpText>
        </div>
        <Switch checked={task.requires_approval ?? false} onCheckedChange={(v) => onUpdate({ ...task, requires_approval: v })} />
      </div>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-medium">Auto Retry</span>
          <HelpText>Automatically retry on transient failures.</HelpText>
        </div>
        <Switch checked={task.auto_retry ?? false} onCheckedChange={(v) => onUpdate({ ...task, auto_retry: v })} />
      </div>

      {task.auto_retry && (
        <FieldLabel label="Max Retries">
          <Input
            type="number" min={1} max={10}
            value={task.max_retries ?? 3}
            onChange={(e) => onUpdate({ ...task, max_retries: Math.max(1, Number(e.target.value)) })}
            className="mt-1"
          />
          <HelpText>Number of retry attempts after the initial failure (1-10).</HelpText>
        </FieldLabel>
      )}

      </CollapsibleSection>

      {/* Task-level lifecycle override */}
      <CollapsibleSection title="Lifecycle Override" description="Override template-level lifecycle for this specific task." defaultOpen={false}>
      <LifecycleInspector
        lifecycle={task.lifecycle}
        onUpdate={(lc) => onUpdate({ ...task, lifecycle: lc })}
        compact
      />

      </CollapsibleSection>

      {/* Task metadata */}
      <CollapsibleSection title="Metadata" description="Arbitrary key-value data attached to this task." defaultOpen={false}>
      <JsonObjectEditor
        value={task.metadata}
        onChange={(v) => onUpdate({ ...task, metadata: v })}
        placeholder='{"priority": "high", "team": "backend"}'
      />

      </CollapsibleSection>

      {/* Actions */}
      <div className="pt-4 border-t border-border/50 space-y-2">
        <Button variant="outline" size="sm" onClick={onDuplicate} className="w-full">
          <Copy className="h-3.5 w-3.5" />
          Duplicate Task
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete} className="w-full">
          <Trash2 className="h-3.5 w-3.5" />
          Delete Task
        </Button>
      </div>
    </div>
  );
}
