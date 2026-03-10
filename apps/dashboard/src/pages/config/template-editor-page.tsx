import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  Save,
  Upload,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  Menu,
  Undo2,
  Redo2,
} from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import { toast } from '../../lib/toast.js';
import type {
  TemplateEditorState,
  TemplateSchema,
  TemplateTaskDefinition,
} from './template-editor-types.js';
import {
  createEmptyTemplate,
  createEmptyPhase,
  createEmptyTask,
} from './template-editor-types.js';
import {
  fetchTemplate,
  saveTemplate,
  publishTemplate,
  createTemplate,
} from './template-editor-api.js';
import { TemplateCanvas } from './template-editor-canvas.js';
import { TemplateInspector } from './template-editor-inspector.js';
import { OutlinePanel } from './template-editor-outline.js';

// ---------------------------------------------------------------------------
// Selection model
// ---------------------------------------------------------------------------

export type SelectedItem =
  | { kind: 'none' }
  | { kind: 'template' }
  | { kind: 'phase'; phaseName: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'variables' }
  | { kind: 'lifecycle' }
  | { kind: 'runtime' }
  | { kind: 'config-policy' }
  | { kind: 'config' }
  | { kind: 'default-instruction-config' }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationIssue {
  level: 'error' | 'warning';
  message: string;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function detectCycles(tasks: TemplateTaskDefinition[]): string | null {
  const adj = new Map<string, string[]>();
  for (const t of tasks) adj.set(t.id, t.depends_on ?? []);

  const visited = new Set<string>();
  const inPath = new Set<string>();

  function visit(id: string): boolean {
    if (inPath.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inPath.add(id);
    for (const dep of adj.get(id) ?? []) {
      if (visit(dep)) return true;
    }
    inPath.delete(id);
    return false;
  }

  for (const t of tasks) {
    if (visit(t.id)) return t.id;
  }
  return null;
}

function validateTemplate(state: TemplateEditorState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const schema = state.schema;

  if (!state.name.trim()) {
    issues.push({ level: 'error', message: 'Template name is required' });
  } else if (state.name.length > 255) {
    issues.push({ level: 'error', message: 'Template name must be 255 characters or less' });
  }
  if (!state.slug.trim()) {
    issues.push({ level: 'error', message: 'Template slug is required' });
  } else if (state.slug.length > 255) {
    issues.push({ level: 'error', message: 'Slug must be 255 characters or less' });
  } else if (!SLUG_PATTERN.test(state.slug)) {
    issues.push({ level: 'error', message: 'Slug must be lowercase letters, numbers, and hyphens (e.g. my-template)' });
  }
  if (state.description.length > 2000) {
    issues.push({ level: 'error', message: 'Description must be 2000 characters or less' });
  }

  if (!schema.tasks || schema.tasks.length === 0) {
    issues.push({ level: 'error', message: 'Template has no tasks' });
  }

  const taskIds = new Set<string>();
  for (const task of schema.tasks ?? []) {
    if (taskIds.has(task.id)) {
      issues.push({ level: 'error', message: `Duplicate task ID: ${task.id}` });
    }
    taskIds.add(task.id);
    if (task.timeout_minutes !== undefined && task.timeout_minutes < 0) {
      issues.push({ level: 'error', message: `Negative timeout on task ${task.id}` });
    }
    if (task.max_retries !== undefined && task.max_retries < 1) {
      issues.push({ level: 'error', message: `Max retries must be >= 1 on task ${task.id}` });
    }
    const taskInstructions = typeof task.input_template?.instructions === 'string'
      ? task.input_template.instructions.trim()
      : '';
    if (!taskInstructions) {
      issues.push({ level: 'error', message: `Task "${task.title_template || task.id}" has no instructions` });
    }
    for (const dep of task.depends_on ?? []) {
      if (dep === task.id) {
        issues.push({ level: 'error', message: `Task ${task.id} depends on itself` });
      } else if (!taskIds.has(dep) && !(schema.tasks ?? []).some((t) => t.id === dep)) {
        issues.push({ level: 'error', message: `Task ${task.id} depends on unknown task ${dep}` });
      }
    }
    const outputKeys = Object.keys(task.output_state ?? {});
    const seenOutputKeys = new Set<string>();
    for (const key of outputKeys) {
      if (seenOutputKeys.has(key)) {
        issues.push({ level: 'error', message: `Duplicate output key "${key}" in task "${task.title_template || task.id}"` });
      }
      seenOutputKeys.add(key);
    }
  }

  // Cross-task output key uniqueness
  const globalOutputKeys = new Map<string, string>();
  for (const task of schema.tasks ?? []) {
    for (const key of Object.keys(task.output_state ?? {})) {
      if (globalOutputKeys.has(key)) {
        issues.push({ level: 'error', message: `Output key "${key}" used in both "${globalOutputKeys.get(key)}" and "${task.title_template || task.id}"` });
      } else {
        globalOutputKeys.set(key, task.title_template || task.id);
      }
    }
  }

  // Empty phases: backend rejects phases with no tasks
  for (const phase of schema.workflow?.phases ?? []) {
    if (phase.tasks.length === 0) {
      issues.push({ level: 'error', message: `Phase "${phase.name}" has no tasks` });
    }
  }

  // Task-phase coverage: every task must be in exactly one phase
  const allPhaseTasks = new Map<string, string>();
  for (const phase of schema.workflow?.phases ?? []) {
    for (const tid of phase.tasks) {
      if (allPhaseTasks.has(tid)) {
        issues.push({ level: 'error', message: `Task ${tid} is assigned to multiple phases` });
      }
      allPhaseTasks.set(tid, phase.name);
    }
  }
  for (const task of schema.tasks ?? []) {
    if (!allPhaseTasks.has(task.id)) {
      issues.push({ level: 'error', message: `Task ${task.id} is not assigned to any phase` });
    }
  }

  // Circular dependency detection
  const cycleTask = detectCycles(schema.tasks ?? []);
  if (cycleTask) {
    issues.push({ level: 'error', message: `Circular dependency detected involving task ${cycleTask}` });
  }

  // Variable validation
  const varNames = new Set<string>();
  for (const v of schema.variables ?? []) {
    if (varNames.has(v.name)) {
      issues.push({ level: 'error', message: `Duplicate variable name: ${v.name}` });
    }
    varNames.add(v.name);
  }

  // Runtime validation
  const rt = schema.runtime;
  if (rt?.pool_mode === 'warm') {
    if (rt.max_runtimes !== undefined && rt.max_runtimes < 1) {
      issues.push({ level: 'error', message: 'Max runtimes must be >= 1 when warm mode is enabled' });
    }
    if (rt.priority !== undefined && (rt.priority < 0 || rt.priority > 100)) {
      issues.push({ level: 'error', message: 'Priority must be between 0 and 100' });
    }
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Schema helpers
// ---------------------------------------------------------------------------

function updateSchema(
  state: TemplateEditorState,
  updater: (schema: TemplateSchema) => TemplateSchema,
): TemplateEditorState {
  return { ...state, schema: updater({ ...state.schema }) };
}

// ---------------------------------------------------------------------------
// Undo/redo history
// ---------------------------------------------------------------------------

interface UndoHistory {
  past: TemplateEditorState[];
  future: TemplateEditorState[];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TemplateEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !id || id === 'new';

  const [state, setState] = useState<TemplateEditorState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<SelectedItem>({ kind: 'template' });
  const [canvasMode, setCanvasMode] = useState<'visual' | 'code'>('visual');
  const [showOutline, setShowOutline] = useState(true);
  const [showInspector, setShowInspector] = useState(true);
  const [showIssues, setShowIssues] = useState(false);

  // Undo/redo
  const historyRef = useRef<UndoHistory>({ past: [], future: [] });
  const [historyLen, setHistoryLen] = useState({ past: 0, future: 0 });
  const canUndo = historyLen.past > 0;
  const canRedo = historyLen.future > 0;

  const syncHistoryLen = useCallback(() => {
    const h = historyRef.current;
    setHistoryLen({ past: h.past.length, future: h.future.length });
  }, []);

  const pushUndo = useCallback((current: TemplateEditorState) => {
    const h = historyRef.current;
    h.past.push(structuredClone(current));
    if (h.past.length > 50) h.past.shift();
    h.future = [];
    syncHistoryLen();
  }, [syncHistoryLen]);

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (h.past.length === 0 || !state) return;
    h.future.push(structuredClone(state));
    const prev = h.past.pop()!;
    setState(prev);
    setDirty(true);
    syncHistoryLen();
  }, [state, syncHistoryLen]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (h.future.length === 0 || !state) return;
    h.past.push(structuredClone(state));
    const next = h.future.pop()!;
    setState(next);
    setDirty(true);
    syncHistoryLen();
  }, [state, syncHistoryLen]);

  // Fetch
  const { data, isLoading, error } = useQuery({
    queryKey: ['template', id],
    queryFn: () => fetchTemplate(id!),
    enabled: Boolean(id) && !isNew,
  });

  useEffect(() => {
    if (isNew && !state) setState(createEmptyTemplate());
  }, [isNew, state]);

  useEffect(() => {
    if (data) {
      setState(data);
      setDirty(false);
      historyRef.current = { past: [], future: [] };
      syncHistoryLen();
    }
  }, [data]);

  // Mutations
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!state) throw new Error('No template');
      return isNew || !state.id ? createTemplate(state) : saveTemplate(state);
    },
    onSuccess: (saved) => {
      setState(saved);
      setDirty(false);
      historyRef.current = { past: [], future: [] };
      syncHistoryLen();
      queryClient.setQueryData(['template', saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template saved');
      if (isNew) navigate(`/config/templates/${saved.id}/edit`, { replace: true });
    },
    onError: (err) => toast.error(`Save failed: ${err.message}`),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!state) throw new Error('No template');
      let current = state;
      if (dirty || isNew || !state.id) {
        current = isNew || !state.id ? await createTemplate(state) : await saveTemplate(state);
      }
      return publishTemplate(current);
    },
    onSuccess: (published) => {
      setState(published);
      setDirty(false);
      historyRef.current = { past: [], future: [] };
      syncHistoryLen();
      queryClient.setQueryData(['template', published.id], published);
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast.success('Template published');
      if (isNew) navigate(`/config/templates/${published.id}/edit`, { replace: true });
    },
    onError: (err) => toast.error(`Publish failed: ${err.message}`),
  });

  // Change handlers with undo support
  const handleChange = useCallback(
    (updated: TemplateEditorState) => {
      setState((prev) => {
        if (prev) pushUndo(prev);
        return updated;
      });
      setDirty(true);
    },
    [pushUndo],
  );

  const handleSchemaChange = useCallback(
    (updater: (schema: TemplateSchema) => TemplateSchema) => {
      setState((prev) => {
        if (!prev) return prev;
        pushUndo(prev);
        return updateSchema(prev, updater);
      });
      setDirty(true);
    },
    [pushUndo],
  );

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === 's' && !e.shiftKey) {
        e.preventDefault();
        if (state && dirty) saveMutation.mutate();
      }
      if (mod && e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault();
        if (state) publishMutation.mutate();
      }
      if (mod && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      if (mod && (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
        e.preventDefault();
        redo();
      }
      // Cmd+1 / Cmd+2 switch canvas mode
      if (mod && e.key === '1') { e.preventDefault(); setCanvasMode('visual'); return; }
      if (mod && e.key === '2') { e.preventDefault(); setCanvasMode('code'); return; }
      // Escape closes inspector/outline panels
      if (e.key === 'Escape') {
        if (showInspector) { setShowInspector(false); return; }
        if (showOutline) { setShowOutline(false); return; }
      }
      // P = add phase, T = add task (only when no input/textarea focused)
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        if (e.key === 'p' || e.key === 'P') {
          if (!mod && !e.shiftKey) {
            e.preventDefault();
            if (state) {
              const phases = state.schema.workflow?.phases ?? [];
              handleSchemaChange((s) => ({
                ...s,
                workflow: { ...s.workflow, phases: [...(s.workflow?.phases ?? []), createEmptyPhase(phases.length)] },
              }));
            }
          }
        }
        if ((e.key === 't' || e.key === 'T') && !mod) {
          e.preventDefault();
          if (state) {
            const phases = state.schema.workflow?.phases ?? [];
            if (phases.length > 0) {
              const lastPhase = phases[phases.length - 1];
              const newTask = createEmptyTask(phases.length - 1, lastPhase.tasks.length);
              handleSchemaChange((s) => ({
                ...s,
                tasks: [...(s.tasks ?? []), newTask],
                workflow: {
                  ...s.workflow,
                  phases: (s.workflow?.phases ?? []).map((p) =>
                    p.name === lastPhase.name ? { ...p, tasks: [...p.tasks, newTask.id] } : p,
                  ),
                },
              }));
            }
          }
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [state, dirty, saveMutation, publishMutation, undo, redo, handleSchemaChange, showInspector, showOutline, setCanvasMode]);

  // Auto-save to localStorage (debounced 5s)
  const autoSaveKey = `template-autosave-${id ?? 'new'}`;
  useEffect(() => {
    if (!state || !dirty) return;
    const timer = setTimeout(() => {
      localStorage.setItem(autoSaveKey, JSON.stringify({ state, timestamp: Date.now() }));
    }, 5000);
    return () => clearTimeout(timer);
  }, [state, dirty, autoSaveKey]);

  // Recovery banner state
  const [recoveryData, setRecoveryData] = useState<TemplateEditorState | null>(null);
  useEffect(() => {
    const raw = localStorage.getItem(autoSaveKey);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { state: TemplateEditorState; timestamp: number };
      const serverTimestamp = data?.updated_at ? new Date(data.updated_at).getTime() : 0;
      if (saved.timestamp > serverTimestamp) {
        setRecoveryData(saved.state);
      } else {
        localStorage.removeItem(autoSaveKey);
      }
    } catch {
      localStorage.removeItem(autoSaveKey);
    }
  }, [autoSaveKey, data]);

  const applyRecovery = useCallback(() => {
    if (recoveryData) {
      setState(recoveryData);
      setDirty(true);
      setRecoveryData(null);
      localStorage.removeItem(autoSaveKey);
    }
  }, [recoveryData, autoSaveKey]);

  const dismissRecovery = useCallback(() => {
    setRecoveryData(null);
    localStorage.removeItem(autoSaveKey);
  }, [autoSaveKey]);

  // Clear auto-save on successful save
  useEffect(() => {
    if (!dirty && state?.id) {
      localStorage.removeItem(autoSaveKey);
    }
  }, [dirty, state?.id, autoSaveKey]);

  // Beforeunload
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) e.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  const issues = useMemo(() => (state ? validateTemplate(state) : []), [state]);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          Failed to load template: {String(error)}
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header bar */}
      <header className="shrink-0 border-b border-border bg-surface px-4 py-2.5 flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/config/templates')} className="gap-1">
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Templates</span>
        </Button>

        <Button
          variant="ghost" size="icon" className="h-8 w-8 lg:hidden"
          onClick={() => { setShowOutline(!showOutline); if (!showOutline) setShowInspector(false); }}
          aria-label="Toggle outline panel"
        >
          <Menu className="h-4 w-4" />
        </Button>

        {/* Template identity — read-only breadcrumb; edit name/slug in inspector */}
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <button
            type="button"
            className="text-sm font-semibold truncate max-w-xs hover:text-accent transition-colors"
            onClick={() => setSelected({ kind: 'template' })}
            title="Click to edit in inspector"
          >
            {state.name || 'Untitled Template'}
          </button>
          <span className="text-xs text-muted truncate hidden sm:inline">{state.slug || 'no-slug'}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">v{state.version}</Badge>
          <Badge variant={state.is_published ? 'success' : 'secondary'} className="shrink-0">
            {state.is_published ? 'Published' : 'Draft'}
          </Badge>
        </div>

        {/* Undo/redo */}
        <div className="hidden sm:flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Validation indicator — clickable to show issues */}
        <div className="hidden sm:flex items-center gap-1.5 relative" aria-live="polite">
          {errors.length > 0 ? (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-red-600 hover:underline"
              onClick={() => setShowIssues(!showIssues)}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {errors.length} error{errors.length !== 1 ? 's' : ''}
            </button>
          ) : warnings.length > 0 ? (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-yellow-600 hover:underline"
              onClick={() => setShowIssues(!showIssues)}
            >
              <AlertCircle className="h-3.5 w-3.5" />
              {warnings.length} warning{warnings.length !== 1 ? 's' : ''}
            </button>
          ) : (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Valid
            </span>
          )}
          {showIssues && issues.length > 0 && (
            <div className="absolute top-full right-0 mt-1 w-72 rounded-md border border-border bg-surface shadow-lg z-50 p-2 space-y-1">
              {issues.map((issue, i) => (
                <div key={i} className={`text-xs px-2 py-1 rounded ${issue.level === 'error' ? 'text-red-700 bg-red-50' : 'text-yellow-700 bg-yellow-50'}`}>
                  {issue.message}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save + Publish */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !dirty}
          >
            {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Save</span>
            {dirty && <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />}
          </Button>
          <Button
            size="sm"
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending || errors.length > 0}
          >
            {publishMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            <span className="hidden sm:inline">Publish</span>
          </Button>
        </div>
      </header>

      {/* Recovery banner */}
      {recoveryData && (
        <div className="shrink-0 px-4 py-2 bg-yellow-50 border-b border-yellow-200 flex items-center gap-3 text-sm">
          <AlertCircle className="h-4 w-4 text-yellow-600 shrink-0" />
          <span className="text-yellow-800">Unsaved changes found from a previous session.</span>
          <Button size="sm" variant="outline" onClick={applyRecovery}>Restore</Button>
          <Button size="sm" variant="ghost" onClick={dismissRecovery}>Dismiss</Button>
        </div>
      )}

      {/* Three-panel workspace */}
      <div className="flex-1 flex overflow-hidden">
        {/* Desktop: inline outline panel (lg+) */}
        {showOutline && (
          <div className="hidden lg:contents">
            <OutlinePanel
              state={state}
              selected={selected}
              onSelect={setSelected}
              onSchemaChange={handleSchemaChange}
              onClose={() => setShowOutline(false)}
            />
          </div>
        )}
        {/* Tablet: overlay outline panel (md..lg) */}
        {showOutline && (
          <div className="hidden md:block lg:hidden fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/20" onClick={() => setShowOutline(false)} />
            <div className="absolute left-0 top-0 bottom-0 w-[280px] border-r border-border bg-surface overflow-y-auto z-50">
              <OutlinePanel
                state={state}
                selected={selected}
                onSelect={(item) => { setSelected(item); setShowOutline(false); }}
                onSchemaChange={handleSchemaChange}
                onClose={() => setShowOutline(false)}
                overlay
              />
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <TemplateCanvas
            state={state}
            mode={canvasMode}
            onModeChange={setCanvasMode}
            selected={selected}
            onSelect={(item) => { setSelected(item); setShowInspector(true); }}
            onChange={handleChange}
            onSchemaChange={handleSchemaChange}
          />
        </div>

        {showInspector && (
          <TemplateInspector
            state={state}
            selected={selected}
            onChange={handleChange}
            onSchemaChange={handleSchemaChange}
            onSelect={setSelected}
            onClose={() => setShowInspector(false)}
          />
        )}
      </div>

      {/* Phone bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 border-t border-border bg-surface flex">
        <button
          className={`flex-1 py-3 text-xs text-center ${!showOutline && !showInspector ? 'text-accent font-semibold' : 'text-muted'}`}
          onClick={() => { setShowOutline(false); setShowInspector(false); }}
        >Canvas</button>
        <button
          className={`flex-1 py-3 text-xs text-center ${showOutline ? 'text-accent font-semibold' : 'text-muted'}`}
          onClick={() => { setShowOutline(true); setShowInspector(false); }}
        >Outline</button>
        <button
          className={`flex-1 py-3 text-xs text-center ${showInspector ? 'text-accent font-semibold' : 'text-muted'}`}
          onClick={() => { setShowOutline(false); setShowInspector(true); }}
        >Properties</button>
      </nav>

    </div>
  );
}

