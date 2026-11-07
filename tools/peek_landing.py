"""Scroll a built landing page and capture a few viewport shots (checks sections below the fold render)."""
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

page_path = Path(sys.argv[1]).resolve()
out_dir = Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(executable_path=CHROME, args=["--proxy-server=http://localhost:3128", "--proxy-bypass-list=127.0.0.1;localhost;<local>"])
    for width, height in [(1280, 820), (390, 844)]:
        page = browser.new_page(viewport={"width": width, "height": height})
        page.goto(page_path.as_uri(), wait_until="load")
        total = page.evaluate("document.documentElement.scrollHeight")
        for index, fraction in enumerate([0.2, 0.45, 0.7]):
            page.evaluate(f"window.scrollTo(0, {int(total * fraction)})")
            page.wait_for_timeout(900)
            page.screenshot(path=str(out_dir / f"{width}-{index}.png"))
        page.close()
    browser.close()
print("ok", total)
