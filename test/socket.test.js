import test from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from '../rooms.js';
import { attach, validUrl } from '../socket.js';
import { FakeIO } from './fake-io.js';

function setup() {
  let t = 1000; const clock = { now: () => t, set: (v) => { t = v; } };
  const rooms = new Rooms(clock.now), io = new FakeIO(); attach(io, rooms);
  return { rooms, io, clock, id: rooms.create() };
}
const join = async (c, room, cid, name = cid) => c.send('join', { room, cid, name });

test('two clients join, see each other, and get peer-joined', async () => {
  const { io, id } = setup();
  const a = io.connect(), b = io.connect();
  const ra = await join(a, id, 'A'); assert.equal(ra.peers.length, 1); assert.equal(ra.host, 'A');
  const rb = await join(b, id, 'B'); assert.equal(rb.peers.length, 2);
  assert.deepEqual(a.got('peer-joined'), [{ id: 'B' }]);
  assert.equal(a.got('state').at(-1).peers.length, 2);
});

test('third client rejected; unknown room rejected; bad input rejected', async () => {
  const { io, id } = setup();
  await join(io.connect(), id, 'A'); await join(io.connect(), id, 'B');
  assert.equal((await join(io.connect(), id, 'C')).error, 'full');
  assert.equal((await join(io.connect(), 'nope', 'D')).error, 'not_found');
  assert.equal((await io.connect().send('join', { room: 5 })).error, 'bad_request');
});

test('play, pause, seek and rate sync to the other client only', async () => {
  const { io, id } = setup();
  const a = io.connect(), b = io.connect(); await join(a, id, 'A'); await join(b, id, 'B');
  await a.send('playback', { playing: true, time: 12.5, rate: 1.25 });
  assert.deepEqual(b.got('playback').at(-1), { playing: true, time: 12.5, rate: 1.25, tick: false });
  assert.equal(a.got('playback').length, 0); // no echo back to sender
  await b.send('playback', { playing: false, time: 40, rate: 1 });
  assert.equal(a.got('playback').at(-1).time, 40);
  assert.equal(a.got('playback').at(-1).playing, false);
});

test('invalid playback values are dropped', async () => {
  const { io, id } = setup();
  const a = io.connect(), b = io.connect(); await join(a, id, 'A'); await join(b, id, 'B');
  for (const bad of [{ playing: 'x', time: 1, rate: 1 }, { playing: true, time: -1, rate: 1 }, { playing: true, time: NaN, rate: 1 }, { playing: true, time: 1, rate: 99 }, null])
    await a.send('playback', bad);
  assert.equal(b.got('playback').length, 0);
});

test('only the host may send drift ticks', async () => {
  const { io, id } = setup();
  const a = io.connect(), b = io.connect(); await join(a, id, 'A'); await join(b, id, 'B');
  await b.send('playback', { playing: true, time: 5, rate: 1, tick: true });
  assert.equal(a.got('playback').length, 0);
  await a.send('playback', { playing: true, time: 5, rate: 1, tick: true });
  assert.equal(b.got('playback').at(-1).tick, true);
});

test('media url validation and broadcast to both', async () => {
  const { io, id } = setup();
  const a = io.connect(), b = io.connect(); await join(a, id, 'A'); await join(b, id, 'B');
  for (const u of ['javascript:alert(1)', 'ftp://x/y.mp4', 'nope', 5]) await a.send('media', { url: u });
  assert.equal(a.got('media').length, 0);
  await a.send('media', { url: 'https://example.com/m.mp4' });
  assert.equal(a.got('media').length, 1); assert.equal(b.got('media').length, 1);
  assert.equal(validUrl('https://x.y/z'), true);
});

test('late joiner receives extrapolated position', async () => {
  const { io, id, clock } = setup();
  const a = io.connect(); await join(a, id, 'A');
  await a.send('media', { url: 'https://example.com/m.mp4' });
  await a.send('playback', { playing: true, time: 10, rate: 1 });
  clock.set(1000 + 7000);
  const b = io.connect(); const r = await join(b, id, 'B');
  assert.equal(r.media.url, 'https://example.com/m.mp4'); assert.equal(r.media.time, 17); assert.equal(r.media.playing, true);
});

test('signals relay only inside the room', async () => {
  const s = setup(); const other = s.rooms.create();
  const a = s.io.connect(), b = s.io.connect(), x = s.io.connect(), y = s.io.connect();
  await join(a, s.id, 'A'); await join(b, s.id, 'B'); await join(x, other, 'X'); await join(y, other, 'Y');
  await a.send('signal', { description: { type: 'offer', sdp: 'v=0' } });
  assert.equal(b.got('signal').length, 1); assert.equal(x.got('signal').length, 0); assert.equal(y.got('signal').length, 0);
  const outsider = s.io.connect(); await outsider.send('signal', { candidate: {} });
  assert.equal(a.got('signal').length, 0); // not a member: ignored
});

test('reconnect with same client id keeps the seat; stale socket cannot evict it', async () => {
  const { io, id } = setup();
  const a = io.connect(), b = io.connect(); await join(a, id, 'A'); await join(b, id, 'B');
  const a2 = io.connect(); const r = await join(a2, id, 'A'); // rejoin before old socket times out
  assert.equal(r.peers.length, 2);
  a.disconnect(); // old socket finally disconnects
  assert.equal(b.got('peer-left').length, 0);
  assert.equal((await b.send('chat', { text: 'hi' })) , undefined);
  assert.equal(a2.got('chat').length, 1);
});

test('leave hands host over and notifies the other peer', async () => {
  const { io, id } = setup();
  const a = io.connect(), b = io.connect(); await join(a, id, 'A'); await join(b, id, 'B');
  await a.send('leave');
  assert.deepEqual(b.got('peer-left'), [{ id: 'A' }]);
  assert.equal(b.got('state').at(-1).host, 'B');
});

test('chat is sanitised and limited', async () => {
  const { io, id } = setup();
  const a = io.connect(), b = io.connect(); await join(a, id, 'A', 'Ali'); await join(b, id, 'B');
  await a.send('chat', { text: '<b>hi</b>\u0000' + 'x'.repeat(900) });
  const m = b.got('chat')[0]; assert.equal(m.from, 'Ali'); assert.ok(!m.text.includes('<')); assert.ok(m.text.length <= 500);
  await a.send('chat', { text: '   ' }); assert.equal(b.got('chat').length, 1);
});
