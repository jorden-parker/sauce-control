/** Trusted PID 1. Input stays in memory; child output never reaches runtime logs. */
export const DEVELOPMENT_LAUNCHER = String.raw`
const net = require('node:net');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const socketPath = '/tmp/sauce-control.sock';
let child, busy = false, launched = false;
try { fs.unlinkSync(socketPath); } catch {}
const base = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node', NODE_ENV: 'development' };
const execute = (command, environment) => spawn('/bin/sh', ['-c', command], {
  cwd: '/app', env: environment, stdio: 'ignore', detached: true
});
const server = net.createServer({ allowHalfOpen: true }, socket => {
  let text = '';
  socket.setEncoding('utf8');
  socket.on('error', () => {});
  socket.on('data', chunk => {
    text += chunk;
    if (Buffer.byteLength(text) > 5 * 1024 * 1024) { text = ''; socket.destroy(); }
  });
  socket.on('end', async () => {
    try {
      const payload = JSON.parse(text); text = '';
      if (payload.probe === true) { socket.end('ready'); return; }
      if (busy || launched) { socket.end('unavailable'); return; }
      busy = true;
      if (payload.installCommand) {
        socket.write('installing\n');
        const installEnv = { ...base };
        if (payload.environment.NODE_AUTH_TOKEN !== undefined) installEnv.NODE_AUTH_TOKEN = payload.environment.NODE_AUTH_TOKEN;
        child = execute(payload.installCommand, installEnv);
        const ok = await new Promise(resolve => {
          child.once('error', () => resolve(false));
          child.once('exit', code => resolve(code === 0));
        });
        delete installEnv.NODE_AUTH_TOKEN;
        if (!ok) { busy = false; socket.end('installation-failed'); return; }
      }
      socket.write('starting\n');
      const environment = { ...base, ...payload.environment, NODE_ENV: 'development', PORT: String(payload.port) };
      delete environment.NODE_AUTH_TOKEN;
      delete payload.environment.NODE_AUTH_TOKEN;
      child = execute(payload.startCommand, environment);
      child.once('error', () => process.exit(1));
      child.once('exit', () => process.exit(1));
      launched = true; busy = false; socket.end('started');
    } catch { text = ''; busy = false; socket.end('invalid-request'); }
  });
});
server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (child?.pid) { try { process.kill(-child.pid, signal); } catch {} }
  server.close(); setTimeout(() => process.exit(0), 500).unref();
});
process.on('uncaughtException', () => process.exit(1));
process.on('unhandledRejection', () => process.exit(1));
`;

/** Fixed command text; only stdin carries values. */
export const DEVELOPMENT_TRANSPORT = String.raw`
const net = require('node:net');
let input = '', attempts = 0;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (Buffer.byteLength(input) > 5*1024*1024) process.exit(1); });
process.stdin.on('end', connect);
function connect() {
  const socket = net.createConnection('/tmp/sauce-control.sock');
  socket.on('connect', () => socket.end(input));
  socket.on('data', chunk => process.stdout.write(chunk));
  socket.on('end', () => { input = ''; });
  socket.on('error', () => { if (++attempts < 100) setTimeout(connect, 50); else process.exit(1); });
}
`;
