import type { ReactNode } from 'react';

import { cn } from '../../lib/utils.js';
import { findNavigationItemByHref } from './layout.js';

interface DashboardPageHeaderProps {
  navHref: string;
  title?: string;
  description: string;
  descriptionClassName?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}

export function DashboardPageHeader(props: DashboardPageHeaderProps): JSX.Element {
  const navItem = findNavigationItemByHref(props.navHref);
  if (!navItem) {
    throw new Error(`Unknown dashboard navigation item: ${props.navHref}`);
  }

  const Icon = navItem.icon;
  const title = props.title ?? navItem.label;

  return (
    <div
      className={cn(
        'flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between',
        props.className,
      )}
    >
      <div className="min-w-0 flex-1 space-y-2">
        {props.eyebrow ? <div>{props.eyebrow}</div> : null}
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
        <p
          className={cn(
            'max-w-4xl text-sm leading-6 text-muted-foreground',
            props.descriptionClassName,
          )}
        >
          {props.description}
        </p>
      </div>
      {props.actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 xl:w-auto xl:justify-end">
          {props.actions}
        </div>
      ) : null}
    </div>
  );
}
