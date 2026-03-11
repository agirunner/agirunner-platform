/**
 * Template Launch Wizard — 3-step flow to create a workflow from a template.
 * Step 1: Select template (if no template pre-selected)
 * Step 2: Configure parameters (variables, name, project, repo)
 * Step 3: Review & launch
 */
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Rocket, Loader2, Search, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import { Badge } from '../../components/ui/badge.js';
import { Switch } from '../../components/ui/switch.js';
import { toast } from '../../lib/toast.js';
import { listTemplates, fetchTemplate } from './template-editor-api.js';
import type { TemplateResponse, TemplateSchema, TemplateVariableDefinition, VariableType } from './template-editor-types.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.js';
import { dashboardApi } from '../../lib/api.js';

function validateVariableValue(type: VariableType, value: string): string | null {
  if (!value.trim()) return null; // empty handled by required check
  switch (type) {
    case 'number':
      return isNaN(Number(value)) ? 'Must be a valid number' : null;
    case 'json':
      try { JSON.parse(value); return null; } catch { return 'Must be valid JSON'; }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Step 1: Select Template
// ---------------------------------------------------------------------------

function StepSelectTemplate({
  templates,
  selectedId,
  onSelect,
}: {
  templates: TemplateResponse[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    const published = templates.filter((t) => t.is_published);
    if (!search.trim()) return published;
    const q = search.toLowerCase();
    return published.filter(
      (t) => t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q),
    );
  }, [templates, search]);

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
        <Input
          placeholder="Search templates..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {filtered.map((t) => {
          const schema = t.schema as TemplateSchema | undefined;
          const taskCount = schema?.tasks?.length ?? 0;
          const phaseCount = schema?.workflow?.phases?.length ?? 0;
          const isSelected = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              className={`w-full text-left p-4 rounded-lg border transition-colors ${
                isSelected
                  ? 'border-accent bg-accent/5'
                  : 'border-border hover:border-accent/40'
              }`}
              onClick={() => onSelect(t.id)}
            >
              <div className="flex items-center gap-2">
                {isSelected && <Check className="h-4 w-4 text-accent shrink-0" />}
                <span className="font-semibold">{t.name}</span>
                <Badge variant="outline" className="text-[10px] ml-auto">v{t.version}</Badge>
              </div>
              {t.description && (
                <p className="text-sm text-muted mt-1 line-clamp-2">{t.description}</p>
              )}
              <p className="text-xs text-muted mt-1">
                {phaseCount} phase{phaseCount !== 1 ? 's' : ''} &middot; {taskCount} task{taskCount !== 1 ? 's' : ''}
              </p>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="text-sm text-muted text-center py-8">No published templates found.</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2: Configure Parameters
// ---------------------------------------------------------------------------

/** Scan all task input_template / title_template fields for {{var}} patterns. */
function detectTemplateVariables(schema: TemplateSchema | undefined): string[] {
  if (!schema?.tasks) return [];
  const found = new Set<string>();
  const RE = /\{\{(\w+)\}\}/g;
  for (const task of schema.tasks) {
    // Scan title_template
    if (task.title_template) {
      for (const m of task.title_template.matchAll(RE)) found.add(m[1]);
    }
    // Scan input_template values recursively (they're often nested strings)
    if (task.input_template) {
      const scan = (obj: unknown): void => {
        if (typeof obj === 'string') {
          for (const m of obj.matchAll(RE)) found.add(m[1]);
        } else if (Array.isArray(obj)) {
          obj.forEach(scan);
        } else if (obj && typeof obj === 'object') {
          Object.values(obj as Record<string, unknown>).forEach(scan);
        }
      };
      scan(task.input_template);
    }
  }
  return [...found];
}

function StepConfigureParams({
  template,
  values,
  onChange,
  workflowName,
  onWorkflowNameChange,
  projectId,
  onProjectIdChange,
  repoUrl,
  onRepoUrlChange,
  repoBranch,
  onRepoBranchChange,
}: {
  template: TemplateResponse;
  values: Record<string, string>;
  onChange: (values: Record<string, string>) => void;
  workflowName: string;
  onWorkflowNameChange: (name: string) => void;
  projectId: string;
  onProjectIdChange: (id: string) => void;
  repoUrl: string;
  onRepoUrlChange: (url: string) => void;
  repoBranch: string;
  onRepoBranchChange: (branch: string) => void;
}) {
  const { data: projectsData } = useQuery({
    queryKey: ['projects'],
    queryFn: () => dashboardApi.listProjects(),
  });
  const projects = projectsData?.data ?? [];
  const schema = template.schema as TemplateSchema | undefined;
  const declaredVars = schema?.variables ?? [];
  const declaredNames = new Set(declaredVars.map((v) => v.name));

  // Auto-detect {{var}} patterns from task templates that aren't formally declared
  const detectedNames = useMemo(() => detectTemplateVariables(schema), [schema]);
  const implicitVars: TemplateVariableDefinition[] = detectedNames
    .filter((name) => !declaredNames.has(name))
    .map((name) => ({ name, type: 'string' as const, required: true }));

  const variables = [...declaredVars, ...implicitVars];
  const required = variables.filter((v) => v.required !== false);
  const optional = variables.filter((v) => v.required === false);

  const isImplicit = (v: TemplateVariableDefinition) => !declaredNames.has(v.name);

  const renderField = (v: TemplateVariableDefinition) => {
    const val = values[v.name] ?? '';
    const useTextarea = isImplicit(v) && v.type === 'string';
    const error = validateVariableValue(v.type, val);
    return (
      <label key={v.name} className="block">
        <span className="text-sm font-medium">
          {v.name}
          {v.required !== false && <span className="text-red-500 ml-0.5">*</span>}
        </span>
        {v.description && <p className="text-xs text-muted">{v.description}</p>}
        {isImplicit(v) && !v.description && (
          <p className="text-xs text-muted">Detected from task templates</p>
        )}
        {v.type === 'boolean' ? (
          <Switch
            checked={val === 'true'}
            onCheckedChange={(c) => onChange({ ...values, [v.name]: String(c) })}
          />
        ) : useTextarea ? (
          <textarea
            value={val}
            onChange={(e) => onChange({ ...values, [v.name]: e.target.value })}
            placeholder="Describe what you want this workflow to accomplish..."
            rows={3}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        ) : (
          <Input
            type={v.type === 'number' ? 'number' : 'text'}
            value={val}
            onChange={(e) => onChange({ ...values, [v.name]: e.target.value })}
            placeholder={v.default !== undefined ? `Default: ${v.default}` : undefined}
            className={`mt-1 ${error ? 'border-red-500' : ''}`}
          />
        )}
        {error && <p className="text-xs text-red-500 mt-0.5">{error}</p>}
      </label>
    );
  };

  return (
    <div className="space-y-6 max-w-lg">
      <div className="text-xs text-muted">
        Template: <span className="font-medium text-foreground">{template.name} v{template.version}</span>
      </div>

      {/* Workflow identity */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Workflow</h4>
        <label className="block">
          <span className="text-sm font-medium">
            Name <span className="text-red-500">*</span>
          </span>
          <Input
            value={workflowName}
            onChange={(e) => onWorkflowNameChange(e.target.value)}
            placeholder="e.g. Q2 Blog Series"
            className="mt-1"
          />
        </label>
      </div>

      {/* Template parameters — shown before project/repo since they're the core input */}
      {variables.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold">Instructions &amp; Parameters</h4>
          {required.map(renderField)}
          {optional.length > 0 && (
            <>
              <p className="text-xs text-muted pt-2">Optional</p>
              {optional.map(renderField)}
            </>
          )}
        </div>
      )}

      {/* Project */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Project</h4>
        <label className="block">
          <span className="text-sm font-medium">Assign to project</span>
          <Select value={projectId || '__none__'} onValueChange={(v) => onProjectIdChange(v === '__none__' ? '' : v)}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="None (standalone)" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None (standalone)</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* Repository */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Repository (optional)</h4>
        <label className="block">
          <span className="text-sm">Repo URL</span>
          <Input
            value={repoUrl}
            onChange={(e) => onRepoUrlChange(e.target.value)}
            placeholder="https://github.com/org/repo"
            className="mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm">Branch</span>
          <Input
            value={repoBranch}
            onChange={(e) => onRepoBranchChange(e.target.value)}
            placeholder="main"
            className="mt-1"
          />
        </label>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3: Review & Launch
// ---------------------------------------------------------------------------


function StepReview({
  template,
  workflowName,
  values,
  repoUrl,
  repoBranch,
}: {
  template: TemplateResponse;
  workflowName: string;
  values: Record<string, string>;
  repoUrl: string;
  repoBranch: string;
}) {
  const [showPayload, setShowPayload] = useState(false);
  const schema = template.schema as TemplateSchema | undefined;
  const phases = schema?.workflow?.phases ?? [];
  const tasks = schema?.tasks ?? [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const taskCount = tasks.length;
  const roles = [...new Set(tasks.map((t) => t.role).filter(Boolean))];

  return (
    <div className="space-y-4 max-w-lg">
      {/* Summary */}
      <div className="rounded-lg border border-border p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold">Workflow</span>
          <span className="text-sm">{workflowName}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Template</span>
          <span className="text-sm">{template.name} v{template.version}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Phases</span>
          <span className="text-sm">{phases.length} ({phases.map((p) => p.name).join(' \u2192 ')})</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted">Tasks</span>
          <span className="text-sm">{taskCount}</span>
        </div>
        {roles.length > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Roles</span>
            <span className="text-sm">{roles.join(', ')}</span>
          </div>
        )}
        {repoUrl && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Repository</span>
            <span className="text-sm truncate max-w-[200px]">{repoUrl} ({repoBranch || 'main'})</span>
          </div>
        )}
      </div>

      {/* Task preview per phase */}
      <div className="rounded-lg border border-border p-3 space-y-3">
        <h5 className="text-xs font-semibold text-muted uppercase">Task Preview</h5>
        {phases.map((phase) => (
          <div key={phase.name}>
            <p className="text-xs font-semibold">
              {phase.name}
              <span className="text-[10px] text-muted ml-1 font-normal">
                {phase.gate === 'manual' ? 'manual gate' : ''}{phase.parallel ? ' \u2016' : ''}
              </span>
            </p>
            <div className="ml-3 space-y-0.5 mt-1">
              {phase.tasks.map((tid) => {
                const t = taskMap.get(tid);
                if (!t) return null;
                const deps = t.depends_on?.length ? ` \u2192 depends on ${t.depends_on.join(', ')}` : '';
                return (
                  <p key={tid} className="text-xs text-muted">
                    {t.title_template || t.id}
                    {t.role && <span className="ml-1">({t.role})</span>}
                    {deps && <span className="text-[10px]">{deps}</span>}
                  </p>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Parameters summary */}
      {Object.keys(values).length > 0 && (
        <div className="rounded-lg border border-border p-3 space-y-1">
          <h5 className="text-xs font-semibold text-muted uppercase mb-2">Parameters</h5>
          {Object.entries(values).map(([k, v]) => (
            v ? (
              <div key={k} className="flex justify-between text-sm">
                <span className="text-muted font-mono text-xs">{k}</span>
                <span className="text-xs truncate max-w-[200px]">{v}</span>
              </div>
            ) : null
          ))}
        </div>
      )}

      {/* Full Payload JSON */}
      <div className="rounded-lg border border-border">
        <button
          type="button"
          className="w-full flex items-center gap-2 px-3 py-2 text-xs text-muted hover:text-foreground"
          onClick={() => setShowPayload(!showPayload)}
        >
          {showPayload ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          Full Payload JSON
        </button>
        {showPayload && (
          <pre className="px-3 pb-3 text-[11px] font-mono overflow-x-auto max-h-64 overflow-y-auto text-muted">
            {JSON.stringify({
              template_id: template.id,
              name: workflowName,
              variables: values,
              repository: repoUrl ? { url: repoUrl, branch: repoBranch || 'main' } : undefined,
            }, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Launch Page
// ---------------------------------------------------------------------------

export function TemplateLaunchPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [step, setStep] = useState(id ? 2 : 1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(id ?? null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [workflowName, setWorkflowName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [repoBranch, setRepoBranch] = useState('');
  const [configOverrides, setConfigOverrides] = useState<Record<string, string>>({});
  const [launching, setLaunching] = useState(false);

  const { data: listData, isLoading: listLoading } = useQuery({
    queryKey: ['templates'],
    queryFn: () => listTemplates({ per_page: 100 }),
  });

  const { data: selectedTemplate, isLoading: templateLoading } = useQuery({
    queryKey: ['template', selectedTemplateId],
    queryFn: () => fetchTemplate(selectedTemplateId!),
    enabled: Boolean(selectedTemplateId),
  });

  const templates = listData?.data ?? [];
  const templateForReview = templates.find((t) => t.id === selectedTemplateId);

  const templateSchema = templateForReview?.schema as TemplateSchema | undefined;
  const detectedVarNames = useMemo(() => detectTemplateVariables(templateSchema), [templateSchema]);

  const canNext = useCallback((): boolean => {
    if (step === 1) return Boolean(selectedTemplateId);
    if (step === 2) {
      if (!workflowName.trim()) return false;
      // Check declared variables — required + type validation
      const vars = templateSchema?.variables ?? [];
      for (const v of vars) {
        const val = values[v.name] ?? '';
        if (v.required !== false && !val.trim() && v.default === undefined) return false;
        if (val.trim() && validateVariableValue(v.type, val)) return false;
      }
      // Check auto-detected variables not formally declared
      const declaredNames = new Set(vars.map((v) => v.name));
      for (const name of detectedVarNames) {
        if (!declaredNames.has(name) && !values[name]?.trim()) return false;
      }
      return true;
    }
    return true;
  }, [step, selectedTemplateId, workflowName, templateSchema, values, detectedVarNames]);

  const handleLaunch = useCallback(async () => {
    if (!selectedTemplateId || !workflowName.trim()) return;
    setLaunching(true);
    try {
      const result = await dashboardApi.createWorkflow({
        template_id: selectedTemplateId,
        name: workflowName.trim(),
        parameters: Object.keys(values).length > 0 ? values : undefined,
        metadata: {
          ...(projectId ? { project_id: projectId } : {}),
          ...(repoUrl ? { repository_url: repoUrl, branch: repoBranch || 'main' } : {}),
          ...(Object.keys(configOverrides).length > 0 ? { config_overrides: configOverrides } : {}),
        },
      }) as { id?: string };
      toast.success('Workflow launched');
      navigate(result?.id ? `/work/workflows/${result.id}` : '/work/workflows');
    } catch (err) {
      toast.error(`Launch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLaunching(false);
    }
  }, [navigate, selectedTemplateId, workflowName, values, projectId, repoUrl, repoBranch, configOverrides]);

  const handleAdvance = useCallback(() => {
    if (step < 3 && canNext()) setStep(step + 1);
    else if (step === 3 && !launching) handleLaunch();
  }, [step, canNext, launching, handleLaunch]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter' && !(e.target as HTMLElement)?.matches('textarea')) {
        e.preventDefault();
        handleAdvance();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleAdvance]);

  const isLoading = listLoading || (selectedTemplateId && templateLoading);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      </div>
    );
  }

  const STEPS = ['Select Template', 'Configure', 'Review & Launch'];

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-xl font-semibold">Launch Workflow</h1>
          <p className="text-sm text-muted">Step {step} of 3 &mdash; {STEPS[step - 1]}</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && <div className="h-px w-6 bg-border" />}
            <div
              className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-full ${
                i + 1 === step
                  ? 'bg-accent text-white'
                  : i + 1 < step
                    ? 'bg-green-100 text-green-700'
                    : 'bg-border/50 text-muted'
              }`}
            >
              <span className="font-medium">{i + 1}</span>
              <span className="hidden sm:inline">{label}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Step content */}
      {step === 1 && (
        <StepSelectTemplate
          templates={templates}
          selectedId={selectedTemplateId}
          onSelect={(id) => setSelectedTemplateId(id)}
        />
      )}
      {step === 2 && templateForReview && (
        <StepConfigureParams
          template={templateForReview}
          values={values}
          onChange={setValues}
          workflowName={workflowName}
          onWorkflowNameChange={setWorkflowName}
          projectId={projectId}
          onProjectIdChange={setProjectId}
          repoUrl={repoUrl}
          onRepoUrlChange={setRepoUrl}
          repoBranch={repoBranch}
          onRepoBranchChange={setRepoBranch}
        />
      )}
      {step === 3 && templateForReview && (
        <StepReview
          template={templateForReview}
          workflowName={workflowName}
          values={values}
          repoUrl={repoUrl}
          repoBranch={repoBranch}
        />
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-border">
        <Button
          variant="outline"
          onClick={() => (step > 1 ? setStep(step - 1) : navigate(-1))}
        >
          <ArrowLeft className="h-4 w-4" />
          {step > 1 ? 'Back' : 'Cancel'}
        </Button>

        {step < 3 ? (
          <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>
            Next
            <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={handleLaunch} disabled={launching}>
            {launching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
            Launch Workflow
          </Button>
        )}
      </div>
    </div>
  );
}
