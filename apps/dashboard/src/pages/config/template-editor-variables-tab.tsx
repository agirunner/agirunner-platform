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
import type { TemplateDefinition, TemplateVariable } from './template-editor-types.js';

interface VariablesTabProps {
  template: TemplateDefinition;
  onChange: (template: TemplateDefinition) => void;
}

function createEmptyVariable(): TemplateVariable {
  return {
    name: '',
    type: 'string',
    default_value: '',
    is_required: false,
    enum_values: '',
    description: '',
  };
}

export function VariablesTab({ template, onChange }: VariablesTabProps): JSX.Element {
  const { variables } = template;

  const updateVariable = useCallback(
    (index: number, field: keyof TemplateVariable, value: string | boolean) => {
      const updated = variables.map((v, i) =>
        i === index ? { ...v, [field]: value } : v,
      );
      onChange({ ...template, variables: updated });
    },
    [template, variables, onChange],
  );

  const addVariable = useCallback(() => {
    onChange({ ...template, variables: [...variables, createEmptyVariable()] });
  }, [template, variables, onChange]);

  const removeVariable = useCallback(
    (index: number) => {
      onChange({ ...template, variables: variables.filter((_, i) => i !== index) });
    },
    [template, variables, onChange],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          Define variables that parameterize this template.
        </p>
        <Button size="sm" onClick={addVariable}>
          <Plus className="h-3 w-3" />
          Add Variable
        </Button>
      </div>

      {variables.length === 0 ? (
        <div className="text-center py-8 text-muted text-sm">
          No variables defined. Click "Add Variable" to get started.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Default</TableHead>
              <TableHead>Required</TableHead>
              <TableHead>Enum Values</TableHead>
              <TableHead className="w-[60px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {variables.map((variable, index) => (
              <TableRow key={index}>
                <TableCell>
                  <Input
                    value={variable.name}
                    onChange={(e) => updateVariable(index, 'name', e.target.value)}
                    placeholder="variable_name"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={variable.type}
                    onValueChange={(val) => updateVariable(index, 'type', val)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">string</SelectItem>
                      <SelectItem value="number">number</SelectItem>
                      <SelectItem value="boolean">boolean</SelectItem>
                      <SelectItem value="array">array</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    value={variable.default_value}
                    onChange={(e) => updateVariable(index, 'default_value', e.target.value)}
                    placeholder="default"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={variable.is_required}
                    onChange={(e) => updateVariable(index, 'is_required', e.target.checked)}
                    className="h-4 w-4 rounded border-border"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={variable.enum_values}
                    onChange={(e) => updateVariable(index, 'enum_values', e.target.value)}
                    placeholder="a,b,c"
                    className="h-8 text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeVariable(index)}
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
