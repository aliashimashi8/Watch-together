// In-memory stand-in for a Socket.IO server, so the real handlers in socket.js can be exercised offline.
export class FakeIO {
  constructor() { this.sockets = new Map(); this.h = {}; this.n = 0; }
  on(ev, fn) { this.h[ev] = fn; }
  to(room) { return { emit: (e, d) => this._room(room, e, d, null) }; }
  _room(room, e, d, except) {
    for (const [id, s] of this.sockets)
      if (id !== except && s.rooms.has(room)) s.deliver(e, d === undefined ? undefined : JSON.parse(JSON.stringify(d)));
  }
  connect(onEvent = () => {}) {
    const io = this, id = 's' + ++this.n, handlers = {}, rooms = new Set();
    const server = {
      id, on: (e, f) => { handlers[e] = f; },
      join: (r) => rooms.add(r), leave: (r) => rooms.delete(r),
      to: (r) => ({ emit: (e, d) => io._room(r, e, d, id) }),
      emit: (e, d) => onEvent(e, d),
    };
    this.sockets.set(id, { rooms, deliver: onEvent });
    this.h.connection(server);
    const events = [];
    const rec = (e, d) => { events.push([e, d]); onEvent(e, d); };
    this.sockets.get(id).deliver = rec;
    server.emit = rec;
    return {
      id, events,
      send: (ev, data) => new Promise((res) => { const r = handlers[ev]?.(JSON.parse(JSON.stringify(data ?? null)), res); if (ev !== 'join') res(r); }),
      got: (name) => events.filter(([e]) => e === name).map(([, d]) => d),
      disconnect: () => { handlers.disconnect?.(); io.sockets.delete(id); },
    };
  }
}
