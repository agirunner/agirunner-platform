import { Input } from '../../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.js';

export interface PlaybookParameter {
  name: string;
  type: 'text' | 'number' | 'boolean' | 'select';
  required?: boolean;
  defaultValue?: string | number | boolean;
  options?: string[];
  description?: string;
}

export interface LaunchParametersFormProps {
  parameters: PlaybookParameter[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  branchName: string;
  onBranchChange: (branch: string) => void;
  tokenBudget: number;
  onTokenBudgetChange: (budget: number) => void;
  costCapUsd: number;
  onCostCapChange: (cap: number) => void;
}

export function generateDefaultBranch(workflowName: string): string {
  if (workflowName === '') return '';
  const words = workflowName.trim().toLowerCase().split(/\s+/);
  const prefix = words[0];
  const rest = words.slice(1).join('-');
  return `${prefix}/${rest}`;
}

function FieldLabel({
  htmlFor,
  label,
  required,
  description,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
  description?: string;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '4px' }}>
      <label
        htmlFor={htmlFor}
        style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--color-status-error, #ef4444)', marginLeft: '2px' }}>*</span>
        )}
      </label>
      {description !== undefined && (
        <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}>
          {description}
        </span>
      )}
    </div>
  );
}

function ParameterField({
  param,
  value,
  onValueChange,
}: {
  param: PlaybookParameter;
  value: unknown;
  onValueChange: (val: unknown) => void;
}): JSX.Element {
  const fieldId = `param-${param.name}`;

  if (param.type === 'boolean') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <FieldLabel htmlFor={fieldId} label={param.name} required={param.required} description={param.description} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <input
            id={fieldId}
            type="checkbox"
            checked={Boolean(value ?? param.defaultValue ?? false)}
            onChange={(e) => onValueChange(e.target.checked)}
            style={{ cursor: 'pointer' }}
          />
          <span style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>
            {param.name}
          </span>
        </div>
      </div>
    );
  }

  if (param.type === 'select' && param.options !== undefined) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <FieldLabel htmlFor={fieldId} label={param.name} required={param.required} description={param.description} />
        <Select
          value={String(value ?? param.defaultValue ?? '')}
          onValueChange={(val) => onValueChange(val)}
        >
          <SelectTrigger id={fieldId}>
            <SelectValue placeholder={`Select ${param.name}`} />
          </SelectTrigger>
          <SelectContent>
            {param.options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (param.type === 'number') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <FieldLabel htmlFor={fieldId} label={param.name} required={param.required} description={param.description} />
        <Input
          id={fieldId}
          type="number"
          value={String(value ?? param.defaultValue ?? '')}
          onChange={(e) => onValueChange(Number(e.target.value))}
        />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <FieldLabel htmlFor={fieldId} label={param.name} required={param.required} description={param.description} />
      <Input
        id={fieldId}
        type="text"
        value={String(value ?? param.defaultValue ?? '')}
        onChange={(e) => onValueChange(e.target.value)}
      />
    </div>
  );
}

export function LaunchParametersForm({
  parameters,
  values,
  onChange,
  branchName,
  onBranchChange,
  tokenBudget,
  onTokenBudgetChange,
  costCapUsd,
  onCostCapChange,
}: LaunchParametersFormProps): JSX.Element {
  function handleParamChange(name: string, value: unknown): void {
    onChange({ ...values, [name]: value });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h4 style={{
          margin: 0,
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Branch
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label
            htmlFor="branch-name"
            style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}
          >
            Branch Name
          </label>
          <Input
            id="branch-name"
            type="text"
            placeholder="feat/my-feature"
            value={branchName}
            onChange={(e) => onBranchChange(e.target.value)}
          />
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <h4 style={{
          margin: 0,
          fontSize: '12px',
          fontWeight: 600,
          color: 'var(--color-text-secondary)',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}>
          Budget
        </h4>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label
              htmlFor="token-budget"
              style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}
            >
              Token Budget
            </label>
            <Input
              id="token-budget"
              type="number"
              min={0}
              value={tokenBudget}
              onChange={(e) => onTokenBudgetChange(Number(e.target.value))}
            />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label
              htmlFor="cost-cap"
              style={{ fontSize: '12px', color: 'var(--color-text-secondary)', fontWeight: 500 }}
            >
              Cost Cap (USD)
            </label>
            <Input
              id="cost-cap"
              type="number"
              min={0}
              step={0.01}
              value={costCapUsd}
              onChange={(e) => onCostCapChange(Number(e.target.value))}
            />
          </div>
        </div>
      </section>

      {parameters.length > 0 && (
        <section style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <h4 style={{
            margin: 0,
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--color-text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
          }}>
            Parameters
          </h4>
          {parameters.map((param) => (
            <ParameterField
              key={param.name}
              param={param}
              value={values[param.name]}
              onValueChange={(val) => handleParamChange(param.name, val)}
            />
          ))}
        </section>
      )}
    </div>
  );
}
