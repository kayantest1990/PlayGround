/* Relay chat client — server mode (REST+SSE) with local fallback (BroadcastChannel+localStorage). */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const roomList = $('roomList'), userList = $('userList'), messagesEl = $('messages');
  const msgInput = $('msgInput'), nickInput = $('nickInput'), roomTitle = $('roomTitle');
  const typingEl = $('typing'), connBadge = $('connBadge'), connDot = $('connDot'), connText = $('connText');

  const DEFAULT_ROOMS = [
    { name: 'general', topic: 'Welcome to Relay — say hello.' },
    { name: 'random', topic: 'Anything goes. Be kind.' },
    { name: 'tech', topic: 'Code, servers, and sockets.' },
  ];
  const EMOJIS = ['😀','😂','😍','🤔','👍','🎉','🔥','🚀','💡','❤️','😎','🤖','👋','✅','⭐','🎮'];

  const store = {
    get nick() { return localStorage.getItem('relay.nick') || ''; },
    set nick(v) { localStorage.setItem('relay.nick', v); },
    get room() { return localStorage.getItem('relay.room') || 'general'; },
    set room(v) { localStorage.setItem('relay.room', v); },
    rooms() {
      try { return JSON.parse(localStorage.getItem('relay.rooms') || 'null') || DEFAULT_ROOMS.map(r => r.name); }
      catch { return DEFAULT_ROOMS.map(r => r.name); }
    },
    setRooms(r) { localStorage.setItem('relay.rooms', JSON.stringify(r)); },
    msgs(room) {
      try { return JSON.parse(localStorage.getItem('relay.msgs.' + room) || '[]'); }
      catch { return []; }
    },
    setMsgs(room, m) { localStorage.setItem('relay.msgs.' + room, JSON.stringify(m.slice(-300))); },
  };

  const randName = () => {
    const a = ['ada','linus','grace','alan','katherine','nikola','radia','barbara','donald','margaret'];
    const b = ['fox','byte','packet','router','comet','pixel','signal','node','relay','switch'];
    return a[Math.floor(Math.random()*a.length)] + '-' + b[Math.floor(Math.random()*b.length)];
  };

  let nick = store.nick || randName();
  store.nick = nick;
  nickInput.value = nick;
  let room = store.room;
  let rooms = store.rooms();
  if (!rooms.includes(room)) room = rooms[0] || 'general';
  let mode = 'local'; // 'local' | 'live'
  let messages = [];
  let lastId = 0;
  let unread = {};
  let presence = new Map(); // user -> lastSeen
  let typingUsers = new Map(); // user -> timeout
  let channel = null;
  let sse = null;
  let clientId = Math.random().toString(36).slice(2);

  try { channel = new BroadcastChannel('relay-chat-v1'); } catch { channel = null; }

  // ---------- helpers ----------
  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  const colorFor = (name) => {
    let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return `linear-gradient(135deg, hsl(${h % 360} 65% 55%), hsl(${(h + 50) % 360} 65% 45%))`;
  };
  const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (ts) => new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric' });

  function setConn(next, label) {
    mode = next;
    connBadge.classList.toggle('live', next === 'live');
    connBadge.classList.toggle('local', next !== 'live');
    connText.textContent = label || next;
  }

  function avatarHTML(user) {
    return `<div class="avatar" style="background:${colorFor(user)}">${esc(user.slice(0,1).toUpperCase() || '?')}</div>`;
  }

  // ---------- render ----------
  function renderRooms() {
    roomList.innerHTML = '';
    for (const r of rooms) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'room-btn' + (r === room ? ' active' : '');
      btn.innerHTML = `<span class="hash">#</span><span>${esc(r)}</span>` +
        (unread[r] ? `<span class="badge">${unread[r] > 9 ? '9+' : unread[r]}</span>` : '');
      btn.onclick = () => switchRoom(r);
      li.appendChild(btn);
      roomList.appendChild(li);
    }
    roomTitle.textContent = '# ' + room;
    const def = DEFAULT_ROOMS.find(d => d.name === room);
    $('roomTopic').textContent = def ? def.topic : 'Room: ' + room;
    msgInput.placeholder = `Message # ${room}…`;
  }

  function renderMessages() {
    messagesEl.innerHTML = '';
    let lastDay = '';
    for (const m of messages) {
      if (m.sys) {
        const d = document.createElement('div');
        d.className = 'msg sys';
        d.innerHTML = `<div class="bubble">${esc(m.text)}</div>`;
        messagesEl.appendChild(d);
        continue;
      }
      const day = fmtDay(m.ts);
      if (day !== lastDay) {
        lastDay = day;
        const d = document.createElement('div');
        d.className = 'day';
        d.textContent = day;
        messagesEl.appendChild(d);
      }
      const wrap = document.createElement('div');
      wrap.className = 'msg' + (m.user === nick ? ' me' : '');
      wrap.innerHTML = `${avatarHTML(m.user)}<div class="bubble"><div class="meta"><span class="user">${esc(m.user)}</span><span class="time">${fmtTime(m.ts)}</span></div><div class="text">${linkify(m.text)}</div></div>`;
      messagesEl.appendChild(wrap);
    }
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderUsers() {
    const now = Date.now();
    for (const [u, t] of [...presence]) if (now - t > 25000) presence.delete(u);
    if (!presence.has(nick)) presence.set(nick, now);
    const users = [...presence.keys()].sort();
    userList.innerHTML = users.map(u => `<li><span class="u-dot"></span>${esc(u)}${u === nick ? ' (you)' : ''}</li>`).join('');
    $('onlineCount').textContent = users.length;
  }

  function renderTyping() {
    const names = [...typingUsers.keys()].filter(u => u !== nick);
    typingEl.textContent = names.length ? `${names.slice(0,2).join(', ')} typing…` : '';
  }

  // ---------- message flow ----------
  function pushMessage(m) {
    if (messages.some(x => x.id === m.id)) return;
    messages.push(m);
    messages = messages.slice(-300);
    if (m.room && m.room !== room) {
      unread[m.room] = (unread[m.room] || 0) + 1;
      renderRooms();
      return;
    }
    if (document.hidden && !m.sys && m.user !== nick) unread[room] = (unread[room] || 0) + 1;
    renderMessages();
    if (mode === 'local') store.setMsgs(room, messages);
  }

  async function send() {
    const text = msgInput.value.trim();
    if (!text) return;
    msgInput.value = '';
    const msg = { id: `${Date.now()}-${clientId}-${Math.floor(Math.random()*1e6)}`, room, user: nick, text: text.slice(0, 1000), ts: Date.now() };
    if (mode === 'live') {
      try {
        await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) });
      } catch { pushMessage(msg); } // offline: show locally
    } else {
      pushMessage(msg);
      channel?.postMessage({ type: 'msg', msg });
    }
    heartbeat();
  }

  function switchRoom(r) {
    room = r; store.room = r; unread[r] = 0;
    messages = []; lastId = 0;
    typingUsers.clear(); renderTyping();
    if (mode === 'live') { fetchHistory(); connectSSE(); }
    else { messages = store.msgs(room); renderMessages(); channel?.postMessage({ type: 'presence', user: nick, room }); }
    renderRooms();
    $('sidebar').classList.remove('open');
  }

  function heartbeat() {
    presence.set(nick, Date.now());
    renderUsers();
    channel?.postMessage({ type: 'presence', user: nick, room, id: clientId });
  }

  function sendTyping() {
    if (mode === 'live') {
      fetch('/api/typing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, user: nick }) }).catch(() => {});
    } else {
      channel?.postMessage({ type: 'typing', user: nick, room });
    }
  }

  // ---------- live (server) mode ----------
  async function fetchHistory() {
    try {
      const res = await fetch(`/api/messages?room=${encodeURIComponent(room)}&since=0`);
      if (!res.ok) throw new Error('no api');
      const data = await res.json();
      messages = data.messages || [];
      renderMessages();
      if (data.rooms?.length) {
        const known = new Set(rooms);
        for (const r of data.rooms) if (!known.has(r)) rooms.push(r);
        store.setRooms(rooms); renderRooms();
      }
      setConn('live', 'live');
    } catch { setConn('local', 'local'); }
  }

  function connectSSE() {
    sse?.close();
    try {
      sse = new EventSource(`/api/events?room=${encodeURIComponent(room)}&user=${encodeURIComponent(nick)}`);
      sse.onopen = () => setConn('live', 'live');
      sse.onerror = () => setConn('local', 'local');
      sse.onmessage = (ev) => {
        try {
          const evt = JSON.parse(ev.data);
          if (evt.type === 'msg') pushMessage(evt.msg);
          else if (evt.type === 'typing' && evt.user !== nick) {
            typingUsers.set(evt.user, Date.now());
            renderTyping();
            clearTimeout(typingUsers.get(evt.user + ':t'));
            typingUsers.set(evt.user + ':t', setTimeout(() => { typingUsers.delete(evt.user); renderTyping(); }, 2500));
          } else if (evt.type === 'presence' && evt.user) { presence.set(evt.user, Date.now()); renderUsers(); }
          else if (evt.type === 'rooms' && evt.rooms?.length) {
            const known = new Set(rooms);
            let changed = false;
            for (const r of evt.rooms) if (!known.has(r)) { rooms.push(r); changed = true; }
            if (changed) { store.setRooms(rooms); renderRooms(); }
          }
        } catch {}
      };
    } catch { setConn('local', 'local'); }
  }

  async function detectServer() {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch('/api/health', { signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) { setConn('live', 'live'); await fetchHistory(); connectSSE(); return; }
      throw new Error('no server');
    } catch { setConn('local', 'local'); }
  }

  // ---------- local channel ----------
  channel?.addEventListener('message', (ev) => {
    const d = ev.data || {};
    if (d.type === 'msg' && d.msg) {
      if (d.msg.room === room) pushMessage(d.msg);
      else { unread[d.msg.room] = (unread[d.msg.room] || 0) + 1; renderRooms(); }
    } else if (d.type === 'presence' && d.user) {
      if (!d.room || d.room === room) { presence.set(d.user, Date.now()); renderUsers(); }
    } else if (d.type === 'typing' && d.user !== nick && d.room === room) {
      typingUsers.set(d.user, Date.now()); renderTyping();
      setTimeout(() => { typingUsers.delete(d.user); renderTyping(); }, 2500);
    } else if (d.type === 'clear' && d.room === room) {
      messages = []; renderMessages(); store.setMsgs(room, []);
    }
  });
  window.addEventListener('storage', (e) => {
    if (e.key === 'relay.msgs.' + room) { messages = store.msgs(room); renderMessages(); }
  });

  // ---------- events ----------
  $('sendBtn').onclick = send;
  msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
  let typingThrottle = 0;
  msgInput.addEventListener('input', () => {
    const now = Date.now();
    if (now - typingThrottle > 2000) { typingThrottle = now; sendTyping(); }
  });
  nickInput.addEventListener('change', () => {
    const v = nickInput.value.trim().slice(0, 24) || randName();
    const old = nick;
    nick = v; store.nick = v;
    $('meAvatar').textContent = nick.slice(0, 1).toUpperCase();
    $('meAvatar').style.background = colorFor(nick);
    pushMessage({ id: `sys-${Date.now()}`, sys: true, text: `${old} is now known as ${nick}`, ts: Date.now() });
    channel?.postMessage({ type: 'msg', msg: { id: `sys-${Date.now()}-${clientId}`, sys: true, room, text: `${old} joined as ${nick}`, ts: Date.now() } });
    renderMessages(); heartbeat();
    if (mode === 'live') connectSSE();
  });
  $('shuffleNick').onclick = () => { nickInput.value = randName(); nickInput.dispatchEvent(new Event('change')); };
  $('addRoom').onclick = () => {
    const name = (prompt('Room name (letters, numbers, dashes):', 'lobby') || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
    if (!name || rooms.includes(name)) return;
    rooms.push(name); store.setRooms(rooms);
    fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: name, user: 'system', text: `Room #${name} created`, sys: true, ts: Date.now(), id: `sys-${Date.now()}` }) }).catch(() => {});
    switchRoom(name);
  };
  $('clearBtn').onclick = async () => {
    if (!confirm(`Clear all messages in #${room}?`)) return;
    messages = []; renderMessages();
    if (mode === 'live') fetch(`/api/messages?room=${encodeURIComponent(room)}`, { method: 'DELETE' }).catch(() => {});
    else { store.setMsgs(room, []); channel?.postMessage({ type: 'clear', room }); }
  };
  $('aboutBtn').onclick = () => $('aboutDialog').showModal();
  $('menuBtn').onclick = () => $('sidebar').classList.toggle('open');
  $('emojiBtn').onclick = () => {
    const pop = $('emojiPop');
    if (pop.hidden) {
      pop.innerHTML = '';
      for (const e of EMOJIS) {
        const b = document.createElement('button');
        b.textContent = e;
        b.onclick = () => { msgInput.value += e; msgInput.focus(); pop.hidden = true; };
        pop.appendChild(b);
      }
      pop.hidden = false;
    } else pop.hidden = true;
  };
  document.addEventListener('click', (e) => {
    if (!$('emojiPop').hidden && !e.target.closest('.composer')) $('emojiPop').hidden = true;
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && unread[room]) { unread[room] = 0; renderRooms(); }
  });

  // ---------- init ----------
  $('meAvatar').textContent = nick.slice(0, 1).toUpperCase();
  $('meAvatar').style.background = colorFor(nick);
  renderRooms();
  messages = store.msgs(room);
  if (!messages.length) {
    messages = [{ id: 'welcome', sys: true, text: `Welcome to #${room} — you are chatting as ${nick}. Open this page in another tab to see realtime sync.`, ts: Date.now() }];
  }
  renderMessages();
  renderUsers();
  setInterval(() => { heartbeat(); renderUsers(); }, 8000);
  setInterval(renderTyping, 3000);
  heartbeat();
  detectServer().then(() => { if (mode === 'local' && !store.msgs(room).length) store.setMsgs(room, messages); });
})();
