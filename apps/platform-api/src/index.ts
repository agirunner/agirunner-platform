import { startServer } from './bootstrap/server.js';

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});
