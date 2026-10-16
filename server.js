import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import rateLimit from 'express-rate-limit';
import { Server } from 'socket.io';
import { Rooms } from './rooms.js';
import { attach } from './socket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render/Railway/Fly proxies
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5 }); // same-origin only by default
const rooms = new Rooms();
setInterval(() => rooms.sweep(10 * 60_000), 60_000).unref();

app.use((req, res, next) => {
  if (req.path !== '/healthz' && process.env.NODE_ENV === 'production' && req.headers['x-forwarded-proto'] === 'http')
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'microphone=(self), display-capture=(self)' });
  next();
});

const limit = (max) => rateLimit({ windowMs: 15 * 60_000, max, standardHeaders: true, legacyHeaders: false });

app.post('/api/rooms', limit(20), (_req, res) => res.json({ id: rooms.create() }));

app.get('/api/ice', limit(100), (_req, res) => {
  const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const urls = (process.env.TURN_URLS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (urls.length) {
    if (process.env.TURN_SECRET) { // coturn REST-style ephemeral credentials (24h)
      const username = String(Math.floor(Date.now() / 1000) + 86400);
      const credential = crypto.createHmac('sha1', process.env.TURN_SECRET).update(username).digest('base64');
      iceServers.push({ urls, username, credential });
    } else if (process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
      iceServers.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
    }
  }
  res.json({ iceServers, turn: iceServers.length > 1 });
});

app.get('/healthz', (_req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));

attach(io, rooms);

const port = Number(process.env.PORT) || 3000;
// Behind a proxy (Render) the proxy's idle timeout must be shorter than Node's, or requests randomly fail with 502.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;
server.listen(port, '0.0.0.0', () => {
  console.log(`Movie Together listening on 0.0.0.0:${port}`);
  if (!process.env.TURN_URLS) console.warn('WARNING: no TURN server configured (TURN_URLS). Voice may fail on some mobile networks.');
});

// Render sends SIGTERM on every deploy/restart: close cleanly so clients reconnect quickly.
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log(`${sig} received, shutting down`);
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
