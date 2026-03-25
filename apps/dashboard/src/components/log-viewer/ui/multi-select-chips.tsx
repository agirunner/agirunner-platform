import { forwardRef, useCallback, useState } from 'react';
import { Plus, X } from 'lucide-react';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { Badge } from '../../ui/badge.js';
import { cn } from '../../../lib/utils.js';

export interface MultiSelectOption {
  value: string;
  label: string;
}

export interface MultiSelectChipsProps {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (selected: string[]) => void;
  className?: string;
  disabled?: boolean;
}

export const SOURCE_OPTIONS: MultiSelectOption[] = [
  { value: 'runtime', label: 'Specialist Agent' },
  { value: 'platform', label: 'Platform' },
  { value: 'container_manager', label: 'Container Manager' },
  { value: 'task_container', label: 'Specialist Execution' },
];

export const CATEGORY_OPTIONS: MultiSelectOption[] = [
  { value: 'llm', label: 'LLM' },
  { value: 'tool', label: 'Tool' },
  { value: 'agent_loop', label: 'Agent Loop' },
  { value: 'task_lifecycle', label: 'Task Lifecycle' },
  { value: 'runtime_lifecycle', label: 'Agent Lifecycle' },
  { value: 'container', label: 'Container' },
  { value: 'api', label: 'API' },
  { value: 'config', label: 'Config' },
  { value: 'auth', label: 'Auth' },
];

export const MultiSelectChips = forwardRef<HTMLDivElement, MultiSelectChipsProps>(
  ({ label, options, selected, onChange, className, disabled }, ref) => {
    const [open, setOpen] = useState(false);

    const handleToggle = useCallback(
      (value: string) => {
        const next = selected.includes(value)
          ? selected.filter((v) => v !== value)
          : [...selected, value];
        onChange(next);
      },
      [selected, onChange],
    );

    const handleRemove = useCallback(
      (value: string) => {
        onChange(selected.filter((v) => v !== value));
      },
      [selected, onChange],
    );

    const labelFor = useCallback(
      (value: string) => options.find((o) => o.value === value)?.label ?? value,
      [options],
    );

    return (
      <div ref={ref} className={cn('flex flex-wrap items-center gap-1.5', className)}>
        <span className="text-xs font-medium text-muted">{label}:</span>

        {selected.map((value) => (
          <Badge key={value} variant="secondary" className="gap-1 pr-1">
            {labelFor(value)}
            <button
              type="button"
              disabled={disabled}
              className="ml-0.5 rounded-full p-0.5 hover:bg-border/50 disabled:pointer-events-none"
              onClick={() => handleRemove(value)}
              aria-label={`Remove ${labelFor(value)}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}

        <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen}>
          <DropdownMenuPrimitive.Trigger asChild>
            <button
              type="button"
              disabled={disabled}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-dashed border-border text-muted hover:bg-border/30 disabled:pointer-events-none disabled:opacity-50"
              aria-label={`Add ${label.toLowerCase()}`}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuPrimitive.Trigger>

          <DropdownMenuPrimitive.Portal>
            <DropdownMenuPrimitive.Content
              sideOffset={4}
              className="z-50 min-w-[10rem] overflow-hidden rounded-md border border-border bg-surface p-1 shadow-md"
            >
              {options.map((option) => {
                const isChecked = selected.includes(option.value);
                return (
                  <DropdownMenuPrimitive.Item
                    key={option.value}
                    className="relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent/10"
                    onSelect={(e) => {
                      e.preventDefault();
                      handleToggle(option.value);
                    }}
                  >
                    <span className="absolute left-2 flex h-4 w-4 items-center justify-center">
                      <CheckboxPrimitive.Root
                        checked={isChecked}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-border data-[state=checked]:border-accent data-[state=checked]:bg-accent"
                        tabIndex={-1}
                        onCheckedChange={() => handleToggle(option.value)}
                      >
                        <CheckboxPrimitive.Indicator>
                          <Check className="h-3 w-3 text-white" />
                        </CheckboxPrimitive.Indicator>
                      </CheckboxPrimitive.Root>
                    </span>
                    {option.label}
                  </DropdownMenuPrimitive.Item>
                );
              })}
            </DropdownMenuPrimitive.Content>
          </DropdownMenuPrimitive.Portal>
        </DropdownMenuPrimitive.Root>
      </div>
    );
  },
);
MultiSelectChips.displayName = 'MultiSelectChips';
