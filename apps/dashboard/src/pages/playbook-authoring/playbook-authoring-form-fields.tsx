import type { ReactNode } from 'react';

import { Switch } from '../../components/ui/switch.js';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';

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
