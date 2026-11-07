# Meetline

Find the fairest place for two or more people to meet, and the road route for each of them.

Add people by searching an address, using your current location, or tapping the map. Meetline looks for cafes, restaurants, malls or parks around the point where nobody travels too long, asks a road router for the real travel time from every person to every candidate, and ranks the places. Each person gets a coloured route on the map, a time, and a link that opens the same trip in Google Maps.

**Live:** https://juw12.github.io/meetline/  
**Sample group:** https://juw12.github.io/meetline/?demo

![Meetline on desktop](docs/screenshot-desktop.png)

## What it does
- **2 to 8 people.** Search (Photon, then Nominatim as fallback), "Use my location" (browser geolocation, with live updates while the tab is open), "Pick on map", or right-click / long-press the map.
- **Per-person travel mode:** drive, cycle or walk.
- **Place type:** cafe, restaurant, mall, park, or the exact fair point.
- **Two rankings:**
  - *Fairest* minimises the longest trip (minimax). Good when you do not want one person stuck in traffic for an hour.
  - *Least total* minimises the sum of all trips (geometric median). Good for fuel or overall time.
- **Real road times** from OSRM (car, bike and foot profiles). If the router is unreachable, Meetline falls back to straight-line estimates and says so.
- **Arrival strip:** every ranked place shows one dot per person on a shared time axis, so you can see how balanced it is before reading any number.
- **Share plan:** the whole plan (people, modes, place) is encoded in the link. Nothing is stored on a server.
- Drag any marker to move a person; results update.

## Run it locally
Geolocation only works on `https://` or `http://localhost`, so serve the folder rather than opening the file directly.

```
start.bat
```
or
```
python -m http.server 8080
```
then open http://localhost:8080/ (add `?demo` for the sample group in Batam).

No build step and no API keys. Leaflet 1.9.4 is vendored in `vendor/leaflet`.

## How the fair point is found
1. Centre: minimax centre of everyone's position (fairest) or geometric median (least total), computed on a local flat projection.
2. Search radius: 30 % of the group's spread, clamped to 0.7-6 km.
3. Candidates: matching places from Photon / Nominatim inside that area, de-duplicated (same name within 60 m).
4. Times: one OSRM table request per travel mode, person x candidate.
5. Rank: by longest trip (or by total), ties broken by the other measure.

## Data sources and limits
- Map tiles: OpenStreetMap. Search: Photon (komoot) and Nominatim. Routing: OSRM via routing.openstreetmap.de. All free community services with fair-use limits; this app makes a handful of requests per search. For heavy use, point `window.MEETLINE_CONFIG` at your own tile, search and routing servers.
- No public transport routing.
- No live location sharing between phones: each person's position is entered on one device, or sent around with the share link.
- Venue coverage depends on OpenStreetMap data in your area.

## Project layout
- `index.html`, `style.css`: the app (dispatch-console design, see `design.md`).
- `src/geo.js`: pure geometry and ranking functions (minimax, median, ranking, share-link encoding).
- `src/app.js`: map, search, routing and UI.
- `src/base.css`: shared component styles.
- `src/demo-snapshot.js`: saved live result for the `?demo` sample group.
- `tests/geo.test.html`: unit tests for `geo.js` (open in a browser, or run `python tools/run_tests.py`).
- `tools/shoot.py`: screenshots at several widths; `tools/run_tests.py`: tests, empty state, demo and live checks.
- `directions/`: the four design directions that were compared before choosing this one.

## Licence
MIT, see `LICENSE`.
