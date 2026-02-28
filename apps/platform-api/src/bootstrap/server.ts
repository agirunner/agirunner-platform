import { buildApp } from './app.js';

export async function startServer(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: app.config.PORT, host: '0.0.0.0' });
}
