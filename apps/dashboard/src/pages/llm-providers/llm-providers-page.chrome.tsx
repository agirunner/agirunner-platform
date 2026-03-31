import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { cn } from '../../lib/utils.js';
import {
  DASHBOARD_BADGE_BASE_CLASS_NAME,
  DASHBOARD_BADGE_TOKENS,
} from '../../lib/dashboard-badge-palette.js';
import type { AssignmentSurfaceSummaryCard } from './llm-providers-page.support.js';
import type { AssignmentRoleRow } from './llm-providers-page.types.js';

export const ELEVATED_SURFACE_CLASS_NAME = 'border-border/80 bg-surface shadow-sm';
export const SUBDUED_SURFACE_CLASS_NAME =
  'rounded-xl border border-border/70 bg-surface p-4 shadow-sm';
export const INSET_PANEL_CLASS_NAME = 'rounded-xl border border-border/70 bg-background/60 p-4';
export const DIALOG_ALERT_CLASS_NAME = 'rounded-xl border px-4 py-3 text-sm shadow-sm';
export const FIELD_ERROR_CLASS_NAME = 'text-xs font-medium';
export const DELETE_ACTION_CLASS_NAME =
  'text-destructive hover:bg-destructive/10 hover:text-destructive';
const OVERRIDES_CHIP_CLASS_NAME = DASHBOARD_BADGE_BASE_CLASS_NAME;
const OVERRIDES_NEUTRAL_CHIP_CLASS_NAME = DASHBOARD_BADGE_TOKENS.informationPrimary.className;
const OVERRIDES_WARNING_CHIP_CLASS_NAME = DASHBOARD_BADGE_TOKENS.warning.className;

const SUCCESS_PANEL_STYLE = {
  borderColor: 'color-mix(in srgb, var(--color-success) 38%, var(--color-border))',
  backgroundColor: 'color-mix(in srgb, var(--color-surface) 90%, var(--color-success) 10%)',
  color: 'var(--color-foreground)',
};
export const WARNING_PANEL_STYLE = {
  borderColor: 'color-mix(in srgb, var(--color-warning) 38%, var(--color-border))',
  backgroundColor: 'color-mix(in srgb, var(--color-surface) 90%, var(--color-warning) 10%)',
  color: 'var(--color-foreground)',
};
export const ERROR_PANEL_STYLE = {
  borderColor: 'color-mix(in srgb, var(--color-destructive) 38%, var(--color-border))',
  backgroundColor: 'color-mix(in srgb, var(--color-surface) 90%, var(--color-destructive) 10%)',
  color: 'var(--color-foreground)',
};
export const ERROR_TEXT_STYLE = { color: 'var(--color-destructive)' };

export function panelToneStyle(tone: 'danger' | 'warning' | 'success') {
  if (tone === 'danger') return ERROR_PANEL_STYLE;
  if (tone === 'warning') return WARNING_PANEL_STYLE;
  return SUCCESS_PANEL_STYLE;
}

export function renderRoleStatusBadge(role: AssignmentRoleRow): JSX.Element {
  if (role.source === 'system') {
    return <Badge variant="secondary">System</Badge>;
  }
  if (role.isActive) {
    return <Badge variant="outline">Active</Badge>;
  }
  if (role.source === 'catalog') {
    return <Badge variant="warning">Inactive</Badge>;
  }
  return <Badge variant="warning">Assignment only</Badge>;
}

export function renderOverridesSummaryChip(
  label: string,
  tone: 'neutral' | 'warning' = 'neutral',
): JSX.Element {
  const toneClassName =
    tone === 'warning' ? OVERRIDES_WARNING_CHIP_CLASS_NAME : OVERRIDES_NEUTRAL_CHIP_CLASS_NAME;

  return <span className={cn(OVERRIDES_CHIP_CLASS_NAME, toneClassName)}>{label}</span>;
}

export function AssignmentSummaryCards(props: {
  cards: AssignmentSurfaceSummaryCard[];
}): JSX.Element {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {props.cards.map((card) => (
        <Card key={card.label} className={ELEVATED_SURFACE_CLASS_NAME}>
          <CardHeader className="space-y-1 pb-3">
            <p className="text-sm font-medium text-muted">{card.label}</p>
            <CardTitle className="text-xl">{card.value}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted">{card.detail}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function SubsectionPanel(props: {
  title: ReactNode;
  description?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}): JSX.Element {
  const hasContent =
    props.children !== undefined && props.children !== null && props.children !== false;

  return (
    <section className={cn(INSET_PANEL_CLASS_NAME, props.className)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-base font-semibold text-foreground">{props.title}</div>
          {props.description ? (
            <p className="text-sm leading-6 text-muted">{props.description}</p>
          ) : null}
        </div>
        {props.headerAction ? <div className="shrink-0">{props.headerAction}</div> : null}
      </div>
      {hasContent ? (
        <div className={cn('mt-4 space-y-4', props.contentClassName)}>{props.children}</div>
      ) : null}
    </section>
  );
}
