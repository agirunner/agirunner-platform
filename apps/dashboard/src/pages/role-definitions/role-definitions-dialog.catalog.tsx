import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Badge } from '../../components/ui/badge.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import type {
  RoleFormState,
  RoleToolCatalogEntry,
} from './role-definitions-page.support.js';

export function RoleToolGrantsSection(props: {
  form: RoleFormState;
  tools: RoleToolCatalogEntry[];
  toggleTool(value: string): void;
}) {
  const enabledToolCount = props.tools.filter((tool) => props.form.allowedTools.includes(tool.id)).length;
  const runtimeTools = props.tools.filter((tool) => tool.owner !== 'task');
  const taskTools = props.tools.filter((tool) => tool.owner === 'task');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool grants</CardTitle>
        <CardDescription>
          Select which agentic runtime tools and task execution tools this role can use. Orchestrator-only tools are managed on the orchestrator surface.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-md border border-border/70 bg-surface px-3 py-3 text-xs text-muted">
          {enabledToolCount > 0
            ? `${enabledToolCount} of ${props.tools.length} tool${props.tools.length === 1 ? '' : 's'} enabled.`
            : 'No tools enabled. Toggle tools on to grant the role access.'}
        </div>
        <ToolGrantGroup
          title="Agentic runtime tools"
          description="Run directly in the runtime loop and are safe to grant to specialist roles."
          tools={runtimeTools}
          allowedTools={props.form.allowedTools}
          toggleTool={props.toggleTool}
        />
        <ToolGrantGroup
          title="Task execution tools"
          description="Run inside the specialist task sandbox and can materialize repo or filesystem state."
          tools={taskTools}
          allowedTools={props.form.allowedTools}
          toggleTool={props.toggleTool}
        />
      </CardContent>
    </Card>
  );
}

function ToolGrantGroup(props: {
  title: string;
  description: string;
  tools: RoleToolCatalogEntry[];
  allowedTools: string[];
  toggleTool(value: string): void;
}) {
  if (props.tools.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">{props.title}</h3>
        <Badge variant="outline">{props.tools.length}</Badge>
      </div>
      <p className="text-xs text-muted">{props.description}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {props.tools.map((tool) => (
          <ToggleCard
            key={tool.id}
            label={tool.name || tool.id}
            checked={props.allowedTools.includes(tool.id)}
            onCheckedChange={() => props.toggleTool(tool.id)}
          />
        ))}
      </div>
    </section>
  );
}
