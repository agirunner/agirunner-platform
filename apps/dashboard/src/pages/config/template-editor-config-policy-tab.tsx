import { useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.js';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '../../components/ui/table.js';
import type { TemplateDefinition, ConfigPolicyField } from './template-editor-types.js';

interface ConfigPolicyTabProps {
  template: TemplateDefinition;
  onChange: (template: TemplateDefinition) => void;
}

function createEmptyPolicy(): ConfigPolicyField {
  return {
    field: '',
    default_value: '',
    is_locked: false,
    override_level: 'per-run',
  };
}

export function ConfigPolicyTab({ template, onChange }: ConfigPolicyTabProps): JSX.Element {
  const { config_policy } = template;

  const updateField = useCallback(
    (index: number, field: keyof ConfigPolicyField, value: string | boolean) => {
      const updated = config_policy.map((p, i) =>
        i === index ? { ...p, [field]: value } : p,
      );
      onChange({ ...template, config_policy: updated });
    },
    [template, config_policy, onChange],
  );

  const addField = useCallback(() => {
    onChange({
      ...template,
      config_policy: [...config_policy, createEmptyPolicy()],
    });
  }, [template, config_policy, onChange]);

  const removeField = useCallback(
    (index: number) => {
      onChange({
        ...template,
        config_policy: config_policy.filter((_, i) => i !== index),
      });
    },
    [template, config_policy, onChange],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Define configuration policy fields and their override behavior.
        </p>
        <Button size="sm" onClick={addField}>
          <Plus className="h-3 w-3" />
          Add Field
        </Button>
      </div>

      {config_policy.length === 0 ? (
        <div className="text-center py-8 text-muted text-sm">
          No config policy fields defined.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Default Value</TableHead>
              <TableHead>Locked</TableHead>
              <TableHead>Override Level</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {config_policy.map((policy, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Input
                    value={policy.field}
                    onChange={(e) => updateField(index, 'field', e.target.value)}
                    placeholder="field.name"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={policy.default_value}
                    onChange={(e) => updateField(index, 'default_value', e.target.value)}
                    placeholder="value"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={policy.is_locked}
                    onChange={(e) => updateField(index, 'is_locked', e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={policy.override_level}
                    onValueChange={(val) => updateField(index, 'override_level', val)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="per-run">Per Run</SelectItem>
                      <SelectItem value="per-task">Per Task</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeField(index)}
                  >
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
