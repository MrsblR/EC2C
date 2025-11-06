const request = require('supertest');
jest.mock('pg', () => {
  const mockQuery = jest.fn(async (q, params) => {
    if (q.startsWith('SELECT 1')) return { rows: [{ col: 1 }] };
    if (q.startsWith('SELECT id, title, done FROM todos')) return { rows: [] };
    if (q.startsWith('INSERT INTO todos')) return { rows: [{ id: 1, title: params[0], done: false }] };
    return { rows: [] };
  });
  return { Pool: jest.fn(() => ({ query: mockQuery })) };
});
const { app } = require('../server.js');

describe('Backend API', () => {
  it('GET /api/health ok', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/todos creates item', async () => {
    const res = await request(app)
      .post('/api/todos')
      .send({ title: 'Test todo' })
      .set('Content-Type', 'application/json');
    expect(res.statusCode).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.title).toBe('Test todo');
  });
});
