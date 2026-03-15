import { useState } from 'react';
import { ChevronDown, ChevronRight, Copy, Pencil, Trash2 } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';
import { Button } from '../../components/ui/button.js';
import { Card, CardContent } from '../../components/ui/card.js';
import { Switch } from '../../components/ui/switch.js';
import { TableCell, TableRow } from '../../components/ui/table.js';
import { cn } from '../../lib/utils.js';
import {
  describeRoleModelPolicy,
  type RoleDefinition,
} from './role-definitions-page.support.js';
import {
  canDeleteRole,
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
  togglingRoleId: string | null;
  onEdit(role: RoleDefinition): void;
  onDelete(role: RoleDefinition): void;
  onToggleActive(role: RoleDefinition): void;
  onDuplicate(role: RoleDefinition): void;
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
                <Switch
                  checked={props.role.is_active !== false}
                  disabled={props.togglingRoleId === props.role.id}
                  onCheckedChange={() => props.onToggleActive(props.role)}
                  onClick={(event) => event.stopPropagation()}
                  aria-label={`Toggle ${props.role.name} active`}
                  className="scale-90"
                />
                <Badge variant={props.role.is_active === false ? 'secondary' : 'success'}>
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
          <Badge variant="outline">{props.role.allowed_tools?.length ?? 0}</Badge>
        </TableCell>
        <TableCell className="text-xs">
          <div className="font-mono">{modelPolicy.primary}</div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={`Duplicate ${props.role.name}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onDuplicate(props.role);
              }}
            >
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={`Edit ${props.role.name}`}
              onClick={(event) => {
                event.stopPropagation();
                props.onEdit(props.role);
              }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            {isDeletable ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-red-600 hover:text-red-700"
                aria-label={`Delete ${props.role.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onDelete(props.role);
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={4} className="bg-border/10">
            <div className="space-y-3 py-3">
              {props.role.system_prompt ? (
                <p className="rounded-lg bg-surface p-3 font-mono text-sm whitespace-pre-wrap">
                  {props.role.system_prompt}
                </p>
              ) : (
                <div className="rounded-lg border border-dashed border-border/70 p-3 text-sm text-muted">
                  No system prompt configured.
                </div>
              )}
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
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
