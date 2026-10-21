import { start } from './server.js';

start().catch((err) => {
  console.error('Failed to start AAIMS backend:', err);
  process.exit(1);
});
