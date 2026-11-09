# Meetline design system

Direction: **dispatch console**. A dark, data-first map tool that reads like a ride-hail dispatch screen or a flight tracker: map in the centre, inputs on the left, the answer on the right. Chosen by council bracket (D beat B 2-0-1 in the final), then refined in Hone 2 (round 1 kept; see `runs/refine_log.md`).

## Facts the design serves
- Job: 2 to 8 people find the place where nobody travels too long, then each person gets a road route.
- The answer is one place and one number (the longest trip). Everything else is supporting evidence.
- Used on phones while out, and on laptops while planning. Both must work at 320 px and at 1440 px.

## References
- Flightradar24: dark basemap, bright data overlays, mono figures.
- Ride-hail dispatch consoles: three columns, live list on the right, map as the work surface.
- Google Maps directions panel: per-person time, mode and distance in one row.
- Citymapper: one clear result first, alternatives below.
- SBB / Swiss rail signage: uppercase tracked labels, one accent colour used only for "act here".

## Palette (dark only)
| token | hex | use |
|---|---|---|
| `--bg` | `#0E1114` | page, inputs |
| `--paper` | `#161A1F` | columns, panels |
| `--soft` | `#1F242B` | hover, status bar |
| `--line` | `#2A3038` | 1 px dividers |
| `--ink` | `#E7EAEE` | text, selected chips |
| `--muted` | `#98A2AD` | secondary text, labels |
| `--accent` | `#F2B233` | amber: primary action, the meeting point, the winning number |
| `--accent-ink` | `#15120A` | text on amber |
| `--accent-soft` | `#2B2416` | amber tint for selected segments |

The basemap is grayscale (inverted, desaturated tiles) so that only person colours and the amber meeting point carry colour on the map.

One accent only. Person colours (`#4D9BFF`, `#FF8A3D`, `#4CC27A`, `#FF5C5C`, `#2FC6CF`, `#E8C547`, `#AEB6BF`, `#C98C5A`) identify people and routes and never style UI controls. No purple anywhere.

### Contrast (WCAG, measured)
- ink on paper 14.48:1, ink on bg 15.69:1
- muted on paper 6.75:1, muted on soft 6.03:1
- accent on paper 9.31:1, accent-ink on accent 9.97:1
- placeholder and strip axis `#9AA4AE` on bg 7.48:1, on paper 6.90:1 (raised from `#7D8792` in Hone 4)
- error `#FFB4B4` on `#3A1C1C` 9.13:1
All text pairs pass AA (4.5:1).

## Type
- **Barlow Semi Condensed** (600) as `--display`: brand name, the Meet at venue name, ranked venue names and person names. Nothing else.
- **Manrope** (400/500/600/700) for all other interface text.
- **JetBrains Mono** (500) for every figure: minutes, counts, rank numbers, the brand sub-label.
- Scale: 11 (mono labels) / 12 / 13 / 14 body / 17 brand / 22-26 result figure.
- Labels: 13 px, 600, uppercase, 0.08em tracking, muted.

## Space, radius, depth, motion
- 4 px base grid; panel padding 18-20 px desktop, 14-16 px phone.
- Radius 6 px everywhere (`--radius`), round only for person markers.
- No drop shadows on panels; separation by 1 px `--line`. Map pins keep a small shadow for legibility.
- Motion: status spinner only (0.8 s linear). Map fly-to uses Leaflet defaults. No decorative animation.

## Layout
- 1440: 330 px left (group + options) / map / 380 px right (result + ranked list), 60 px toolbar with search and actions.
- 760-1100: two columns, results move under the map; the brand sub-label hides so the search keeps at least 200 px.
- Phone (under 760): toolbar, map, group editor, options (place type, rank by), status, result detail, ranked places, then How it works. The group comes first because adding people is the first job. Toolbar wraps: search full width, Locate and Pick buttons share one row.
- Under 360 px the map pin label hides (the result card shows the same text).
- Tap targets at least 40 px high; mode switch buttons 32 px inside a 40 px row.

## Controls
- One primary (amber) button per state: "Use my location" before there is a result, "Share this plan" after. The other one drops to a quiet button.
- Travel mode is a labeled row under each person ("Car / moto", "Bike", "Walk"), not icons. The selected mode uses `--accent-soft` with amber text.
- Option labels say what they do: "Place type", "Rank by". The group count reads "3 people · up to 8".
- Venues within 60 m of each other merge into one card with a "Same block:" line, so the list does not repeat one building.
- Venue facts come only from OSM tags. The open state sits on its own line (ink when open, muted when closed; no green/red, the accent stays reserved). Cuisine, extras and the website link follow as one plain muted line joined with " · ". Nothing renders when a venue has no tags.

## Meet at panel (hone 5)
- Each leg row ends with a 3 px bar in the person's colour, right-aligned so every bar ends at the venue; the longest trip fills the row.
- Below the legs: "Meet at [time]" (native time input, mono, dark color-scheme) and "Leave by" with one name + clock time per person, earliest first. Default time is the next quarter hour that gives the slowest person their trip plus 10 minutes.
- Each leg has a quiet underlined "Bus/train" link (muted, not accent) that opens Google Maps transit directions.
- Desktop map labels the dashed ring "Fair zone · similar trip times" (mono, amber outline); hidden under 760 px where the ring is small.
- Search field has a visible "Add" button inside the right edge, same action as Enter.
- `--muted` raised to #aab3bd for AA contrast on small labels.

## Signature: the arrival strip
Each ranked place shows one dot per person on a shared time axis, with a bar from the shortest to the longest trip. You can see fairness (a short bar) before reading a number. The selected place gets an amber left rule and an amber rank badge; its pin on the map is the only amber pin.

## Voice
- Plain, short, practical. "Add a person: address or place", "Use my location", "Share this plan".
- Numbers over adjectives: "27 min longest", "Everyone arrives within 6 min", "58 min combined", not "Great spot".
- The arrival strip has a labeled 0-30 min axis so the dots read without a legend.
- Privacy stated once, quietly: "Locations stay in this browser and in links you share."

## Banned defaults
- Purple or violet anywhere, gradient text, glassmorphism, neon glows.
- Emoji in UI or copy.
- Inter-only or system-only type.
- Hype words ("seamless", "revolutionary", "unlock").
- Center-aligned hero marketing layout inside the tool.
- More than one accent colour.

## Files
- `index.html`, `style.css`: this direction (tokens, layout, overrides).
- `src/base.css`: shared components (people rows, chips, results, legs, pins).
- `directions/A-D`: the four bracket directions, kept for reference.
