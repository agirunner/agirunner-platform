import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.js';
import { Input } from '../../components/ui/input.js';
import { ToggleCard } from '../../components/ui/toggle-card.js';
import { cn } from '../../lib/utils.js';
import type {
  CapabilityOption,
  RoleFormState,
} from './role-definitions-page.support.js';

export function RoleCapabilitiesSection(props: {
  form: RoleFormState;
  capabilities: CapabilityOption[];
  customCapability: string;
  customCapabilityError?: string;
  setCustomCapability(value: string): void;
  onCustomCapabilityBlur(): void;
  toggleCapability(value: string): void;
  addCustomCapability(): void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Capabilities</CardTitle>
        <CardDescription>
          Advertise what the role can do for routing, staffing, and operator understanding.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          {props.capabilities.map((capability) => (
            <button
              key={capability.value}
              type="button"
              onClick={() => props.toggleCapability(capability.value)}
              className={cn(
                'rounded-lg border px-3 py-3 text-left transition-colors',
                props.form.capabilities.includes(capability.value)
                  ? 'border-accent bg-accent/10'
                  : 'border-border/70 bg-muted/10 hover:bg-muted/20',
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">{capability.label}</div>
                <Badge
                  variant={
                    props.form.capabilities.includes(capability.value) ? 'default' : 'outline'
                  }
                >
                  {capability.category}
                </Badge>
              </div>
              <div className="mt-1 text-sm text-muted">{capability.description}</div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {props.form.capabilities.map((capability) => (
            <Badge key={capability} variant="secondary">
              {capability}
            </Badge>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={props.customCapability}
            aria-invalid={props.customCapabilityError ? true : undefined}
            className={
              props.customCapabilityError ? 'border-red-300 focus-visible:ring-red-500' : undefined
            }
            onChange={(event) => props.setCustomCapability(event.target.value)}
            onBlur={props.onCustomCapabilityBlur}
            placeholder="Add a custom capability, for example role:data-scientist"
          />
          <Button type="button" variant="outline" onClick={props.addCustomCapability}>
            Add custom capability
          </Button>
        </div>
        {props.customCapabilityError ? (
          <p className="text-xs text-red-600">{props.customCapabilityError}</p>
        ) : (
          <p className="text-xs text-muted">
            Use stable ID-style capability labels so routing and staffing logic stay readable.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function RoleToolGrantsSection(props: {
  form: RoleFormState;
  tools: string[];
  customTool: string;
  customToolError?: string;
  setCustomTool(value: string): void;
  onCustomToolBlur(): void;
  toggleTool(value: string): void;
  addCustomTool(): void;
}) {
  const enabledToolCount = props.tools.filter((tool) => props.form.allowedTools.includes(tool)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tool grants</CardTitle>
        <CardDescription>
          Grant concrete tools directly instead of forcing raw JSON edits.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted">
          Existing grants that are no longer in the standard catalog still stay editable here.
        </p>
        <div className="rounded-md border border-border/70 bg-surface px-3 py-3 text-xs text-muted">
          {enabledToolCount > 0
            ? `${enabledToolCount} catalog tool grant${enabledToolCount === 1 ? '' : 's'} enabled for this role.`
            : 'No catalog tools enabled. Add grants here or confirm that the role should stay read-only.'}
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
        <div className="flex flex-wrap gap-2">
          {props.form.allowedTools.map((tool) => (
            <Badge key={tool} variant="outline">
              {tool}
            </Badge>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={props.customTool}
            aria-invalid={props.customToolError ? true : undefined}
            className={props.customToolError ? 'border-red-300 focus-visible:ring-red-500' : undefined}
            onChange={(event) => props.setCustomTool(event.target.value)}
            onBlur={props.onCustomToolBlur}
            placeholder="Add a custom tool grant"
          />
          <Button type="button" variant="outline" onClick={props.addCustomTool}>
            Add custom tool
          </Button>
        </div>
        {props.customToolError ? (
          <p className="text-xs text-red-600">{props.customToolError}</p>
        ) : (
          <p className="text-xs text-muted">
            Use the exact tool ID when you add a non-catalog grant.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
