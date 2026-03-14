import type { Dispatch, SetStateAction } from 'react';

import { Badge } from '../../components/ui/badge.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import { Switch } from '../../components/ui/switch.js';
import { Textarea } from '../../components/ui/textarea.js';
import type {
  EscalationTargetOption,
  RoleDialogValidation,
} from './role-definitions-dialog.support.js';
import type {
  RoleDefinition,
  RoleFormState,
  RoleModelOption,
} from './role-definitions-page.support.js';

export function RoleBasicsSection(props: {
  form: RoleFormState;
  setForm: Dispatch<SetStateAction<RoleFormState>>;
  role?: RoleDefinition | null;
  escalationOptions: EscalationTargetOption[];
  validation: RoleDialogValidation;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Role basics</CardTitle>
        <CardDescription>
          Set the role identity, prompt, lifecycle state, and review posture.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Name</span>
          <Input
            value={props.form.name}
            onChange={(event) =>
              props.setForm((current) => ({ ...current, name: event.target.value }))
            }
            aria-invalid={Boolean(props.validation.fieldErrors.name)}
          />
          {props.validation.fieldErrors.name ? (
            <span className="text-xs text-red-600 dark:text-red-400">{props.validation.fieldErrors.name}</span>
          ) : null}
        </label>
        <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/10 px-4 py-3">
          <div>
            <div className="font-medium">Active role</div>
            <p className="text-sm text-muted">
              Inactive roles stay visible but are excluded from active use.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {props.role ? (
              <Badge variant={props.role.is_built_in ? 'secondary' : 'outline'}>
                {props.role.is_built_in ? 'Built-in' : 'Custom'}
              </Badge>
            ) : null}
            <Switch
              checked={props.form.isActive}
              onCheckedChange={(checked) =>
                props.setForm((current) => ({ ...current, isActive: checked }))
              }
              aria-label="Active role"
            />
          </div>
        </div>
        <label className="grid gap-2 text-sm md:col-span-2">
          <span className="font-medium">Description</span>
          <Input
            value={props.form.description}
            onChange={(event) =>
              props.setForm((current) => ({ ...current, description: event.target.value }))
            }
            placeholder="What this role is responsible for."
          />
        </label>
        <label className="grid gap-2 text-sm md:col-span-2">
          <span className="font-medium">System prompt</span>
          <Textarea
            value={props.form.systemPrompt}
            onChange={(event) =>
              props.setForm((current) => ({ ...current, systemPrompt: event.target.value }))
            }
            rows={8}
          />
          <span className="text-xs text-muted">
            Explain how the specialist should reason, verify, and communicate.
          </span>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Verification strategy</span>
          <Select
            value={props.form.verificationStrategy}
            onValueChange={(value) =>
              props.setForm((current) => ({ ...current, verificationStrategy: value }))
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="peer_review">Peer review</SelectItem>
              <SelectItem value="human_approval">Human approval</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Escalation target</span>
          <Select
            value={props.form.escalationTarget ?? '__none__'}
            onValueChange={(value) =>
              props.setForm((current) => ({
                ...current,
                escalationTarget: value === '__none__' ? null : value,
                maxEscalationDepth: value === '__none__' ? 5 : current.maxEscalationDepth,
              }))
            }
          >
            <SelectTrigger aria-invalid={Boolean(props.validation.fieldErrors.escalationTarget)}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.escalationOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-xs text-muted">
            {props.escalationOptions.find(
              (option) => option.value === (props.form.escalationTarget ?? '__none__'),
            )?.description ?? 'Choose where the role should hand off blocked work.'}
          </span>
          {props.validation.fieldErrors.escalationTarget ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {props.validation.fieldErrors.escalationTarget}
            </span>
          ) : null}
        </label>
        {props.form.escalationTarget ? (
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Max escalation depth</span>
            <Input
              type="number"
              min={1}
              max={10}
              value={props.form.maxEscalationDepth}
              onChange={(event) =>
                props.setForm((current) => ({
                  ...current,
                  maxEscalationDepth: Math.max(
                    1,
                    Math.min(10, Number(event.target.value) || 1),
                  ),
                }))
              }
              aria-invalid={Boolean(props.validation.fieldErrors.maxEscalationDepth)}
            />
            {props.validation.fieldErrors.maxEscalationDepth ? (
              <span className="text-xs text-red-600 dark:text-red-400">
                {props.validation.fieldErrors.maxEscalationDepth}
              </span>
            ) : null}
          </label>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function RoleModelPreferenceSection(props: {
  form: RoleFormState;
  setForm: Dispatch<SetStateAction<RoleFormState>>;
  modelOptions: RoleModelOption[];
  isModelCatalogLoading: boolean;
  modelCatalogError?: string | null;
  validation: RoleDialogValidation;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model preference</CardTitle>
        <CardDescription>
          Choose live models for the role default and fallback chain.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Preferred model</span>
          <Select
            value={props.form.modelPreference || '__system__'}
            onValueChange={(value) =>
              props.setForm((current) => ({
                ...current,
                modelPreference: value === '__system__' ? '' : value,
                fallbackModel: value === '__system__' ? '' : current.fallbackModel,
              }))
            }
          >
            <SelectTrigger aria-invalid={Boolean(props.validation.fieldErrors.modelPreference)}>
              <SelectValue
                placeholder={
                  props.isModelCatalogLoading ? 'Loading models...' : 'Use system default'
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__system__">Use system default</SelectItem>
              {props.modelOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {props.validation.fieldErrors.modelPreference ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {props.validation.fieldErrors.modelPreference}
            </span>
          ) : null}
        </label>
        <label className="grid gap-2 text-sm">
          <span className="font-medium">Fallback model</span>
          <Select
            disabled={!props.form.modelPreference}
            value={props.form.fallbackModel || '__none__'}
            onValueChange={(value) =>
              props.setForm((current) => ({
                ...current,
                fallbackModel: value === '__none__' ? '' : value,
              }))
            }
          >
            <SelectTrigger aria-invalid={Boolean(props.validation.fieldErrors.fallbackModel)}>
              <SelectValue
                placeholder={
                  props.form.modelPreference
                    ? 'Select fallback model'
                    : 'Choose a preferred model first'
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">No fallback</SelectItem>
              {props.modelOptions
                .filter((option) => option.value !== props.form.modelPreference)
                .map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {props.validation.fieldErrors.fallbackModel ? (
            <span className="text-xs text-red-600 dark:text-red-400">
              {props.validation.fieldErrors.fallbackModel}
            </span>
          ) : null}
        </label>
        <div className="rounded-lg border border-border/70 bg-muted/10 px-4 py-3 text-sm text-muted">
          {props.modelCatalogError
            ? `Model catalog unavailable: ${props.modelCatalogError}. Existing selections remain editable.`
            : 'Live models come from the enabled provider catalog. Workflow and project overrides can still supersede this default.'}
        </div>
      </CardContent>
    </Card>
  );
}
