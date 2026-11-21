import { spawn } from 'node:child_process';

const procs = [
  spawn('npm', ['--prefix', 'server', 'run', 'dev'], { stdio: 'inherit', shell: true }),
  spawn('npm', ['--prefix', 'client', 'run', 'dev'], { stdio: 'inherit', shell: true }),
];

const shutdown = () => {
  for (const p of procs) {
    try { p.kill('SIGTERM'); } catch {}
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
