import { useCallback } from 'react';
import { Input } from '../../components/ui/input.js';
import { Button } from '../../components/ui/button.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/card.js';
import { cn } from '../../lib/utils.js';
import type {
  TemplateDefinition,
  RuntimeConfig,
  TaskContainerConfig,
  PullPolicy,
  PoolMode,
} from './template-editor-types.js';

interface RuntimeTabProps {
  template: TemplateDefinition;
  onChange: (template: TemplateDefinition) => void;
}

function PoolModeToggle({
  value,
  onChange,
  isWarmDisabled,
}: {
  value: PoolMode;
  onChange: (mode: PoolMode) => void;
  isWarmDisabled?: boolean;
}): JSX.Element {
  return (
    <div className="flex gap-1">
      <Button
        type="button"
        size="sm"
        variant={value === 'warm' ? 'default' : 'outline'}
        disabled={isWarmDisabled}
        onClick={() => onChange('warm')}
      >
        Warm
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === 'cold' ? 'default' : 'outline'}
        onClick={() => onChange('cold')}
      >
        Cold
      </Button>
    </div>
  );
}

function PullPolicySelect({
  value,
  onChange,
}: {
  value: PullPolicy;
  onChange: (policy: PullPolicy) => void;
}): JSX.Element {
  return (
    <Select value={value} onValueChange={(val) => onChange(val as PullPolicy)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="always">Always</SelectItem>
        <SelectItem value="if-not-present">If Not Present</SelectItem>
        <SelectItem value="never">Never</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function RuntimeTab({ template, onChange }: RuntimeTabProps): JSX.Element {
  const { runtime, task_container: taskContainer } = template;

  const updateRuntime = useCallback(
    (field: keyof RuntimeConfig, value: string | number) => {
      const updated: RuntimeConfig = { ...runtime, [field]: value };
      const updatedTaskContainer = { ...taskContainer };

      if (field === 'pool_mode' && value === 'cold') {
        updatedTaskContainer.pool_mode = 'cold';
        updatedTaskContainer.warm_pool_size = 0;
      }

      onChange({
        ...template,
        runtime: updated,
        task_container: updatedTaskContainer,
      });
    },
    [template, runtime, taskContainer, onChange],
  );

  const updateTaskContainer = useCallback(
    (field: keyof TaskContainerConfig, value: string | number) => {
      const updated: TaskContainerConfig = { ...taskContainer, [field]: value };

      if (field === 'pool_mode' && value === 'cold') {
        updated.warm_pool_size = 0;
      }

      onChange({
        ...template,
        task_container: updated,
      });
    },
    [template, taskContainer, onChange],
  );

  const isRuntimeCold = runtime.pool_mode === 'cold';
  const isTaskContainerCold = taskContainer.pool_mode === 'cold';

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Runtime Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Pool Mode</label>
              <PoolModeToggle
                value={runtime.pool_mode}
                onChange={(mode) => updateRuntime('pool_mode', mode)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Max Runtimes</label>
              <Input
                type="number"
                min={1}
                max={100}
                value={runtime.max_runtimes}
                onChange={(e) => updateRuntime('max_runtimes', Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Priority</label>
              <Input
                type="number"
                min={0}
                max={100}
                value={runtime.priority}
                onChange={(e) => updateRuntime('priority', Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Idle Timeout (seconds)</label>
              <Input
                type="number"
                min={0}
                value={runtime.idle_timeout}
                onChange={(e) => updateRuntime('idle_timeout', Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Grace Period (seconds)</label>
              <Input
                type="number"
                min={0}
                value={runtime.grace_period}
                onChange={(e) => updateRuntime('grace_period', Number(e.target.value))}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Image</label>
              <Input
                value={runtime.image}
                onChange={(e) => updateRuntime('image', e.target.value)}
                placeholder="agirunner-runtime:local"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Pull Policy</label>
              <PullPolicySelect
                value={runtime.pull_policy}
                onChange={(policy) => updateRuntime('pull_policy', policy)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">CPU Limit</label>
              <Input
                value={runtime.cpu_limit}
                onChange={(e) => updateRuntime('cpu_limit', e.target.value)}
                placeholder="1.0"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Memory Limit</label>
              <Input
                value={runtime.memory_limit}
                onChange={(e) => updateRuntime('memory_limit', e.target.value)}
                placeholder="512m"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task Container Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Pool Mode</label>
              <PoolModeToggle
                value={taskContainer.pool_mode}
                onChange={(mode) => updateTaskContainer('pool_mode', mode)}
                isWarmDisabled={isRuntimeCold}
              />
              {isRuntimeCold && (
                <p className="text-xs text-muted">
                  Warm pool unavailable when runtime pool mode is cold.
                </p>
              )}
            </div>
            <div className={cn('space-y-2', isTaskContainerCold && 'opacity-50')}>
              <label className="text-xs font-medium text-muted">Warm Pool Size</label>
              <Input
                type="number"
                min={0}
                value={taskContainer.warm_pool_size}
                onChange={(e) => updateTaskContainer('warm_pool_size', Number(e.target.value))}
                disabled={isTaskContainerCold}
              />
            </div>
            <div className="space-y-2 col-span-2">
              <label className="text-xs font-medium text-muted">Image</label>
              <Input
                value={taskContainer.image}
                onChange={(e) => updateTaskContainer('image', e.target.value)}
                placeholder="ubuntu:22.04"
              />
              <p className="text-xs text-muted">
                Base OS image for task execution. Common choices: alpine, ubuntu, debian, fedora, amazonlinux.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Pull Policy</label>
              <PullPolicySelect
                value={taskContainer.pull_policy}
                onChange={(policy) => updateTaskContainer('pull_policy', policy)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">CPU Limit</label>
              <Input
                value={taskContainer.cpu_limit}
                onChange={(e) => updateTaskContainer('cpu_limit', e.target.value)}
                placeholder="0.5"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted">Memory Limit</label>
              <Input
                value={taskContainer.memory_limit}
                onChange={(e) => updateTaskContainer('memory_limit', e.target.value)}
                placeholder="256m"
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
