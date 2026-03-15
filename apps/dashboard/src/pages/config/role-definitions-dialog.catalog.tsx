import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import type {
  RoleFormState,
} from './role-definitions-page.support.js';

export function RoleToolGrantsSection(props: {
  form: RoleFormState;
  tools: string[];
  toggleTool(value: string): void;
}) {
  const enabledToolCount = props.tools.filter((tool) => props.form.allowedTools.includes(tool)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool grants</CardTitle>
        <CardDescription>
          Select which tools this role is allowed to use.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border/70 bg-surface px-3 py-3 text-xs text-muted">
          {enabledToolCount > 0
            ? `${enabledToolCount} of ${props.tools.length} tool${props.tools.length === 1 ? '' : 's'} enabled.`
            : 'No tools enabled. Toggle tools on to grant the role access.'}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {props.tools.map((tool) => (
            <ToggleCard
              key={tool}
              label={tool}
              checked={props.form.allowedTools.includes(tool)}
              onCheckedChange={() => props.toggleTool(tool)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
