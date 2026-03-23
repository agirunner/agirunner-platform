import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { cn } from '../../lib/utils.js';
import { Badge } from '../../components/ui/badge.js';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

export function OperatorBreadcrumbTrail(props: {
  items: BreadcrumbItem[];
  emptyLabel?: string;
}): JSX.Element | null {
  if (props.items.length === 0) {
    return props.emptyLabel ? (
      <Badge variant="outline">{props.emptyLabel}</Badge>
    ) : null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {props.items.map((item, index) => (
        <span key={`${item.label}:${index}`} className="inline-flex items-center gap-1.5">
          {index > 0 ? <ArrowRight className="h-3 w-3 text-muted" /> : null}
          {item.href ? (
            <Link to={item.href} className={cn('rounded-full', FOCUS_RING)}>
              <Badge
                variant="outline"
                className="max-w-full cursor-pointer break-words whitespace-normal transition-colors hover:bg-accent/10 hover:text-accent"
              >
                {item.label}
              </Badge>
            </Link>
          ) : (
            <Badge variant="outline" className="max-w-full break-words whitespace-normal">
              {item.label}
            </Badge>
          )}
        </span>
      ))}
    </div>
  );
}
