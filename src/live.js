/* Meetline live group: end-to-end encrypted location sharing through a public ntfy.sh topic.
   The room id and AES-GCM key live only in the link's #fragment, which browsers never send to a server.
   ntfy.sh relays and caches ciphertext for a few hours; it cannot read names or positions. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MeetLive = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RELAY = 'https://ntfy.sh';
  const TOPIC_PREFIX = 'meetline-';
  const HISTORY = '30m';
  const POLL_MS = 20000;

  function b64url(bytes) {
    let text = '';
    bytes.forEach((b) => {
      text += String.fromCharCode(b);
    });
    return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromB64url(text) {
    const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) {
      bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
  }

  function randomToken(byteCount) {
    const bytes = new Uint8Array(byteCount);
    crypto.getRandomValues(bytes);
    return b64url(bytes);
  }

  function supported() {
    return Boolean(typeof crypto !== 'undefined' && crypto.subtle && typeof fetch === 'function'
      && (typeof isSecureContext === 'undefined' || isSecureContext));
  }

  // "live=<room>.<key>" in the fragment. Room: 12 random bytes, key: 16 random bytes (AES-128).
  function parseInvite(hash) {
    const match = /(?:^|[#&])live=([A-Za-z0-9_-]{8,32})\.([A-Za-z0-9_-]{22})(?:&|$)/.exec(hash || '');
    return match ? { room: match[1], key: match[2] } : null;
  }

  function newInvite() {
    return { room: randomToken(12), key: randomToken(16) };
  }

  function inviteFragment(invite) {
    return `live=${invite.room}.${invite.key}`;
  }

  async function importKey(keyText) {
    return crypto.subtle.importKey('raw', fromB64url(keyText), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  async function seal(cryptoKey, payload) {
    const iv = new Uint8Array(12);
    crypto.getRandomValues(iv);
    const plain = new TextEncoder().encode(JSON.stringify(payload));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, plain));
    const out = new Uint8Array(iv.length + sealed.length);
    out.set(iv, 0);
    out.set(sealed, iv.length);
    return b64url(out);
  }

  async function open(cryptoKey, text) {
    const bytes = fromB64url(String(text || '').trim());
    if (bytes.length < 29) {
      throw new Error('short message');
    }
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, cryptoKey, bytes.slice(12));
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // Validate a decrypted update before it touches app state.
  function clean(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.id !== 'string' || payload.id.length > 40) {
      return null;
    }
    if (payload.x === 'leave') {
      return { id: payload.id, leave: true, t: Number(payload.t) || Date.now() };
    }
    const lat = Number(payload.a);
    const lon = Number(payload.o);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return null;
    }
    return {
      id: payload.id,
      name: String(payload.n || 'Friend').slice(0, 24),
      lat,
      lon,
      mode: ['car', 'bike', 'foot', 'transit'].includes(payload.m) ? payload.m : 'car',
      t: Number(payload.t) || Date.now(),
    };
  }

  /* A room connection: publish() sends one sealed update, onUpdate receives every valid update
     from others (and from earlier sessions, up to 30 minutes back). */
  function connect(invite, handlers) {
    const topic = TOPIC_PREFIX + invite.room;
    const seen = new Set();
    let keyPromise = importKey(invite.key);
    let source = null;
    let pollTimer = null;
    let lastId = '';
    let closed = false;

    async function handle(raw) {
      let message;
      try {
        message = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (error) {
        return;
      }
      if (!message || message.event !== 'message' || !message.message || seen.has(message.id)) {
        return;
      }
      seen.add(message.id);
      lastId = message.id;
      try {
        const update = clean(await open(await keyPromise, message.message));
        if (update && handlers.onUpdate) {
          handlers.onUpdate(update);
        }
      } catch (error) {
        /* Not ours, wrong key, or tampered: ignore. */
      }
    }

    function status(kind) {
      if (handlers.onStatus) {
        handlers.onStatus(kind);
      }
    }

    async function poll() {
      if (closed) {
        return;
      }
      try {
        const res = await fetch(`${RELAY}/${topic}/json?poll=1&since=${lastId || HISTORY}`);
        const text = await res.text();
        for (const line of text.split('\n')) {
          if (line.trim()) {
            await handle(line);
          }
        }
        status('online');
      } catch (error) {
        status('offline');
      }
      pollTimer = setTimeout(poll, POLL_MS);
    }

    function subscribe() {
      if (typeof EventSource === 'undefined') {
        poll();
        return;
      }
      let failures = 0;
      source = new EventSource(`${RELAY}/${topic}/sse?since=${HISTORY}`);
      source.onopen = () => {
        failures = 0;
        status('online');
      };
      source.onmessage = (event) => {
        failures = 0;
        handle(event.data);
      };
      source.onerror = () => {
        failures += 1;
        status('reconnecting');
        // Some networks block streaming responses: switch to plain polling after repeated drops.
        if (failures >= 4 || source.readyState === 2) {
          source.close();
          source = null;
          if (!closed && !pollTimer) {
            poll();
          }
        }
      };
    }

    async function publish(payload) {
      if (closed) {
        return false;
      }
      try {
        const body = await seal(await keyPromise, payload);
        const res = await fetch(`${RELAY}/${topic}`, { method: 'POST', body });
        return res.ok;
      } catch (error) {
        return false;
      }
    }

    function close() {
      closed = true;
      if (source) {
        source.close();
      }
      clearTimeout(pollTimer);
    }

    subscribe();
    return { publish, close, topic };
  }

  return {
    supported,
    parseInvite,
    newInvite,
    inviteFragment,
    importKey,
    seal,
    open,
    clean,
    connect,
    randomToken,
    RELAY,
  };
});
