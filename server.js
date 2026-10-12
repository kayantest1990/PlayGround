#!/usr/bin/env node
/* Relay chat server — zero dependencies (Node built-ins only).
 * Serves index.html + static assets, plus JSON + SSE chat API:
 *   GET  /api/health
 *   GET  /api/rooms
 *   GET  /api/messages?room=name&since=id
 *   POST /api/messages   {room, user, text}
 *   DELETE /api/messages?room=name
 *   POST /api/typing     {room, user}
 *   GET  /api/events?room=name  (SSE: msg | typing | presence | rooms)
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_MSG = 1000;
const MAX_ROOM_MSGS = 300;
const DEFAULT_ROOMS = ['general', 'random', 'tech'];

export function createStore() {
  const rooms = new Map(DEFAULT_ROOMS.map((r) => [r, []]));
  const listeners = new Set(); // {res, room}
  let seq = 0;

  const cleanRoom = (name) => String(name || 'general').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'general';

  function broadcast(room, payload) {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const l of listeners) {
      if (l.room === room || payload.type === 'rooms') {
        try { l.res.write(data); } catch { listeners.delete(l); }
      }
    }
  }

  function listRooms() { return [...rooms.keys()].sort(); }

  function history(room, since = 0) {
    const msgs = rooms.get(room) || [];
    if (!since) return msgs;
    const idx = msgs.findIndex((m) => String(m.id) === String(since));
    return idx === -1 ? msgs : msgs.slice(idx + 1);
  }

  function post(raw) {
    const room = cleanRoom(raw.room);
    const user = String(raw.user ?? 'anon').slice(0, 24) || 'anon';
    const text = String(raw.text ?? '').slice(0, MAX_MSG);
    if (!text.trim()) throw new Error('empty message');
    if (!rooms.has(room)) {
      rooms.set(room, []);
      broadcast(room, { type: 'rooms', rooms: listRooms() });
    }
    const msg = {
      id: raw.id ? String(raw.id).slice(0, 80) : `${Date.now()}-${++seq}`,
      room, user, text,
      ts: Number(raw.ts) || Date.now(),
      ...(raw.sys ? { sys: true } : {}),
    };
    const arr = rooms.get(room);
    if (arr.some((m) => m.id === msg.id)) return { msg, duplicate: true };
    arr.push(msg);
    while (arr.length > MAX_ROOM_MSGS) arr.shift();
    broadcast(room, { type: 'msg', msg });
    return { msg, duplicate: false };
  }

  function clear(room) {
    room = cleanRoom(room);
    rooms.set(room, []);
    broadcast(room, { type: 'clear', room });
  }

  return { rooms, listeners, listRooms, history, post, clear, broadcast, cleanRoom };
}

export function createApp({ root = ROOT } = {}) {
  const store = createStore();

  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify(obj));
  };
  const readBody = (req) => new Promise((resolveBody, reject) => {
    let buf = '';
    req.on('data', (c) => { buf += c; if (buf.length > 64 * 1024) { req.destroy(); reject(new Error('too large')); } });
    req.on('end', () => { try { resolveBody(buf ? JSON.parse(buf) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');

      // CORS preflight
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' });
        res.end();
        return;
      }

      // ---- API ----
      if (url.pathname === '/api/health') return json(res, 200, { ok: true, service: 'relay-chat', time: Date.now() });
      if (url.pathname === '/api/rooms' && req.method === 'GET') return json(res, 200, { rooms: store.listRooms() });

      if (url.pathname === '/api/messages') {
        if (req.method === 'GET') {
          const room = store.cleanRoom(url.searchParams.get('room'));
          return json(res, 200, { room, rooms: store.listRooms(), messages: store.history(room, url.searchParams.get('since') || 0) });
        }
        if (req.method === 'POST') {
          try {
            const body = await readBody(req);
            const { msg } = store.post(body);
            return json(res, 201, { ok: true, msg });
          } catch (e) { return json(res, 400, { ok: false, error: e.message }); }
        }
        if (req.method === 'DELETE') {
          store.clear(url.searchParams.get('room'));
          return json(res, 200, { ok: true });
        }
        return json(res, 405, { error: 'method not allowed' });
      }

      if (url.pathname === '/api/typing' && req.method === 'POST') {
        try {
          const body = await readBody(req);
          const room = store.cleanRoom(body.room);
          const user = String(body.user || 'anon').slice(0, 24);
          store.broadcast(room, { type: 'typing', room, user, ts: Date.now() });
          return json(res, 200, { ok: true });
        } catch { return json(res, 400, { ok: false }); }
      }

      if (url.pathname === '/api/events' && req.method === 'GET') {
        const room = store.cleanRoom(url.searchParams.get('room'));
        const user = String(url.searchParams.get('user') || 'anon').slice(0, 24);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        });
        res.write(': connected\n\n');
        const listener = { res, room };
        store.listeners.add(listener);
        store.broadcast(room, { type: 'presence', room, user, ts: Date.now() });
        const keep = setInterval(() => { try { res.write(': keepalive\n\n'); } catch { clearInterval(keep); } }, 20000);
        req.on('close', () => { store.listeners.delete(listener); clearInterval(keep); });
        return;
      }

      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });

      // ---- static ----
      let path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (path !== resolve(root) && !path.startsWith(resolve(root) + '/')) { res.writeHead(403); res.end('Forbidden'); return; }
      try {
        const { statSync } = await import('node:fs');
        if (statSync(path).isDirectory()) path = join(path, 'index.html');
      } catch { path = join(root, 'index.html'); }
      if (!existsSync(path)) path = join(root, 'index.html');
      const body = await readFile(path);
      res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(body);
    } catch {
      try { json(res, 500, { error: 'internal error' }); } catch {}
    }
  });

  return { server, store };
}

import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createApp();
  server.listen(port, '0.0.0.0', () => console.log(`Relay chat server listening on http://localhost:${port}`));
}
