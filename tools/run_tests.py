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
        # CDN scripts go through a proxy; allow slow loads instead of failing on a busy machine.
        browser_new_page = browser.new_page

        def new_page(**kwargs):
            created = browser_new_page(**kwargs)
            created.set_default_navigation_timeout(90000)
            created.set_default_timeout(90000)
            return created

        browser.new_page = new_page

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

        # Venue facts: serve the snapshot with known OSM tags on the top venue, then read the UI.
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        errors = collect_errors(page)

        snapshot_file = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "demo-snapshot.js")
        with open(snapshot_file, encoding="utf-8") as handle:
            patched_snapshot = handle.read().replace(
                '"id":"node6871176666","name":"toko juice",',
                '"id":"node6871176666","name":"toko juice","tags":{"opening_hours":"Mo-Su 00:00-24:00",'
                '"cuisine":"juice","website":"example.com"},',
            )

        def patch_snapshot(route):
            route.fulfill(status=200, content_type="application/javascript", body=patched_snapshot)

        page.route("**/demo-snapshot.js*", patch_snapshot)
        page.goto(base + "/index.html?demo", wait_until="domcontentloaded")
        facts_ready = wait_ready(page, 45)
        facts = page.evaluate(
            "({card: (document.querySelector('#results .venue-hours') || {}).textContent || '',"
            " detail: ((document.querySelector('#detail .detail-hours') || {}).textContent || '') + ' | ' + ((document.querySelector('#detail .detail-facts') || {}).textContent || ''),"
            " link: (document.querySelector('#detail .fact-link') || {}).href || ''})"
        )
        starbucks = page.evaluate(
            "(() => { const hit = Array.from(document.querySelectorAll('#results .venue'))"
            ".find(li => li.textContent.includes('Starbucks'));"
            " if (!hit) { return ''; } hit.querySelector('.venue-hit').click();"
            " return (document.querySelector('#detail .detail-facts') || {}).textContent || ''; })()"
        )
        report["facts"] = dict(facts, starbucks=starbucks, ready=facts_ready, errors=errors)
        ok = ok and facts_ready and not errors
        ok = ok and facts["card"] == "Open 24 hours"
        ok = ok and "Open 24 hours" in facts["detail"] and "Juice" in facts["detail"]
        ok = ok and facts["link"].startswith("https://example.com")
        ok = ok and "Coffee shop" in starbucks and "Takeaway" in starbucks

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
