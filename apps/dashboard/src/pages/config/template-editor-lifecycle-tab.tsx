import { useCallback } from 'react';
import { Input } from '../../components/ui/input.js';
import { Switch } from '../../components/ui/switch.js';
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
import type { TemplateDefinition, LifecyclePolicy } from './template-editor-types.js';

interface LifecycleTabProps {
  template: TemplateDefinition;
  onChange: (template: TemplateDefinition) => void;
}

export function LifecycleTab({ template, onChange }: LifecycleTabProps): JSX.Element {
  const { lifecycle } = template;

  const updateRetry = useCallback(
    (field: keyof LifecyclePolicy['retry'], value: string | number) => {
      onChange({
        ...template,
        lifecycle: {
          ...lifecycle,
          retry: { ...lifecycle.retry, [field]: value },
        },
      });
    },
    [template, lifecycle, onChange],
  );

  const updateEscalation = useCallback(
    (field: keyof LifecyclePolicy['escalation'], value: string | boolean) => {
      onChange({
        ...template,
        lifecycle: {
          ...lifecycle,
          escalation: { ...lifecycle.escalation, [field]: value },
        },
      });
    },
    [template, lifecycle, onChange],
  );

  const updateRework = useCallback(
    (value: number) => {
      onChange({
        ...template,
        lifecycle: {
          ...lifecycle,
          rework: { max_cycles: value },
        },
      });
    },
    [template, lifecycle, onChange],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Retry Policy</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted">Max Attempts</label>
            <Input
              type="number"
              min={0}
              value={lifecycle.retry.max_attempts}
              onChange={(e) => updateRetry('max_attempts', Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted">Backoff Strategy</label>
            <Select
              value={lifecycle.retry.backoff_strategy}
              onValueChange={(val) => updateRetry('backoff_strategy', val)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed</SelectItem>
                <SelectItem value="exponential">Exponential</SelectItem>
                <SelectItem value="linear">Linear</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted">Initial Delay (ms)</label>
            <Input
              type="number"
              min={0}
              value={lifecycle.retry.initial_delay_ms}
              onChange={(e) => updateRetry('initial_delay_ms', Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted">
              Retryable Error Types
            </label>
            <Input
              value={lifecycle.retry.retryable_error_types}
              onChange={(e) => updateRetry('retryable_error_types', e.target.value)}
              placeholder="timeout,rate_limit"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Escalation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Enabled</label>
            <Switch
              checked={lifecycle.escalation.is_enabled}
              onCheckedChange={(checked) =>
                updateEscalation('is_enabled', checked)
              }
            />
          </div>
          {lifecycle.escalation.is_enabled && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted">Target Role</label>
                <Input
                  value={lifecycle.escalation.target_role}
                  onChange={(e) => updateEscalation('target_role', e.target.value)}
                  placeholder="senior_developer"
                />
              </div>
              <div className="space-y-2 col-span-2">
                <label className="text-xs font-medium text-muted">Instructions</label>
                <Input
                  value={lifecycle.escalation.instructions}
                  onChange={(e) =>
                    updateEscalation('instructions', e.target.value)
                  }
                  placeholder="Escalation instructions..."
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rework</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted">Max Cycles</label>
            <Input
              type="number"
              min={0}
              value={lifecycle.rework.max_cycles}
              onChange={(e) => updateRework(Number(e.target.value))}
              className="w-32"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
