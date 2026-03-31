import type { ReactNode } from 'react';

import { DashboardSectionCard } from '../../components/layout/dashboard-section-card.js';
import { Switch } from '../../components/ui/switch.js';

export function SectionCard(props: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <DashboardSectionCard
      id={props.id}
      className="scroll-mt-24"
      title={props.title}
      description={props.description}
    >
      {props.children}
    </DashboardSectionCard>
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
