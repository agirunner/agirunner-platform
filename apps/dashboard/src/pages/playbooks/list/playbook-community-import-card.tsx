import type { DashboardCommunityCatalogPlaybookRecord } from '../../../lib/api.js';
import { Badge } from '../../../components/ui/badge.js';
import { Button } from '../../../components/ui/button.js';

export function PlaybookCommunityImportCard(props: {
  isFocused: boolean;
  isSelected: boolean;
  onFocus(): void;
  onToggleSelected(): void;
  playbook: DashboardCommunityCatalogPlaybookRecord;
}): JSX.Element {
  const { playbook } = props;
  return (
    <button
      type="button"
      data-testid={`community-playbook-card-${playbook.id}`}
      onClick={props.onFocus}
      className={`grid gap-4 rounded-2xl border p-4 text-left transition ${
        props.isFocused
          ? 'border-accent bg-accent/5'
          : 'border-border/70 bg-card/70 hover:border-accent/50'
      }`}
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{playbook.name}</span>
            <Badge variant="outline">v{playbook.version}</Badge>
            <span className="text-xs font-medium uppercase tracking-[0.12em] text-muted">
              by {playbook.author}
            </span>
            <Badge variant={playbook.stability === 'experimental' ? 'warning' : 'success'}>
              {playbook.stability === 'experimental' ? 'Experimental' : 'Stable'}
            </Badge>
          </div>
          <p className="text-sm text-muted">{playbook.summary}</p>
        </div>
        <Button
          type="button"
          data-testid={`community-playbook-select-${playbook.id}`}
          variant={props.isSelected ? 'default' : 'secondary'}
          size="default"
          className="min-w-28 justify-self-end rounded-xl px-4"
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleSelected();
          }}
        >
          {props.isSelected ? 'Selected' : 'Select'}
        </Button>
      </div>
    </button>
  );
}
