import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('todo-app baseline behavior', () => {
  const app = createApp();

  it('creates a todo', async () => {
    const response = await request(app).post('/todos').send({ title: 'ship v1' });
    expect(response.status).toBe(201);
    expect(response.body.data.title).toBe('ship v1');
  });

  it('updates an existing todo with non-empty title', async () => {
    const create = await request(app).post('/todos').send({ title: 'initial' });
    const update = await request(app)
      .put(`/todos/${create.body.data.id}`)
      .send({ title: 'updated' });

    expect(update.status).toBe(200);
    expect(update.body.data.title).toBe('updated');
  });

  it('deletes an existing todo', async () => {
    const create = await request(app).post('/todos').send({ title: 'delete me' });
    const remove = await request(app).delete(`/todos/${create.body.data.id}`);
    expect(remove.status).toBe(204);
  });
});
