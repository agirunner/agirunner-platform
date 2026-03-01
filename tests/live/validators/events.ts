interface SseEvent {
  id?: string;
  event?: string;
  data?: string;
}

function parseSseChunk(chunk: string): SseEvent[] {
  const blocks = chunk.split('\n\n').filter(Boolean);
  return blocks.map((block) => {
    const event: SseEvent = {};
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) {
        event.id = line.slice(3).trim();
      } else if (line.startsWith('event:')) {
        event.event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        event.data = line.slice(5).trim();
      }
    }
    return event;
  });
}

export async function captureSseEvents(options: {
  url: string;
  apiKey: string;
  durationMs?: number;
}): Promise<SseEvent[]> {
  const response = await fetch(options.url, {
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      accept: 'text/event-stream',
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Unable to connect SSE stream ${options.url}: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  const stopAt = Date.now() + (options.durationMs ?? 15_000);

  while (Date.now() < stopAt) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    const text = decoder.decode(value, { stream: true });
    events.push(...parseSseChunk(text));
  }

  reader.releaseLock();
  return events.filter((event) => event.event || event.id || event.data);
}

export function validateEventOrderAndGaps(events: SseEvent[], requiredOrder: string[]): string[] {
  if (events.length === 0) {
    throw new Error('No SSE events captured');
  }

  const eventNames = events.map((event) => event.event).filter(Boolean) as string[];
  const validations: string[] = [];

  let cursor = 0;
  for (const expected of requiredOrder) {
    const foundAt = eventNames.indexOf(expected, cursor);
    if (foundAt === -1) {
      throw new Error(`Expected SSE event ${expected} not found after position ${cursor}`);
    }
    cursor = foundAt + 1;
    validations.push(`event_order:${expected}`);
  }

  const numericIds = events
    .map((event) => Number(event.id))
    .filter((id) => Number.isInteger(id) && id > 0);

  if (numericIds.length >= 2) {
    for (let i = 1; i < numericIds.length; i += 1) {
      if (numericIds[i] !== numericIds[i - 1] + 1) {
        throw new Error(`SSE gap detected: ${numericIds[i - 1]} -> ${numericIds[i]}`);
      }
    }
    validations.push('event_ids_contiguous');
  }

  return validations;
}
