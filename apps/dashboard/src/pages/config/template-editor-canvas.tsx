import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  applyNodeChanges,
  applyEdgeChanges,
  Panel,
  useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus, Code, Eye, Copy, Trash2, ArrowRightLeft, Maximize, Grid3x3 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import type {
  TemplateEditorState,
  TemplateSchema,
  TemplateTaskDefinition,
  WorkflowPhaseDefinition,
} from './template-editor-types.js';
import {
  createEmptyPhase,
  createEmptyTask,
} from './template-editor-types.js';
import type { SelectedItem } from './template-editor-page.js';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CanvasProps {
  state: TemplateEditorState;
  mode: 'visual' | 'code';
  onModeChange: (mode: 'visual' | 'code') => void;
  selected: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  onChange: (state: TemplateEditorState) => void;
  onSchemaChange: (updater: (schema: TemplateSchema) => TemplateSchema) => void;
}

// ---------------------------------------------------------------------------
// Visual mode: build ReactFlow nodes/edges from schema
// ---------------------------------------------------------------------------

const TASK_HEIGHT = 56;
const TASK_GAP = 8;
const TASK_PADDING = 16;
const PARALLEL_TASK_WIDTH = 160;
const SEQUENTIAL_TASK_WIDTH = 228;
const PHASE_HEADER = 44;


function buildNodes(
  phases: WorkflowPhaseDefinition[],
  tasks: TemplateTaskDefinition[],
  selectedItem: SelectedItem,
): Node[] {
  const nodes: Node[] = [];
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  let xOffset = 0;

  for (const phase of phases) {
    const phaseTasks = phase.tasks.map((id) => taskMap.get(id)).filter(Boolean) as TemplateTaskDefinition[];
    const isPhaseSelected = selectedItem.kind === 'phase' && selectedItem.phaseName === phase.name;
    const phaseTaskIds = new Set(phase.tasks);

    // Build DAG rows: assign each task a row based on its longest dependency chain depth
    // Tasks with no intra-phase deps go to row 0 (parallel). Tasks depending on row-0 tasks
    // go to row 1, etc. Tasks in the same row are parallel with each other.
    const rowOf = new Map<string, number>();
    function getRow(taskId: string, visited: Set<string>): number {
      if (rowOf.has(taskId)) return rowOf.get(taskId)!;
      if (visited.has(taskId)) return 0; // cycle guard
      visited.add(taskId);
      const task = taskMap.get(taskId);
      const internalDeps = (task?.depends_on ?? []).filter((d) => phaseTaskIds.has(d));
      const row = internalDeps.length === 0
        ? 0
        : Math.max(...internalDeps.map((d) => getRow(d, visited))) + 1;
      rowOf.set(taskId, row);
      return row;
    }
    for (const t of phaseTasks) getRow(t.id, new Set());

    // Group tasks by row
    const rows: TemplateTaskDefinition[][] = [];
    for (const t of phaseTasks) {
      const r = rowOf.get(t.id) ?? 0;
      while (rows.length <= r) rows.push([]);
      rows[r].push(t);
    }

    // Calculate phase dimensions from the row layout
    const maxCols = Math.max(1, ...rows.map((r) => r.length));
    const numRows = rows.length;
    const taskW = maxCols > 1 ? PARALLEL_TASK_WIDTH : SEQUENTIAL_TASK_WIDTH;
    const phaseWidth = Math.max(260, TASK_PADDING * 2 + maxCols * taskW + Math.max(0, maxCols - 1) * TASK_GAP);
    const phaseHeight = Math.max(120, PHASE_HEADER + numRows * (TASK_HEIGHT + TASK_GAP) + 12);

    nodes.push({
      id: `phase:${phase.name}`,
      type: 'group',
      position: { x: xOffset, y: 0 },
      draggable: false,
      style: {
        width: phaseWidth,
        height: phaseHeight,
        backgroundColor: isPhaseSelected
          ? 'rgba(37, 99, 235, 0.08)'
          : 'rgba(107, 114, 128, 0.04)',
        border: isPhaseSelected
          ? '2px solid rgba(37, 99, 235, 0.4)'
          : '1px solid rgba(229, 231, 235, 0.6)',
        borderRadius: '10px',
        padding: '8px',
      },
      data: { label: `${phase.name}${phase.gate === 'manual' ? '\n\u{1F6D1} manual gate' : ''}` },
    });

    for (let row = 0; row < rows.length; row++) {
      const rowTasks = rows[row];
      // Center the row's tasks within the phase width
      const rowWidth = rowTasks.length * taskW + Math.max(0, rowTasks.length - 1) * TASK_GAP;
      const rowStartX = Math.max(TASK_PADDING, (phaseWidth - rowWidth) / 2);

      rowTasks.forEach((task, col) => {
        const isTaskSelected = selectedItem.kind === 'task' && selectedItem.taskId === task.id;
        const secondaryParts: string[] = [];
        if (task.role) secondaryParts.push(task.role);
        if (task.requires_approval) secondaryParts.push('\u2705');
        const secondary = secondaryParts.join(' \u00B7 ');

        nodes.push({
          id: `task:${task.id}`,
          position: {
            x: rowStartX + col * (taskW + TASK_GAP),
            y: PHASE_HEADER + row * (TASK_HEIGHT + TASK_GAP),
          },
          parentId: `phase:${phase.name}`,
          extent: 'parent' as const,
          draggable: false,
          data: {
            label: `${task.title_template || task.id}\n${secondary}`,
            role: task.role,
          },
          style: {
            width: taskW,
            padding: '6px 10px',
            backgroundColor: isTaskSelected ? 'rgba(37, 99, 235, 0.06)' : '#ffffff',
            border: isTaskSelected
              ? '2px solid rgba(37, 99, 235, 0.5)'
              : '1px solid #e5e7eb',
            borderRadius: '8px',
            fontSize: '11px',
            lineHeight: '1.4',
            whiteSpace: 'pre-line',
            cursor: 'pointer',
          },
        });
      });
    }

    xOffset += phaseWidth + 50;
  }

  return nodes;
}

function buildEdges(tasks: TemplateTaskDefinition[]): Edge[] {
  const edges: Edge[] = [];
  for (const task of tasks) {
    for (const dep of task.depends_on ?? []) {
      edges.push({
        id: `edge:${dep}->${task.id}`,
        source: `task:${dep}`,
        target: `task:${task.id}`,
        animated: true,
        selectable: true,
        style: { stroke: '#2563eb', strokeWidth: 1.5 },
      });
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Context menu types
// ---------------------------------------------------------------------------

interface ContextMenuState {
  x: number;
  y: number;
  type: 'task' | 'phase' | 'canvas' | 'edge';
  id: string;
}

// ---------------------------------------------------------------------------
// Visual canvas inner (needs ReactFlowProvider)
// ---------------------------------------------------------------------------

function VisualCanvasInner({
  state,
  selected,
  onSelect,
  onSchemaChange,
}: {
  state: TemplateEditorState;
  selected: SelectedItem;
  onSelect: (item: SelectedItem) => void;
  onSchemaChange: (updater: (schema: TemplateSchema) => TemplateSchema) => void;
}) {
  const { fitView } = useReactFlow();
  const [showGrid, setShowGrid] = useState(true);
  const phases = state.schema.workflow?.phases ?? [];
  const tasks = state.schema.tasks ?? [];

  const [nodes, setNodes] = useState<Node[]>(() => buildNodes(phases, tasks, selected));
  const [edges, setEdges] = useState<Edge[]>(() => buildEdges(tasks));

  // Sync when schema changes externally
  useEffect(() => {
    setNodes(buildNodes(phases, tasks, selected));
    setEdges(buildEdges(tasks));
  }, [phases, tasks, selected]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Filter out position changes — nodes use fixed auto-layout
      const filtered = changes.filter((c) => c.type !== 'position');
      if (filtered.length > 0) setNodes((nds) => applyNodeChanges(filtered, nds));
    },
    [],
  );
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      // When edges are removed (via selection + Delete), update the schema
      const removals = changes.filter((c) => c.type === 'remove');
      if (removals.length > 0) {
        const removedIds = new Set(removals.map((c) => c.id));
        onSchemaChange((s) => ({
          ...s,
          tasks: (s.tasks ?? []).map((t) => {
            const updated = (t.depends_on ?? []).filter(
              (dep) => !removedIds.has(`edge:${dep}->${t.id}`),
            );
            return updated.length === (t.depends_on ?? []).length
              ? t
              : { ...t, depends_on: updated.length > 0 ? updated : undefined };
          }),
        }));
      }
      setEdges((eds) => applyEdgeChanges(changes, eds));
    },
    [onSchemaChange],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const sourceId = connection.source.replace('task:', '');
      const targetId = connection.target.replace('task:', '');
      // Self-loop
      if (sourceId === targetId) return;
      // Check if adding this edge would create a cycle:
      // We're adding targetId depends_on sourceId. A cycle exists if
      // sourceId already transitively depends on targetId.
      const reachable = (from: string, goal: string, visited: Set<string>): boolean => {
        if (from === goal) return true;
        if (visited.has(from)) return false;
        visited.add(from);
        const t = tasks.find((task) => task.id === from);
        return (t?.depends_on ?? []).some((dep) => reachable(dep, goal, visited));
      };
      if (reachable(sourceId, targetId, new Set())) return;

      onSchemaChange((s) => ({
        ...s,
        tasks: (s.tasks ?? []).map((t) =>
          t.id === targetId
            ? { ...t, depends_on: [...new Set([...(t.depends_on ?? []), sourceId])] }
            : t,
        ),
      }));
    },
    [onSchemaChange, tasks],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith('phase:')) {
        onSelect({ kind: 'phase', phaseName: node.id.replace('phase:', '') });
      } else if (node.id.startsWith('task:')) {
        onSelect({ kind: 'task', taskId: node.id.replace('task:', '') });
      }
    },
    [onSelect],
  );

  const handlePaneClick = useCallback(() => {
    onSelect({ kind: 'template' });
  }, [onSelect]);

  const addPhase = useCallback(() => {
    const newPhase = createEmptyPhase(phases.length);
    onSchemaChange((s) => ({
      ...s,
      workflow: {
        ...s.workflow,
        phases: [...(s.workflow?.phases ?? []), newPhase],
      },
    }));
  }, [phases.length, onSchemaChange]);

  const addTaskToLastPhase = useCallback(() => {
    if (phases.length === 0) return;
    const lastPhase = phases[phases.length - 1];
    const newTask = createEmptyTask(phases.length - 1, lastPhase.tasks.length);
    onSchemaChange((s) => ({
      ...s,
      tasks: [...(s.tasks ?? []), newTask],
      workflow: {
        ...s.workflow,
        phases: (s.workflow?.phases ?? []).map((p) =>
          p.name === lastPhase.name ? { ...p, tasks: [...p.tasks, newTask.id] } : p,
        ),
      },
    }));
  }, [phases, onSchemaChange]);

  // Context menu
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      e.preventDefault();
      if (node.id.startsWith('phase:')) {
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'phase', id: node.id.replace('phase:', '') });
      } else if (node.id.startsWith('task:')) {
        setContextMenu({ x: e.clientX, y: e.clientY, type: 'task', id: node.id.replace('task:', '') });
      }
    },
    [],
  );

  const handleEdgeContextMenu = useCallback(
    (e: React.MouseEvent, edge: Edge) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, type: 'edge', id: edge.id });
    },
    [],
  );

  const handlePaneContextMenu = useCallback(
    (e: MouseEvent | React.MouseEvent) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, type: 'canvas', id: '' });
    },
    [],
  );

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [contextMenu]);

  // Double-click inline rename
  const [renaming, setRenaming] = useState<{ type: 'task' | 'phase'; id: string; value: string } | null>(null);

  const handleNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.id.startsWith('task:')) {
        const taskId = node.id.replace('task:', '');
        const task = tasks.find((t) => t.id === taskId);
        if (task) setRenaming({ type: 'task', id: taskId, value: task.title_template || task.id });
      } else if (node.id.startsWith('phase:')) {
        const phaseName = node.id.replace('phase:', '');
        setRenaming({ type: 'phase', id: phaseName, value: phaseName });
      }
    },
    [tasks],
  );

  const commitRename = useCallback(() => {
    if (!renaming || !renaming.value.trim()) { setRenaming(null); return; }
    if (renaming.type === 'task') {
      onSchemaChange((s) => ({
        ...s,
        tasks: (s.tasks ?? []).map((t) => t.id === renaming.id ? { ...t, title_template: renaming.value } : t),
      }));
    } else {
      const oldName = renaming.id;
      const newName = renaming.value;
      onSchemaChange((s) => ({
        ...s,
        workflow: {
          ...s.workflow,
          phases: (s.workflow?.phases ?? []).map((p) => p.name === oldName ? { ...p, name: newName } : p),
        },
      }));
      onSelect({ kind: 'phase', phaseName: newName });
    }
    setRenaming(null);
  }, [renaming, onSchemaChange, onSelect]);

  // Delete handler — only for nodes (task/phase); edge deletion handled by onEdgesChange
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (selected.kind === 'task') {
        // Also remove this task from other tasks' depends_on
        const taskId = selected.taskId;
        onSchemaChange((s) => ({
          ...s,
          tasks: (s.tasks ?? [])
            .filter((t) => t.id !== taskId)
            .map((t) => {
              const deps = (t.depends_on ?? []).filter((d) => d !== taskId);
              return deps.length === (t.depends_on ?? []).length
                ? t
                : { ...t, depends_on: deps.length > 0 ? deps : undefined };
            }),
          workflow: {
            ...s.workflow,
            phases: (s.workflow?.phases ?? []).map((p) => ({
              ...p,
              tasks: p.tasks.filter((id) => id !== taskId),
            })),
          },
        }));
        onSelect({ kind: 'template' });
      } else if (selected.kind === 'phase') {
        const phase = phases.find((p) => p.name === selected.phaseName);
        const phaseTaskIds = new Set(phase?.tasks ?? []);
        onSchemaChange((s) => ({
          ...s,
          tasks: (s.tasks ?? [])
            .filter((t) => !phaseTaskIds.has(t.id))
            .map((t) => {
              const deps = (t.depends_on ?? []).filter((d) => !phaseTaskIds.has(d));
              return deps.length === (t.depends_on ?? []).length
                ? t
                : { ...t, depends_on: deps.length > 0 ? deps : undefined };
            }),
          workflow: {
            ...s.workflow,
            phases: (s.workflow?.phases ?? []).filter((p) => p.name !== selected.phaseName),
          },
        }));
        onSelect({ kind: 'template' });
      }
    },
    [selected, phases, onSchemaChange, onSelect],
  );

  return (
    <div className="flex-1 relative" tabIndex={0} onKeyDown={handleKeyDown}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={handleNodeDoubleClick}
        onNodeContextMenu={handleNodeContextMenu}
        onEdgeContextMenu={handleEdgeContextMenu}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        fitView
        proOptions={{ hideAttribution: true }}
        deleteKeyCode="Delete"
      >
        {showGrid && <Background />}
        <Controls />
        <Panel position="top-left">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={addPhase}>
              <Plus className="h-3 w-3" />
              Phase
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={addTaskToLastPhase}
              disabled={phases.length === 0}
            >
              <Plus className="h-3 w-3" />
              Task
            </Button>
          </div>
        </Panel>
        {phases.length === 0 && (
          <Panel position="top-center">
            <div className="mt-32 text-center text-muted text-sm px-4">
              <p className="font-medium mb-1">Empty template</p>
              <p>Click &quot;Phase&quot; to add your first workflow phase, then add tasks to it.</p>
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-border bg-surface shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === 'task' && (
            <>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2"
                onClick={() => { onSelect({ kind: 'task', taskId: contextMenu.id }); setContextMenu(null); }}
              >Edit</button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2"
                onClick={() => {
                  const task = tasks.find((t) => t.id === contextMenu.id);
                  if (task) {
                    const newId = `${task.id}_copy`;
                    const clone = { ...structuredClone(task), id: newId };
                    const phase = phases.find((p) => p.tasks.includes(task.id));
                    onSchemaChange((s) => ({
                      ...s,
                      tasks: [...(s.tasks ?? []), clone],
                      workflow: phase ? {
                        ...s.workflow,
                        phases: (s.workflow?.phases ?? []).map((p) =>
                          p.name === phase.name ? { ...p, tasks: [...p.tasks, newId] } : p),
                      } : s.workflow,
                    }));
                  }
                  setContextMenu(null);
                }}
              ><Copy className="h-3 w-3" />Duplicate</button>
              {phases.filter((p) => !p.tasks.includes(contextMenu.id)).map((targetPhase) => (
                <button
                  key={targetPhase.name}
                  type="button"
                  className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2"
                  onClick={() => {
                    const srcPhase = phases.find((p) => p.tasks.includes(contextMenu.id));
                    onSchemaChange((s) => ({
                      ...s,
                      workflow: {
                        ...s.workflow,
                        phases: (s.workflow?.phases ?? []).map((p) => {
                          if (p.name === srcPhase?.name) return { ...p, tasks: p.tasks.filter((id) => id !== contextMenu.id) };
                          if (p.name === targetPhase.name) return { ...p, tasks: [...p.tasks, contextMenu.id] };
                          return p;
                        }),
                      },
                    }));
                    setContextMenu(null);
                  }}
                ><ArrowRightLeft className="h-3 w-3" />Move to {targetPhase.name}</button>
              ))}
              <div className="border-t border-border/50 my-0.5" />
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2 text-red-600"
                onClick={() => {
                  onSchemaChange((s) => ({
                    ...s,
                    tasks: (s.tasks ?? []).filter((t) => t.id !== contextMenu.id),
                    workflow: {
                      ...s.workflow,
                      phases: (s.workflow?.phases ?? []).map((p) => ({ ...p, tasks: p.tasks.filter((id) => id !== contextMenu.id) })),
                    },
                  }));
                  onSelect({ kind: 'template' });
                  setContextMenu(null);
                }}
              ><Trash2 className="h-3 w-3" />Delete</button>
            </>
          )}
          {contextMenu.type === 'phase' && (
            <>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30"
                onClick={() => {
                  setRenaming({ type: 'phase', id: contextMenu.id, value: contextMenu.id });
                  setContextMenu(null);
                }}
              >Rename</button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2"
                onClick={() => {
                  const phaseIndex = phases.findIndex((p) => p.name === contextMenu.id);
                  const phase = phases[phaseIndex];
                  if (phase) {
                    const newTask = createEmptyTask(phaseIndex, phase.tasks.length);
                    onSchemaChange((s) => ({
                      ...s,
                      tasks: [...(s.tasks ?? []), newTask],
                      workflow: {
                        ...s.workflow,
                        phases: (s.workflow?.phases ?? []).map((p) =>
                          p.name === contextMenu.id ? { ...p, tasks: [...p.tasks, newTask.id] } : p),
                      },
                    }));
                  }
                  setContextMenu(null);
                }}
              ><Plus className="h-3 w-3" />Add Task</button>
              <div className="border-t border-border/50 my-0.5" />
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2 text-red-600"
                onClick={() => {
                  const phase = phases.find((p) => p.name === contextMenu.id);
                  const phaseTaskIds = new Set(phase?.tasks ?? []);
                  onSchemaChange((s) => ({
                    ...s,
                    tasks: (s.tasks ?? []).filter((t) => !phaseTaskIds.has(t.id)),
                    workflow: {
                      ...s.workflow,
                      phases: (s.workflow?.phases ?? []).filter((p) => p.name !== contextMenu.id),
                    },
                  }));
                  onSelect({ kind: 'template' });
                  setContextMenu(null);
                }}
              ><Trash2 className="h-3 w-3" />Delete Phase</button>
            </>
          )}
          {contextMenu.type === 'edge' && (
            <button
              type="button"
              className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2 text-red-600"
              onClick={() => {
                const edgeId = contextMenu.id;
                // Parse edge id: "edge:sourceId->targetId"
                const match = edgeId.match(/^edge:(.+)->(.+)$/);
                if (match) {
                  const [, sourceId, targetId] = match;
                  onSchemaChange((s) => ({
                    ...s,
                    tasks: (s.tasks ?? []).map((t) =>
                      t.id === targetId
                        ? {
                            ...t,
                            depends_on: (t.depends_on ?? []).filter((d) => d !== sourceId),
                          }
                        : t,
                    ),
                  }));
                }
                setContextMenu(null);
              }}
            ><Trash2 className="h-3 w-3" />Remove dependency</button>
          )}
          {contextMenu.type === 'canvas' && (
            <>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2"
                onClick={() => { addPhase(); setContextMenu(null); }}
              ><Plus className="h-3 w-3" />Add Phase</button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2"
                onClick={() => { addTaskToLastPhase(); setContextMenu(null); }}
                disabled={phases.length === 0}
              ><Plus className="h-3 w-3" />Add Task</button>
              <div className="border-t border-border/50 my-0.5" />
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2"
                onClick={() => { fitView({ padding: 0.2, duration: 300 }); setContextMenu(null); }}
              ><Maximize className="h-3 w-3" />Fit View</button>
              <button
                type="button"
                className="w-full text-left px-3 py-1.5 hover:bg-border/30 flex items-center gap-2"
                onClick={() => { setShowGrid((g) => !g); setContextMenu(null); }}
              ><Grid3x3 className="h-3 w-3" />{showGrid ? 'Hide Grid' : 'Show Grid'}</button>
            </>
          )}
        </div>
      )}

      {/* Inline rename overlay */}
      {renaming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setRenaming(null)}>
          <div className="bg-surface border border-border rounded-md p-3 shadow-lg" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs text-muted mb-2">
              Rename {renaming.type === 'task' ? 'task' : 'phase'}
            </p>
            <Input
              autoFocus
              value={renaming.value}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }}
              className="text-sm h-8 w-64"
            />
            <div className="flex justify-end gap-2 mt-2">
              <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
              <Button size="sm" onClick={commitRename}>Rename</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Code mode (lazy Monaco)
// ---------------------------------------------------------------------------

import { lazy, Suspense } from 'react';

const MonacoEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.Editor })),
);

function CodeCanvas({
  state,
  onChange,
  onParseErrorChange,
}: {
  state: TemplateEditorState;
  onChange: (state: TemplateEditorState) => void;
  onParseErrorChange: (hasError: boolean) => void;
}) {
  const [parseError, setParseError] = useState<string | null>(null);

  const jsonText = useMemo(() => JSON.stringify(state.schema, null, 2), [state.schema]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;
      try {
        const parsed = JSON.parse(value);
        setParseError(null);
        onParseErrorChange(false);
        onChange({ ...state, schema: parsed });
      } catch (err) {
        setParseError((err as Error).message);
        onParseErrorChange(true);
      }
    },
    [state, onChange, onParseErrorChange],
  );

  return (
    <div className="flex-1 flex flex-col">
      {parseError && (
        <div className="px-3 py-1.5 text-xs text-red-600 bg-red-50 border-b border-red-200">
          JSON error: {parseError} — fix before switching to Visual mode
        </div>
      )}
      <Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center text-muted text-sm">
            Loading editor...
          </div>
        }
      >
        <MonacoEditor
          height="100%"
          language="json"
          value={jsonText}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            tabSize: 2,
            formatOnPaste: true,
          }}
        />
      </Suspense>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main canvas component
// ---------------------------------------------------------------------------

export function TemplateCanvas({
  state,
  mode,
  onModeChange,
  selected,
  onSelect,
  onChange,
  onSchemaChange,
}: CanvasProps): JSX.Element {
  const [hasParseError, setHasParseError] = useState(false);

  const handleModeChange = useCallback(
    (newMode: 'visual' | 'code') => {
      if (hasParseError && newMode === 'visual') return;
      onModeChange(newMode);
    },
    [hasParseError, onModeChange],
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Mode toggle */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-1.5 border-b border-border bg-surface/50">
        <Button
          size="sm"
          variant={mode === 'visual' ? 'default' : 'ghost'}
          onClick={() => handleModeChange('visual')}
          disabled={hasParseError && mode === 'code'}
          className="h-7 text-xs"
        >
          <Eye className="h-3 w-3" />
          Visual
        </Button>
        <Button
          size="sm"
          variant={mode === 'code' ? 'default' : 'ghost'}
          onClick={() => handleModeChange('code')}
          className="h-7 text-xs"
        >
          <Code className="h-3 w-3" />
          Code
        </Button>
      </div>

      {/* Canvas body */}
      {mode === 'visual' ? (
        <ReactFlowProvider>
          <VisualCanvasInner
            state={state}
            selected={selected}
            onSelect={onSelect}
            onSchemaChange={onSchemaChange}
          />
        </ReactFlowProvider>
      ) : (
        <CodeCanvas state={state} onChange={onChange} onParseErrorChange={setHasParseError} />
      )}
    </div>
  );
}
