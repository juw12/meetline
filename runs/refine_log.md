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
