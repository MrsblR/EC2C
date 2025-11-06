const request = require('supertest');
jest.mock('pg', () => {
  const mockQuery = jest.fn(async (q, params) => {
    if (q.startsWith('SELECT 1')) return { rows: [{ col: 1 }] };
    if (q.startsWith('SELECT id, title, done FROM todos')) return { rows: [{ id: 1, title: 'Test todo', done: false }] };
    if (q.startsWith('INSERT INTO todos')) return { rows: [{ id: 1, title: params[0], done: false }] };
    if (q.startsWith('UPDATE todos SET done')) return { rows: [{ id: params[1], title: 'Test todo', done: params[0] }] };
    if (q.startsWith('DELETE FROM todos')) return { rowCount: 1, rows: [{ id: params[0] }] };
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

  it('PATCH /api/todos/:id sets done', async () => {
    const res = await request(app)
      .patch('/api/todos/1')
      .send({ done: true })
      .set('Content-Type', 'application/json');
    expect(res.statusCode).toBe(200);
    expect(res.body.done).toBe(true);
  });

  it('DELETE /api/todos/:id deletes item', async () => {
    const res = await request(app)
      .delete('/api/todos/1');
    expect(res.statusCode).toBe(204);
  });
});
