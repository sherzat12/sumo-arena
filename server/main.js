// Точка входа: npm start
import os from 'node:os';
import { startServer } from './index.js';

const port = Number(process.env.PORT) || 3000;
const { port: actual } = await startServer({ port });

console.log(`Sumo Arena запущена: http://localhost:${actual}`);
const lan = Object.values(os.networkInterfaces())
  .flat()
  .filter((n) => n && n.family === 'IPv4' && !n.internal)
  .map((n) => `http://${n.address}:${actual}`);
if (lan.length) console.log(`Друг в той же Wi-Fi сети: ${lan.join('  или  ')}`);
