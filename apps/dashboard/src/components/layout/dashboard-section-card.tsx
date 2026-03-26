import type { ReactNode } from 'react';

import { cn } from '../../lib/utils.js';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../ui/card.js';

export function DashboardSectionCard(props: {
  id?: string;
  title?: ReactNode;
  description?: ReactNode;
  headerAction?: ReactNode;
  children: ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  contentWrapper?: boolean;
}): JSX.Element {
  const hasHeader =
    props.title !== undefined
    || props.description !== undefined
    || props.headerAction !== undefined;

  return (
    <Card id={props.id} className={cn('border-border/70 shadow-sm', props.className)}>
      {hasHeader ? (
        <CardHeader className={cn('space-y-3', props.headerClassName)}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              {props.title !== undefined ? (
                <CardTitle className={cn('text-base text-foreground', props.titleClassName)}>
                  {props.title}
                </CardTitle>
              ) : null}
              {props.description !== undefined ? (
                <CardDescription
                  className={cn('text-sm leading-6 text-muted', props.descriptionClassName)}
                >
                  {props.description}
                </CardDescription>
              ) : null}
            </div>
            {props.headerAction !== undefined ? (
              <div className="shrink-0">{props.headerAction}</div>
            ) : null}
          </div>
        </CardHeader>
      ) : null}
      {props.contentWrapper === false ? (
        props.children
      ) : (
        <CardContent className={cn(hasHeader ? undefined : 'pt-6', props.bodyClassName)}>
          {props.children}
        </CardContent>
      )}
    </Card>
  );
}
