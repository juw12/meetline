"""Serve the Meetline folder on localhost, open pages in Chrome, wait for the app, take screenshots.

Usage:
  python tools/shoot.py snapshot                       # live demo run -> src/demo-snapshot.js
  python tools/shoot.py shots <out_dir> <page> [...]   # page = path under meetline/, e.g. directions/A/index.html
      options: --query "?demo" --widths 390,1440 --state ready|empty
Writes <out_dir>/<name>-<width>.png and <out_dir>/report.json (console errors, overflow, timings).
"""
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
PROXY_ARGS = ["--proxy-server=http://localhost:3128", "--proxy-bypass-list=127.0.0.1;localhost;<local>"]
HEIGHTS = {320: 700, 390: 844, 768: 1024, 1024: 768, 1280: 800, 1440: 900}


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(ROOT))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, server.server_address[1]


def launch(playwright):
    options = {"args": PROXY_ARGS}
    if Path(CHROME).exists():
        options["executable_path"] = CHROME
    return playwright.chromium.launch(**options)


def wait_ready(page, timeout_s):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        ready = page.evaluate("document.documentElement.dataset.ready === 'true'")
        if ready:
            return True
        page.wait_for_timeout(500)
    return False


def wait_tiles(page, timeout_s=25):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        pending = page.evaluate(
            "Array.from(document.querySelectorAll('.leaflet-tile')).filter(t => !t.complete).length"
        )
        if pending == 0:
            return True
        page.wait_for_timeout(400)
    return False


def snapshot():
    from playwright.sync_api import sync_playwright
    server, port = serve()
    result = {}
    with sync_playwright() as playwright:
        browser = launch(playwright)
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda exc: errors.append(str(exc)))
        started = time.time()
        page.goto(f"http://127.0.0.1:{port}/directions/A/index.html?demo=live", wait_until="load")
        ok = wait_ready(page, 150)
        result["ready"] = ok
        result["seconds"] = round(time.time() - started, 1)
        result["errors"] = errors
        if ok:
            snap = page.evaluate("Meetline.snapshot()")
            text = "/* Saved live result for the Batam sample group (OSM Nominatim + OSRM). Regenerate: python tools/shoot.py snapshot */\n"
            text += "window.MEETLINE_SNAPSHOT = " + json.dumps(snap, separators=(",", ":")) + ";\n"
            (ROOT / "src" / "demo-snapshot.js").write_text(text, encoding="utf-8", newline="\n")
            result["venues"] = [(v["name"], round(v["max"] / 60, 1), round(v["sum"] / 60, 1)) for v in snap["ranked"]]
            result["status"] = page.evaluate("document.getElementById('status').textContent")
        page.screenshot(path=str(ROOT / "tools" / "snapshot-live.png"))
    print(json.dumps(result, indent=1), flush=True)
    os._exit(0)


def shots(out_dir, pages, query, widths, state):
    from playwright.sync_api import sync_playwright
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    server, port = serve()
    report = {}
    with sync_playwright() as playwright:
        browser = launch(playwright)
        for page_path in pages:
            name = Path(page_path).parent.name if Path(page_path).name == "index.html" else Path(page_path).stem
            if name in ("", "."):
                name = "app"
            entry = report.setdefault(name, {"errors": [], "overflow": [], "files": []})
            for width in widths:
                page = browser.new_page(viewport={"width": width, "height": HEIGHTS.get(width, 900)})
                page.on("console", lambda msg, e=entry: e["errors"].append(msg.text) if msg.type == "error" else None)
                page.on("pageerror", lambda exc, e=entry: e["errors"].append(str(exc)))
                url = f"http://127.0.0.1:{port}/{page_path}{query}"
                for attempt in range(2):
                    try:
                        page.goto(url, wait_until="domcontentloaded", timeout=45000)
                        break
                    except Exception as exc:
                        entry["errors"].append(f"{width}px goto attempt {attempt + 1}: {str(exc)[:80]}")
                if state == "ready":
                    if not wait_ready(page, 60):
                        entry["errors"].append(f"{width}px: app never reported ready")
                else:
                    page.wait_for_timeout(1500)
                wait_tiles(page)
                page.add_style_tag(content="*{transition:none!important;animation:none!important}")
                page.wait_for_timeout(600)
                scroll_width = page.evaluate("document.documentElement.scrollWidth")
                if scroll_width > width:
                    entry["overflow"].append(f"{width}px viewport scrolls to {scroll_width}px")
                clipped = page.evaluate("""() => {
                    const bad = [];
                    document.querySelectorAll('button, .btn, .chip, .seg, .venue-name, .detail-name, h1, h2').forEach(n => {
                        const r = n.getBoundingClientRect();
                        if (r.width && r.right > window.innerWidth + 1) bad.push((n.className || n.tagName) + ' right=' + Math.round(r.right));
                    });
                    return bad.slice(0, 8);
                }""")
                if clipped:
                    entry["overflow"].extend(f"{width}px: {c}" for c in clipped)
                file = out / f"{name}-{width}.png"
                page.screenshot(path=str(file), full_page=True)
                entry["files"].append(str(file))
                page.close()
                print(f"shot {file.name}", flush=True)
    (out / "report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(json.dumps(report, indent=1), flush=True)
    os._exit(0)


if __name__ == "__main__":
    os.environ.pop("HTTP_PROXY", None)
    os.environ.pop("HTTPS_PROXY", None)
    os.environ["NO_PROXY"] = "localhost,127.0.0.1"
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    if sys.argv[1] == "snapshot":
        snapshot()
    elif sys.argv[1] == "shots":
        args = sys.argv[2:]
        query = "?demo"
        widths = [390, 1440]
        state = "ready"
        positional = []
        i = 0
        while i < len(args):
            if args[i] == "--query":
                query = args[i + 1]
                i += 2
            elif args[i] == "--widths":
                widths = [int(w) for w in args[i + 1].split(",")]
                i += 2
            elif args[i] == "--state":
                state = args[i + 1]
                i += 2
            else:
                positional.append(args[i])
                i += 1
        shots(positional[0], positional[1:], query, widths, state)
