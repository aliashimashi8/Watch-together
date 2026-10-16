import test from 'node:test';
import assert from 'node:assert/strict';
import { Rooms } from '../rooms.js';

test('room ids are unguessable and unique', () => {
  const r = new Rooms();
  const a = r.create(), b = r.create();
  assert.notEqual(a, b);
  assert.ok(a.length >= 12);
});

test('max two peers, unknown room rejected, reconnect replaces socket', () => {
  const r = new Rooms(); const id = r.create();
  assert.equal(r.join('nope', 'a', 's1', 'A').error, 'not_found');
  r.join(id, 'a', 's1', 'A'); r.join(id, 'b', 's2', 'B');
  assert.equal(r.join(id, 'c', 's3', 'C').error, 'full');
  assert.ok(r.join(id, 'a', 's9', 'A').room);
  assert.equal(r.leave(id, 'a', 's1'), null);
});

test('host moves to the remaining peer', () => {
  const r = new Rooms(); const id = r.create();
  r.join(id, 'a', 's1', 'A'); r.join(id, 'b', 's2', 'B');
  assert.equal(r.get(id).host, 'a');
  r.leave(id, 'a', 's1');
  assert.equal(r.get(id).host, 'b');
});

test('late joiners get the extrapolated playback position', () => {
  let t = 0; const r = new Rooms(() => t); const id = r.create();
  const room = r.join(id, 'a', 's1', 'A').room;
  r.setMedia(room, { url: 'https://x/y.mp4', playing: true, time: 10, rate: 2 });
  t = 5000;
  assert.equal(r.position(room), 20);
  r.setMedia(room, { playing: false, time: 20 });
  t = 9000;
  assert.equal(r.position(room), 20);
});

test('empty rooms expire', () => {
  let t = 0; const r = new Rooms(() => t); const id = r.create();
  t = 11 * 60_000; r.sweep(10 * 60_000);
  assert.equal(r.get(id), undefined);
});
