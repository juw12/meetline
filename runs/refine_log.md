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

## Hone 4 (UI polish: hierarchy, phone order, privacy copy)

Keep rule: council pairwise is a B win AND the simulated-user bots rate it better than the baseline.
Measurement note: the local proxy was down at the start, so the first two shoots (h4r0, h4r1) had blank map tiles and no web font. They were discarded. `tools/shoot.py` now uses the proxy only when it is listening, and every later shot was checked for tiles and fonts before judging.

| round | change | council (3 judges) | pair vs baseline | bots (would use, mean) | kept? |
|---|---|---|---|---|---|
| h4b0 | baseline (Hone 3 live build) | 7.7 | - | 4/6, 5.83; resample 6/6, 6.17 | baseline |
| h4r2 | Barlow Semi Condensed display face; Maps as text link; ghost toolbar once a result exists; phone shows result before the editor; 18 px initial dots; dim minor pins; "Midpoint only"; collapsible How it works; privacy copy + share-link note; placeholder/axis #7D8792 -> #9AA4AE | 7.8 | 0/1/2 (tie) | 6/6, 6.17, "better" | no (pair tie) |
| h4r3 | r2 + "Fair zone" map label, How it works open on desktop, compact options | 8.0 | 0/2/1 (B win) | 3/6, 5.50, "not better" | no (bots) |
| h4r4 | r3 + label hidden on phone, phone map 52vh, "First to last arrival" copy | 8.0 | 0/2/1 (B win) | 3/6, 5.67; resample 4/6, 5.50 | no (bots, confirmed by resample) |

Stop: plateau (3 rounds without a kept gain).
Final pick, stated plainly: no round met the strict keep rule. h4r2 is the only round not worse than the baseline on either signal (council +0.1 with a pairwise tie; bots 6.17 against baseline samples of 5.83 and 6.17), so h4r2 shipped. One copy fix from r4 was added on top because it corrects a factual contradiction, not a style choice: "Everyone arrives within 16 min" next to a 27 min longest trip now reads "First to last arrival: 16 min". r3/r4 files are kept in runs/hone4/r3files and runs/hone4/r4files.
What the bots still ask for is outside a static UI: public transport, live location sharing, venue photos and ratings, a separate motorbike mode. Those need a routing or places backend.
Final checks: run_tests ok (geo, demo 4 venues / 7 routes, facts), slop_check PASS (0 blockers, 0 warnings), no overflow at 320/390/1440, asset version 20261108c.
Lesson: confirm map tiles and web fonts actually loaded in every screenshot before any judge sees it; a blank map scored like a design problem.

## Hone 5 (bigger functional gains: meeting plan, transit links, signature bars)
Rule: keep a round only if the 3-judge council picks it in a position-swapped pairwise vote AND the 6 simulated-user bots do not get worse. Bot scores turned out to be noisy (baseline resampled 3x: 6.33 / 5.33 / 6.00, would-use 6, 2, 4 of 6), so bots were pooled across resamples.

| Round | Change | Council pairwise vs ref | Bots (mean, would-use) |
|---|---|---|---|
| h5b0 | shipped Hone 4 | council 8.3 | 6.33, 5.33, 6.00 (12/18) |
| h5r1 | collapsed options, Share place only, Map link, transit links | lost to h5b0 (A, tie, tie) | 6.00 (5/6) |
| h5r2 | arrival bars, departure line, Fair zone label | won vs h5b0 (B 2, tie 1) | 6.00, 5.83 (7/12) |
| h5r3 | r2 + phone result above map, muted contrast | tie vs r2 (no win) | 6.00 (5/6) |
| h5r5 | r2 + Add button, contrast, leave-order schedule, zone label text | won vs h5b0 (B 2, tie 1) | 5.33, 5.67 (7/12) |
| h5r6 (shipped) | r5 + meeting time picker with clock leave-by times, per-person Bus/train link, privacy line | won vs h5b0 (B 2, tie 1), council 8.0 | 6.00, 5.83, 6.00 (14/18) |

Shipped h5r6 (asset version 20261109a):
- Meet at panel: right-aligned arrival bar per person (all bars end at the venue), then "Meet at [time]" with each person's leave-by clock time.
- Bus/train link per person (Google Maps transit directions); footer and README say transit is not computed in-app.
- Visible Add button in the search field; desktop map labels the ring "Fair zone · similar trip times"; --muted raised to #aab3bd.
- Tests: tools/run_tests.py adds a plan check (18:00 meeting gives Juwen 5:33 PM, Andi 5:43 PM, Sari 5:49 PM; 3 transit links; Add button). All pass. slop_check PASS. Overflow 0 at 320/390/1440.
- Pooled bots: shipped 5.94 mean, 14/18 would use vs baseline 5.89, 12/18.
- Honest read: council prefers it clearly; the bots are flat-to-slightly-better and still ask for venue photos/ratings, live traffic, computed public transport and live location sharing, which need a server or paid APIs.
