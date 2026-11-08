# meetline refine log

Rubric: runs/rubric.md (frozen). Judge: council (3 judges). Shots: ?demo snapshot at 390 + 1440.

## Bracket (round 1)

| match | votes A/B/tie | winner | note |
|---|---|---|---|
| A (sidebar) vs B (transit board) | 0/3/0 | B | B leads with result; A form-first |
| C (field map) vs D (dispatch) | 1/1/1 | D (tiebreak score D 8.1 vs C 7.7) | tie on votes |
| D vs B (final) | 2/0/1 | **D** | D beat B on votes; B score 7.8 |

## Polish loop (winner D, baseline 8.1)

| round | change | gates | judge score | pairwise win | kept? | note |
|---|---|---|---|---|---|---|
| 0 | baseline D | slop 0/0, no overflow, no JS errors | 8.1 | - | yes | best |
| 1 | one primary per state (locate demotes after result), drop duplicate top Share, arrival-strip key | slop 0/0, no overflow, no JS errors | 8.0 | no (0/1/2) | no | below best+0.3 |
| 2 | r1 + mono data voice for all figures, larger result figure, phone order result > group > ranked | slop 0/0, no overflow, no JS errors | 7.8 | no (0/1/2) | no | plateau: 2 rounds without gain, loop stopped |

Result: baseline D (8.1, council-judged, 3 judges) kept and promoted to index.html/style.css.

## Hone 2 (series runs/hone2, simulated-user bots + council)

Panel: 6 simulated-user bots on 3 models, built from runs/hone2/customer.json (assumed persona) and runs/hone2/brief.md. Not real users.
Keep rule: bots compare says "better" AND council pairwise is a B win.

| round | change | gates | council | bots (would use, mean) | pair vs best | kept? |
|---|---|---|---|---|---|---|
| 0 | baseline D (previous winner) | slop 0/0, no overflow, no JS errors | 7.8 | 5/6, 5.83 | - | baseline |
| 1 | phone order group-first; labeled mode row (Car / moto, Bike, Walk); same-block venue merge; plain stats ("Everyone arrives within X", "X combined") + 0-30 min axis; one primary per state; grayscale map; How it works + privacy note | slop 0/0, no overflow, no JS errors | 7.8 | 6/6, 6.33, "better" | 0/2/1 vs r0, B win | **yes** |
| 2 | r1 + phone summary bar, initials on dots, labeled fair-middle marker, neutral mode chips, transit note, collapsible ranking explainer | slop 0/0, no overflow, no JS errors | 7.9 | 4/6, 6.0, "not better" | 0/1/2 vs r1 | no |
| 3 | r2 minus summary bar, detail card after map on phone, map 44vh, "road time, no live traffic" note | slop 0/0, no overflow, no JS errors | 8.2 | 6/6, 6.5 (+0.17), "not better" | 0/1/2 vs r1 | no |

Stop: plateau (2 rounds without a kept gain). Result: r1 kept and promoted to index.html, style.css, src/app.js, src/base.css.
Note: r3 had the highest council score but did not win pairwise against r1 and the bots did not rate it better, so it failed the keep rule. r3 files kept in runs/hone2/r3_files for reference.
Final checks on r1: geo tests 21/21, demo renders 4 venue cards and 7 routes, no overflow or JS errors at 320/390/768/1024/1440, slop_check PASS (0 blockers, 0 warnings).

## Hone 3 (venue facts, closes the "no venue info" gap)

Goal: show the facts a group needs before committing to a place, from data the app already queries, without inventing anything.

- Nominatim search now asks for `extratags`; only opening_hours, cuisine, website, takeaway, outdoor_seating and wheelchair are kept.
- `G.openState()` parses common OSM opening_hours forms (24/7, day ranges and lists, split shifts, past-midnight spans, off, later rule overrides, comma-joined rules, "Mon"/"Sun" names). Anything else returns null and the raw text is shown.
- Card: one line "Open now · until 22:00" / "Closed · opens tomorrow 08:00". Meet at panel: open state line + "Cuisine · Takeaway · Website".
- Real data check (Batam cafes, live Nominatim): 30 results, 12 with tags, 5 with opening_hours; 2 of those 5 used the comma / "Mo- Sun" variants, now parsed.
- Bug caught by tests: "javascript:" websites were being prefixed with https://; now any non-web scheme is dropped.
- Layout fix after visual check: separator dots started wrapped lines; facts moved to plain inline text.

Checks: geo tests 40/40, demo 4 venues / 7 routes, facts DOM test (injected hours) pass, no overflow or JS errors at 1440/390/320, slop_check PASS.
