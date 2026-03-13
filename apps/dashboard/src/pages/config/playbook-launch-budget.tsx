import { useEffect, useState } from 'react';

import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import type {
  LaunchValidationResult,
  WorkflowBudgetDraft,
  WorkflowBudgetMode,
} from './playbook-launch-support.js';
import {
  clearWorkflowBudgetDraft,
  readWorkflowBudgetMode,
} from './playbook-launch-support.js';

export function WorkflowBudgetEditor(props: {
  draft: WorkflowBudgetDraft;
  fieldErrors: LaunchValidationResult['fieldErrors'];
  onChange(draft: WorkflowBudgetDraft): void;
}): JSX.Element {
  const [mode, setMode] = useState<WorkflowBudgetMode>(() =>
    readWorkflowBudgetMode(props.draft),
  );

  useEffect(() => {
    if (readWorkflowBudgetMode(props.draft) === 'guarded') {
      setMode('guarded');
    }
  }, [props.draft]);

  function setBudgetMode(nextMode: WorkflowBudgetMode) {
    setMode(nextMode);
    if (nextMode === 'open-ended') {
      props.onChange(clearWorkflowBudgetDraft());
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <BudgetModeCard
          title="Open-ended workflow"
          description="Launch without explicit token, cost, or duration ceilings. The workflow inherits open-ended defaults."
          isSelected={mode === 'open-ended'}
          onSelect={() => setBudgetMode('open-ended')}
        />
        <BudgetModeCard
          title="Guarded workflow"
          description="Set explicit token, cost, or duration limits before launch so the run has clear operator guardrails."
          isSelected={mode === 'guarded'}
          onSelect={() => setBudgetMode('guarded')}
        />
      </div>

      {mode === 'open-ended' ? (
        <div className="rounded-xl border border-border/70 bg-muted/10 p-4 text-sm text-muted">
          No workflow budget guardrails. The workflow will launch with open-ended defaults until
          you switch to a guarded workflow and set at least one limit.
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/10 px-4 py-3">
            <div className="space-y-1">
              <div className="text-sm font-medium text-foreground">Guardrail inputs</div>
              <p className="text-sm text-muted">
                Set one or more launch guardrails. Leave any specific field blank if that limit
                should remain open.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setBudgetMode('open-ended')}
            >
              Clear guardrails
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <BudgetNumberField
              label="Token Budget"
              value={props.draft.tokenBudget}
              placeholder="Optional cap"
              min={1}
              step={1}
              inputMode="numeric"
              error={props.fieldErrors.tokenBudget}
              hint="Integer cap for total tokens across the workflow."
              onChange={(value) =>
                props.onChange({ ...props.draft, tokenBudget: value })
              }
            />
            <BudgetNumberField
              label="Cost Cap (USD)"
              value={props.draft.costCapUsd}
              placeholder="Optional cap"
              min={0.0001}
              step={0.01}
              inputMode="decimal"
              error={props.fieldErrors.costCapUsd}
              hint="Stop treating spend as open-ended when the workflow has a dollar ceiling."
              onChange={(value) =>
                props.onChange({ ...props.draft, costCapUsd: value })
              }
            />
            <BudgetNumberField
              label="Max Duration (Minutes)"
              value={props.draft.maxDurationMinutes}
              placeholder="Optional cap"
              min={1}
              step={1}
              inputMode="numeric"
              error={props.fieldErrors.maxDurationMinutes}
              hint="Guard against workflows running longer than the intended operator window."
              onChange={(value) =>
                props.onChange({ ...props.draft, maxDurationMinutes: value })
              }
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BudgetModeCard(props: {
  title: string;
  description: string;
  isSelected: boolean;
  onSelect(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.isSelected}
      onClick={props.onSelect}
      className={`rounded-xl border p-4 text-left transition-colors ${
        props.isSelected
          ? 'border-accent bg-accent/10 shadow-sm'
          : 'border-border/70 bg-muted/10 hover:bg-muted/20'
      }`}
    >
      <div className="text-sm font-medium text-foreground">{props.title}</div>
      <p className="mt-2 text-sm text-muted">{props.description}</p>
    </button>
  );
}

function BudgetNumberField(props: {
  label: string;
  value: string;
  min: number;
  step: number;
  inputMode: 'numeric' | 'decimal';
  placeholder: string;
  hint: string;
  error?: string;
  onChange(value: string): void;
}): JSX.Element {
  return (
    <label className="grid gap-2 text-sm">
      <span className="font-medium">{props.label}</span>
      <Input
        type="number"
        min={props.min}
        step={props.step}
        inputMode={props.inputMode}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
      />
      <span className="text-xs text-muted">{props.hint}</span>
      {props.error ? <span className="text-xs text-red-600 dark:text-red-400">{props.error}</span> : null}
    </label>
  );
}
