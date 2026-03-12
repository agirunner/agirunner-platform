import { ArrowRight } from 'lucide-react';

import { Badge } from '../../components/ui/badge.js';

export function OperatorBreadcrumbTrail(props: {
  items: string[];
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
        <span key={`${item}:${index}`} className="inline-flex items-center gap-1.5">
          {index > 0 ? <ArrowRight className="h-3 w-3 text-muted" /> : null}
          <Badge variant="outline" className="max-w-full break-words whitespace-normal">
            {item}
          </Badge>
        </span>
      ))}
    </div>
  );
}
