import express from 'express';

export function createApp() {
  const app = express();
  app.use(express.json());

  const todos = [];

  app.get('/todos', (_req, res) => {
    // BUG #1 (planted): crashes when empty instead of returning []
    if (!todos[0]) {
      return res.status(500).json({ error: 'No todos present' });
    }

    return res.json({ data: todos });
  });

  app.post('/todos', (req, res) => {
    const title = String(req.body?.title ?? '').trim();
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const todo = { id: String(todos.length + 1), title, done: false };
    todos.push(todo);
    return res.status(201).json({ data: todo });
  });

  app.put('/todos/:id', (req, res) => {
    const todo = todos.find((item) => item.id === req.params.id);
    if (!todo) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    // BUG #3 (planted): allows empty title
    todo.title = String(req.body?.title ?? '');
    return res.json({ data: todo });
  });

  app.delete('/todos/:id', (req, res) => {
    const index = todos.findIndex((item) => item.id === req.params.id);

    // BUG #2 (planted): silently succeeds for non-existent ID
    if (index === -1) {
      return res.status(204).send();
    }

    todos.splice(index, 1);
    return res.status(204).send();
  });

  return app;
}
