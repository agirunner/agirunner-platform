export interface StructuredValueFact {
  label: string;
  value: string;
}

export interface StructuredValueSummary {
  hasValue: boolean;
  shapeLabel: string;
  detail: string;
  keyHighlights: string[];
  scalarFacts: StructuredValueFact[];
}

export function summarizeStructuredValue(value: unknown): StructuredValueSummary {
  if (typeof value === 'undefined') {
    return {
      hasValue: false,
      shapeLabel: 'No packet',
      detail: 'No structured data recorded.',
      keyHighlights: [],
      scalarFacts: [],
    };
  }

  if (Array.isArray(value)) {
    return {
      hasValue: true,
      shapeLabel: `${value.length} item${value.length === 1 ? '' : 's'}`,
      detail: value.length > 0 ? 'Ordered list payload.' : 'Empty list payload.',
      keyHighlights: [],
      scalarFacts: [],
    };
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
    const scalarFacts = keys
      .filter((key) => isScalarValue(record[key]))
      .slice(0, 4)
      .map((key) => ({
        label: formatFactLabel(key),
        value: formatFactValue(record[key]),
      }));

    return {
      hasValue: true,
      shapeLabel: `${keys.length} field${keys.length === 1 ? '' : 's'}`,
      detail:
        keys.length > 0
          ? `Includes ${keys
              .slice(0, 4)
              .map((key) => formatFactLabel(key))
              .join(', ')}.`
          : 'Empty structured payload.',
      keyHighlights: keys.slice(0, 6).map((key) => formatFactLabel(key)),
      scalarFacts,
    };
  }

  return {
    hasValue: true,
    shapeLabel: scalarShapeLabel(value),
    detail: 'Inline scalar payload.',
    keyHighlights: [],
    scalarFacts: [{ label: 'Value', value: formatFactValue(value) }],
  };
}

function formatFactLabel(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('.', ' ');
}

function formatFactValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.length > 96 ? `${value.slice(0, 93)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'null';
  }
  return 'structured';
}

function scalarShapeLabel(value: unknown): string {
  if (typeof value === 'string') {
    return 'Text value';
  }
  if (typeof value === 'number') {
    return 'Numeric value';
  }
  if (typeof value === 'boolean') {
    return 'Boolean value';
  }
  return 'Scalar value';
}

function isScalarValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value === null
  );
}
