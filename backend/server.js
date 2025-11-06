const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;
const databaseUrl = process.env.DATABASE_URL || 'postgres://postgres:postgres@db:5432/postgres';

const pool = new Pool({ connectionString: databaseUrl });

app.use(bodyParser.json());

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.status(200).json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', error: String(e) });
  }
});

app.get('/api/todos', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, title, done FROM todos ORDER BY id DESC');
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'DB error', detail: String(e) });
  }
});

app.post('/api/todos', async (req, res) => {
  const title = (req.body && req.body.title) ? String(req.body.title) : '';
  if (!title.trim()) return res.status(400).json({ error: 'title required' });
  try {
    const { rows } = await pool.query('INSERT INTO todos(title) VALUES($1) RETURNING id, title, done', [title]);
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'DB error', detail: String(e) });
  }
});

// Export app for tests
module.exports = { app };

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`Backend listening on port ${port}`);
  });
}
