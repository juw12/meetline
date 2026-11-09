/* Meetline geo + ranking helpers. Pure functions, no DOM. Works in the browser (window.MeetGeo) and Node (require). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MeetGeo = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EARTH_RADIUS_M = 6371008.8;
  const M_PER_DEG_LAT = 110574;
  const M_PER_DEG_LON_EQ = 111320;

  // Fallback speeds when the road router is unreachable (urban averages, km/h).
  const FALLBACK_SPEED_KMH = { car: 30, bike: 14, foot: 4.8, transit: 16 };
  // Road distance is longer than the straight line; 1.35 is a common urban detour factor.
  const DETOUR_FACTOR = 1.35;

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversine(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLon = toRad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  // Local equirectangular projection around an origin; accurate to well under 1% at city scale.
  function projector(origin) {
    const kx = M_PER_DEG_LON_EQ * Math.cos(toRad(origin.lat));
    const ky = M_PER_DEG_LAT;
    return {
      toXY: (p) => ({ x: (p.lon - origin.lon) * kx, y: (p.lat - origin.lat) * ky }),
      toLatLon: (q) => ({ lat: origin.lat + q.y / ky, lon: origin.lon + q.x / kx }),
    };
  }

  // Spherical mean of the points (the plain geographic midpoint).
  function centroid(points) {
    if (!points.length) {
      return null;
    }
    let x = 0;
    let y = 0;
    let z = 0;
    for (const p of points) {
      const lat = toRad(p.lat);
      const lon = toRad(p.lon);
      x += Math.cos(lat) * Math.cos(lon);
      y += Math.cos(lat) * Math.sin(lon);
      z += Math.sin(lat);
    }
    const n = points.length;
    x /= n;
    y /= n;
    z /= n;
    const lon = Math.atan2(y, x);
    const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
    return { lat: (lat * 180) / Math.PI, lon: (lon * 180) / Math.PI };
  }

  // Centre of the smallest circle around all points (minimises the farthest straight-line trip).
  // Badoiu-Clarkson iteration: converges to within about R/sqrt(iterations).
  function minimaxCenter(points, iterations) {
    if (points.length <= 1) {
      return points.length ? { lat: points[0].lat, lon: points[0].lon } : null;
    }
    const steps = iterations || 4000;
    const proj = projector(centroid(points));
    const xy = points.map(proj.toXY);
    let c = { x: xy[0].x, y: xy[0].y };
    for (let i = 1; i <= steps; i++) {
      let far = xy[0];
      let farD = -1;
      for (const q of xy) {
        const d = (q.x - c.x) ** 2 + (q.y - c.y) ** 2;
        if (d > farD) {
          farD = d;
          far = q;
        }
      }
      c = { x: c.x + (far.x - c.x) / (i + 1), y: c.y + (far.y - c.y) / (i + 1) };
    }
    return proj.toLatLon(c);
  }

  // Geometric median (minimises the sum of straight-line distances). Weiszfeld iteration.
  function geometricMedian(points, iterations) {
    if (points.length <= 2) {
      return centroid(points);
    }
    const proj = projector(centroid(points));
    const xy = points.map(proj.toXY);
    let c = {
      x: xy.reduce((s, q) => s + q.x, 0) / xy.length,
      y: xy.reduce((s, q) => s + q.y, 0) / xy.length,
    };
    for (let i = 0; i < (iterations || 200); i++) {
      let nx = 0;
      let ny = 0;
      let den = 0;
      let onPoint = false;
      for (const q of xy) {
        const d = Math.hypot(q.x - c.x, q.y - c.y);
        if (d < 1e-6) {
          onPoint = true;
          continue;
        }
        nx += q.x / d;
        ny += q.y / d;
        den += 1 / d;
      }
      if (!den || onPoint && den === 0) {
        break;
      }
      const next = { x: nx / den, y: ny / den };
      if (Math.hypot(next.x - c.x, next.y - c.y) < 0.01) {
        c = next;
        break;
      }
      c = next;
    }
    return proj.toLatLon(c);
  }

  function searchCenter(points, objective) {
    return objective === 'total' ? geometricMedian(points) : minimaxCenter(points);
  }

  // Search radius for venues: a share of the group's spread, clamped to a walkable-to-district range.
  function searchRadius(points, center) {
    const spread = Math.max(0, ...points.map((p) => haversine(p, center)));
    return Math.min(6000, Math.max(700, spread * 0.3));
  }

  function bbox(center, radiusM) {
    const dLat = radiusM / M_PER_DEG_LAT;
    const dLon = radiusM / (M_PER_DEG_LON_EQ * Math.cos(toRad(center.lat)));
    return {
      west: center.lon - dLon,
      south: center.lat - dLat,
      east: center.lon + dLon,
      north: center.lat + dLat,
    };
  }

  function estimateTrip(from, to, mode) {
    const distance = haversine(from, to) * DETOUR_FACTOR;
    const speed = FALLBACK_SPEED_KMH[mode] || FALLBACK_SPEED_KMH.car;
    return { duration: distance / (speed / 3.6), distance };
  }

  // Score every candidate from a durations matrix [person][candidate] (seconds).
  // objective 'fair': smallest longest trip first; 'total': smallest sum first.
  function rankCandidates(candidates, durations, distances, objective) {
    const scored = candidates.map((candidate, j) => {
      const times = durations.map((row) => row[j]);
      const dists = distances.map((row) => row[j]);
      const valid = times.every((t) => Number.isFinite(t));
      const max = valid ? Math.max(...times) : Infinity;
      const min = valid ? Math.min(...times) : Infinity;
      const sum = valid ? times.reduce((s, t) => s + t, 0) : Infinity;
      return Object.assign({}, candidate, {
        times,
        dists,
        max,
        min,
        sum,
        gap: valid ? max - min : Infinity,
        reachable: valid,
      });
    });
    const primary = objective === 'total' ? 'sum' : 'max';
    const secondary = objective === 'total' ? 'max' : 'sum';
    scored.sort((a, b) => (a[primary] - b[primary]) || (a[secondary] - b[secondary]) || (a.order || 0) - (b.order || 0));
    return scored;
  }

  // De-duplicate venues that share a name within 60 m (chains often appear twice), keep the nearest N.
  function dedupeVenues(venues, center, limit) {
    const kept = [];
    const sorted = venues
      .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
      .map((v) => Object.assign({}, v, { fromCenter: haversine(v, center) }))
      .sort((a, b) => a.fromCenter - b.fromCenter);
    for (const v of sorted) {
      const twin = kept.find((k) => haversine(k, v) < 60 && (k.name || '').toLowerCase() === (v.name || '').toLowerCase());
      if (!twin) {
        kept.push(v);
      }
      if (kept.length >= (limit || 12)) {
        break;
      }
    }
    return kept;
  }

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds)) {
      return 'no route';
    }
    const minutes = Math.max(1, Math.round(seconds / 60));
    if (minutes < 60) {
      return minutes + ' min';
    }
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h + ' h ' + String(m).padStart(2, '0');
  }

  function formatDistance(meters) {
    if (!Number.isFinite(meters)) {
      return '';
    }
    if (meters < 950) {
      return Math.round(meters / 10) * 10 + ' m';
    }
    return (meters / 1000).toFixed(meters < 9500 ? 1 : 0) + ' km';
  }

  // ---------- OSM venue tags ----------
  // Supports the common opening_hours forms: "24/7", "Mo-Fr 08:00-22:00; Sa,Su 10:00-23:00",
  // split shifts "09:00-12:00,13:00-17:00", spans past midnight "18:00-02:00", and "off".
  // Anything else (PH, months, sunrise, comments) returns null so the UI shows the raw text instead of guessing.
  const DAY_CODES = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
  const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAY_RE = '(?:Mo|Tu|We|Th|Fr|Sa|Su)';
  const DAYS_PART_RE = new RegExp('^(' + DAY_RE + '(?:-' + DAY_RE + ')?(?:,' + DAY_RE + '(?:-' + DAY_RE + ')?)*)(?:\\s+|$)');
  const SPAN_RE = /^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/;

  function parseDayList(text) {
    const days = [];
    for (const part of text.split(',')) {
      const [from, to] = part.split('-');
      const start = DAY_CODES.indexOf(from);
      const end = to ? DAY_CODES.indexOf(to) : start;
      for (let d = start, guard = 0; guard < 7; d = (d + 1) % 7, guard += 1) {
        days.push(d);
        if (d === end) {
          break;
        }
      }
    }
    return days;
  }

  // Common real-world variants: "Mon"/"Sun" day names, "Mo - Fr" spacing, and rules joined by ", ".
  const LONG_DAYS = { Mon: 'Mo', Tue: 'Tu', Wed: 'We', Thu: 'Th', Fri: 'Fr', Sat: 'Sa', Sun: 'Su' };

  function normalizeHours(text) {
    return String(text || '')
      .trim()
      .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\b/g, (word, short) => LONG_DAYS[short])
      .replace(new RegExp('(' + DAY_RE + ')\\s*-\\s*(' + DAY_RE + ')', 'g'), '$1-$2')
      // A comma after a time and before a day code starts a new rule; "Sa,Su" day lists stay intact.
      .replace(new RegExp('(\\d)\\s*,\\s*(?=' + DAY_RE + '\\b)', 'g'), '$1; ');
  }

  function parseOpeningHours(text) {
    const source = normalizeHours(text);
    if (!source) {
      return null;
    }
    if (source === '24/7') {
      return { always: true };
    }
    const week = [[], [], [], [], [], [], []];
    for (const rawRule of source.split(';')) {
      const rule = rawRule.trim();
      if (!rule) {
        continue;
      }
      const dayMatch = rule.match(DAYS_PART_RE);
      const days = dayMatch ? parseDayList(dayMatch[1]) : [0, 1, 2, 3, 4, 5, 6];
      const rest = (dayMatch ? rule.slice(dayMatch[0].length) : rule).trim();
      let spans;
      if (rest === 'off' || rest === 'closed') {
        spans = [];
      } else if (rest === '00:00-24:00' || rest === '24/7') {
        spans = [[0, 1440]];
      } else {
        if (!rest) {
          return null;
        }
        spans = [];
        for (const chunk of rest.split(',')) {
          const m = chunk.trim().match(SPAN_RE);
          if (!m) {
            return null;
          }
          const start = Number(m[1]) * 60 + Number(m[2]);
          let end = Number(m[3]) * 60 + Number(m[4]);
          if (start > 1440 || end > 1440 || Number(m[2]) > 59 || Number(m[4]) > 59) {
            return null;
          }
          if (end <= start) {
            end += 1440;
          }
          spans.push([start, end]);
        }
      }
      // Later rules replace earlier ones for the same day, as in the OSM spec.
      days.forEach((d) => {
        week[d] = spans.slice();
      });
    }
    return { always: false, week };
  }

  function clock(minutes) {
    const m = ((minutes % 1440) + 1440) % 1440;
    return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  }

  // Open/closed state at a given local time. Returns null when the hours cannot be parsed.
  function openState(text, date) {
    const parsed = parseOpeningHours(text);
    if (!parsed) {
      return null;
    }
    if (parsed.always) {
      return { open: true, label: 'Open 24 hours' };
    }
    const now = date || new Date();
    const today = (now.getDay() + 6) % 7;
    const minute = now.getHours() * 60 + now.getMinutes();
    // Absolute intervals from yesterday to a week ahead, in minutes from today 00:00.
    const intervals = [];
    for (let offset = -1; offset <= 7; offset += 1) {
      const day = (today + offset + 7) % 7;
      parsed.week[day].forEach(([start, end]) => {
        intervals.push([offset * 1440 + start, offset * 1440 + end]);
      });
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const current = intervals.find(([start, end]) => start <= minute && minute < end);
    if (current) {
      let until = current[1];
      let extended = true;
      while (extended) {
        extended = false;
        for (const [start, end] of intervals) {
          if (start <= until && end > until) {
            until = end;
            extended = true;
          }
        }
      }
      if (until - minute >= 7 * 1440) {
        return { open: true, label: 'Open 24 hours' };
      }
      return { open: true, label: 'Open now · until ' + (until % 1440 === 0 ? 'midnight' : clock(until)) };
    }
    const next = intervals.find(([start]) => start > minute);
    if (!next) {
      return { open: false, label: 'Closed' };
    }
    const dayOffset = Math.floor(next[0] / 1440);
    let when = clock(next[0]);
    if (dayOffset === 1) {
      when = 'tomorrow ' + when;
    } else if (dayOffset > 1) {
      when = DAY_SHORT[(today + dayOffset) % 7] + ' ' + when;
    }
    return { open: false, label: 'Closed · opens ' + when };
  }

  function humanizeTag(value) {
    const text = String(value || '').split(';').map((s) => s.trim().replace(/_/g, ' ')).filter(Boolean).join(', ');
    return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
  }

  // Short, factual venue details from OSM tags. Only what the tags say; nothing is inferred.
  function venueFacts(tags, date) {
    const t = tags || {};
    const hoursText = t.opening_hours || '';
    const state = hoursText ? openState(hoursText, date) : null;
    const extras = [];
    if (t.takeaway === 'yes' || t.takeaway === 'only') {
      extras.push(t.takeaway === 'only' ? 'Takeaway only' : 'Takeaway');
    }
    if (t.outdoor_seating === 'yes') {
      extras.push('Outdoor seating');
    }
    if (t.wheelchair === 'yes') {
      extras.push('Wheelchair access');
    }
    let website = String(t.website || t['contact:website'] || '').trim();
    if (website && !/^[a-z][a-z0-9+.-]*:/i.test(website)) {
      // Bare domains like "example.com" get https; any other scheme (javascript:, mailto:) is dropped below.
      website = 'https://' + website;
    }
    return {
      hours: state,
      hoursText: state ? '' : hoursText,
      cuisine: humanizeTag(t.cuisine),
      extras,
      website: /^https?:\/\/[^\s"'<>]+$/i.test(website) ? website : '',
    };
  }

  // Share-link encoding: names are URI-encoded, coordinates kept to 5 decimals (about 1 m).
  const MODES = ['car', 'bike', 'foot', 'transit'];

  // Decode an encoded polyline (Google format). Transitous returns precision 7, OSRM-style tools 5 or 6.
  function decodePolyline(text, precision) {
    const factor = Math.pow(10, precision || 5);
    const points = [];
    let index = 0;
    let lat = 0;
    let lon = 0;
    while (index < text.length) {
      for (let axis = 0; axis < 2; axis++) {
        let result = 0;
        let shift = 0;
        let byte;
        do {
          byte = text.charCodeAt(index++) - 63;
          result |= (byte & 0x1f) << shift;
          shift += 5;
        } while (byte >= 0x20 && index < text.length);
        const delta = result & 1 ? ~(result >> 1) : result >> 1;
        if (axis === 0) {
          lat += delta;
        } else {
          lon += delta;
        }
      }
      points.push([lat / factor, lon / factor]);
    }
    return points;
  }

  function encodePlan(plan) {
    const params = new URLSearchParams();
    const people = plan.people.map((p) => [
      encodeURIComponent(p.name || ''),
      p.lat.toFixed(5),
      p.lon.toFixed(5),
      MODES.includes(p.mode) ? p.mode : 'car',
    ].join('~'));
    params.set('p', people.join('|'));
    if (plan.category) {
      params.set('cat', plan.category);
    }
    if (plan.objective) {
      params.set('obj', plan.objective);
    }
    if (plan.venue) {
      params.set('v', [encodeURIComponent(plan.venue.name || ''), plan.venue.lat.toFixed(5), plan.venue.lon.toFixed(5)].join('~'));
    }
    return params.toString();
  }

  function decodePlan(text) {
    const params = new URLSearchParams((text || '').replace(/^[#?]/, ''));
    const raw = params.get('p');
    const people = [];
    if (raw) {
      for (const chunk of raw.split('|')) {
        const [name, lat, lon, mode] = chunk.split('~');
        const latN = Number(lat);
        const lonN = Number(lon);
        if (Number.isFinite(latN) && Number.isFinite(lonN) && Math.abs(latN) <= 90 && Math.abs(lonN) <= 180) {
          let decoded = '';
          try {
            decoded = decodeURIComponent(name || '');
          } catch (error) {
            decoded = name || '';
          }
          people.push({
            name: decoded.slice(0, 24),
            lat: latN,
            lon: lonN,
            mode: MODES.includes(mode) ? mode : 'car',
          });
        }
      }
    }
    let venue = null;
    const v = params.get('v');
    if (v) {
      const [name, lat, lon] = v.split('~');
      if (Number.isFinite(Number(lat)) && Number.isFinite(Number(lon))) {
        let decoded = '';
        try {
          decoded = decodeURIComponent(name || '');
        } catch (error) {
          decoded = name || '';
        }
        venue = { name: decoded, lat: Number(lat), lon: Number(lon) };
      }
    }
    return {
      people: people.slice(0, 8),
      category: params.get('cat') || null,
      objective: params.get('obj') === 'total' ? 'total' : (params.get('obj') ? 'fair' : null),
      venue,
    };
  }

  return {
    haversine,
    centroid,
    minimaxCenter,
    geometricMedian,
    searchCenter,
    searchRadius,
    bbox,
    estimateTrip,
    rankCandidates,
    dedupeVenues,
    formatDuration,
    formatDistance,
    parseOpeningHours,
    openState,
    venueFacts,
    encodePlan,
    decodePlan,
    decodePolyline,
    FALLBACK_SPEED_KMH,
  };
});
