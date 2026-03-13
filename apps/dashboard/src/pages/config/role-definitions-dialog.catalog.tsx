import type { Dispatch, SetStateAction } from 'react';

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
import { cn } from '../../lib/utils.js';
import type {
  CapabilityOption,
  RoleFormState,
} from './role-definitions-page.support.js';

export function RoleCapabilitiesSection(props: {
  form: RoleFormState;
  capabilities: CapabilityOption[];
  customCapability: string;
  setCustomCapability: Dispatch<SetStateAction<string>>;
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
            onChange={(event) => props.setCustomCapability(event.target.value)}
            placeholder="Add a custom capability, for example role:data-scientist"
          />
          <Button type="button" variant="outline" onClick={props.addCustomCapability}>
            Add custom capability
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function RoleToolGrantsSection(props: {
  form: RoleFormState;
  tools: string[];
  customTool: string;
  setCustomTool: Dispatch<SetStateAction<string>>;
  toggleTool(value: string): void;
  addCustomTool(): void;
}) {
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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {props.tools.map((tool) => (
            <label
              key={tool}
              className="flex items-center gap-2 rounded-md border border-border/70 bg-muted/10 px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={props.form.allowedTools.includes(tool)}
                onChange={() => props.toggleTool(tool)}
                className="rounded"
              />
              <span>{tool}</span>
            </label>
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
            onChange={(event) => props.setCustomTool(event.target.value)}
            placeholder="Add a custom tool grant"
          />
          <Button type="button" variant="outline" onClick={props.addCustomTool}>
            Add custom tool
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
