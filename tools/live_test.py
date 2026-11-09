"""Live group and transit checks with a mocked ntfy.sh relay and a mocked Transitous answer.

Run: python tools/live_test.py   (prints PASS/FAIL lines, exit code 1 on any failure)
"""
import base64
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import shoot  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

REAL = "--real" in sys.argv  # use the public ntfy.sh relay instead of the mock
RELAY = []          # ntfy messages: {"id", "time", "event", "topic", "message"}
POSTS = []          # raw published bodies
results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail and not ok else ""))


def encode_polyline(points, precision=7):
    factor = 10 ** precision
    out = []
    prev = [0, 0]
    for lat, lon in points:
        for i, value in enumerate((lat, lon)):
            v = int(round(value * factor))
            delta = v - prev[i]
            prev[i] = v
            delta = ~(delta << 1) if delta < 0 else delta << 1
            while delta >= 0x20:
                out.append(chr((0x20 | (delta & 0x1F)) + 63))
                delta >>= 5
            out.append(chr(delta + 63))
    return "".join(out)


def relay_route(route):
    request = route.request
    url = request.url
    if request.method == "POST":
        body = request.post_data or ""
        POSTS.append(body)
        topic = url.rstrip("/").split("/")[-1]
        msg = {"id": f"m{len(RELAY) + 1}", "time": int(time.time()), "event": "message", "topic": topic, "message": body}
        RELAY.append(msg)
        route.fulfill(status=200, content_type="application/json", body=json.dumps(msg),
                      headers={"Access-Control-Allow-Origin": "*"})
        return
    topic = url.split("ntfy.sh/")[1].split("/")[0]
    lines = ["retry: 800", ""]
    for msg in RELAY:
        if msg["topic"] == topic:
            lines += [f"id: {msg['id']}", "data: " + json.dumps(msg), ""]
    route.fulfill(status=200, body="\n".join(lines) + "\n",
                  headers={"Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*"})


def transit_route(route):
    start = (1.12830, 104.05270)
    stop1 = (1.1300, 104.0500)
    stop2 = (1.1440, 104.0200)
    end = (1.1468, 104.0122)
    data = {
        "itineraries": [{
            "duration": 1980,
            "transfers": 0,
            "legs": [
                {"mode": "WALK", "duration": 240, "legGeometry": {"points": encode_polyline([start, stop1]), "precision": 7}},
                {"mode": "BUS", "routeShortName": "5", "duration": 1500, "legGeometry": {"points": encode_polyline([stop1, stop2]), "precision": 7}},
                {"mode": "WALK", "duration": 240, "legGeometry": {"points": encode_polyline([stop2, end]), "precision": 7}},
            ],
        }],
        "direct": [],
    }
    route.fulfill(status=200, content_type="application/json", body=json.dumps(data),
                  headers={"Access-Control-Allow-Origin": "*"})


def wait_for(page, expression, timeout_s=20):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if page.evaluate(expression):
            return True
        page.wait_for_timeout(300)
    return False


def main():
    server, port = shoot.serve()
    base = f"http://127.0.0.1:{port}/index.html"
    with sync_playwright() as pw:
        browser = shoot.launch(pw)

        # Phone A starts a live group.
        ctx_a = browser.new_context(geolocation={"latitude": 1.12830, "longitude": 104.05270}, permissions=["geolocation"])
        if not REAL:
            ctx_a.route("https://ntfy.sh/**", relay_route)
        page_a = ctx_a.new_page()
        errors = []
        page_a.on("pageerror", lambda e: errors.append(str(e)))
        page_a.goto(base, wait_until="domcontentloaded", timeout=60000)
        page_a.wait_for_selector("[data-live=form]")
        page_a.click("[data-live=form]")
        page_a.fill("#live-name", "Juwen")
        page_a.click(".live-go")
        ok = wait_for(page_a, "document.documentElement.dataset.live === 'on' && Meetline.state.people.some(p => p.isMe)")
        check("A starts a live group and shares its position", ok)
        invite = page_a.evaluate("location.href")
        check("invite link keeps room and key in the #fragment", "#live=" in invite and "?" not in invite.split("#")[0], invite)
        wait_for(page_a, "true", 1)
        if not REAL:
            check("A published an update", len(POSTS) >= 1, str(len(POSTS)))
        plain_leak = any("Juwen" in p or "104.05" in p or "1.128" in p for p in POSTS)
        if not REAL:
            check("relay only sees ciphertext (no name or coordinates)", POSTS and not plain_leak)

        # A message sealed with a different key must be ignored.
        topic = invite.split("#live=")[1].split(".")[0]
        bogus = base64.urlsafe_b64encode(bytes(range(60))).decode().rstrip("=")
        RELAY.append({"id": "bogus1", "time": int(time.time()), "event": "message", "topic": "meetline-" + topic, "message": bogus})

        # Phone B opens the invite.
        ctx_b = browser.new_context(geolocation={"latitude": 1.14680, "longitude": 104.01220}, permissions=["geolocation"])
        if not REAL:
            ctx_b.route("https://ntfy.sh/**", relay_route)
        page_b = ctx_b.new_page()
        page_b.on("pageerror", lambda e: errors.append(str(e)))
        page_b.goto(invite, wait_until="domcontentloaded", timeout=60000)
        ok = wait_for(page_b, "Meetline.state.people.some(p => p.name === 'Juwen' && p.liveId)")
        check("B sees A's live position after decrypting", ok)
        check("B is offered the join form", page_b.evaluate("document.documentElement.dataset.live") == "join")
        check("forged message ignored", page_b.evaluate("Meetline.state.people.length") == 1,
              str(page_b.evaluate("Meetline.state.people.map(p => p.name)")))
        badge = page_b.inner_text("#people")
        check("live badge shown on A's row", "live" in badge.lower(), badge[:120])
        page_b.fill("#live-name", "Sari")
        page_b.click(".live-go")
        ok = wait_for(page_b, "document.documentElement.dataset.live === 'on' && Meetline.state.people.length === 2")
        check("B joins and both people are in B's group", ok)

        ok = wait_for(page_a, "Meetline.state.people.some(p => p.name === 'Sari' && p.liveId)", 25)
        check("A receives B's live position", ok)
        bar = page_a.inner_text("#live")
        check("A's bar counts 2 sharing", "2 sharing" in bar, bar)

        page_b.click("[data-live=leave]")
        ok = wait_for(page_a, "!Meetline.state.people.some(p => p.name === 'Sari')", 25)
        check("B leaving removes B from A's group", ok)
        check("B's page returned to a normal plan", page_b.evaluate("document.documentElement.dataset.live") == "off")
        check("no page errors during live flow", not errors, "; ".join(errors[:3]))
        ctx_a.close()
        ctx_b.close()

        # Transit: timetable answer replaces the road estimate and is described in the leg row.
        ctx_t = browser.new_context()
        ctx_t.route("https://api.transitous.org/**", transit_route)
        page_t = ctx_t.new_page()
        terrors = []
        page_t.on("pageerror", lambda e: terrors.append(str(e)))
        page_t.goto(base + "#p=Andi~1.12830~104.05270~transit|Sari~1.14680~104.01220~car&cat=point&obj=fair", wait_until="domcontentloaded", timeout=60000)
        ok = wait_for(page_t, "document.documentElement.dataset.ready === 'true'", 60)
        check("transit plan renders", ok)
        legs = page_t.inner_text("#detail") if ok else ""
        check("transit leg shows the bus line and walking", "Bus 5" in legs and "min walk" in legs, legs[:200])
        andi_time = page_t.evaluate("(() => { const r = Object.values(Meetline.state.routes)[0]; return r && r.duration; })()")
        check("transit time comes from the timetable (33 min)", andi_time == 1980, str(andi_time))
        modes = page_t.evaluate("document.querySelectorAll('.person')[0].querySelectorAll('.mode-btn').length")
        check("four travel modes per person", modes == 4, str(modes))
        check("no page errors during transit flow", not terrors, "; ".join(terrors[:3]))
        browser.close()
    server.shutdown()
    failed = results.count(False)
    print(f"{len(results) - failed}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
