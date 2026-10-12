import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from './server.js';

function listen(app) {
  return new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', () => resolve(app.server.address().port));
  });
}

test('health + rooms', async () => {
  const app = createApp();
  const port = await listen(app);
  try {
    const h = await fetch(`http://127.0.0.1:${port}/api/health`).then((r) => r.json());
    assert.equal(h.ok, true);
    const r = await fetch(`http://127.0.0.1:${port}/api/rooms`).then((x) => x.json());
    assert.ok(r.rooms.includes('general'));
  } finally { app.server.close(); }
});

test('post + history + since + clear', async () => {
  const app = createApp();
  const port = await listen(app);
  const base = `http://127.0.0.1:${port}`;
  try {
    const m1 = await fetch(`${base}/api/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: 'general', user: 'ada', text: 'hello' }),
    }).then((r) => r.json());
    assert.equal(m1.ok, true);
    const m2 = await fetch(`${base}/api/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: 'general', user: 'grace', text: 'hi!' }),
    }).then((r) => r.json());
    assert.equal(m2.ok, true);

    const all = await fetch(`${base}/api/messages?room=general&since=0`).then((r) => r.json());
    assert.equal(all.messages.length, 2);

    const tail = await fetch(`${base}/api/messages?room=general&since=${m1.msg.id}`).then((r) => r.json());
    assert.equal(tail.messages.length, 1);
    assert.equal(tail.messages[0].user, 'grace');

    const bad = await fetch(`${base}/api/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ room: 'general', user: 'x', text: '   ' }),
    });
    assert.equal(bad.status, 400);

    await fetch(`${base}/api/messages?room=general`, { method: 'DELETE' });
    const empty = await fetch(`${base}/api/messages?room=general&since=0`).then((r) => r.json());
    assert.equal(empty.messages.length, 0);
  } finally { app.server.close(); }
});

test('serves index.html', async () => {
  const app = createApp();
  const port = await listen(app);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('Relay'));
  } finally { app.server.close(); }
});
