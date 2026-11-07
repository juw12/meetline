"""Run Meetline checks in headless Chrome.

  python tools/run_tests.py          # geo unit tests + empty state + snapshot demo
  python tools/run_tests.py --live   # also runs ?demo=live against real OSM / OSRM (needs network)

Prints a JSON report; exit code 1 if anything fails.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from shoot import launch, serve, wait_ready  # noqa: E402


def collect_errors(page):
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(str(exc)))
    page.on("requestfailed", lambda req: errors.append("request failed: " + req.url))
    return errors


def main():
    from playwright.sync_api import sync_playwright

    live = "--live" in sys.argv
    server, port = serve()
    base = f"http://127.0.0.1:{port}"
    report = {}
    ok = True
    with sync_playwright() as playwright:
        browser = launch(playwright)

        page = browser.new_page()
        errors = collect_errors(page)
        page.goto(base + "/tests/geo.test.html", wait_until="load")
        results = page.evaluate("window.TEST_RESULTS")
        report["geo"] = {
            "total": results["total"],
            "failed": results["failed"],
            "failures": [r for r in results["results"] if not r["pass"]],
            "errors": errors,
        }
        ok = ok and results["failed"] == 0 and not errors

        page = browser.new_page(viewport={"width": 390, "height": 844})
        errors = collect_errors(page)
        page.goto(base + "/index.html", wait_until="domcontentloaded")
        page.wait_for_timeout(2500)
        empty = page.evaluate(
            "({people: document.documentElement.dataset.people,"
            " emptyVisible: !document.getElementById('empty').hidden,"
            " need: document.getElementById('empty-need').textContent,"
            " detailHidden: document.getElementById('detail').hidden})"
        )
        report["empty"] = dict(empty, errors=[e for e in errors if "tile.openstreetmap" not in e])
        ok = ok and empty["emptyVisible"] and empty["detailHidden"] and not report["empty"]["errors"]

        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = collect_errors(page)
        page.goto(base + "/index.html?demo", wait_until="domcontentloaded")
        ready = wait_ready(page, 45)
        demo = page.evaluate(
            "({count: document.getElementById('people-count').textContent,"
            " venues: document.querySelectorAll('#results .venue').length,"
            " routes: document.querySelectorAll('.leaflet-overlay-pane path').length,"
            " meet: (document.querySelector('.detail-name, #detail h2, #detail h3') || {}).textContent || ''})"
        )
        report["demo"] = dict(demo, ready=ready, errors=errors)
        ok = ok and ready and demo["venues"] >= 3 and demo["routes"] >= 3 and not errors

        if live:
            page = browser.new_page(viewport={"width": 1440, "height": 900})
            errors = collect_errors(page)
            started = time.time()
            page.goto(base + "/index.html?demo=live", wait_until="domcontentloaded")
            ready = wait_ready(page, 150)
            status = page.evaluate("(document.getElementById('status') || {}).textContent || ''")
            venues = page.evaluate(
                "Array.from(document.querySelectorAll('#results .venue-name')).map(n => n.textContent)"
            )
            report["live"] = {
                "ready": ready,
                "seconds": round(time.time() - started, 1),
                "venues": venues,
                "status": status.strip(),
                "errors": errors,
            }
            ok = ok and ready and len(venues) >= 1

        browser.close()
    report["ok"] = ok
    print(json.dumps(report, indent=1, ensure_ascii=False), flush=True)
    os._exit(0 if ok else 1)


if __name__ == "__main__":
    main()
