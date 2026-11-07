"""Run the portfolio add_card.py when git-over-HTTPS is blocked by the proxy.

Replaces its git refresh with a GitHub API download of the current scripts/apps.json, then runs it unchanged.
Usage: python add_card_api.py <add_card args...>
"""
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

TOOLS = Path(os.path.expanduser("~/.vector/skills/hone/portfolio/tools"))
sys.path.insert(0, str(TOOLS))
import add_card  # noqa: E402


def gh_json(path):
    env = dict(os.environ, HTTPS_PROXY="http://localhost:3128")
    out = subprocess.run(["gh", "api", path], capture_output=True, text=True, encoding="utf-8", env=env, check=True).stdout
    return json.loads(out)


def refresh_from_api():
    meta = gh_json("repos/juw12/projects/contents/scripts/apps.json")
    if meta.get("content"):
        data = base64.b64decode(meta["content"])
    else:
        blob = gh_json(f"repos/juw12/projects/git/blobs/{meta['sha']}")
        data = base64.b64decode(blob["content"])
    target = add_card.PROJECTS_DIR / "scripts" / "apps.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    print(f"apps.json refreshed from API (sha {meta['sha'][:7]})")


add_card.refresh_clones = refresh_from_api
sys.argv = ["add_card.py", *sys.argv[1:]]
add_card.main()
