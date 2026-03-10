/**
 * Template inspector — main dispatcher panel.
 * Delegates to focused sub-panels based on the selected item.
 */
import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Plus, Rocket } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Textarea } from '../../components/ui/textarea.js';
import { Switch } from '../../components/ui/switch.js';
import type {
  TemplateEditorState,
  TemplateSchema,
  TemplateTaskDefinition,
  WorkflowPhaseDefinition,
  WorkflowGateType,
} from './template-editor-types.js';
import { GATE_TYPES, createEmptyTask, createEmptyPhase } from './template-editor-types.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Trash2 } from 'lucide-react';
import type { SelectedItem } from './template-editor-page.js';
import { HelpText, FieldLabel, SectionHeader } from './template-editor-inspector-shared.js';
import { listTemplates } from './template-editor-api.js';
import { TaskInspector } from './template-editor-inspector-task.js';
import { VariablesInspector, LifecycleInspector } from './template-editor-inspector-settings.js';
import { RuntimeInspector } from './template-editor-inspector-runtime.js';
import {
  ConfigPolicyInspector,
  ConfigInspector,
  DefaultInstructionConfigInspector,
  MetadataInspector,
} from './template-editor-inspector-config.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InspectorProps {
  state: TemplateEditorState;
  selected: SelectedItem;
  onChange: (state: TemplateEditorState) => void;
  onSchemaChange: (updater: (schema: TemplateSchema) => TemplateSchema) => void;
  onSelect: (item: SelectedItem) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Template overview
// ---------------------------------------------------------------------------

function TemplateOverviewInspector({
  state,
  onChange,
  onSchemaChange,
}: {
  state: TemplateEditorState;
  onChange: (state: TemplateEditorState) => void;
  onSchemaChange: (updater: (schema: TemplateSchema) => TemplateSchema) => void;
}) {
  const navigate = useNavigate();
  const [slugError, setSlugError] = useState<string | null>(null);
  const checkSlugUniqueness = useCallback(async () => {
    if (!state.slug.trim()) return;
    try {
      const result = await listTemplates({ slug: state.slug, per_page: 1 });
      const conflict = result.data.find((t) => t.id !== state.id);
      setSlugError(conflict ? `Slug "${state.slug}" is already in use` : null);
    } catch {
      // Network error — skip check
    }
  }, [state.slug, state.id]);

  return (
    <div className="space-y-4">
      <SectionHeader title="Template" description="Identity and metadata for this template." />

      <FieldLabel label="Name">
        <Input
          value={state.name}
          onChange={(e) => onChange({ ...state, name: e.target.value })}
          placeholder="e.g. Feature Build"
          maxLength={255}
          className="mt-1"
        />
        <HelpText>Human-readable name shown in the library and when launching (max 255 chars).</HelpText>
      </FieldLabel>

      <FieldLabel label="Slug">
        <Input
          value={state.slug}
          onChange={(e) => { onChange({ ...state, slug: e.target.value }); setSlugError(null); }}
          onBlur={checkSlugUniqueness}
          placeholder="e.g. feature-build"
          maxLength={255}
          className={`mt-1 ${slugError ? 'border-red-500' : ''}`}
        />
        {slugError && <p className="text-[10px] text-red-500 mt-0.5">{slugError}</p>}
        <HelpText>URL-friendly identifier (lowercase, hyphens, no spaces, max 255 chars). Checked for uniqueness.</HelpText>
      </FieldLabel>

      <FieldLabel label="Description">
        <Textarea
          value={state.description}
          onChange={(e) => onChange({ ...state, description: e.target.value })}
          placeholder="What does this template do?"
          rows={3}
          maxLength={2000}
          className="mt-1"
        />
        <div className="flex justify-between">
          <HelpText>Shown on the template card and in the launch flow.</HelpText>
          <span className="text-[10px] text-muted">{state.description.length}/2000</span>
        </div>
      </FieldLabel>

      <div className="flex items-center justify-between py-2">
        <div>
          <span className="text-xs font-medium">Published</span>
          <HelpText>Published templates can launch workflows and provision warm containers.</HelpText>
        </div>
        <Switch
          checked={state.is_published}
          onCheckedChange={(checked) => onChange({ ...state, is_published: checked })}
        />
      </div>

      {/* Quick actions */}
      <div className="pt-2 border-t border-border/50 space-y-1.5">
        <span className="text-[10px] text-muted uppercase tracking-wide font-medium">Quick Actions</span>
        <Button
          size="sm" variant="outline" className="w-full justify-start text-xs"
          onClick={() => {
            const phases = state.schema.workflow?.phases ?? [];
            const newPhase = createEmptyPhase(phases.length);
            onSchemaChange((s) => ({
              ...s,
              workflow: { ...s.workflow, phases: [...(s.workflow?.phases ?? []), newPhase] },
            }));
          }}
        >
          <Plus className="h-3 w-3" />
          Add Phase
        </Button>
        <Button
          size="sm" variant="outline" className="w-full justify-start text-xs"
          onClick={() => {
            const blob = new Blob([JSON.stringify(state.schema, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${state.slug || 'template'}-v${state.version}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          }}
        >
          Export JSON
        </Button>
        {state.is_published && (
          <Button
            size="sm" variant="outline" className="w-full justify-start text-xs"
            onClick={() => navigate(`/config/templates/launch?template=${state.id}`)}
          >
            <Rocket className="h-3 w-3" />
            Launch Workflow
          </Button>
        )}
      </div>

      <div className="text-xs text-muted space-y-1 pt-2 border-t border-border/50">
        <p>Version: {state.version}</p>
        <p>Built-in: {state.is_built_in ? 'Yes' : 'No'}</p>
        {state.created_at && <p>Created: {new Date(state.created_at).toLocaleString()}</p>}
        {state.updated_at && <p>Updated: {new Date(state.updated_at).toLocaleString()}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phase inspector
// ---------------------------------------------------------------------------

function PhaseInspector({
  phase,
  allTasks,
  onUpdate,
  onDelete,
  onSelectTask,
  onAddTask,
}: {
  phase: WorkflowPhaseDefinition;
  allTasks: TemplateTaskDefinition[];
  onUpdate: (updated: WorkflowPhaseDefinition) => void;
  onDelete: () => void;
  onSelectTask: (taskId: string) => void;
  onAddTask: (phaseName: string) => void;
}) {
  const phaseTasks = allTasks.filter((t) => phase.tasks.includes(t.id));
  return (
    <div className="space-y-4">
      <SectionHeader title="Phase" description="A group of tasks that execute together." />

      <FieldLabel label="Name">
        <Input
          value={phase.name}
          onChange={(e) => onUpdate({ ...phase, name: e.target.value })}
          className="mt-1"
        />
        <HelpText>Display name for this phase (e.g. &quot;Planning&quot;, &quot;Implementation&quot;).</HelpText>
      </FieldLabel>

      <FieldLabel label="Gate Type">
        <Select value={phase.gate} onValueChange={(v) => onUpdate({ ...phase, gate: v as WorkflowGateType })}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None — no gate, tasks start immediately</SelectItem>
            <SelectItem value="all_complete">All Complete — wait for all previous phase tasks</SelectItem>
            <SelectItem value="manual">Manual — requires human approval to proceed</SelectItem>
            <SelectItem value="auto">Auto — system decides based on task results</SelectItem>
          </SelectContent>
        </Select>
        <HelpText>Controls when tasks in this phase are allowed to start.</HelpText>
      </FieldLabel>

      <div className="flex items-center justify-between">
        <div>
          <span className="text-xs font-medium">Parallel Execution</span>
          <HelpText>When on, tasks in this phase run concurrently. When off, they run sequentially.</HelpText>
        </div>
        <Switch checked={phase.parallel} onCheckedChange={(v) => onUpdate({ ...phase, parallel: v })} />
      </div>

      <div className="pt-2 space-y-1">
        <span className="text-xs font-medium">Tasks ({phaseTasks.length})</span>
        {phaseTasks.map((t) => (
          <button
            key={t.id}
            type="button"
            className="w-full text-left px-2 py-1 text-xs rounded-md hover:bg-border/30 truncate"
            onClick={() => onSelectTask(t.id)}
          >
            {t.title_template || t.id}
          </button>
        ))}
        <button
          type="button"
          className="w-full text-left px-2 py-1 text-xs text-muted hover:text-foreground rounded-md flex items-center gap-1"
          onClick={() => onAddTask(phase.name)}
        >
          <Plus className="h-3 w-3" />
          Add Task
        </button>
      </div>

      <div className="pt-4 border-t border-border/50">
        <Button variant="destructive" size="sm" onClick={onDelete} className="w-full">
          <Trash2 className="h-3.5 w-3.5" />
          Delete Phase
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main inspector
// ---------------------------------------------------------------------------

export function TemplateInspector({
  state,
  selected,
  onChange,
  onSchemaChange,
  onSelect,
  onClose,
}: InspectorProps): JSX.Element {
  const tasks = state.schema.tasks ?? [];
  const phases = state.schema.workflow?.phases ?? [];

  // Task update with automatic reference migration on ID change
  const handleUpdateTask = useCallback(
    (originalId: string, updated: TemplateTaskDefinition) => {
      const idChanged = originalId !== updated.id;
      onSchemaChange((s) => ({
        ...s,
        tasks: (s.tasks ?? []).map((t) => {
          if (t.id === originalId) return updated;
          if (idChanged && t.depends_on?.includes(originalId)) {
            return { ...t, depends_on: t.depends_on.map((d) => (d === originalId ? updated.id : d)) };
          }
          return t;
        }),
        workflow: idChanged
          ? {
              ...s.workflow,
              phases: (s.workflow?.phases ?? []).map((p) => ({
                ...p,
                tasks: p.tasks.map((id) => (id === originalId ? updated.id : id)),
              })),
            }
          : s.workflow,
      }));
      if (idChanged) {
        onSelect({ kind: 'task', taskId: updated.id });
      }
    },
    [onSchemaChange, onSelect],
  );

  const handleDuplicateTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const newId = `${task.id}_copy`;
      const clone = { ...structuredClone(task), id: newId };
      // Find which phase the original is in
      const phase = phases.find((p) => p.tasks.includes(taskId));
      onSchemaChange((s) => ({
        ...s,
        tasks: [...(s.tasks ?? []), clone],
        workflow: phase
          ? {
              ...s.workflow,
              phases: (s.workflow?.phases ?? []).map((p) =>
                p.name === phase.name ? { ...p, tasks: [...p.tasks, newId] } : p,
              ),
            }
          : s.workflow,
      }));
      onSelect({ kind: 'task', taskId: newId });
    },
    [tasks, phases, onSchemaChange, onSelect],
  );

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      onSchemaChange((s) => ({
        ...s,
        tasks: (s.tasks ?? []).filter((t) => t.id !== taskId),
        workflow: {
          ...s.workflow,
          phases: (s.workflow?.phases ?? []).map((p) => ({
            ...p,
            tasks: p.tasks.filter((id) => id !== taskId),
          })),
        },
      }));
      onSelect({ kind: 'template' });
    },
    [onSchemaChange, onSelect],
  );

  // Phase update with name tracking
  const handleUpdatePhase = useCallback(
    (originalName: string, updated: WorkflowPhaseDefinition) => {
      onSchemaChange((s) => ({
        ...s,
        workflow: {
          ...s.workflow,
          phases: (s.workflow?.phases ?? []).map((p) => (p.name === originalName ? updated : p)),
        },
      }));
      if (originalName !== updated.name) {
        onSelect({ kind: 'phase', phaseName: updated.name });
      }
    },
    [onSchemaChange, onSelect],
  );

  const handleDeletePhase = useCallback(
    (phaseName: string) => {
      const phase = phases.find((p) => p.name === phaseName);
      const phaseTaskIds = new Set(phase?.tasks ?? []);
      onSchemaChange((s) => ({
        ...s,
        tasks: (s.tasks ?? []).filter((t) => !phaseTaskIds.has(t.id)),
        workflow: {
          ...s.workflow,
          phases: (s.workflow?.phases ?? []).filter((p) => p.name !== phaseName),
        },
      }));
      onSelect({ kind: 'template' });
    },
    [phases, onSchemaChange, onSelect],
  );

  let content: React.ReactNode;

  switch (selected.kind) {
    case 'template':
    case 'none':
      content = <TemplateOverviewInspector state={state} onChange={onChange} onSchemaChange={onSchemaChange} />;
      break;
    case 'task': {
      const task = tasks.find((t) => t.id === selected.taskId);
      content = task ? (
        <TaskInspector
          task={task}
          allTasks={tasks}
          onUpdate={(updated) => handleUpdateTask(task.id, updated)}
          onDelete={() => handleDeleteTask(task.id)}
          onDuplicate={() => handleDuplicateTask(task.id)}
        />
      ) : (
        <p className="text-xs text-muted p-4">Task not found.</p>
      );
      break;
    }
    case 'phase': {
      const phase = phases.find((p) => p.name === selected.phaseName);
      content = phase ? (
        <PhaseInspector
          phase={phase}
          allTasks={tasks}
          onUpdate={(updated) => handleUpdatePhase(phase.name, updated)}
          onDelete={() => handleDeletePhase(phase.name)}
          onSelectTask={(taskId) => onSelect({ kind: 'task', taskId })}
          onAddTask={(phaseName) => {
            const phaseIndex = phases.findIndex((p) => p.name === phaseName);
            if (phaseIndex < 0) return;
            const newTask = createEmptyTask(phaseIndex, phase.tasks.length);
            onSchemaChange((s) => ({
              ...s,
              tasks: [...(s.tasks ?? []), newTask],
              workflow: {
                ...s.workflow,
                phases: (s.workflow?.phases ?? []).map((p) =>
                  p.name === phaseName ? { ...p, tasks: [...p.tasks, newTask.id] } : p,
                ),
              },
            }));
            onSelect({ kind: 'task', taskId: newTask.id });
          }}
        />
      ) : (
        <p className="text-xs text-muted p-4">Phase not found.</p>
      );
      break;
    }
    case 'variables':
      content = (
        <VariablesInspector
          variables={state.schema.variables ?? []}
          onUpdate={(vars) => onSchemaChange((s) => ({ ...s, variables: vars }))}
        />
      );
      break;
    case 'lifecycle':
      content = (
        <LifecycleInspector
          lifecycle={state.schema.lifecycle}
          onUpdate={(lc) => onSchemaChange((s) => ({ ...s, lifecycle: lc }))}
        />
      );
      break;
    case 'runtime':
      content = (
        <RuntimeInspector
          runtime={state.schema.runtime}
          taskContainer={state.schema.task_container}
          isPublished={state.is_published}
          onUpdateRuntime={(rt) => onSchemaChange((s) => ({ ...s, runtime: rt }))}
          onUpdateTaskContainer={(tc) => onSchemaChange((s) => ({ ...s, task_container: tc }))}
        />
      );
      break;
    case 'config-policy':
      content = (
        <ConfigPolicyInspector
          configPolicy={state.schema.config_policy}
          onUpdate={(policy) => onSchemaChange((s) => ({ ...s, config_policy: policy }))}
        />
      );
      break;
    case 'config':
      content = (
        <ConfigInspector
          config={state.schema.config}
          onUpdate={(c) => onSchemaChange((s) => ({ ...s, config: c }))}
        />
      );
      break;
    case 'default-instruction-config':
      content = (
        <DefaultInstructionConfigInspector
          instructionConfig={state.schema.default_instruction_config}
          onUpdate={(c) => onSchemaChange((s) => ({ ...s, default_instruction_config: c }))}
        />
      );
      break;
    case 'metadata':
      content = (
        <MetadataInspector
          metadata={state.schema.metadata}
          onUpdate={(m) => onSchemaChange((s) => ({ ...s, metadata: m }))}
        />
      );
      break;
    default:
      content = <p className="text-xs text-muted p-4">Select an item to inspect.</p>;
  }

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-surface overflow-y-auto hidden md:block">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-muted uppercase tracking-wide">Inspector</span>
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={onClose} aria-label="Close inspector">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="p-3">{content}</div>
    </aside>
  );
}
