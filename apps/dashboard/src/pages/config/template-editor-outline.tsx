/**
 * Outline panel — left sidebar tree view of workflow structure and settings.
 */
import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  ChevronLeft,
  Plus,
  Variable,
  RefreshCw,
  Cpu,
  Shield,
  Settings2,
  BookOpen,
  Tag,
  Trash2,
  Copy,
  GripVertical,
  LayoutDashboard,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.js';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.js';
import type {
  TemplateEditorState,
  TemplateSchema,
  WorkflowPhaseDefinition,
} from './template-editor-types.js';
import { createEmptyPhase, createEmptyTask } from './template-editor-types.js';
import type { SelectedItem } from './template-editor-page.js';

// ---------------------------------------------------------------------------
// Outline panel
// ---------------------------------------------------------------------------

export function OutlinePanel({
  state,
  selected,
  onSelect,
  onSchemaChange,
  onClose,
  overlay,
}: {
  state: TemplateEditorState;
  selected: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  onSchemaChange: (updater: (schema: TemplateSchema) => TemplateSchema) => void;
  onClose: () => void;
  overlay?: boolean;
}) {
  const phases = state.schema.workflow?.phases ?? [];
  const tasks = state.schema.tasks ?? [];
  const [collapsed, setCollapsed] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(phases.map((p) => p.name)));

  const togglePhase = (name: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const tasksInPhase = (phase: WorkflowPhaseDefinition) =>
    tasks.filter((t) => phase.tasks.includes(t.id));

  const addPhase = () => {
    const newPhase = createEmptyPhase(phases.length);
    onSchemaChange((s) => ({
      ...s,
      workflow: { ...s.workflow, phases: [...(s.workflow?.phases ?? []), newPhase] },
    }));
  };

  const addTaskToPhase = (phaseName: string) => {
    const phaseIndex = phases.findIndex((p) => p.name === phaseName);
    if (phaseIndex < 0) return;
    const newTask = createEmptyTask(phaseIndex, phases[phaseIndex].tasks.length);
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
  };

  const isSelected = (item: SelectedItem) => {
    if (selected.kind !== item.kind) return false;
    if (item.kind === 'phase' && selected.kind === 'phase') return item.phaseName === selected.phaseName;
    if (item.kind === 'task' && selected.kind === 'task') return item.taskId === selected.taskId;
    return true;
  };

  const itemClass = (item: SelectedItem) =>
    `w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors ${
      isSelected(item) ? 'bg-accent/10 text-accent font-medium' : 'text-foreground hover:bg-border/30'
    }`;

  if (collapsed) {
    return (
      <TooltipProvider delayDuration={200}>
        <aside className={`w-10 shrink-0 border-r border-border bg-surface overflow-y-auto flex-col items-center py-2 gap-1 ${overlay ? 'flex' : 'hidden lg:flex'}`}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-2 rounded-md hover:bg-border/30" onClick={() => setCollapsed(false)}>
                <PanelLeftOpen className="h-3.5 w-3.5 text-muted" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand outline</TooltipContent>
          </Tooltip>
          <div className="border-t border-border/50 w-6 my-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={`p-2 rounded-md ${selected.kind === 'template' || selected.kind === 'none' ? 'bg-accent/10 text-accent' : 'hover:bg-border/30 text-muted'}`}
                onClick={() => onSelect({ kind: 'template' })}
              ><LayoutDashboard className="h-3.5 w-3.5" /></button>
            </TooltipTrigger>
            <TooltipContent side="right">Overview</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={`p-2 rounded-md ${selected.kind === 'phase' || selected.kind === 'task' ? 'bg-accent/10 text-accent' : 'hover:bg-border/30 text-muted'}`}
                onClick={() => { setCollapsed(false); }}
              ><Layers className="h-3.5 w-3.5" /></button>
            </TooltipTrigger>
            <TooltipContent side="right">Workflow ({phases.length}p / {tasks.length}t)</TooltipContent>
          </Tooltip>
          <div className="border-t border-border/50 w-6 my-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button className={`p-2 rounded-md ${selected.kind === 'variables' ? 'bg-accent/10 text-accent' : 'hover:bg-border/30 text-muted'}`} onClick={() => onSelect({ kind: 'variables' })}>
                <Variable className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Variables</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className={`p-2 rounded-md ${selected.kind === 'lifecycle' ? 'bg-accent/10 text-accent' : 'hover:bg-border/30 text-muted'}`} onClick={() => onSelect({ kind: 'lifecycle' })}>
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Lifecycle</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className={`p-2 rounded-md ${selected.kind === 'runtime' ? 'bg-accent/10 text-accent' : 'hover:bg-border/30 text-muted'}`} onClick={() => onSelect({ kind: 'runtime' })}>
                <Cpu className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Runtime</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className={`p-2 rounded-md ${selected.kind === 'config-policy' ? 'bg-accent/10 text-accent' : 'hover:bg-border/30 text-muted'}`} onClick={() => onSelect({ kind: 'config-policy' })}>
                <Shield className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Config Policy</TooltipContent>
          </Tooltip>
        </aside>
      </TooltipProvider>
    );
  }

  return (
    <aside className={`w-60 shrink-0 border-r border-border bg-surface overflow-y-auto ${overlay ? 'block' : 'hidden lg:block'}`}>
      <div className="p-3 space-y-1">
        <div className="flex items-center justify-between mb-1">
          <button className={itemClass({ kind: 'template' })} onClick={() => onSelect({ kind: 'template' })}>
            Overview
          </button>
          <button className="p-1 rounded-md hover:bg-border/30 text-muted shrink-0" onClick={() => setCollapsed(true)} title="Collapse outline">
            <PanelLeftClose className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Phases + tasks */}
        <div className="pt-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-semibold text-muted uppercase tracking-wide">
              Workflow
              {phases.length > 0 && (
                <span className="ml-1 font-normal normal-case tracking-normal">
                  ({phases.length}p / {tasks.length}t)
                </span>
              )}
            </span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={addPhase} aria-label="Add phase">
              <Plus className="h-3 w-3" />
            </Button>
          </div>

          {phases.length === 0 && (
            <p className="text-xs text-muted px-3 py-2">No phases yet. Click + to add one.</p>
          )}

          {phases.map((phase, phaseIdx) => (
            <div key={phase.name} className="group/phase">
              <div className="flex items-center">
                <button className="p-1 text-muted hover:text-foreground" onClick={() => togglePhase(phase.name)}>
                  {expandedPhases.has(phase.name)
                    ? <ChevronDown className="h-3.5 w-3.5" />
                    : <ChevronRight className="h-3.5 w-3.5" />}
                </button>
                <button
                  className={`flex-1 text-left px-1 py-1 text-sm rounded-md truncate ${
                    selected.kind === 'phase' && selected.phaseName === phase.name
                      ? 'bg-accent/10 text-accent font-medium' : 'hover:bg-border/30'
                  }`}
                  onClick={() => onSelect({ kind: 'phase', phaseName: phase.name })}
                >{phase.name}</button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="icon" variant="ghost"
                      className="h-6 w-6 opacity-0 group-hover/phase:opacity-100"
                    ><GripVertical className="h-3 w-3" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => addTaskToPhase(phase.name)}>
                      <Plus className="h-3.5 w-3.5 mr-2" />Add Task
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      if (phaseIdx > 0) {
                        onSchemaChange((s) => {
                          const ps = [...(s.workflow?.phases ?? [])];
                          [ps[phaseIdx - 1], ps[phaseIdx]] = [ps[phaseIdx], ps[phaseIdx - 1]];
                          return { ...s, workflow: { ...s.workflow, phases: ps } };
                        });
                      }
                    }} disabled={phaseIdx === 0}>
                      Move Up
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => {
                      if (phaseIdx < phases.length - 1) {
                        onSchemaChange((s) => {
                          const ps = [...(s.workflow?.phases ?? [])];
                          [ps[phaseIdx], ps[phaseIdx + 1]] = [ps[phaseIdx + 1], ps[phaseIdx]];
                          return { ...s, workflow: { ...s.workflow, phases: ps } };
                        });
                      }
                    }} disabled={phaseIdx === phases.length - 1}>
                      Move Down
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-red-600"
                      onClick={() => {
                        const phaseTaskIds = new Set(phase.tasks);
                        onSchemaChange((s) => ({
                          ...s,
                          tasks: (s.tasks ?? []).filter((t) => !phaseTaskIds.has(t.id)),
                          workflow: { ...s.workflow, phases: (s.workflow?.phases ?? []).filter((p) => p.name !== phase.name) },
                        }));
                        onSelect({ kind: 'template' });
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" />Delete Phase
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              {expandedPhases.has(phase.name) && (
                <div className="ml-6 space-y-0.5">
                  {tasksInPhase(phase).map((task, taskIdx) => (
                    <div key={task.id} className="flex items-center group/task">
                      <button
                        className={`flex-1 text-left px-2 py-1 text-xs rounded-md truncate ${
                          selected.kind === 'task' && selected.taskId === task.id
                            ? 'bg-accent/10 text-accent font-medium'
                            : 'text-muted hover:bg-border/30 hover:text-foreground'
                        }`}
                        onClick={() => onSelect({ kind: 'task', taskId: task.id })}
                      >{task.title_template || task.id}</button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-5 w-5 opacity-0 group-hover/task:opacity-100 shrink-0">
                            <GripVertical className="h-2.5 w-2.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => {
                            const newId = `${task.id}_copy`;
                            const clone = { ...structuredClone(task), id: newId };
                            onSchemaChange((s) => ({
                              ...s,
                              tasks: [...(s.tasks ?? []), clone],
                              workflow: {
                                ...s.workflow,
                                phases: (s.workflow?.phases ?? []).map((p) =>
                                  p.name === phase.name ? { ...p, tasks: [...p.tasks, newId] } : p,
                                ),
                              },
                            }));
                            onSelect({ kind: 'task', taskId: newId });
                          }}>
                            <Copy className="h-3.5 w-3.5 mr-2" />Duplicate
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            if (taskIdx > 0) {
                              onSchemaChange((s) => ({
                                ...s,
                                workflow: {
                                  ...s.workflow,
                                  phases: (s.workflow?.phases ?? []).map((p) => {
                                    if (p.name !== phase.name) return p;
                                    const ts = [...p.tasks];
                                    [ts[taskIdx - 1], ts[taskIdx]] = [ts[taskIdx], ts[taskIdx - 1]];
                                    return { ...p, tasks: ts };
                                  }),
                                },
                              }));
                            }
                          }} disabled={taskIdx === 0}>
                            Move Up
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => {
                            const phaseTasks = tasksInPhase(phase);
                            if (taskIdx < phaseTasks.length - 1) {
                              onSchemaChange((s) => ({
                                ...s,
                                workflow: {
                                  ...s.workflow,
                                  phases: (s.workflow?.phases ?? []).map((p) => {
                                    if (p.name !== phase.name) return p;
                                    const ts = [...p.tasks];
                                    [ts[taskIdx], ts[taskIdx + 1]] = [ts[taskIdx + 1], ts[taskIdx]];
                                    return { ...p, tasks: ts };
                                  }),
                                },
                              }));
                            }
                          }} disabled={taskIdx === tasksInPhase(phase).length - 1}>
                            Move Down
                          </DropdownMenuItem>
                          {/* Move to Phase submenu */}
                          {phases.filter((p) => p.name !== phase.name).map((targetPhase) => (
                            <DropdownMenuItem
                              key={targetPhase.name}
                              onClick={() => {
                                onSchemaChange((s) => ({
                                  ...s,
                                  workflow: {
                                    ...s.workflow,
                                    phases: (s.workflow?.phases ?? []).map((p) => {
                                      if (p.name === phase.name) return { ...p, tasks: p.tasks.filter((id) => id !== task.id) };
                                      if (p.name === targetPhase.name) return { ...p, tasks: [...p.tasks, task.id] };
                                      return p;
                                    }),
                                  },
                                }));
                              }}
                            >
                              Move to {targetPhase.name}
                            </DropdownMenuItem>
                          ))}
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => {
                              onSchemaChange((s) => ({
                                ...s,
                                tasks: (s.tasks ?? []).filter((t) => t.id !== task.id),
                                workflow: {
                                  ...s.workflow,
                                  phases: (s.workflow?.phases ?? []).map((p) => ({
                                    ...p,
                                    tasks: p.tasks.filter((id) => id !== task.id),
                                  })),
                                },
                              }));
                              onSelect({ kind: 'template' });
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 mr-2" />Delete Task
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ))}
                  <button
                    className="w-full text-left px-2 py-1 text-xs text-muted hover:text-foreground rounded-md flex items-center gap-1"
                    onClick={() => addTaskToPhase(phase.name)}
                  ><Plus className="h-3 w-3" />Add task</button>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Settings section */}
        <div className="pt-4 border-t border-border/50 mt-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wide px-2">Settings</span>
          <div className="mt-1 space-y-0.5">
            <button className={itemClass({ kind: 'variables' })} onClick={() => onSelect({ kind: 'variables' })}>
              <span className="flex items-center gap-2">
                <Variable className="h-3.5 w-3.5" />Variables
                {(state.schema.variables?.length ?? 0) > 0 && (
                  <Badge variant="outline" className="text-[10px] ml-auto">{state.schema.variables!.length}</Badge>
                )}
              </span>
            </button>
            <button className={itemClass({ kind: 'lifecycle' })} onClick={() => onSelect({ kind: 'lifecycle' })}>
              <span className="flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5" />
                <span className="truncate">
                  Lifecycle
                  {state.schema.lifecycle?.retry_policy && (
                    <span className="text-[10px] text-muted font-normal ml-1">
                      {state.schema.lifecycle.retry_policy.max_attempts}r
                      {state.schema.lifecycle.escalation?.enabled ? ' · esc' : ''}
                    </span>
                  )}
                </span>
              </span>
            </button>
            <button className={itemClass({ kind: 'runtime' })} onClick={() => onSelect({ kind: 'runtime' })}>
              <span className="flex items-center gap-2">
                <Cpu className="h-3.5 w-3.5" />
                <span className="truncate">
                  Runtime
                  {state.schema.runtime?.pool_mode === 'warm' ? (
                    <span className="text-[10px] text-muted font-normal ml-1">
                      warm · {state.schema.runtime.max_runtimes ?? 0}rt
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted font-normal ml-1">cold</span>
                  )}
                </span>
                {state.schema.runtime?.pool_mode === 'warm' && (
                  <span className="inline-block h-2 w-2 rounded-full bg-green-500 ml-auto shrink-0" />
                )}
              </span>
            </button>
            <button className={itemClass({ kind: 'config-policy' })} onClick={() => onSelect({ kind: 'config-policy' })}>
              <span className="flex items-center gap-2">
                <Shield className="h-3.5 w-3.5" />
                <span className="truncate">
                  Config Policy
                  {state.schema.config_policy && Object.keys(state.schema.config_policy).length > 0 && (
                    <span className="text-[10px] text-muted font-normal ml-1">
                      {Object.keys(state.schema.config_policy).length} fields
                    </span>
                  )}
                </span>
              </span>
            </button>
          </div>
        </div>

        {/* Advanced section */}
        <div className="pt-4 border-t border-border/50 mt-2">
          <span className="text-xs font-semibold text-muted uppercase tracking-wide px-2">Advanced</span>
          <div className="mt-1 space-y-0.5">
            <button className={itemClass({ kind: 'config' })} onClick={() => onSelect({ kind: 'config' })}>
              <span className="flex items-center gap-2"><Settings2 className="h-3.5 w-3.5" />Config</span>
            </button>
            <button className={itemClass({ kind: 'default-instruction-config' })} onClick={() => onSelect({ kind: 'default-instruction-config' })}>
              <span className="flex items-center gap-2"><BookOpen className="h-3.5 w-3.5" />Default Instructions</span>
            </button>
            <button className={itemClass({ kind: 'metadata' })} onClick={() => onSelect({ kind: 'metadata' })}>
              <span className="flex items-center gap-2"><Tag className="h-3.5 w-3.5" />Metadata</span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
