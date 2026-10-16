// Socket event handling, separated from server.js so it can be tested without a network.
const clean = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n) : '');
const num = (x, lo, hi) => Number.isFinite(x) && x >= lo && x <= hi;
export const validUrl = (u) => {
  try { return typeof u === 'string' && ['http:', 'https:'].includes(new URL(u).protocol) && u.length <= 2000; } catch { return false; }
};

export function attach(io, rooms) {
  io.on('connection', (socket) => {
    let ctx = null;
    let tokens = 100; // per 5 s; ICE candidates come in bursts
    const refill = setInterval(() => { tokens = 100; }, 5000);
    refill.unref?.();
    const ok = () => ctx && tokens-- > 0;
    const room = () => rooms.get(ctx.room);

    socket.on('join', (d, ack = () => {}) => {
      if (!d || typeof d.room !== 'string' || typeof d.cid !== 'string' || !d.cid || d.cid.length > 64 || tokens-- <= 0)
        return ack({ error: 'bad_request' });
      if (ctx && ctx.room !== d.room) leave(); // switching rooms on one socket
      const res = rooms.join(d.room, d.cid, socket.id, clean(d.name, 24) || 'Guest');
      if (res.error) return ack(res);
      ctx = { room: d.room, cid: d.cid };
      socket.join(d.room);
      ack({ ok: true, ...rooms.snapshot(res.room) });
      socket.to(d.room).emit('state', rooms.snapshot(res.room)); // state first, then peer-joined
      socket.to(d.room).emit('peer-joined', { id: d.cid });
    });

    socket.on('signal', (d) => { // relay only inside the sender's own room
      if (ok() && d && typeof d === 'object' && JSON.stringify(d).length < 20000) socket.to(ctx.room).emit('signal', d);
    });

    socket.on('media', (d) => {
      if (!ok() || !d || !validUrl(d.url)) return;
      rooms.setMedia(room(), { url: d.url, playing: false, time: 0, rate: 1 });
      io.to(ctx.room).emit('media', { url: d.url });
    });

    socket.on('playback', (d) => {
      if (!ok() || !d || typeof d.playing !== 'boolean' || !num(d.time, 0, 1e6) || !num(d.rate, 0.25, 4)) return;
      if (d.tick && room().host !== ctx.cid) return; // only the host sends drift ticks
      rooms.setMedia(room(), { playing: d.playing, time: d.time, rate: d.rate });
      socket.to(ctx.room).emit('playback', { playing: d.playing, time: d.time, rate: d.rate, tick: !!d.tick });
    });

    socket.on('chat', (d) => {
      const text = clean(d?.text, 500);
      if (!ok() || !text) return;
      const p = room().peers.get(ctx.cid);
      io.to(ctx.room).emit('chat', { from: p?.name || 'Guest', cid: ctx.cid, text, t: Date.now() });
    });

    function leave() {
      if (!ctx) return;
      const { room: id, cid } = ctx;
      ctx = null;
      const r = rooms.leave(id, cid, socket.id);
      socket.leave(id);
      if (r) { io.to(id).emit('peer-left', { id: cid }); io.to(id).emit('state', rooms.snapshot(r)); }
    }
    socket.on('leave', leave);
    socket.on('disconnect', () => { clearInterval(refill); leave(); });
  });
}
