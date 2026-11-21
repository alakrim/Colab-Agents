import { createAgentCompanyApp } from './app.js';

const PORT = Number(process.env.PORT || 3001);
const runtime = createAgentCompanyApp();

runtime.server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  Agent Company OS server listening on http://localhost:${PORT}`);
  console.log(`  Data directory:      ${runtime.appDb.paths.dataRoot}`);
  console.log(`  UI WebSocket:        ws://localhost:${PORT}/ws/events`);
  console.log(`  Browser Bridge WS:   ws://localhost:${PORT}/ws/bridge?token=${runtime.adapters.browserBridge.pairingToken}\n`);
});

const shutdown = () => {
  runtime.stop();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
