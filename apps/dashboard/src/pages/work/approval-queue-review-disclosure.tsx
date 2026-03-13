import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

import { Button } from '../../components/ui/button.js';

export function ApprovalQueueReviewDisclosure(props: {
  title: string;
  summary: string;
  children: React.ReactNode;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const triggerId = useId();
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    panelHeadingRef.current?.focus();
  }, [isOpen]);

  function closePanel(): void {
    setIsOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  return (
    <section className="rounded-xl border border-border/70 bg-background/80 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="text-sm font-medium">{props.title}</div>
          <p className="text-sm text-muted">{props.summary}</p>
        </div>
        <Button
          ref={triggerRef}
          type="button"
          variant="outline"
          className="w-full justify-between sm:w-auto"
          aria-expanded={isOpen}
          aria-controls={panelId}
          id={triggerId}
          onClick={() => setIsOpen((current) => !current)}
        >
          {isOpen ? 'Hide full review packet' : 'Open full review packet'}
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {isOpen ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={triggerId}
          className="mt-4 space-y-4 border-t border-border/70 pt-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1">
              <h3
                ref={panelHeadingRef}
                tabIndex={-1}
                className="text-sm font-semibold text-foreground"
              >
                Full review packet
              </h3>
              <p className="text-sm text-muted">
                Review the decision trail, artifacts, and orchestrator follow-up without leaving the queue.
              </p>
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={closePanel}>
              Collapse packet
              <ChevronUp className="h-4 w-4" />
            </Button>
          </div>
          {props.children}
        </div>
      ) : null}
    </section>
  );
}
