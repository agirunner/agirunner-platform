interface StructuredRecordViewProps {
  data: unknown;
  emptyMessage?: string;
  depth?: number;
}

export function StructuredRecordView(props: StructuredRecordViewProps): JSX.Element {
  const record = asRecord(props.data);
  const entries = Object.entries(record);

  if (entries.length === 0) {
    return <p className="text-sm text-muted">{props.emptyMessage ?? 'No data available.'}</p>;
  }

  return (
    <dl className="grid gap-3 rounded-md border border-border/70 bg-border/10 p-4">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid gap-1 border-b border-border/60 pb-3 last:border-b-0 last:pb-0"
        >
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">
            {humanizeKey(key)}
          </dt>
          <dd className="text-sm text-foreground">
            {renderStructuredValue(value, props.depth ?? 0)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function renderStructuredValue(value: unknown, depth: number): JSX.Element {
  if (value === null || value === undefined || value === '') {
    return <span className="text-sm text-muted">—</span>;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <span>{String(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="text-sm text-muted">None</span>;
    }

    const allPrimitive = value.every((item) => isPrimitive(item));
    if (allPrimitive) {
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {value.map((item, index) => (
            <li key={`${String(item)}-${index}`}>{String(item)}</li>
          ))}
        </ul>
      );
    }

    return (
      <div className="grid gap-3">
        {value.map((item, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-md border border-border/60 bg-surface/70 p-3"
          >
            <strong className="text-sm">Item {index + 1}</strong>
            {depth >= 1 ? (
              <span className="text-sm text-muted">{summarizeComplexValue(item)}</span>
            ) : (
              <StructuredRecordView data={item} depth={depth + 1} />
            )}
          </div>
        ))}
      </div>
    );
  }

  if (depth >= 1) {
    return <span className="text-sm text-muted">{summarizeComplexValue(value)}</span>;
  }

  return (
    <StructuredRecordView
      data={value}
      depth={depth + 1}
    />
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function summarizeComplexValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} items`;
  }

  const keys = Object.keys(asRecord(value));
  if (keys.length === 0) {
    return 'No details';
  }

  return keys.join(', ');
}
