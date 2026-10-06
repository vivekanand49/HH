// Runs the API server and the Vite dev server together. Ctrl+C stops both.
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  spawn(npm, ['run', 'dev', '-w', 'server'], { stdio: 'inherit' }),
  spawn(npm, ['run', 'dev', '-w', 'client'], { stdio: 'inherit' }),
];

const stop = () => {
  for (const p of procs) p.kill('SIGTERM');
  process.exit();
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
