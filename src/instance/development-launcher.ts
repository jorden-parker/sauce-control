import { INSTALLATION_ERROR_HINTS } from "./installation-diagnostics";

/** Trusted PID 1. Input stays in memory; child output never reaches runtime logs. Relays the published bridge port to the development server's own port. */
export const DEVELOPMENT_LAUNCHER = String.raw`
const net = require('node:net');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const socketPath = '/tmp/sauce-control.sock';
const exitPath = '/home/node/.sauce-control-exit';
let child, bridge, busy = false, launched = false;
try { fs.unlinkSync(socketPath); } catch {}
const base = { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/home/node', NODE_ENV: 'development' };
const errorCodes = ${JSON.stringify([...Object.keys(INSTALLATION_ERROR_HINTS).filter((code) => code !== "ELIFECYCLE"), "ELIFECYCLE"])};
const execute = (command, environment, diagnose = false) => spawn('/bin/sh', ['-c', command], {
  cwd: '/app', env: environment, stdio: diagnose ? ['ignore', 'pipe', 'pipe'] : 'ignore', detached: true
});
// Drain both streams but retain at most 256 characters per stream.
// Only allowlisted codes survive; raw chunks are never forwarded or saved.
const watch = (child) => {
  let errorIndex = errorCodes.length;
  for (const stream of [child.stdout, child.stderr]) {
    let tail = '';
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
      const text = tail + chunk;
      for (let index = 0; index < errorIndex; index++) {
        if (new RegExp('\\b' + errorCodes[index] + '\\b').test(text)) { errorIndex = index; break; }
      }
      tail = text.slice(-256);
    });
    stream.on('end', () => { tail = ''; });
  }
  return () => errorCodes[errorIndex] || 'unknown';
};
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
        const installEnv = { ...payload.setupEnvironment, ...base, PORT: String(payload.port) };
        if (payload.environment.NODE_AUTH_TOKEN !== undefined) installEnv.NODE_AUTH_TOKEN = payload.environment.NODE_AUTH_TOKEN;
        const tokenStatus = installEnv.NODE_AUTH_TOKEN === undefined ? 'absent' : installEnv.NODE_AUTH_TOKEN.length ? 'present' : 'empty';
        child = execute(payload.installCommand, installEnv, true);
        const errorCode = watch(child);
        const status = await new Promise(resolve => {
          child.once('error', () => resolve('spawn'));
          // close waits for stdout and stderr to drain, including the last error.
          child.once('close', (code, signal) => resolve(signal ? 'signal' : code));
        });
        delete installEnv.NODE_AUTH_TOKEN;
        if (status !== 0) { busy = false; socket.end('installation-failed:' + errorCode() + ':' + tokenStatus + ':' + status); return; }
      }
      socket.write('starting\n');
      delete payload.setupEnvironment;
      const environment = { ...base, ...payload.environment, NODE_ENV: 'development', PORT: String(payload.port) };
      delete environment.NODE_AUTH_TOKEN;
      delete payload.environment.NODE_AUTH_TOKEN;
      child = execute(payload.startCommand, environment, true);
      const startErrorCode = watch(child);
      child.once('error', () => process.exit(1));
      // Only the exit status and an allowlisted code outlive the development server, in a
      // file the host reads after the container stops. Raw output is never kept.
      child.once('exit', (code, signal) => {
        try { fs.writeFileSync(exitPath, (signal ? 'signal' : String(code)) + ':' + startErrorCode()); } catch {}
        process.exit(1);
      });
      // Development servers often bind only to localhost (Vite, say), which the published
      // port cannot reach. The bridge accepts on every interface and relays to that loopback.
      // Loopback is tried by address, since "localhost" resolves differently per runtime.
      const relay = (downstream, hosts) => {
        const upstream = net.connect({ autoSelectFamily: false, host: hosts[0], port: payload.port });
        let connected = false;
        upstream.once('connect', () => { connected = true; downstream.pipe(upstream); upstream.pipe(downstream); });
        upstream.on('error', () => { if (!connected && hosts.length > 1) relay(downstream, hosts.slice(1)); else downstream.destroy(); });
      };
      bridge = net.createServer({}, downstream => {
        downstream.on('error', () => {});
        relay(downstream, ['127.0.0.1', '::1']);
      });
      bridge.on('error', () => process.exit(1));
      bridge.listen(payload.bridgePort);
      launched = true; busy = false; socket.end('started');
    } catch { text = ''; busy = false; socket.end('invalid-request'); }
  });
});
server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  if (child?.pid) { try { process.kill(-child.pid, signal); } catch {} }
  bridge?.close(); server.close(); setTimeout(() => process.exit(0), 500).unref();
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
