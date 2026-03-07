import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import type { TemplateDefinition } from './template-editor-types.js';
import type { SelectedItem } from './template-editor-visual-tab.js';

interface VisualEditPanelProps {
  template: TemplateDefinition;
  selectedItem: SelectedItem;
  onSave: (template: TemplateDefinition) => void;
  onClose: () => void;
}

export function VisualEditPanel({
  template,
  selectedItem,
  onSave,
  onClose,
}: VisualEditPanelProps): JSX.Element {
  if (selectedItem.kind === 'phase') {
    return (
      <PhaseEditForm
        template={template}
        phaseId={selectedItem.phaseId}
        onSave={onSave}
        onClose={onClose}
      />
    );
  }

  return (
    <TaskEditForm
      template={template}
      phaseId={selectedItem.phaseId}
      taskId={selectedItem.taskId}
      onSave={onSave}
      onClose={onClose}
    />
  );
}

interface PhaseEditFormProps {
  template: TemplateDefinition;
  phaseId: string;
  onSave: (template: TemplateDefinition) => void;
  onClose: () => void;
}

function PhaseEditForm({ template, phaseId, onSave, onClose }: PhaseEditFormProps): JSX.Element {
  const phase = template.phases.find((p) => p.id === phaseId);
  const [name, setName] = useState(phase?.name ?? '');
  const [gateType, setGateType] = useState(phase?.gate_type ?? 'approval');

  useEffect(() => {
    setName(phase?.name ?? '');
    setGateType(phase?.gate_type ?? 'approval');
  }, [phase]);

  function handleApply() {
    const updatedPhases = template.phases.map((p) =>
      p.id === phaseId ? { ...p, name, gate_type: gateType } : p,
    );
    onSave({ ...template, phases: updatedPhases });
  }

  return (
    <div className="w-72 border-l border-border bg-surface p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Edit Phase</h3>
        <Button size="icon" variant="ghost" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted">Phase Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted">Gate Type</label>
        <Select value={gateType} onValueChange={setGateType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="approval">Approval</SelectItem>
            <SelectItem value="automatic">Automatic</SelectItem>
            <SelectItem value="manual">Manual</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" className="w-full" onClick={handleApply}>
        Apply
      </Button>
    </div>
  );
}

interface TaskEditFormProps {
  template: TemplateDefinition;
  phaseId: string;
  taskId: string;
  onSave: (template: TemplateDefinition) => void;
  onClose: () => void;
}

function TaskEditForm({
  template,
  phaseId,
  taskId,
  onSave,
  onClose,
}: TaskEditFormProps): JSX.Element {
  const phase = template.phases.find((p) => p.id === phaseId);
  const task = phase?.tasks.find((t) => t.id === taskId);

  const [name, setName] = useState(task?.name ?? '');
  const [role, setRole] = useState(task?.role ?? 'developer');
  const [type, setType] = useState(task?.type ?? 'autonomous');

  useEffect(() => {
    setName(task?.name ?? '');
    setRole(task?.role ?? 'developer');
    setType(task?.type ?? 'autonomous');
  }, [task]);

  function handleApply() {
    const updatedPhases = template.phases.map((p) =>
      p.id === phaseId
        ? {
            ...p,
            tasks: p.tasks.map((t) =>
              t.id === taskId ? { ...t, name, role, type } : t,
            ),
          }
        : p,
    );
    onSave({ ...template, phases: updatedPhases });
  }

  return (
    <div className="w-72 border-l border-border bg-surface p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Edit Task</h3>
        <Button size="icon" variant="ghost" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted">Task Name</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted">Role</label>
        <Select value={role} onValueChange={setRole}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="developer">Developer</SelectItem>
            <SelectItem value="reviewer">Reviewer</SelectItem>
            <SelectItem value="architect">Architect</SelectItem>
            <SelectItem value="tester">Tester</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted">Type</label>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="autonomous">Autonomous</SelectItem>
            <SelectItem value="human-review">Human Review</SelectItem>
            <SelectItem value="approval">Approval</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button size="sm" className="w-full" onClick={handleApply}>
        Apply
      </Button>
    </div>
  );
}
