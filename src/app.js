/* Meetline app: map, people, venue search, routing, sharing. Needs Leaflet (L) and MeetGeo. */
(function () {
  'use strict';

  const G = window.MeetGeo;
  const CFG = Object.assign({
    tiles: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    colors: ['#1C64D9', '#DD5A12', '#2F8A3E', '#C92A2A', '#0B7A87', '#B07D10', '#495057', '#8B5A2B'],
    maxPeople: 8,
    resultCount: 5,
    defaultView: { lat: 1.1301, lon: 104.0529, zoom: 12 },
  }, window.MEETLINE_CONFIG || {});

  const ROUTER = {
    car: 'https://routing.openstreetmap.de/routed-car',
    bike: 'https://routing.openstreetmap.de/routed-bike',
    foot: 'https://routing.openstreetmap.de/routed-foot',
  };
  const MODE_LABEL = { car: 'Drive', bike: 'Cycle', foot: 'Walk' };
  const GMAPS_MODE = { car: 'driving', bike: 'bicycling', foot: 'walking' };
  const CATEGORIES = [
    { id: 'cafe', label: 'Cafe', query: 'cafe' },
    { id: 'restaurant', label: 'Restaurant', query: 'restaurant' },
    { id: 'mall', label: 'Mall', query: 'mall' },
    { id: 'park', label: 'Park', query: 'park' },
    { id: 'point', label: 'Exact point', query: null },
  ];
  const OBJECTIVES = [
    { id: 'fair', label: 'Fairest', hint: 'Shortest longest trip' },
    { id: 'total', label: 'Least total', hint: 'Smallest combined travel time' },
  ];
  const DEMO_PEOPLE = [
    { name: 'Juwen', lat: 1.04350, lon: 104.03500, mode: 'car', place: 'Batamindo, Muka Kuning' },
    { name: 'Sari', lat: 1.14680, lon: 104.01220, mode: 'car', place: 'Nagoya Hill, Lubuk Baja' },
    { name: 'Andi', lat: 1.12830, lon: 104.05270, mode: 'bike', place: 'Batam Centre' },
  ];

  const ICON = {
    car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 16h14M6.5 16v2M17.5 16v2M4 16v-3.2l2-4.8h12l2 4.8V16"/><circle cx="7.5" cy="13" r=".9"/><circle cx="16.5" cy="13" r=".9"/></svg>',
    bike: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="16" r="3.5"/><circle cx="18" cy="16" r="3.5"/><path d="M6 16l4-7h5l3 7M10 9l2 7h-6M14 6h2"/></svg>',
    foot: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 2.5 2.5V21M8 12l2.5-4.5L14 9l2 3M12.5 8.5L12 15"/></svg>',
    locate: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>',
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) {
      node.className = cls;
    }
    if (html !== undefined) {
      node.innerHTML = html;
    }
    return node;
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  // Storage can throw in sandboxed or opaque-origin frames; fall back to memory.
  const store = (() => {
    const memory = {};
    try {
      const key = '__meetline_probe';
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
      return window.localStorage;
    } catch (error) {
      return {
        getItem: (k) => (k in memory ? memory[k] : null),
        setItem: (k, v) => {
          memory[k] = String(v);
        },
        removeItem: (k) => {
          delete memory[k];
        },
      };
    }
  })();

  const state = {
    people: [],
    category: 'cafe',
    objective: 'fair',
    center: null,
    radius: 0,
    ranked: [],
    selectedId: null,
    routes: {},
    status: 'idle',
    note: '',
    estimated: false,
    picking: false,
    invitedVenue: null,
    nextId: 1,
  };

  let map;
  let layers;
  let runToken = 0;
  let recomputeTimer = null;
  let watchId = null;
  const venueCache = new Map();

  /* ---------- network ---------- */

  async function fetchJSON(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || 15000);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // Nominatim allows one request per second; queue every call through this gate.
  let nominatimChain = Promise.resolve();
  function nominatim(path) {
    const job = nominatimChain.then(async () => {
      const started = Date.now();
      try {
        return await fetchJSON('https://nominatim.openstreetmap.org/' + path, 15000);
      } finally {
        const wait = 1100 - (Date.now() - started);
        if (wait > 0) {
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      }
    });
    nominatimChain = job.catch(() => {});
    return job;
  }

  function shortAddress(address, fallbackName) {
    if (!address) {
      return fallbackName || '';
    }
    const street = address.road || address.pedestrian || address.neighbourhood || '';
    const area = address.suburb || address.village || address.city_district || address.quarter || address.town || address.city || '';
    return [street, area].filter(Boolean).join(', ') || fallbackName || '';
  }

  async function reverseLabel(lat, lon) {
    try {
      const data = await nominatim(`reverse?format=jsonv2&zoom=17&addressdetails=1&lat=${lat}&lon=${lon}`);
      return shortAddress(data.address, data.name) || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    } catch (error) {
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
  }

  async function searchVenues(center, radius, category) {
    const box = G.bbox(center, radius);
    const key = [category.id, center.lat.toFixed(3), center.lon.toFixed(3), Math.round(radius / 100)].join(':');
    if (venueCache.has(key)) {
      return venueCache.get(key);
    }
    const viewbox = [box.west, box.north, box.east, box.south].map((n) => n.toFixed(5)).join(',');
    let venues = [];
    try {
      const rows = await nominatim(`search?format=jsonv2&addressdetails=1&limit=30&bounded=1&q=${encodeURIComponent(category.query)}&viewbox=${viewbox}`);
      venues = rows.filter((r) => r.name).map((r) => ({
        id: r.osm_type + r.osm_id,
        name: r.name,
        lat: Number(r.lat),
        lon: Number(r.lon),
        type: category.label,
        address: shortAddress(r.address, ''),
      }));
    } catch (error) {
      venues = [];
    }
    if (!venues.length) {
      // Fallback geocoder with the same bounding box.
      try {
        const bb = [box.west, box.south, box.east, box.north].map((n) => n.toFixed(5)).join(',');
        const data = await fetchJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(category.query)}&limit=30&bbox=${bb}`, 15000);
        venues = (data.features || []).filter((f) => f.properties && f.properties.name).map((f) => ({
          id: 'ph' + (f.properties.osm_type || '') + f.properties.osm_id,
          name: f.properties.name,
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          type: category.label,
          address: [f.properties.street, f.properties.district || f.properties.city].filter(Boolean).join(', '),
        }));
      } catch (error) {
        venues = [];
      }
    }
    const kept = G.dedupeVenues(venues, center, 14);
    venueCache.set(key, kept);
    return kept;
  }

  // Durations/distances matrix [person][candidate]. One table request per travel mode.
  async function travelMatrix(people, candidates) {
    const durations = people.map(() => candidates.map(() => Infinity));
    const distances = people.map(() => candidates.map(() => Infinity));
    const estimated = people.map(() => false);
    const modes = [...new Set(people.map((p) => p.mode))];
    await Promise.all(modes.map(async (mode) => {
      const group = people.map((p, i) => ({ p, i })).filter((x) => x.p.mode === mode);
      const coords = group.map((x) => x.p).concat(candidates).map((c) => `${c.lon.toFixed(6)},${c.lat.toFixed(6)}`).join(';');
      const sources = group.map((_, k) => k).join(';');
      const destinations = candidates.map((_, k) => k + group.length).join(';');
      try {
        const data = await fetchJSON(`${ROUTER[mode]}/table/v1/driving/${coords}?sources=${sources}&destinations=${destinations}&annotations=duration,distance`, 20000);
        if (data.code !== 'Ok') {
          throw new Error(data.code);
        }
        group.forEach((x, k) => {
          candidates.forEach((_, j) => {
            const d = data.durations[k][j];
            durations[x.i][j] = d == null ? Infinity : d;
            distances[x.i][j] = data.distances && data.distances[k][j] != null ? data.distances[k][j] : Infinity;
          });
        });
      } catch (error) {
        group.forEach((x) => {
          estimated[x.i] = true;
          candidates.forEach((c, j) => {
            const trip = G.estimateTrip(x.p, c, mode);
            durations[x.i][j] = trip.duration;
            distances[x.i][j] = trip.distance;
          });
        });
      }
    }));
    return { durations, distances, estimated };
  }

  async function fetchRoute(person, venue) {
    const url = `${ROUTER[person.mode]}/route/v1/driving/${person.lon.toFixed(6)},${person.lat.toFixed(6)};${venue.lon.toFixed(6)},${venue.lat.toFixed(6)}?overview=full&geometries=geojson`;
    try {
      const data = await fetchJSON(url, 20000);
      if (data.code !== 'Ok' || !data.routes.length) {
        throw new Error(data.code);
      }
      const route = data.routes[0];
      return {
        coords: route.geometry.coordinates.map((c) => [c[1], c[0]]),
        duration: route.duration,
        distance: route.distance,
        estimated: false,
      };
    } catch (error) {
      const trip = G.estimateTrip(person, venue, person.mode);
      return {
        coords: [[person.lat, person.lon], [venue.lat, venue.lon]],
        duration: trip.duration,
        distance: trip.distance,
        estimated: true,
      };
    }
  }

  /* ---------- people ---------- */

  function colorFor(person) {
    return CFG.colors[(person.colorIndex || 0) % CFG.colors.length];
  }

  function freeColorIndex() {
    const used = new Set(state.people.map((p) => p.colorIndex));
    for (let i = 0; i < CFG.colors.length; i++) {
      if (!used.has(i)) {
        return i;
      }
    }
    return state.people.length % CFG.colors.length;
  }

  function defaultName() {
    let n = state.people.length + 1;
    const names = new Set(state.people.map((p) => p.name));
    while (names.has('Friend ' + n)) {
      n += 1;
    }
    return 'Friend ' + n;
  }

  function addPerson(data, options) {
    if (state.people.length >= CFG.maxPeople) {
      toast(`Up to ${CFG.maxPeople} people per plan.`);
      return null;
    }
    const person = {
      id: state.nextId++,
      name: (data.name || defaultName()).slice(0, 24),
      lat: data.lat,
      lon: data.lon,
      mode: data.mode || 'car',
      place: data.place || '',
      isMe: Boolean(data.isMe),
      colorIndex: freeColorIndex(),
    };
    state.people.push(person);
    if (!person.place) {
      reverseLabel(person.lat, person.lon).then((label) => {
        person.place = label;
        renderPeople();
      });
    }
    if (!options || !options.silent) {
      changed();
    }
    return person;
  }

  function removePerson(id) {
    const person = state.people.find((p) => p.id === id);
    state.people = state.people.filter((p) => p.id !== id);
    if (person && person.isMe) {
      stopWatch();
    }
    changed();
  }

  function updatePerson(id, patch, recompute) {
    const person = state.people.find((p) => p.id === id);
    if (!person) {
      return;
    }
    Object.assign(person, patch);
    if (recompute) {
      changed();
    } else {
      renderPeople();
      syncHash();
    }
  }

  /* ---------- location ---------- */

  function locateMe() {
    if (!('geolocation' in navigator)) {
      toast('This browser cannot share location. Search an address instead.');
      return;
    }
    if (!window.isSecureContext) {
      toast('Location needs a secure page (https or localhost). Search an address instead.');
      return;
    }
    setStatus('busy', 'Waiting for your location...');
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const me = state.people.find((p) => p.isMe);
      if (me) {
        updatePerson(me.id, { lat, lon, place: '' }, true);
        reverseLabel(lat, lon).then((label) => updatePerson(me.id, { place: label }, false));
      } else {
        addPerson({ name: 'You', lat, lon, isMe: true });
      }
      if (state.people.length < 2) {
        map.setView([lat, lon], 14);
        setStatus('idle', '');
      }
      startWatch();
    }, (err) => {
      const messages = {
        1: 'Location access is blocked. Allow it in your browser\'s site settings, or search an address instead.',
        2: 'Your location is unavailable right now. Search an address or tap the map instead.',
        3: 'Finding your location took too long. Try again, or search an address.',
      };
      setStatus('idle', '');
      toast(messages[err.code] || 'Could not get your location.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  }

  // Keep "You" current while the page is open; recompute only after moving more than 150 m.
  function startWatch() {
    if (watchId !== null || !navigator.geolocation) {
      return;
    }
    watchId = navigator.geolocation.watchPosition((pos) => {
      const me = state.people.find((p) => p.isMe);
      if (!me) {
        stopWatch();
        return;
      }
      const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (G.haversine(me, next) > 150) {
        updatePerson(me.id, next, true);
      }
    }, () => {}, { enableHighAccuracy: true, maximumAge: 20000 });
    renderPeople();
  }

  function stopWatch() {
    if (watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
    }
    watchId = null;
  }

  /* ---------- search box ---------- */

  let suggestTimer = null;
  let suggestions = [];
  let activeSuggestion = -1;

  function setupSearch() {
    const input = $('#search-input');
    const list = $('#search-suggest');
    if (!input || !list) {
      return;
    }
    input.addEventListener('input', () => {
      clearTimeout(suggestTimer);
      const q = input.value.trim();
      if (q.length < 3) {
        hideSuggestions();
        return;
      }
      suggestTimer = setTimeout(() => loadSuggestions(q), 300);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (!suggestions.length) {
          return;
        }
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        activeSuggestion = (activeSuggestion + step + suggestions.length) % suggestions.length;
        paintSuggestions();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (suggestions.length) {
          chooseSuggestion(suggestions[Math.max(0, activeSuggestion)]);
        } else if (input.value.trim().length >= 3) {
          loadSuggestions(input.value.trim(), true);
        }
      } else if (event.key === 'Escape') {
        hideSuggestions();
      }
    });
    document.addEventListener('click', (event) => {
      if (!list.contains(event.target) && event.target !== input) {
        hideSuggestions();
      }
    });
  }

  async function loadSuggestions(q, pickFirst) {
    const c = map.getCenter();
    try {
      const data = await fetchJSON(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=6&lat=${c.lat.toFixed(4)}&lon=${c.lng.toFixed(4)}`, 10000);
      suggestions = (data.features || []).map((f) => {
        const p = f.properties || {};
        const title = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || 'Unnamed place';
        const sub = [p.street && p.name ? p.street : '', p.district || p.locality || '', p.city || p.county || '', p.country || '']
          .filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).slice(0, 3).join(', ');
        return { title, sub, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] };
      });
    } catch (error) {
      try {
        const rows = await nominatim(`search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`);
        suggestions = rows.map((r) => ({
          title: r.name || r.display_name.split(',')[0],
          sub: r.display_name.split(',').slice(1, 4).join(',').trim(),
          lat: Number(r.lat),
          lon: Number(r.lon),
        }));
      } catch (err) {
        suggestions = [];
        toast('Address search is unreachable. Tap the map to place the person instead.');
      }
    }
    activeSuggestion = suggestions.length ? 0 : -1;
    if (pickFirst && suggestions.length) {
      chooseSuggestion(suggestions[0]);
      return;
    }
    paintSuggestions();
  }

  function paintSuggestions() {
    const list = $('#search-suggest');
    list.innerHTML = '';
    if (!suggestions.length) {
      list.hidden = true;
      return;
    }
    suggestions.forEach((s, i) => {
      const item = el('li', 'suggest-item' + (i === activeSuggestion ? ' is-active' : ''));
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', i === activeSuggestion ? 'true' : 'false');
      item.innerHTML = `<span class="suggest-title">${esc(s.title)}</span><span class="suggest-sub">${esc(s.sub)}</span>`;
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        chooseSuggestion(s);
      });
      list.appendChild(item);
    });
    list.hidden = false;
  }

  function hideSuggestions() {
    const list = $('#search-suggest');
    if (list) {
      list.hidden = true;
    }
    suggestions = [];
    activeSuggestion = -1;
  }

  function chooseSuggestion(s) {
    const input = $('#search-input');
    input.value = '';
    hideSuggestions();
    const place = [s.title, s.sub.split(',')[0]].filter(Boolean).join(', ');
    const person = addPerson({ lat: s.lat, lon: s.lon, place });
    if (person && state.people.length === 1) {
      map.setView([s.lat, s.lon], 14);
    }
    if (person) {
      // Let the user name the person straight away.
      setTimeout(() => {
        const field = document.querySelector(`.person[data-id="${person.id}"] .person-name`);
        if (field) {
          field.focus();
          field.select();
        }
      }, 50);
    }
  }

  /* ---------- compute ---------- */

  function changed() {
    state.ranked = state.people.length >= 2 ? state.ranked : [];
    renderPeople();
    renderMapPeople();
    syncHash();
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(recompute, 450);
  }

  async function recompute() {
    const token = ++runToken;
    if (state.people.length < 2) {
      state.ranked = [];
      state.routes = {};
      state.selectedId = null;
      state.center = null;
      setStatus('idle', '');
      renderAll();
      return;
    }
    const people = state.people.map((p) => Object.assign({}, p));
    const category = CATEGORIES.find((c) => c.id === state.category) || CATEGORIES[0];
    const center = G.searchCenter(people, state.objective);
    let radius = G.searchRadius(people, center);
    state.center = center;
    state.radius = radius;
    renderMapCenter();
    setStatus('busy', category.query ? `Looking for ${category.label.toLowerCase()}s near the ${state.objective === 'fair' ? 'fairest' : 'most central'} point...` : 'Checking travel times...');

    let candidates = [];
    let note = '';
    if (category.query) {
      candidates = await searchVenues(center, radius, category);
      if (token !== runToken) {
        return;
      }
      if (candidates.length < 3) {
        radius = Math.min(12000, radius * 2.5);
        state.radius = radius;
        candidates = await searchVenues(center, radius, category);
        if (token !== runToken) {
          return;
        }
      }
      if (!candidates.length) {
        note = `No ${category.label.toLowerCase()}s on the map near the middle. Showing the exact point instead.`;
      }
    }
    candidates = candidates.map((c, i) => Object.assign(c, { order: i }));
    candidates.push({
      id: 'center',
      name: state.objective === 'fair' ? 'Fairest exact point' : 'Most central point',
      lat: center.lat,
      lon: center.lon,
      type: 'Exact point',
      address: '',
      order: 999,
      isPoint: true,
    });
    if (category.query && candidates.length > 1) {
      // The exact point is a reference, not a venue: keep it out of the ranking when real places exist.
      candidates = candidates.filter((c) => !c.isPoint);
    }

    setStatus('busy', 'Comparing travel times for everyone...');
    const matrix = await travelMatrix(people, candidates);
    if (token !== runToken) {
      return;
    }
    const ranked = G.rankCandidates(candidates, matrix.durations, matrix.distances, state.objective)
      .filter((c) => c.reachable)
      .slice(0, CFG.resultCount);
    state.estimated = matrix.estimated.some(Boolean);
    state.ranked = ranked;
    state.note = note;
    let selected = ranked[0];
    if (state.invitedVenue) {
      const match = ranked.find((c) => G.haversine(c, state.invitedVenue) < 40);
      if (match) {
        selected = match;
      }
      state.invitedVenue = null;
    }
    state.selectedId = selected ? selected.id : null;
    state.routes = {};
    renderResults();
    renderMapVenues();
    if (!ranked.length) {
      setStatus('error', 'No one can reach these places by road. Try another place type or travel mode.');
      return;
    }
    await loadRoutes(token);
  }

  async function loadRoutes(token) {
    const venue = selectedVenue();
    if (!venue) {
      return;
    }
    setStatus('busy', 'Drawing routes...');
    const people = state.people.slice();
    const routes = await Promise.all(people.map((p) => fetchRoute(p, venue)));
    if (token !== runToken) {
      return;
    }
    state.routes = {};
    people.forEach((p, i) => {
      state.routes[p.id] = routes[i];
    });
    const anyEstimated = routes.some((r) => r.estimated) || state.estimated;
    setStatus('ready', state.note || (anyEstimated ? 'Router unreachable for some trips: times are straight-line estimates.' : ''));
    renderDetail();
    renderRoutes();
    fitToPlan();
    syncHash();
    document.documentElement.dataset.ready = 'true';
  }

  function selectedVenue() {
    return state.ranked.find((c) => c.id === state.selectedId) || null;
  }

  function selectVenue(id) {
    if (state.selectedId === id) {
      return;
    }
    state.selectedId = id;
    state.routes = {};
    renderResults();
    renderMapVenues();
    renderDetail();
    renderRoutes();
    loadRoutes(runToken);
  }

  /* ---------- rendering: panel ---------- */

  function setStatus(kind, text) {
    state.status = kind;
    const box = $('#status');
    if (box) {
      box.dataset.kind = kind;
      box.textContent = text || '';
      box.hidden = !text;
    }
    document.documentElement.dataset.busy = kind === 'busy' ? 'true' : 'false';
  }

  function toast(text) {
    const box = $('#toast');
    if (!box) {
      return;
    }
    box.textContent = text;
    box.hidden = false;
    box.classList.add('is-on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => {
      box.classList.remove('is-on');
      box.hidden = true;
    }, 4200);
  }

  function renderPeople() {
    const list = $('#people');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    state.people.forEach((p) => {
      const item = el('li', 'person');
      item.dataset.id = p.id;
      item.style.setProperty('--c', colorFor(p));
      const modes = ['car', 'bike', 'foot'].map((m) => `<button type="button" class="mode-btn${p.mode === m ? ' is-on' : ''}" data-mode="${m}" aria-pressed="${p.mode === m}" title="${MODE_LABEL[m]}">${ICON[m]}<span class="sr">${MODE_LABEL[m]}</span></button>`).join('');
      const live = p.isMe && watchId !== null ? '<span class="person-live">Live</span>' : '';
      item.innerHTML = `
        <span class="person-mark" aria-hidden="true">${esc((p.name || '?').trim().charAt(0).toUpperCase() || '?')}</span>
        <div class="person-main">
          <input class="person-name" value="${esc(p.name)}" maxlength="24" aria-label="Name" spellcheck="false">
          <div class="person-place">${live}${esc(p.place || 'Finding address...')}</div>
        </div>
        <div class="mode" role="group" aria-label="Travel mode for ${esc(p.name)}">${modes}</div>
        <button type="button" class="icon-btn person-remove" aria-label="Remove ${esc(p.name)}">${ICON.close}</button>`;
      const nameInput = item.querySelector('.person-name');
      nameInput.addEventListener('change', () => {
        updatePerson(p.id, { name: nameInput.value.trim() || defaultName() }, false);
        renderMapPeople();
        renderResults();
        renderDetail();
      });
      nameInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          nameInput.blur();
        }
      });
      item.querySelectorAll('.mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => updatePerson(p.id, { mode: btn.dataset.mode }, true));
      });
      item.querySelector('.person-remove').addEventListener('click', () => removePerson(p.id));
      item.querySelector('.person-mark').addEventListener('click', () => map.setView([p.lat, p.lon], Math.max(map.getZoom(), 14)));
      list.appendChild(item);
    });
    const count = $('#people-count');
    if (count) {
      count.textContent = state.people.length ? `${state.people.length} of ${CFG.maxPeople} people` : '';
    }
    const empty = $('#empty');
    if (empty) {
      empty.hidden = state.people.length >= 2;
      const need = $('#empty-need');
      if (need) {
        need.textContent = state.people.length === 1 ? 'Add one more person to find a place.' : 'Add at least two people.';
      }
    }
    document.documentElement.dataset.people = String(state.people.length);
  }

  function renderControls() {
    const cats = $('#categories');
    if (cats) {
      cats.innerHTML = '';
      CATEGORIES.forEach((c) => {
        const btn = el('button', 'chip' + (state.category === c.id ? ' is-on' : ''), esc(c.label));
        btn.type = 'button';
        btn.setAttribute('aria-pressed', state.category === c.id ? 'true' : 'false');
        btn.addEventListener('click', () => {
          if (state.category !== c.id) {
            state.category = c.id;
            renderControls();
            changed();
          }
        });
        cats.appendChild(btn);
      });
    }
    const obj = $('#objective');
    if (obj) {
      obj.innerHTML = '';
      OBJECTIVES.forEach((o) => {
        const btn = el('button', 'seg' + (state.objective === o.id ? ' is-on' : ''), `<span class="seg-label">${esc(o.label)}</span><span class="seg-hint">${esc(o.hint)}</span>`);
        btn.type = 'button';
        btn.setAttribute('aria-pressed', state.objective === o.id ? 'true' : 'false');
        btn.addEventListener('click', () => {
          if (state.objective !== o.id) {
            state.objective = o.id;
            renderControls();
            changed();
          }
        });
        obj.appendChild(btn);
      });
    }
  }

  // Arrival strip: one tick per person on a shared time axis, so the spread is visible at a glance.
  function arrivalStrip(venue, scaleMax) {
    const ticks = state.people.map((p, i) => {
      const t = venue.times[i];
      const left = Math.min(100, (t / scaleMax) * 100);
      return `<span class="tick" style="left:${left.toFixed(1)}%;--c:${colorFor(p)}" title="${esc(p.name)}: ${G.formatDuration(t)}"></span>`;
    }).join('');
    const minLeft = Math.min(100, (venue.min / scaleMax) * 100);
    const maxLeft = Math.min(100, (venue.max / scaleMax) * 100);
    return `<div class="strip" aria-hidden="true"><span class="strip-span" style="left:${minLeft.toFixed(1)}%;width:${Math.max(0.5, maxLeft - minLeft).toFixed(1)}%"></span>${ticks}</div>`;
  }

  function renderResults() {
    const list = $('#results');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    const wrap = $('#results-wrap');
    if (wrap) {
      wrap.hidden = !state.ranked.length;
    }
    document.documentElement.dataset.result = state.ranked.length ? 'true' : 'false';
    if (!state.ranked.length) {
      return;
    }
    const scaleMax = Math.max(...state.ranked.map((v) => v.max)) * 1.05;
    state.ranked.forEach((v, idx) => {
      const item = el('li', 'venue' + (v.id === state.selectedId ? ' is-selected' : ''));
      item.dataset.id = v.id;
      const meta = [v.type, v.address].filter(Boolean).join(' · ');
      item.innerHTML = `
        <button type="button" class="venue-hit" aria-pressed="${v.id === state.selectedId}">
          <span class="venue-rank">${idx + 1}</span>
          <span class="venue-body">
            <span class="venue-name">${esc(v.name)}</span>
            <span class="venue-meta">${esc(meta)}</span>
            ${arrivalStrip(v, scaleMax)}
            <span class="venue-stats">
              <span class="stat stat-main"><b>${G.formatDuration(v.max)}</b> longest</span>
              <span class="stat">${G.formatDuration(v.gap)} gap</span>
              <span class="stat">${G.formatDuration(v.sum)} total</span>
            </span>
          </span>
        </button>`;
      item.querySelector('.venue-hit').addEventListener('click', () => selectVenue(v.id));
      list.appendChild(item);
    });
    const label = $('#results-label');
    if (label) {
      const cat = CATEGORIES.find((c) => c.id === state.category);
      label.textContent = state.objective === 'fair'
        ? `Best ${cat.id === 'point' ? 'point' : cat.label.toLowerCase() + 's'}, ranked by the longest trip`
        : `Best ${cat.id === 'point' ? 'point' : cat.label.toLowerCase() + 's'}, ranked by total travel time`;
    }
  }

  function renderDetail() {
    const box = $('#detail');
    if (!box) {
      return;
    }
    const venue = selectedVenue();
    if (!venue) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    const rows = state.people.map((p, i) => {
      const route = state.routes[p.id];
      const duration = route ? route.duration : venue.times[i];
      const distance = route ? route.distance : venue.dists[i];
      const approx = route && route.estimated ? ' approx.' : '';
      const href = `https://www.google.com/maps/dir/?api=1&origin=${p.lat},${p.lon}&destination=${venue.lat},${venue.lon}&travelmode=${GMAPS_MODE[p.mode]}`;
      return `<li class="leg" style="--c:${colorFor(p)}">
          <span class="leg-mark" aria-hidden="true">${esc((p.name || '?').charAt(0).toUpperCase())}</span>
          <span class="leg-who"><span class="leg-name">${esc(p.name)}</span><span class="leg-mode">${MODE_LABEL[p.mode]} · ${G.formatDistance(distance)}${approx}</span></span>
          <span class="leg-time">${G.formatDuration(duration)}</span>
          <a class="leg-go" href="${href}" target="_blank" rel="noopener" aria-label="Directions for ${esc(p.name)} in Google Maps">${ICON.arrow}<span>Route</span></a>
        </li>`;
    }).join('');
    const where = `https://www.google.com/maps/search/?api=1&query=${venue.lat},${venue.lon}`;
    box.innerHTML = `
      <div class="detail-head">
        <div>
          <p class="detail-kicker">Meet at</p>
          <h2 class="detail-name">${esc(venue.name)}</h2>
          <p class="detail-meta">${esc([venue.type, venue.address].filter(Boolean).join(' · '))}</p>
        </div>
        <div class="detail-figure"><span class="detail-figure-num">${G.formatDuration(venue.max)}</span><span class="detail-figure-label">longest trip</span></div>
      </div>
      <ol class="legs">${rows}</ol>
      <div class="detail-actions">
        <button type="button" class="btn btn-primary" data-action="share">Share this plan</button>
        <a class="btn btn-quiet" href="${where}" target="_blank" rel="noopener">Open in Google Maps</a>
      </div>`;
    box.querySelector('[data-action="share"]').addEventListener('click', sharePlan);
  }

  /* ---------- rendering: map ---------- */

  function personIcon(p) {
    const letter = esc((p.name || '?').trim().charAt(0).toUpperCase() || '?');
    return L.divIcon({
      className: 'pin-wrap',
      html: `<div class="pin-person${p.isMe ? ' is-me' : ''}" style="--c:${colorFor(p)}"><span>${letter}</span></div>`,
      iconSize: [34, 34],
      iconAnchor: [17, 17],
    });
  }

  function renderMapPeople() {
    layers.people.clearLayers();
    state.people.forEach((p) => {
      const marker = L.marker([p.lat, p.lon], {
        icon: personIcon(p),
        draggable: true,
        keyboard: true,
        title: `${p.name}, drag to move`,
        zIndexOffset: 500,
      });
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        updatePerson(p.id, { lat: ll.lat, lon: ll.lng, place: '' }, true);
        reverseLabel(ll.lat, ll.lng).then((label) => updatePerson(p.id, { place: label }, false));
      });
      marker.addTo(layers.people);
    });
  }

  function renderMapCenter() {
    layers.center.clearLayers();
    if (!state.center || state.people.length < 2) {
      return;
    }
    L.circle([state.center.lat, state.center.lon], {
      radius: state.radius,
      className: 'search-ring',
      interactive: false,
    }).addTo(layers.center);
    L.marker([state.center.lat, state.center.lon], {
      icon: L.divIcon({ className: 'pin-wrap', html: '<div class="pin-center"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      interactive: false,
      keyboard: false,
    }).addTo(layers.center);
  }

  function renderMapVenues() {
    layers.venues.clearLayers();
    state.ranked.forEach((v, idx) => {
      const selected = v.id === state.selectedId;
      const label = selected
        ? `<div class="pin-label"><b>${esc(v.name)}</b><span>${G.formatDuration(v.max)} longest trip</span></div>`
        : '';
      const marker = L.marker([v.lat, v.lon], {
        icon: L.divIcon({
          className: 'pin-wrap',
          html: `<div class="pin-venue-wrap"><div class="pin-venue${selected ? ' is-selected' : ''}"><span>${idx + 1}</span></div>${label}</div>`,
          iconSize: selected ? [40, 40] : [28, 28],
          iconAnchor: selected ? [20, 40] : [14, 28],
        }),
        title: v.name,
        zIndexOffset: selected ? 1000 : 100,
      });
      marker.on('click', () => selectVenue(v.id));
      marker.addTo(layers.venues);
    });
  }

  function renderRoutes() {
    layers.routes.clearLayers();
    state.people.forEach((p) => {
      const route = state.routes[p.id];
      if (!route) {
        return;
      }
      L.polyline(route.coords, { color: '#ffffff', weight: 8, opacity: 0.9, interactive: false, className: 'route-casing' }).addTo(layers.routes);
      L.polyline(route.coords, {
        color: colorFor(p),
        weight: 4.5,
        opacity: 0.95,
        dashArray: route.estimated ? '2 8' : null,
        lineCap: 'round',
        className: 'route-line',
      }).bindTooltip(`${esc(p.name)}: ${G.formatDuration(route.duration)}, ${G.formatDistance(route.distance)}`, { sticky: true }).addTo(layers.routes);
    });
  }

  // Keep the plan clear of any panel that overlaps the map.
  function overlapPadding() {
    const pad = { top: 40, right: 40, bottom: 40, left: 40 };
    const panel = $('#panel');
    const mapBox = $('#map').getBoundingClientRect();
    if (!panel) {
      return pad;
    }
    const pb = panel.getBoundingClientRect();
    const overlaps = pb.right > mapBox.left && pb.left < mapBox.right && pb.bottom > mapBox.top && pb.top < mapBox.bottom;
    if (!overlaps || getComputedStyle(panel).display === 'none') {
      return pad;
    }
    if (pb.width < mapBox.width * 0.7) {
      if (pb.left - mapBox.left < mapBox.right - pb.right) {
        pad.left += Math.max(0, pb.right - mapBox.left);
      } else {
        pad.right += Math.max(0, mapBox.right - pb.left);
      }
    } else if (pb.top > mapBox.top + mapBox.height * 0.25) {
      pad.bottom += Math.max(0, mapBox.bottom - pb.top);
    } else {
      pad.top += Math.max(0, pb.bottom - mapBox.top);
    }
    const extra = document.querySelectorAll('[data-map-overlay]');
    extra.forEach((node) => {
      const r = node.getBoundingClientRect();
      if (r.top < mapBox.top + mapBox.height / 2) {
        pad.top = Math.max(pad.top, r.bottom - mapBox.top + 16);
      }
    });
    return pad;
  }

  function fitToPlan() {
    const points = state.people.map((p) => [p.lat, p.lon]);
    const venue = selectedVenue();
    if (venue) {
      points.push([venue.lat, venue.lon]);
    }
    Object.values(state.routes).forEach((r) => {
      r.coords.forEach((c, i) => {
        if (i % 10 === 0) {
          points.push(c);
        }
      });
    });
    if (points.length < 2) {
      return;
    }
    const pad = overlapPadding();
    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [pad.left, pad.top + 30],
      paddingBottomRight: [pad.right, pad.bottom],
      maxZoom: 16,
      animate: false,
    });
  }

  function renderAll() {
    renderPeople();
    renderControls();
    renderResults();
    renderDetail();
    renderMapPeople();
    renderMapCenter();
    renderMapVenues();
    renderRoutes();
  }

  /* ---------- sharing ---------- */

  function planLink() {
    const venue = selectedVenue();
    const query = G.encodePlan({
      people: state.people,
      category: state.category,
      objective: state.objective,
      venue: venue ? { name: venue.name, lat: venue.lat, lon: venue.lon } : null,
    });
    const base = location.href.split('#')[0].replace(/[?&]demo(=[^&]*)?/, '').replace(/\?$/, '');
    return `${base}#${query}`;
  }

  function syncHash() {
    if (document.documentElement.dataset.demo === 'true') {
      return;
    }
    const venue = selectedVenue();
    const query = state.people.length ? G.encodePlan({
      people: state.people,
      category: state.category,
      objective: state.objective,
      venue: venue ? { name: venue.name, lat: venue.lat, lon: venue.lon } : null,
    }) : '';
    try {
      history.replaceState(null, '', query ? `#${query}` : location.pathname + location.search);
    } catch (error) {
      /* file:// in some browsers */
    }
    store.setItem('meetline:last', query);
  }

  async function sharePlan() {
    if (!state.people.length) {
      toast('Add people first, then share the plan.');
      return;
    }
    const url = planLink();
    const venue = selectedVenue();
    const text = venue ? `Let's meet at ${venue.name}. Routes for everyone:` : 'Add your location so we can find a place to meet:';
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: 'Meetline plan', text, url });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return;
        }
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied. Whoever opens it sees this group and can add their own location.');
    } catch (error) {
      window.prompt('Copy this link:', url);
    }
  }

  /* ---------- boot ---------- */

  function initMap() {
    map = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: true })
      .setView([CFG.defaultView.lat, CFG.defaultView.lon], CFG.defaultView.zoom);
    L.control.zoom({ position: CFG.zoomPosition || 'bottomright' }).addTo(map);
    L.tileLayer(CFG.tiles, {
      attribution: CFG.attribution,
      subdomains: CFG.subdomains || 'abc',
      maxZoom: 19,
      crossOrigin: true,
    }).addTo(map);
    layers = {
      center: L.layerGroup().addTo(map),
      routes: L.layerGroup().addTo(map),
      venues: L.layerGroup().addTo(map),
      people: L.layerGroup().addTo(map),
    };
    map.on('click', (event) => {
      if (!state.picking) {
        return;
      }
      setPicking(false);
      addPerson({ lat: event.latlng.lat, lon: event.latlng.lng });
    });
    map.on('contextmenu', (event) => {
      addPerson({ lat: event.latlng.lat, lon: event.latlng.lng });
      toast('Person added. Drag the marker to adjust.');
    });
  }

  function setPicking(on) {
    state.picking = on;
    $('#map').classList.toggle('is-picking', on);
    const btn = $('#btn-pick');
    if (btn) {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.classList.toggle('is-on', on);
    }
    if (on) {
      setStatus('busy', 'Tap the map where the person is.');
      document.documentElement.dataset.busy = 'false';
    } else if (state.status === 'busy') {
      setStatus('idle', '');
    }
  }

  function bindButtons() {
    const locate = $('#btn-locate');
    if (locate) {
      locate.addEventListener('click', locateMe);
    }
    const pick = $('#btn-pick');
    if (pick) {
      pick.addEventListener('click', () => setPicking(!state.picking));
    }
    document.querySelectorAll('[data-action="share-top"]').forEach((btn) => btn.addEventListener('click', sharePlan));
    document.querySelectorAll('[data-action="demo"]').forEach((btn) => btn.addEventListener('click', () => loadPeople(DEMO_PEOPLE)));
    document.querySelectorAll('[data-action="clear"]').forEach((btn) => btn.addEventListener('click', () => {
      stopWatch();
      state.people = [];
      changed();
    }));
    const handle = $('#sheet-handle');
    if (handle) {
      handle.addEventListener('click', () => {
        const panel = $('#panel');
        const open = !panel.classList.contains('is-expanded');
        panel.classList.toggle('is-expanded', open);
        handle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.picking) {
        setPicking(false);
      }
    });
  }

  function loadPeople(list, options) {
    stopWatch();
    state.people = [];
    list.forEach((p) => addPerson(p, { silent: true }));
    renderPeople();
    renderMapPeople();
    if (state.people.length) {
      map.fitBounds(L.latLngBounds(state.people.map((p) => [p.lat, p.lon])), { padding: [60, 60], maxZoom: 14 });
    }
    if (!options || !options.noCompute) {
      changed();
    }
  }

  // Demo snapshot: a saved real result (same APIs) so the demo renders without waiting on the network.
  function loadSnapshot(snap) {
    state.category = snap.category;
    state.objective = snap.objective;
    loadPeople(snap.people, { noCompute: true });
    state.center = snap.center;
    state.radius = snap.radius;
    state.ranked = snap.ranked;
    state.selectedId = snap.selectedId;
    state.routes = {};
    state.people.forEach((p, i) => {
      state.routes[p.id] = snap.routes[i];
    });
    renderAll();
    setStatus('ready', '');
    fitToPlan();
    document.documentElement.dataset.ready = 'true';
  }

  function snapshot() {
    return JSON.parse(JSON.stringify({
      category: state.category,
      objective: state.objective,
      people: state.people.map((p) => ({ name: p.name, lat: p.lat, lon: p.lon, mode: p.mode, place: p.place })),
      center: state.center,
      radius: state.radius,
      ranked: state.ranked,
      selectedId: state.selectedId,
      routes: state.people.map((p) => state.routes[p.id]),
    }));
  }

  function boot() {
    initMap();
    setupSearch();
    bindButtons();
    renderControls();
    const params = new URLSearchParams(location.search);
    const demo = params.has('demo') || location.hash === '#demo';
    const fromHash = G.decodePlan(location.hash);
    if (demo && params.get('demo') !== 'live' && window.MEETLINE_SNAPSHOT) {
      document.documentElement.dataset.demo = 'true';
      loadSnapshot(window.MEETLINE_SNAPSHOT);
    } else if (demo) {
      loadPeople(DEMO_PEOPLE);
    } else if (fromHash.people.length) {
      if (fromHash.category) {
        state.category = fromHash.category;
      }
      if (fromHash.objective) {
        state.objective = fromHash.objective;
      }
      state.invitedVenue = fromHash.venue;
      renderControls();
      loadPeople(fromHash.people);
      toast('Shared plan opened. Tap "Use my location" to add yourself.');
    } else {
      const last = G.decodePlan(store.getItem('meetline:last') || '');
      if (last.people.length) {
        if (last.category) {
          state.category = last.category;
        }
        if (last.objective) {
          state.objective = last.objective;
        }
        renderControls();
        loadPeople(last.people);
      } else {
        renderAll();
      }
    }
    setTimeout(() => map.invalidateSize(), 100);
    window.addEventListener('resize', () => map.invalidateSize());
  }

  window.Meetline = { state, snapshot, recompute, addPerson, loadPeople, sharePlan, planLink, CATEGORIES };
  document.addEventListener('DOMContentLoaded', boot);
})();
