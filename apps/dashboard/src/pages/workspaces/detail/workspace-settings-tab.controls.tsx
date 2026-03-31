import type { ChangeEvent, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

import { Badge } from '../../../components/ui/badge.js';
import { FieldErrorText } from '../../../components/forms/form-feedback.js';
import { Card, CardContent } from '../../../components/ui/card.js';
import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';
import { Textarea } from '../../../components/ui/textarea.js';
import { cn } from '../../../lib/utils.js';
import {
  buildWorkspaceSecretPostureSummary,
  type WorkspaceSecretDraft,
  type WorkspaceSecretMode,
} from './workspace-settings-support.js';

const SECRET_MODE_OPTIONS: Array<{ value: WorkspaceSecretMode; label: string }> = [
  { value: 'preserve', label: 'Preserve existing' },
  { value: 'replace', label: 'Replace on save' },
  { value: 'clear', label: 'Clear on save' },
];

export function StaticSettingsSection(props: {
  id: string;
  title: string;
  description: string;
  summary?: string;
  headerAction?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card id={props.id} className="border-border/70 shadow-none">
      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="text-base font-semibold text-foreground">{props.title}</div>
            <p className="text-sm leading-6 text-muted">
              {[props.description, props.summary].filter(Boolean).join(' ')}
            </p>
          </div>
          {props.headerAction ? <div className="shrink-0">{props.headerAction}</div> : null}
        </div>
      </div>
      <CardContent className="px-4 pb-4 pt-0">{props.children}</CardContent>
    </Card>
  );
}

export function SettingsDisclosureSection(props: {
  id: string;
  title: string;
  description: string;
  summary?: string;
  actionLabel: string;
  isExpanded: boolean;
  onToggle(): void;
  children: ReactNode;
}): JSX.Element {
  return (
    <Card id={props.id} className="border-border/70 shadow-none">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left"
        aria-expanded={props.isExpanded}
        onClick={props.onToggle}
      >
        <div className="min-w-0 flex-1 space-y-1">
          <div className="text-base font-semibold text-foreground">{props.title}</div>
          <p className="text-sm leading-6 text-muted">
            {[props.description, props.summary].filter(Boolean).join(' ')}
          </p>
        </div>
        <div className="flex items-center pt-0.5">
          <span className="sr-only">{props.actionLabel}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted transition-transform',
              props.isExpanded && 'rotate-180',
            )}
          />
        </div>
      </button>
      {props.isExpanded ? (
        <CardContent className="px-4 pb-4 pt-0">{props.children}</CardContent>
      ) : null}
    </Card>
  );
}

export function TextField(props: {
  label: string;
  value: string;
  error?: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{props.label}</span>
      <Input
        value={props.value}
        aria-invalid={props.error ? true : undefined}
        onChange={(event) => props.onChange(event.target.value)}
      />
      <FieldErrorText message={props.error} />
    </label>
  );
}

export function SecretDisclosureRow(props: {
  label: string;
  draft: WorkspaceSecretDraft;
  error?: string;
  textarea?: boolean;
  isExpanded: boolean;
  onToggle(): void;
  onChange(next: WorkspaceSecretDraft): void;
}): JSX.Element {
  const InputComponent = props.textarea ? Textarea : Input;
  const summary = buildWorkspaceSecretPostureSummary(props.draft);
  const isBodyVisible = props.isExpanded || props.draft.mode === 'replace';
  const actionLabel = props.draft.configured
    ? props.isExpanded
      ? 'Hide secret'
      : 'Edit secret'
    : props.isExpanded
      ? 'Hide setup'
      : 'Set up secret';

  return (
    <div className="rounded-xl border border-border/70 bg-background/70">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 px-3.5 py-3 text-left"
        aria-expanded={isBodyVisible}
        onClick={props.onToggle}
      >
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-medium text-foreground">{props.label}</div>
            <Badge variant={props.draft.configured ? 'secondary' : 'outline'}>
              {summary.statusLabel}
            </Badge>
            <Badge variant={summary.tone === 'warning' ? 'warning' : 'outline'}>
              {summary.postureLabel}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-muted">{summary.detail}</p>
        </div>
        <div className="flex items-center gap-2 pt-0.5">
          <span className="text-xs font-medium text-muted">{actionLabel}</span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-muted transition-transform',
              isBodyVisible && 'rotate-180',
            )}
          />
        </div>
      </button>

      {isBodyVisible ? (
        <div className="space-y-3 border-t border-border/70 px-3.5 py-3">
          <label className="grid gap-1.5 text-xs sm:max-w-[220px]">
            <span className="font-medium text-muted">Secret posture</span>
            <Select
              value={props.draft.mode}
              onValueChange={(value) =>
                props.onChange({
                  ...props.draft,
                  mode: value as WorkspaceSecretMode,
                  value: value === 'clear' ? '' : props.draft.value,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SECRET_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          {props.draft.mode === 'replace' ? (
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">New value</span>
              <InputComponent
                value={props.draft.value}
                aria-invalid={props.error ? true : undefined}
                className={props.textarea ? 'min-h-[96px]' : undefined}
                onChange={(
                  event: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLTextAreaElement>,
                ) => props.onChange({ ...props.draft, value: event.target.value })}
              />
              <FieldErrorText message={props.error} />
            </label>
          ) : props.draft.mode === 'clear' ? (
            <p className="text-xs leading-5 text-muted">
              Stored value will be cleared when you save.
            </p>
          ) : !props.draft.configured ? (
            <p className="text-xs leading-5 text-muted">
              Choose Replace on save when you are ready to add this secret.
            </p>
          ) : (
            <p className="text-xs leading-5 text-muted">Stored value will stay unchanged.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
