import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Plus } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Badge } from '../../components/ui/badge.js';
import type { TemplateDefinition, PhaseDefinition, TaskDefinition } from './template-editor-types.js';
import { VisualEditPanel } from './template-editor-visual-panel.js';

interface VisualTabProps {
  template: TemplateDefinition;
  onChange: (template: TemplateDefinition) => void;
}

type SelectedItem =
  | { kind: 'phase'; phaseId: string }
  | { kind: 'task'; phaseId: string; taskId: string };

const PHASE_WIDTH = 280;
const PHASE_PADDING = 40;
const TASK_HEIGHT = 50;
const TASK_GAP = 10;

function buildNodes(phases: PhaseDefinition[]): Node[] {
  const nodes: Node[] = [];
  let xOffset = 0;

  for (const phase of phases) {
    const phaseHeight = Math.max(
      120,
      80 + phase.tasks.length * (TASK_HEIGHT + TASK_GAP) + PHASE_PADDING,
    );

    nodes.push({
      id: `phase-${phase.id}`,
      type: 'group',
      position: { x: xOffset, y: 0 },
      style: {
        width: PHASE_WIDTH,
        height: phaseHeight,
        backgroundColor: 'rgba(var(--color-accent-rgb, 100 100 255) / 0.05)',
        border: '1px solid rgba(var(--color-border-rgb, 200 200 200) / 0.5)',
        borderRadius: '8px',
        padding: '8px',
      },
      data: { label: phase.name || 'Unnamed Phase' },
    });

    phase.tasks.forEach((task, taskIndex) => {
      nodes.push({
        id: `task-${task.id}`,
        position: { x: 20, y: 50 + taskIndex * (TASK_HEIGHT + TASK_GAP) },
        parentId: `phase-${phase.id}`,
        extent: 'parent' as const,
        data: { label: task.name || 'Unnamed Task', role: task.role, type: task.type },
        style: {
          width: PHASE_WIDTH - 40,
          padding: '8px 12px',
          backgroundColor: 'var(--color-surface, #fff)',
          border: '1px solid var(--color-border, #e5e7eb)',
          borderRadius: '6px',
          fontSize: '13px',
        },
      });
    });

    xOffset += PHASE_WIDTH + 60;
  }

  return nodes;
}

function buildEdges(phases: PhaseDefinition[]): Edge[] {
  const edges: Edge[] = [];

  for (const phase of phases) {
    for (const task of phase.tasks) {
      for (const dep of task.depends_on) {
        edges.push({
          id: `edge-${dep}-${task.id}`,
          source: `task-${dep}`,
          target: `task-${task.id}`,
          animated: true,
          style: { stroke: 'var(--color-accent, #6366f1)' },
        });
      }
    }
  }

  return edges;
}

function generateId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export function VisualTab({ template, onChange }: VisualTabProps): JSX.Element {
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);

  const initialNodes = useMemo(() => buildNodes(template.phases), [template.phases]);
  const initialEdges = useMemo(() => buildEdges(template.phases), [template.phases]);

  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  const [edges, setEdges] = useState<Edge[]>(initialEdges);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node) => {
      const nodeId = node.id;
      if (nodeId.startsWith('phase-')) {
        const phaseId = nodeId.replace('phase-', '');
        setSelectedItem({ kind: 'phase', phaseId });
      } else if (nodeId.startsWith('task-')) {
        const taskId = nodeId.replace('task-', '');
        const ownerPhase = template.phases.find((p) =>
          p.tasks.some((t) => t.id === taskId),
        );
        if (ownerPhase) {
          setSelectedItem({ kind: 'task', phaseId: ownerPhase.id, taskId });
        }
      }
    },
    [template.phases],
  );

  const addPhase = useCallback(() => {
    const newPhase: PhaseDefinition = {
      id: generateId(),
      name: `Phase ${template.phases.length + 1}`,
      gate: 'all_complete',
      gate_type: 'approval',
      parallel: false,
      tasks: [],
    };
    const updated = { ...template, phases: [...template.phases, newPhase] };
    onChange(updated);
    setNodes(buildNodes(updated.phases));
    setEdges(buildEdges(updated.phases));
  }, [template, onChange]);

  const addTask = useCallback(() => {
    if (template.phases.length === 0) return;
    const lastPhase = template.phases[template.phases.length - 1];
    const newTask: TaskDefinition = {
      id: generateId(),
      name: `Task ${lastPhase.tasks.length + 1}`,
      role: 'developer',
      type: 'autonomous',
      depends_on: [],
      requires_approval: false,
      input_template: '',
      output_mode: 'inline',
    };
    const updatedPhases = template.phases.map((p) =>
      p.id === lastPhase.id ? { ...p, tasks: [...p.tasks, newTask] } : p,
    );
    const updated = { ...template, phases: updatedPhases };
    onChange(updated);
    setNodes(buildNodes(updated.phases));
    setEdges(buildEdges(updated.phases));
  }, [template, onChange]);

  const handleEditSave = useCallback(
    (updatedTemplate: TemplateDefinition) => {
      onChange(updatedTemplate);
      setNodes(buildNodes(updatedTemplate.phases));
      setEdges(buildEdges(updatedTemplate.phases));
    },
    [onChange],
  );

  return (
    <div className="flex h-[600px] border border-border rounded-lg overflow-hidden">
      <div className="flex-1 relative">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={handleNodeClick}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls />
          <Panel position="top-left">
            <div className="flex gap-2">
              <Button size="sm" onClick={addPhase}>
                <Plus className="h-3 w-3" />
                Add Phase
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={addTask}
                disabled={template.phases.length === 0}
              >
                <Plus className="h-3 w-3" />
                Add Task
              </Button>
            </div>
          </Panel>
          {template.phases.length === 0 && (
            <Panel position="top-center">
              <div className="mt-40 text-center text-muted text-sm">
                Click "Add Phase" to start building your workflow.
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>

      {selectedItem && (
        <VisualEditPanel
          template={template}
          selectedItem={selectedItem}
          onSave={handleEditSave}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </div>
  );
}

export { type SelectedItem };
