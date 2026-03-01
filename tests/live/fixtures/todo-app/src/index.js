import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT ?? 3002);

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`todo-app listening on :${port}`);
});
