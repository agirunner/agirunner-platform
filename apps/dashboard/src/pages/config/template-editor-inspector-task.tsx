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
import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '../../lib/api.js';
import type {
  TemplateTaskDefinition,
  LifecyclePolicy,
  OutputStateDeclaration,
  OutputStorageMode,
} from './template-editor-types.js';
import { OUTPUT_STORAGE_MODES } from './template-editor-types.js';
import {
  HelpText,
  FieldLabel,
  SectionHeader,
  CollapsibleSection,
  ExpandableTextarea,
  JsonObjectEditor,
  KeyValueEditor,
} from './template-editor-inspector-shared.js';
import { LifecycleInspector } from './template-editor-inspector-settings.js';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 60);
}

function extractInstructions(inputTemplate: Record<string, unknown> | undefined): string {
  if (!inputTemplate) return '';
  if (typeof inputTemplate.instructions === 'string') return inputTemplate.instructions;
  // Fallback: if the whole object is a single string value, use it
  const values = Object.values(inputTemplate);
  if (values.length === 1 && typeof values[0] === 'string') return values[0];
  // Otherwise show JSON for complex existing data
  if (Object.keys(inputTemplate).length > 0) return JSON.stringify(inputTemplate, null, 2);
  return '';
}

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
  const { data: roles } = useQuery({
    queryKey: ['role-definitions'],
    queryFn: () => dashboardApi.listRoleDefinitions(),
    staleTime: 60_000,
  });

  return (
    <div className="space-y-4">
      <SectionHeader title="Task" description="Configure this task's identity, inputs, and behavior." />

      {/* Identity */}
      <FieldLabel label="Title">
        <Input
          value={task.title_template}
          onChange={(e) => {
            const title = e.target.value;
            const newId = slugify(title);
            const idChanged = newId && !allTasks.some((t) => t.id !== task.id && t.id === newId);
            onUpdate({ ...task, title_template: title, ...(idChanged ? { id: newId } : {}) });
          }}
          className="mt-1"
        />
        <span className="text-[10px] font-mono text-muted mt-0.5 block">id: {task.id}</span>
      </FieldLabel>

      <FieldLabel label="Role">
        <Select value={task.role ?? ''} onValueChange={(v) => onUpdate({ ...task, role: v || undefined })}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Select role..." /></SelectTrigger>
          <SelectContent>
            {(roles ?? []).map((r: { name: string }) => (
              <SelectItem key={r.name} value={r.name}>{r.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <HelpText>Agent role assigned to execute this task. Defines system prompt, tools, and model.</HelpText>
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

      {/* Instructions */}
      <CollapsibleSection title="Instructions" description="What the agent should do when executing this task.">

      <FieldLabel label="Instructions">
        <ExpandableTextarea
          value={extractInstructions(task.input_template)}
          onChange={(v) => onUpdate({
            ...task,
            input_template: v.trim()
              ? { ...task.input_template, instructions: v }
              : undefined,
            context_template: undefined,
          })}
          placeholder="Describe what the agent should do. Use {{variable}} for template substitution."
          label="Task Instructions"
        />
        <HelpText>Plain text instructions passed to the agent. Supports {'{{variable}}'} substitution from template variables.</HelpText>
      </FieldLabel>

      </CollapsibleSection>

      {/* Output */}
      <CollapsibleSection title="Output" description="How this task's output is stored and surfaced." defaultOpen>

      {Object.entries(task.output_state ?? {}).map(([key, decl]) => {
        const d = decl as OutputStateDeclaration;
        const updateDecl = (patch: Partial<OutputStateDeclaration>) =>
          onUpdate({ ...task, output_state: { ...task.output_state, [key]: { ...d, ...patch } } });
        const renameKey = (newKey: string) => {
          if (!newKey || newKey === key) return;
          const entries = Object.entries(task.output_state ?? {});
          const rebuilt: Record<string, OutputStateDeclaration> = {};
          for (const [k, v] of entries) rebuilt[k === key ? newKey : k] = v as OutputStateDeclaration;
          onUpdate({ ...task, output_state: rebuilt });
        };
        const removeKey = () => {
          const next = { ...(task.output_state ?? {}) };
          delete next[key];
          onUpdate({ ...task, output_state: Object.keys(next).length ? next : undefined });
        };
        return (
          <div key={key} className="p-3 rounded-md border border-border/50 bg-background space-y-2">
            <div className="flex items-center gap-1">
              <Input
                value={key}
                onChange={(e) => renameKey(e.target.value.replace(/[^a-z0-9_]/gi, '_').toLowerCase())}
                className="flex-1 text-xs h-6 font-mono"
              />
              <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" aria-label={`Remove output ${key}`} onClick={removeKey}>
                <X className="h-3 w-3" />
              </Button>
            </div>
            <FieldLabel label="Storage Mode">
              <Select
                value={d.mode}
                onValueChange={(v) => updateDecl({ mode: v as OutputStorageMode, path: undefined, media_type: undefined })}
              >
                <SelectTrigger className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="inline">Inline — in DB</SelectItem>
                  <SelectItem value="artifact">Artifact — file storage</SelectItem>
                  <SelectItem value="git">Git — in repository</SelectItem>
                </SelectContent>
              </Select>
            </FieldLabel>

            <FieldLabel label="Summary">
              <Input
                value={d.summary ?? ''}
                onChange={(e) => updateDecl({ summary: e.target.value || undefined })}
                placeholder="Brief description of this output"
                className="mt-1 text-xs h-7"
              />
            </FieldLabel>
          </div>
        );
      })}
      <Button
        size="sm" variant="outline" className="w-full"
        onClick={() => {
          const existing = Object.keys(task.output_state ?? {});
          const key = existing.length === 0 ? 'result' : `result_${existing.length + 1}`;
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
        The output name is a key the agent must include in its result. Downstream tasks can reference it.
      </HelpText>

      </CollapsibleSection>

      {/* Environment */}
      <CollapsibleSection title="Environment" description="Pre-configures the workspace before the agent starts. Optional — agents can also set up their own environment via tools." defaultOpen>

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
          placeholder="alpine/git:2.47.2 (default)"
          className="mt-1 text-xs font-mono"
        />
        <HelpText>Advanced — override the task container image. Agents install their own tools at runtime, so the default is almost always correct.</HelpText>
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
          <span className="text-xs font-medium">Requires Output Review</span>
          <HelpText>Human must review the agent's output before this task is considered complete.</HelpText>
        </div>
        <Switch checked={task.requires_output_review ?? false} onCheckedChange={(v) => onUpdate({ ...task, requires_output_review: v })} />
      </div>

      {task.requires_output_review && (
        <FieldLabel label="Review Prompt">
          <ExpandableTextarea
            value={task.review_prompt ?? ''}
            onChange={(v) => onUpdate({ ...task, review_prompt: v.trim() || undefined })}
            placeholder="What should the reviewer look for? e.g. 'Verify the design covers all acceptance criteria.'"
            label="Review Prompt"
          />
          <HelpText>Shown to the human reviewer when evaluating this task's output. Supports {'{{variable}}'} substitution.</HelpText>
        </FieldLabel>
      )}

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

      <FieldLabel label="Role Config (JSON)">
        <JsonObjectEditor
          value={task.role_config}
          onChange={(v) => onUpdate({ ...task, role_config: v })}
          placeholder='{"model": "claude-opus", "temperature": 0.2}'
        />
        <HelpText>Per-task overrides for the assigned role (model, temperature, tools, etc.).</HelpText>
      </FieldLabel>

      </CollapsibleSection>

      {/* Task-level lifecycle override */}
      <CollapsibleSection title="Lifecycle Override" description="Override template-level lifecycle for this specific task." defaultOpen>
      <LifecycleInspector
        lifecycle={task.lifecycle}
        onUpdate={(lc) => onUpdate({ ...task, lifecycle: lc })}
        compact
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
