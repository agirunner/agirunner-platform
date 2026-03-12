import type { ReactNode } from 'react';

import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { type RuntimePoolDraft } from './playbook-authoring-support.js';

export function SectionCard(props: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card id={props.id} className="scroll-mt-24 border-border/70 bg-card/80 shadow-sm">
      <CardHeader className="space-y-1 pb-4">
        <CardTitle className="text-base">{props.title}</CardTitle>
        <p className="text-sm text-muted">{props.description}</p>
      </CardHeader>
      <CardContent>{props.children}</CardContent>
    </Card>
  );
}

export function LabeledField(props: {
  label: string;
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <label className={`grid gap-2 text-sm ${props.className ?? ''}`.trim()}>
      <span className="font-medium">{props.label}</span>
      {props.children}
    </label>
  );
}

export function ToggleField(props: {
  label: string;
  checked: boolean;
  onCheckedChange(checked: boolean): void;
}): JSX.Element {
  return (
    <label className="flex items-center gap-3 text-sm">
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
      <span className="font-medium">{props.label}</span>
    </label>
  );
}

export function RuntimePoolFields(props: {
  title: string;
  pool: RuntimePoolDraft;
  canDisable?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onChange(field: keyof Omit<RuntimePoolDraft, 'enabled'>, value: string): void;
}): JSX.Element {
  const disabled = props.canDisable && props.pool.enabled === false;

  return (
    <div className="rounded-md border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="text-sm font-medium">{props.title}</div>
        {props.canDisable ? (
          <ToggleField
            label="Enable override"
            checked={props.pool.enabled !== false}
            onCheckedChange={(checked) => props.onEnabledChange?.(checked)}
          />
        ) : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledField label="Pool mode">
          <Select
            value={props.pool.pool_mode || '__unset__'}
            onValueChange={(value) =>
              props.onChange('pool_mode', value === '__unset__' ? '' : value)
            }
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="inherit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset__">inherit</SelectItem>
              <SelectItem value="warm">warm</SelectItem>
              <SelectItem value="cold">cold</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>
        <LabeledField label="Pull policy">
          <Select
            value={props.pool.pull_policy || '__unset__'}
            onValueChange={(value) =>
              props.onChange('pull_policy', value === '__unset__' ? '' : value)
            }
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="inherit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unset__">inherit</SelectItem>
              <SelectItem value="always">always</SelectItem>
              <SelectItem value="if-not-present">if-not-present</SelectItem>
              <SelectItem value="never">never</SelectItem>
            </SelectContent>
          </Select>
        </LabeledField>
        <LabeledField label="Image">
          <Input
            value={props.pool.image}
            onChange={(event) => props.onChange('image', event.target.value)}
            disabled={disabled}
            placeholder="ghcr.io/agirunner/runtime:latest"
          />
        </LabeledField>
        <LabeledField label="Max runtimes">
          <Input
            type="number"
            inputMode="numeric"
            value={props.pool.max_runtimes}
            onChange={(event) => props.onChange('max_runtimes', event.target.value)}
            disabled={disabled}
            placeholder="4"
          />
        </LabeledField>
        <LabeledField label="CPU">
          <Input
            value={props.pool.cpu}
            onChange={(event) => props.onChange('cpu', event.target.value)}
            disabled={disabled}
            placeholder="2"
          />
        </LabeledField>
        <LabeledField label="Memory">
          <Input
            value={props.pool.memory}
            onChange={(event) => props.onChange('memory', event.target.value)}
            disabled={disabled}
            placeholder="4Gi"
          />
        </LabeledField>
        <LabeledField label="Priority">
          <Input
            type="number"
            inputMode="numeric"
            value={props.pool.priority}
            onChange={(event) => props.onChange('priority', event.target.value)}
            disabled={disabled}
            placeholder="10"
          />
        </LabeledField>
        <LabeledField label="Idle timeout (seconds)">
          <Input
            type="number"
            inputMode="numeric"
            value={props.pool.idle_timeout_seconds}
            onChange={(event) => props.onChange('idle_timeout_seconds', event.target.value)}
            disabled={disabled}
            placeholder="600"
          />
        </LabeledField>
        <LabeledField label="Grace period (seconds)">
          <Input
            type="number"
            inputMode="numeric"
            value={props.pool.grace_period_seconds}
            onChange={(event) => props.onChange('grace_period_seconds', event.target.value)}
            disabled={disabled}
            placeholder="60"
          />
        </LabeledField>
      </div>
    </div>
  );
}
