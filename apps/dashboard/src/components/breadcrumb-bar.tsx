import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';

import { cn } from '../lib/utils.js';
import { buildBreadcrumbs } from './layout-breadcrumbs.js';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export function BreadcrumbBar(): JSX.Element | null {
  const { pathname } = useLocation();
  const crumbs = buildBreadcrumbs(pathname);

  if (crumbs.length <= 1 && crumbs[0]?.label === 'Home') {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1 text-sm">
        <li className="inline-flex items-center">
          <Link
            to="/"
            className={cn(
              'rounded-sm p-0.5 text-muted transition-colors hover:text-foreground',
              FOCUS_RING,
            )}
            aria-label="Home"
          >
            <Home className="h-3.5 w-3.5" />
          </Link>
        </li>
        {crumbs.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1">
            <ChevronRight className="h-3.5 w-3.5 text-muted/60" />
            {crumb.href ? (
              <Link
                to={crumb.href}
                className={cn(
                  'rounded-sm px-1 py-0.5 text-muted transition-colors hover:text-foreground',
                  FOCUS_RING,
                )}
              >
                {crumb.label}
              </Link>
            ) : (
              <span className="px-1 py-0.5 font-medium text-foreground">
                {crumb.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
