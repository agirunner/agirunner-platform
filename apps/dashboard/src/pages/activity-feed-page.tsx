import { useMemo, useState } from 'react';
import { useEffect } from 'react';

import { subscribeToEvents, type StreamEventPayload } from '../lib/sse.js';

interface ActivityFeedEvent {
  id: string;
  type: string;
  entityType: string;
  entityId: string;
  actorType: string;
  actorId: string;
  createdAt: string;
}

const MAX_EVENTS = 200;

export function ActivityFeedPage(): JSX.Element {
  const [events, setEvents] = useState<ActivityFeedEvent[]>([]);
  const [typeFilter, setTypeFilter] = useState('all');

  useEffect(() => {
    return subscribeToEvents((eventType, payload) => {
      const normalized = normalizeActivityEvent(eventType, payload);
      setEvents((current) => [normalized, ...current].slice(0, MAX_EVENTS));
    });
  }, []);

  const visibleEvents = useMemo(() => {
    if (typeFilter === 'all') {
      return events;
    }

    return events.filter((event) => event.entityType === typeFilter);
  }, [events, typeFilter]);

  return (
    <section className="card">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h2>Activity Feed</h2>
          <p className="muted">Live control-plane event stream across pipelines, tasks, workers, and agents.</p>
        </div>
        <div className="row">
          <label htmlFor="activity-type-filter">Entity</label>
          <select
            id="activity-type-filter"
            value={typeFilter}
            onChange={(event) => setTypeFilter(event.target.value)}
          >
            <option value="all">All</option>
            <option value="pipeline">Pipeline</option>
            <option value="task">Task</option>
            <option value="worker">Worker</option>
            <option value="agent">Agent</option>
            <option value="system">System</option>
          </select>
          <button className="button" type="button" onClick={() => setEvents([])}>
            Clear
          </button>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Event</th>
            <th>Entity</th>
            <th>Actor</th>
          </tr>
        </thead>
        <tbody>
          {visibleEvents.map((event) => (
            <tr key={event.id}>
              <td>{new Date(event.createdAt).toLocaleTimeString()}</td>
              <td>{event.type}</td>
              <td>
                {event.entityType}:{event.entityId}
              </td>
              <td>
                {event.actorType}:{event.actorId}
              </td>
            </tr>
          ))}
          {visibleEvents.length === 0 ? (
            <tr>
              <td colSpan={4} className="muted">
                Waiting for events...
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </section>
  );
}

export function normalizeActivityEvent(eventType: string, payload: StreamEventPayload): ActivityFeedEvent {
  const type = typeof payload.type === 'string' ? payload.type : eventType;
  const entityType = typeof payload.entity_type === 'string' ? payload.entity_type : 'system';
  const entityId = typeof payload.entity_id === 'string' ? payload.entity_id : 'n/a';
  const actorType = typeof payload.actor_type === 'string' ? payload.actor_type : 'system';
  const actorId = typeof payload.actor_id === 'string' ? payload.actor_id : 'n/a';
  const createdAt = typeof payload.created_at === 'string' ? payload.created_at : new Date().toISOString();
  const streamId = typeof payload.id === 'number' || typeof payload.id === 'string' ? String(payload.id) : undefined;

  return {
    id: streamId ?? `${type}-${entityType}-${entityId}-${createdAt}`,
    type,
    entityType,
    entityId,
    actorType,
    actorId,
    createdAt,
  };
}
