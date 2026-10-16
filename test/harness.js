// Test-only server: serves public/ and bridges the browser's socket.io calls (via a tiny shim over fetch)
// into the REAL handlers in socket.js. Lets headless Chrome run the real client without socket.io installed.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Rooms } from '../rooms.js';
import { attach } from '../socket.js';
import { FakeIO } from './fake-io.js';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
const rooms = new Rooms(), fio = new FakeIO(); attach(fio, rooms);
const clients = new Map(); // sid -> {c, queue, wake}
const SHIM = `window.io=function(){const hs={};let sid=null,closed=false,chain=Promise.resolve();
const fire=(e,d)=>(hs[e]||[]).forEach(f=>f(d));
const post=(u,b)=>fetch(u,{method:'POST',body:JSON.stringify(b)}).then(r=>r.json());
const api={on:(e,f)=>{(hs[e]=hs[e]||[]).push(f);return api},
emit:(ev,data,ack)=>{const my=sid;chain=chain.then(async()=>{if(!my||my!==sid)return;const r=await post('/h/send',{sid:my,ev,data});if(ack)ack(r.ack)})},
close:()=>{closed=true;if(sid)post('/h/disconnect',{sid})},
_drop:(ms)=>{const o=sid;sid=null;post('/h/disconnect',{sid:o});fire('disconnect');setTimeout(connect,ms||800)}};
window.__sock=api;
async function connect(){const s=(await post('/h/connect',{})).sid;sid=s;fire('connect');
 while(!closed&&sid===s){try{const evs=await (await fetch('/h/poll?sid='+s)).json();if(sid===s)evs.forEach(([e,d])=>fire(e,d))}catch{break}}}
connect();return api};`;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const body = (req) => new Promise((r) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => r(b ? JSON.parse(b) : {})); });
const json = (res, o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/socket.io/socket.io.js') { res.setHeader('content-type', 'text/javascript'); return res.end(SHIM); }
  if (u.pathname === '/api/rooms' && req.method === 'POST') return json(res, { id: rooms.create() });
  if (u.pathname === '/api/ice') return json(res, { iceServers: [], turn: false });
  if (u.pathname === '/sample.webm') { res.setHeader('accept-ranges', 'bytes'); res.setHeader('content-type', 'video/webm');
    const buf = fs.readFileSync(process.env.SAMPLE || '/tmp/sample.webm'); const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
    if (m) { const s = +m[1], e = m[2] ? +m[2] : buf.length - 1; res.statusCode = 206; res.setHeader('content-range', `bytes ${s}-${e}/${buf.length}`); return res.end(buf.subarray(s, e + 1)); }
    return res.end(buf); }
  if (u.pathname === '/h/connect') { const q = { queue: [], wake: null };
    q.c = fio.connect((e, d) => { q.queue.push([e, d]); q.wake?.(); }); clients.set(q.c.id, q); return json(res, { sid: q.c.id }); }
  if (u.pathname === '/h/send') { const b = await body(req); const q = clients.get(b.sid); if (!q) return json(res, {});
    return json(res, { ack: await q.c.send(b.ev, b.data) }); }
  if (u.pathname === '/h/disconnect') { const b = await body(req); clients.get(b.sid)?.c.disconnect(); clients.delete(b.sid); return json(res, {}); }
  if (u.pathname === '/h/poll') { const q = clients.get(u.searchParams.get('sid')); if (!q) return json(res, []);
    if (!q.queue.length) await new Promise((r) => { q.wake = r; setTimeout(r, 15000); });
    return json(res, q.queue.splice(0)); }
  const f = path.join(pub, u.pathname === '/' ? 'index.html' : u.pathname);
  if (!f.startsWith(pub) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', mime[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
}).listen(3100, () => console.log('harness :3100'));
