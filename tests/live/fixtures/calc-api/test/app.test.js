import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

describe('calc-api', () => {
  const app = createApp();

  it('adds numbers', async () => {
    const response = await request(app).get('/add?a=2&b=3');
    expect(response.status).toBe(200);
    expect(response.body.result).toBe(5);
  });

  it('subtracts numbers', async () => {
    const response = await request(app).get('/subtract?a=7&b=4');
    expect(response.status).toBe(200);
    expect(response.body.result).toBe(3);
  });

  it('multiplies numbers', async () => {
    const response = await request(app).get('/multiply?a=6&b=8');
    expect(response.status).toBe(200);
    expect(response.body.result).toBe(48);
  });

  it('divides numbers', async () => {
    const response = await request(app).get('/divide?a=12&b=3');
    expect(response.status).toBe(200);
    expect(response.body.result).toBe(4);
  });

  it('rejects divide by zero', async () => {
    const response = await request(app).get('/divide?a=1&b=0');
    expect(response.status).toBe(400);
  });
});
