"""One polish round: shoot a page, build the phone+desktop combo, run slop_check, council score and pair vs best.

Usage:
  python tools/hone_round.py <round_dir> <page> <best_combo> [--name D] [--no-judge]
Prints a JSON summary on the last line.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PY = sys.executable
SKILLS = Path(os.path.expanduser("~/.vector/skills/hone"))
SLOP = SKILLS / "design/tools/slop_check.py"
COUNCIL = SKILLS / "council/council.py"


def run(cmd, cwd=ROOT):
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc.returncode, proc.stdout + proc.stderr


def make_combo(out_dir, name):
    desktop = Image.open(out_dir / f"{name}-1440.png").convert("RGB")
    phone = Image.open(out_dir / f"{name}-390.png").convert("RGB")
    height = desktop.height
    phone_scaled = phone.resize((int(phone.width * height / phone.height), height), Image.LANCZOS)
    combo = Image.new("RGB", (phone_scaled.width + 24 + desktop.width, height), "#888888")
    combo.paste(phone_scaled, (0, 0))
    combo.paste(desktop, (phone_scaled.width + 24, 0))
    path = out_dir / f"{name}-combo.jpg"
    combo.save(path, quality=85)
    return path


def main():
    args = sys.argv[1:]
    judge = "--no-judge" not in args
    args = [a for a in args if a != "--no-judge"]
    name = "D"
    if "--name" in args:
        i = args.index("--name")
        name = args[i + 1]
        del args[i:i + 2]
    round_dir, page = args[0], args[1]
    best_combo = str((ROOT / args[2]).resolve())
    out_dir = ROOT / "runs" / round_dir
    page_dir = (ROOT / page).parent

    code, _ = run([PY, str(ROOT / "tools/shoot.py"), "shots", str(out_dir), page, "--query", "?demo", "--widths", "390,1440"])
    report = json.loads((out_dir / "report.json").read_text(encoding="utf-8"))
    combo = make_combo(out_dir, name)

    slop_files = [page_dir / "index.html", page_dir / "style.css", ROOT / "src/base.css", ROOT / "src/app.js"]
    slop_code, slop_out = run([PY, str(SLOP), *[str(f) for f in slop_files]])

    summary = {"shoot_exit": code, "report": report, "slop_exit": slop_code, "slop_tail": slop_out[-300:], "combo": str(combo)}
    if judge:
        runs = ROOT / "runs"
        run([PY, str(COUNCIL), "score", "--rubric", "rubric.md", "--image", str(combo), "--out", str(out_dir / "score.json")], cwd=runs)
        run([PY, str(COUNCIL), "pair", "--rubric", "rubric.md", "--image-a", best_combo, "--image-b", str(combo), "--out", str(out_dir / "pair.json")], cwd=runs)
        score = json.loads((out_dir / "score.json").read_text(encoding="utf-8"))
        pair = json.loads((out_dir / "pair.json").read_text(encoding="utf-8"))
        summary.update({
            "score": score.get("council_score"),
            "fixes": [f.get("fix") for f in score.get("fixes", [])],
            "votes": pair.get("votes"),
            "b_wins": pair.get("b_wins"),
        })
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
