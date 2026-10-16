import crypto from 'node:crypto';

export const MAX_PEERS = 2;

export class Rooms {
  constructor(now = () => Date.now()) { this.map = new Map(); this.now = now; }

  create() {
    const id = crypto.randomBytes(9).toString('base64url'); // 72 bits, unguessable
    this.map.set(id, {
      id, peers: new Map(), host: null, emptySince: this.now(),
      media: { url: '', playing: false, time: 0, rate: 1, at: this.now() },
    });
    return id;
  }

  get(id) { return this.map.get(id); }

  // peers are keyed by a per-tab client id so a reconnect replaces the old socket
  join(id, cid, sid, name) {
    const r = this.map.get(id);
    if (!r) return { error: 'not_found' };
    if (!r.peers.has(cid) && r.peers.size >= MAX_PEERS) return { error: 'full' };
    r.peers.set(cid, { id: cid, name, sid });
    if (!r.host) r.host = cid;
    r.emptySince = null;
    return { room: r };
  }

  leave(id, cid, sid) {
    const r = this.map.get(id);
    const p = r?.peers.get(cid);
    if (!p || p.sid !== sid) return null; // stale socket, ignore
    r.peers.delete(cid);
    if (r.host === cid) r.host = r.peers.keys().next().value ?? null;
    if (!r.peers.size) r.emptySince = this.now();
    return r;
  }

  setMedia(r, patch) { r.media = { ...r.media, ...patch, at: this.now() }; }

  position(r) {
    const m = r.media;
    return m.playing ? m.time + ((this.now() - m.at) / 1000) * m.rate : m.time;
  }

  snapshot(r) {
    return {
      room: r.id, host: r.host,
      peers: [...r.peers.values()].map(({ id, name }) => ({ id, name })),
      media: { ...r.media, time: this.position(r) },
    };
  }

  sweep(maxIdleMs) {
    for (const [id, r] of this.map)
      if (r.emptySince != null && this.now() - r.emptySince > maxIdleMs) this.map.delete(id);
  }
}
