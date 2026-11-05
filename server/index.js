import os from 'node:os';
import { createGameServer } from './game-server.js';

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const dataFile = process.env.DATA_FILE || undefined;

const game = createGameServer({ port, host, dataFile });
await game.listen();

console.log(`Ok Küp çalışıyor: http://localhost:${port}`);
for (const nets of Object.values(os.networkInterfaces())) {
  for (const n of nets || []) {
    if (n.family === 'IPv4' && !n.internal) console.log(`  iPhone'dan (aynı Wi-Fi): http://${n.address}:${port}`);
  }
}

const shutdown = async () => { await game.close(); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
