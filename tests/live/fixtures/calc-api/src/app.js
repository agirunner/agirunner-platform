import express from 'express';

export function createApp() {
  const app = express();

  app.get('/add', (req, res) => {
    const a = Number(req.query.a ?? 0);
    const b = Number(req.query.b ?? 0);
    res.json({ result: a + b });
  });

  app.get('/subtract', (req, res) => {
    const a = Number(req.query.a ?? 0);
    const b = Number(req.query.b ?? 0);
    res.json({ result: a - b });
  });

  app.get('/multiply', (req, res) => {
    const a = Number(req.query.a ?? 0);
    const b = Number(req.query.b ?? 0);
    res.json({ result: a * b });
  });

  app.get('/divide', (req, res) => {
    const a = Number(req.query.a ?? 0);
    const b = Number(req.query.b ?? 0);

    if (b === 0) {
      return res.status(400).json({ error: 'Division by zero' });
    }

    return res.json({ result: a / b });
  });

  return app;
}
