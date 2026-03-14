import { useState } from 'react';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';

import type {
  DashboardEffectiveModelResolution,
  DashboardLlmModelRecord,
} from '../../lib/api.js';
import { StructuredRecordView } from '../../components/structured-data.js';
import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Textarea } from '../../components/ui/textarea.js';
import { cn } from '../../lib/utils.js';
import { createRoleOverrideDraft, type RoleOverrideDraft } from './project-detail-support.js';

const EMPTY_SELECT_VALUE = '__empty__';

export function RoleOverrideEditor(props: {
  drafts: RoleOverrideDraft[];
  resolvedRoles: string[];
  providerOptions: string[];
  modelOptions: DashboardLlmModelRecord[];
  onChange(drafts: RoleOverrideDraft[]): void;
}): JSX.Element {
  const [expandedDraftId, setExpandedDraftId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      {props.drafts.length === 0 ? (
        <div className="rounded-xl border border-border/70 bg-muted/20 p-3 text-sm text-muted">
          No project-specific overrides configured yet.
        </div>
      ) : (
        props.drafts.map((draft) => {
          const isResolvedRole = props.resolvedRoles.includes(draft.role.trim());
          const providerOptions = ensureCurrentStringOption(props.providerOptions, draft.provider);
          const modelOptions = ensureCurrentStringOption(
            props.modelOptions
              .filter(
                (model) =>
                  !draft.provider || !model.provider_name || model.provider_name === draft.provider,
              )
              .map((model) => model.model_id),
            draft.model,
          );

          return (
            <section key={draft.id} className="rounded-xl border border-border/70 bg-background/70">
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left"
                aria-expanded={expandedDraftId === draft.id}
                onClick={() =>
                  setExpandedDraftId((current) => (current === draft.id ? null : draft.id))
                }
              >
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={isResolvedRole ? 'secondary' : 'outline'}>
                      {isResolvedRole ? 'resolved role' : 'custom role'}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">
                      {draft.role.trim() || 'New role override'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
                    <span>Provider: {draft.provider || 'Inherited / unset'}</span>
                    <span>Model: {draft.model || 'Inherited / unset'}</span>
                    <span>
                      {draft.reasoningConfig.trim()
                        ? 'Reasoning override set'
                        : 'Default reasoning posture'}
                    </span>
                  </div>
                </div>
                <ChevronDown
                  className={cn(
                    'mt-1 h-4 w-4 shrink-0 text-muted transition-transform',
                    expandedDraftId === draft.id && 'rotate-180',
                  )}
                />
              </button>

              {expandedDraftId === draft.id ? (
                <div className="space-y-3 border-t border-border/70 px-4 py-4">
                  <div className="grid gap-3 lg:grid-cols-3">
                    <label className="grid gap-1.5 text-xs">
                      <span className="font-medium">Role</span>
                      <Input
                        value={draft.role}
                        placeholder="architect"
                        onChange={(event) =>
                          props.onChange(
                            updateRoleDraft(props.drafts, draft.id, { role: event.target.value }),
                          )
                        }
                      />
                    </label>
                    <label className="grid gap-1.5 text-xs">
                      <span className="font-medium">Provider</span>
                      <Select
                        value={draft.provider || EMPTY_SELECT_VALUE}
                        onValueChange={(value) =>
                          props.onChange(
                            updateRoleDraft(props.drafts, draft.id, {
                              provider: value === EMPTY_SELECT_VALUE ? '' : value,
                              model: '',
                            }),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select provider" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY_SELECT_VALUE}>Select provider</SelectItem>
                          {providerOptions.map((provider) => (
                            <SelectItem key={provider} value={provider}>
                              {provider}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </label>
                    <label className="grid gap-1.5 text-xs">
                      <span className="font-medium">Model</span>
                      <Select
                        value={draft.model || EMPTY_SELECT_VALUE}
                        onValueChange={(value) =>
                          props.onChange(
                            updateRoleDraft(props.drafts, draft.id, {
                              model: value === EMPTY_SELECT_VALUE ? '' : value,
                            }),
                          )
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={EMPTY_SELECT_VALUE}>Select model</SelectItem>
                          {modelOptions.map((model) => (
                            <SelectItem key={model} value={model}>
                              {model}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs leading-5 text-muted">
                        {draft.provider
                          ? 'Only models for the selected provider are shown here.'
                          : 'Choose a provider first to narrow the available models.'}
                      </p>
                    </label>
                  </div>

                  <label className="grid gap-1.5 text-xs">
                    <span className="font-medium">Reasoning config</span>
                    <Textarea
                      value={draft.reasoningConfig}
                      className="min-h-[96px] font-mono text-xs"
                      placeholder='{"effort":"medium"}'
                      onChange={(event) =>
                        props.onChange(
                          updateRoleDraft(props.drafts, draft.id, {
                            reasoningConfig: event.target.value,
                          }),
                        )
                      }
                    />
                    <p className="text-xs leading-5 text-muted">
                      Leave this blank unless the selected provider/model pair needs explicit
                      reasoning posture overrides.
                    </p>
                  </label>

                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setExpandedDraftId((current) => (current === draft.id ? null : current));
                        props.onChange(props.drafts.filter((entry) => entry.id !== draft.id));
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Remove role
                    </Button>
                  </div>
                </div>
              ) : null}
            </section>
          );
        })
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          const nextDraft = createRoleOverrideDraft();
          setExpandedDraftId(nextDraft.id);
          props.onChange([...props.drafts, nextDraft]);
        }}
      >
        <Plus className="h-4 w-4" />
        Add role override
      </Button>
    </div>
  );
}

export function ResolvedModelCards(props: {
  effectiveModels: Record<string, DashboardEffectiveModelResolution>;
}): JSX.Element {
  const entries = Object.entries(props.effectiveModels);
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No model overrides or resolved roles available.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map(([role, resolution]) => (
        <div
          key={role}
          className="rounded-xl border border-border/70 bg-background/70 p-4 text-sm"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{role}</Badge>
            <Badge variant={resolution.fallback ? 'warning' : 'secondary'}>
              {resolution.source}
            </Badge>
          </div>
          {resolution.resolved ? (
            <div className="mt-3 space-y-3">
              <div>
                {resolution.resolved.provider.name} / {resolution.resolved.model.modelId}
              </div>
              {resolution.resolved.reasoningConfig ? (
                <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <StructuredRecordView
                    data={resolution.resolved.reasoningConfig}
                    emptyMessage="No reasoning config."
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-muted">No resolved model available.</p>
          )}
          {resolution.fallback_reason ? (
            <p className="mt-3 text-xs leading-5 text-amber-700 dark:text-amber-300">
              {resolution.fallback_reason}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ensureCurrentStringOption(options: string[], currentValue: string): string[] {
  const normalized = options.filter((value, index) => value && options.indexOf(value) === index);
  if (currentValue && !normalized.includes(currentValue)) {
    return [currentValue, ...normalized];
  }
  return normalized;
}

function updateRoleDraft(
  drafts: RoleOverrideDraft[],
  id: string,
  update: Partial<RoleOverrideDraft>,
): RoleOverrideDraft[] {
  return drafts.map((draft) => (draft.id === id ? { ...draft, ...update } : draft));
}
