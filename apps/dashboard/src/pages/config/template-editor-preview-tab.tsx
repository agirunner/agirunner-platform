import { useMemo, useState } from 'react';
import { Play } from 'lucide-react';
import { Button } from '../../components/ui/button.js';
import { Input } from '../../components/ui/input.js';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../../components/ui/card.js';
import type { TemplateDefinition } from './template-editor-types.js';

interface PreviewTabProps {
  template: TemplateDefinition;
}

export function PreviewTab({ template }: PreviewTabProps): JSX.Element {
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);

  const generatedWorkflow = useMemo(() => {
    const resolved: Record<string, unknown> = {};
    for (const variable of template.variables) {
      resolved[variable.name] =
        variableValues[variable.name] ?? variable.default_value ?? '';
    }

    return {
      template_id: template.id,
      template_name: template.name,
      parameters: resolved,
      phases: template.phases.map((phase) => ({
        name: phase.name,
        gate_type: phase.gate_type,
        tasks: phase.tasks.map((task) => ({
          name: task.name,
          role: task.role,
          type: task.type,
          depends_on: task.depends_on,
        })),
      })),
      lifecycle: template.lifecycle,
    };
  }, [template, variableValues]);

  const handleVariableChange = (name: string, value: string) => {
    setVariableValues((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Template Variables</CardTitle>
        </CardHeader>
        <CardContent>
          {template.variables.length === 0 ? (
            <p className="text-sm text-muted">
              No variables defined. Add variables in the Variables tab.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {template.variables.map((variable) => (
                <div key={variable.name} className="space-y-1">
                  <label className="text-xs font-medium text-muted">
                    {variable.name}
                    {variable.is_required && (
                      <span className="text-red-500 ml-1">*</span>
                    )}
                  </label>
                  <Input
                    value={variableValues[variable.name] ?? variable.default_value}
                    onChange={(e) => handleVariableChange(variable.name, e.target.value)}
                    placeholder={variable.default_value || variable.type}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={() => setIsPreviewVisible(true)}>
          <Play className="h-4 w-4" />
          Run Preview
        </Button>
      </div>

      {isPreviewVisible && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Generated Workflow JSON</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="bg-border/10 rounded-lg p-4 text-xs font-mono overflow-auto max-h-[400px]">
              {JSON.stringify(generatedWorkflow, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
