import type { DashboardWorkflowOperatorBriefRecord } from '../../../lib/api.js';

const SECTION_LABELS: Record<string, string> = {
  deliverables: 'Deliverables',
  next_steps: 'Next Steps',
  risks_and_callouts: 'Risks & Callouts',
  links: 'Links',
  scope_and_objective: 'Scope & Objective',
  decisions_made: 'Decisions Made',
  validation: 'Validation',
  open_questions: 'Open Questions',
  operator_action: 'Operator Action',
  approval_and_review_context: 'Approval & Review Context',
  inputs_used: 'Inputs Used',
  delta_since_last_brief: 'Delta Since Last Brief',
};

export function WorkflowBriefRenderer(props: {
  brief: DashboardWorkflowOperatorBriefRecord;
  compact?: boolean;
}): JSX.Element {
  const detailedBrief = asRecord(props.brief.detailed_brief_json);
  const shortBrief = asRecord(props.brief.short_brief);
  const sections = asRecord(detailedBrief.sections);
  const headline =
    readText(detailedBrief.headline) ??
    readText(shortBrief.headline) ??
    'Workflow brief';
  const summary =
    readText(detailedBrief.summary) ??
    readText(shortBrief.delta_label) ??
    readText(shortBrief.status_label);

  return (
    <div className="grid gap-3">
      <div className="grid gap-1">
        <p className={props.compact ? 'text-sm font-semibold text-foreground' : 'text-lg font-semibold text-foreground'}>
          {headline}
        </p>
        {summary ? <p className="text-sm text-muted-foreground">{summary}</p> : null}
      </div>
      {Object.entries(sections).map(([sectionKey, sectionValue]) => {
        const items = asArray(sectionValue);
        if (items.length === 0) {
          return null;
        }
        return (
          <section key={sectionKey} className="grid gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {SECTION_LABELS[sectionKey] ?? humanizeToken(sectionKey)}
            </p>
            <div className="grid gap-2">
              {items.map((item, index) => (
                <BriefSectionItem
                  key={`${props.brief.id}:${sectionKey}:${index}`}
                  item={item}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BriefSectionItem(props: { item: unknown }): JSX.Element {
  if (typeof props.item === 'string') {
    return <p className="text-sm text-foreground">{props.item}</p>;
  }

  if (Array.isArray(props.item)) {
    return (
      <div className="grid gap-1">
        {props.item.map((entry, index) => (
          <BriefSectionItem key={`array:${index}`} item={entry} />
        ))}
      </div>
    );
  }

  const record = asRecord(props.item);
  const nestedItems = asArray(record.items);
  if (nestedItems.length > 0) {
    return (
      <div className="grid gap-1">
        {nestedItems.map((entry, index) => (
          <BriefSectionItem key={`nested:${index}`} item={entry} />
        ))}
      </div>
    );
  }

  const label =
    readText(record.label) ??
    readText(record.title) ??
    readText(record.name) ??
    readText(record.headline);
  const value =
    readText(record.value) ??
    readText(record.summary) ??
    readText(record.text) ??
    readText(record.description) ??
    readText(record.detail);
  const href = readText(record.url) ?? readText(record.href);

  if (href) {
    return (
      <a
        className="text-sm font-medium text-accent underline-offset-4 hover:underline"
        href={href}
        target="_blank"
        rel="noreferrer"
      >
        {label ?? href}
      </a>
    );
  }

  if (label || value) {
    return (
      <div className="grid gap-1">
        {label ? <p className="text-sm font-medium text-foreground">{label}</p> : null}
        {value ? <p className="text-sm text-muted-foreground">{value}</p> : null}
      </div>
    );
  }

  return <></>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function humanizeToken(value: string): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}
