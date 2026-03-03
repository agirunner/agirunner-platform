interface SseEvent {
  id?: string;
  event?: string;
  data?: string;
}

interface OrderedEventMatch {
  expected: string;
  eventIndex: number;
  eventId?: string;
}

function parseSseBlock(block: string): SseEvent {
  const event: SseEvent = {};
  const dataLines: string[] = [];

  for (const rawLine of block.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.length === 0 || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('id:')) {
      event.id = line.slice(3).trim();
      continue;
    }

    if (line.startsWith('event:')) {
      event.event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length > 0) {
    event.data = dataLines.join('\n');
  }

  return event;
}

function normalizeSseChunk(chunk: string): string {
  return chunk.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function consumeSseBlocksFromBuffer(buffer: string): {
  events: SseEvent[];
  remainder: string;
} {
  const events: SseEvent[] = [];
  let cursor = 0;
  let separatorAt = buffer.indexOf('\n\n');

  while (separatorAt !== -1) {
    const block = buffer.slice(cursor, separatorAt).trim();
    if (block.length > 0) {
      events.push(parseSseBlock(block));
    }

    cursor = separatorAt + 2;
    separatorAt = buffer.indexOf('\n\n', cursor);
  }

  return {
    events,
    remainder: buffer.slice(cursor),
  };
}

function findOrderedEventMatches(events: SseEvent[], requiredOrder: string[]): OrderedEventMatch[] | null {
  const matches: OrderedEventMatch[] = [];
  let cursor = 0;

  for (const expected of requiredOrder) {
    let foundAt = -1;
    for (let i = cursor; i < events.length; i += 1) {
      if (events[i]?.event === expected) {
        foundAt = i;
        break;
      }
    }

    if (foundAt === -1) {
      return null;
    }

    const event = events[foundAt];
    matches.push({
      expected,
      eventIndex: foundAt,
      eventId: event?.id,
    });
    cursor = foundAt + 1;
  }

  return matches;
}

function parsePositiveIntegerId(id: string | undefined): number | null {
  if (!id) return null;

  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric <= 0) {
    return null;
  }

  return numeric;
}

function describeEventWindow(events: SseEvent[], fromIndex: number, max = 8): string {
  const window = events.slice(fromIndex, fromIndex + max);
  if (window.length === 0) return 'none';

  return window
    .map((event, i) => {
      const at = fromIndex + i;
      const name = event.event ?? '<unnamed>';
      const id = event.id ?? '<no-id>';
      return `${at}:${name}#${id}`;
    })
    .join(', ');
}

function assertNonDecreasingNumericEventIds(events: SseEvent[]): string | null {
  let previous: { id: number; index: number } | null = null;

  for (let i = 0; i < events.length; i += 1) {
    const numericId = parsePositiveIntegerId(events[i]?.id);
    if (numericId === null) continue;

    if (previous && numericId < previous.id) {
      throw new Error(
        `SSE id order violation: event index ${i} has id ${numericId}, preceding numeric id was ${previous.id} at index ${previous.index}`,
      );
    }

    previous = { id: numericId, index: i };
  }

  if (!previous) {
    return null;
  }

  const firstNumeric = events
    .map((event, index) => ({ index, id: parsePositiveIntegerId(event.id) }))
    .find((entry): entry is { index: number; id: number } => entry.id !== null);

  if (!firstNumeric) {
    return null;
  }

  return `event_ids_non_decreasing:start=${firstNumeric.id}@${firstNumeric.index},end=${previous.id}@${previous.index}`;
}

export async function captureSseEvents(options: {
  url: string;
  apiKey: string;
  durationMs?: number;
  requiredOrder?: string[];
}): Promise<SseEvent[]> {
  const durationMs = options.durationMs ?? 15_000;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), durationMs);

  const response = await fetch(options.url, {
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      accept: 'text/event-stream',
    },
    signal: abortController.signal,
  });

  if (!response.ok || !response.body) {
    clearTimeout(timeout);
    throw new Error(`Unable to connect SSE stream ${options.url}: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = '';

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (abortController.signal.aborted) {
          break;
        }
        throw error;
      }

      if (chunk.done) {
        break;
      }

      buffer += normalizeSseChunk(decoder.decode(chunk.value, { stream: true }));
      const consumed = consumeSseBlocksFromBuffer(buffer);
      buffer = consumed.remainder;
      events.push(...consumed.events);

      if (options.requiredOrder && findOrderedEventMatches(events, options.requiredOrder)) {
        break;
      }
    }

    buffer += normalizeSseChunk(decoder.decode());
    const consumed = consumeSseBlocksFromBuffer(buffer);
    events.push(...consumed.events);
  } finally {
    clearTimeout(timeout);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  return events.filter((event) => event.event || event.id || event.data);
}

export function validateEventOrderAndGaps(events: SseEvent[], requiredOrder: string[]): string[] {
  if (events.length === 0) {
    throw new Error('No SSE events captured');
  }

  const validations: string[] = [];
  const matchedEvents: OrderedEventMatch[] = [];

  let cursor = 0;
  let previousMatchedNumericId: number | null = null;

  for (const expected of requiredOrder) {
    let foundAt = -1;
    for (let i = cursor; i < events.length; i += 1) {
      if (events[i]?.event === expected) {
        foundAt = i;
        break;
      }
    }

    if (foundAt === -1) {
      throw new Error(
        `Expected SSE event ${expected} not found after position ${cursor}; observed: ${describeEventWindow(events, cursor)}`,
      );
    }

    const event = events[foundAt];
    const eventId = event?.id ?? 'none';
    const numericId = parsePositiveIntegerId(event?.id);

    if (
      previousMatchedNumericId !== null &&
      numericId !== null &&
      numericId <= previousMatchedNumericId
    ) {
      throw new Error(
        `SSE causality breach for required sequence: ${expected} resolved at index ${foundAt} with id ${numericId}, previous matched required id was ${previousMatchedNumericId}`,
      );
    }

    if (numericId !== null) {
      previousMatchedNumericId = numericId;
    }

    validations.push(`event_order:${expected}@index=${foundAt}:id=${eventId}`);
    matchedEvents.push({ expected, eventIndex: foundAt, eventId: event?.id });
    cursor = foundAt + 1;
  }

  if (matchedEvents.length > 0) {
    validations.push(
      `event_trace_chain:${matchedEvents
        .map((match) => `${match.expected}@${match.eventIndex}#${match.eventId ?? 'none'}`)
        .join('>')}`,
    );
  }

  const nonDecreasingIdValidation = assertNonDecreasingNumericEventIds(events);
  if (nonDecreasingIdValidation) {
    validations.push(nonDecreasingIdValidation);
  }

  return validations;
}
