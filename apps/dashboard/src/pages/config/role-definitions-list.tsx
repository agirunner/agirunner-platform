import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { TableCell, TableRow } from '../../components/ui/table.js';
import { cn } from '../../lib/utils.js';
import {
  describeRoleModelPolicy,
  type RoleDefinition,
} from './role-definitions-page.support.js';
import {
  canDeleteRole,
  describeRoleLifecyclePolicy,
} from './role-definitions-lifecycle.js';

export function MetricCard(props: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'warning';
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs font-medium uppercase tracking-wide text-muted">{props.label}</div>
        <div
          className={cn(
            'mt-2 text-2xl font-semibold',
            props.tone === 'success' && 'text-green-700 dark:text-green-400',
            props.tone === 'warning' && 'text-amber-700 dark:text-amber-400',
          )}
        >
          {props.value}
        </div>
      </CardContent>
    </Card>
  );
}

export function RoleRow(props: {
  role: RoleDefinition;
  onEdit(role: RoleDefinition): void;
  onDelete(role: RoleDefinition): void;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const modelPolicy = describeRoleModelPolicy(props.role);
  const isDeletable = canDeleteRole(props.role);

  return (
    <>
      <TableRow
        className={cn(
          'cursor-pointer',
          isExpanded && 'border-b-0',
          props.role.is_active === false && 'opacity-75',
        )}
        onClick={() => setIsExpanded((value) => !value)}
      >
        <TableCell>
          <div className="flex items-start gap-2">
            {isExpanded ? (
              <ChevronDown className="mt-1 h-4 w-4 text-muted" />
            ) : (
              <ChevronRight className="mt-1 h-4 w-4 text-muted" />
            )}
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{props.role.name}</span>
                <Badge variant={props.role.is_active === false ? 'warning' : 'success'}>
                  {props.role.is_active === false ? 'Inactive' : 'Active'}
                </Badge>
                <Badge variant={props.role.is_built_in ? 'secondary' : 'outline'}>
                  {props.role.is_built_in ? 'Built-in' : 'Custom'}
                </Badge>
              </div>
              <div className="text-sm text-muted">
                {props.role.description ?? 'No description provided.'}
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{props.role.capabilities?.length ?? 0}</Badge>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{props.role.allowed_tools?.length ?? 0}</Badge>
        </TableCell>
        <TableCell className="space-y-1 text-xs">
          <div className="font-mono">{modelPolicy.primary}</div>
          <div className="text-muted">{modelPolicy.fallback}</div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit ${props.role.name}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onEdit(props.role);
              }}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            {isDeletable ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600 hover:text-red-700"
                aria-label={`Delete ${props.role.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onDelete(props.role);
                }}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : (
              <Badge variant="secondary">Built-in</Badge>
            )}
          </div>
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={5} className="bg-border/10">
            <div className="grid gap-4 py-3 xl:grid-cols-[1.2fr_1fr]">
              <div className="space-y-3">
                {props.role.system_prompt ? (
                  <p className="rounded-lg bg-surface p-3 font-mono text-sm whitespace-pre-wrap">
                    {props.role.system_prompt}
                  </p>
                ) : (
                  <div className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted">
                    No system prompt configured.
                  </div>
                )}
                {props.role.capabilities?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {props.role.capabilities.map((capability) => (
                      <Badge key={capability} variant="secondary">
                        {capability}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                {props.role.allowed_tools?.length ? (
                  <div className="flex flex-wrap gap-1">
                    {props.role.allowed_tools.map((tool) => (
                      <Badge key={tool} variant="outline">
                        {tool}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2 rounded-lg border border-border/70 bg-surface px-4 py-3 text-sm">
                <div>
                  <span className="font-medium">Verification:</span>{' '}
                  {props.role.verification_strategy ?? 'none'}
                </div>
                <div>
                  <span className="font-medium">Escalation:</span>{' '}
                  {props.role.escalation_target ?? 'none'}
                </div>
                <div>
                  <span className="font-medium">Max depth:</span>{' '}
                  {props.role.max_escalation_depth ?? 5}
                </div>
                <div>
                  <span className="font-medium">Fallback model:</span> {modelPolicy.fallback}
                </div>
                <div>
                  <span className="font-medium">Lifecycle:</span>{' '}
                  {describeRoleLifecyclePolicy(props.role)}
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
