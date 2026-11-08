"""Check that the Meetline live surfaces respond and mention the project."""
import os
import sys
import time
import urllib.request

PROXY = os.environ.get("HTTPS_PROXY", "http://localhost:3128")
URLS = [
    "https://juw12.github.io/meetline/",
    "https://juw12.github.io/p/meetline/",
    "https://juw12.github.io/p/",
    "https://juwenlie.pages.dev/",
]


def fetch(opener, url):
    separator = "&" if "?" in url else "?"
    request = urllib.request.Request(
        f"{url}{separator}cb={int(time.time())}",
        headers={"User-Agent": "Mozilla/5.0"},
    )
    try:
        with opener.open(request, timeout=20) as response:
            body = response.read().decode("utf-8", errors="replace")
            return response.status, body
    except Exception as error:
        return getattr(error, "code", type(error).__name__), ""


def main():
    use_proxy = "--direct" not in sys.argv
    handlers = []
    if use_proxy:
        handlers.append(urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    opener = urllib.request.build_opener(*handlers)
    for url in URLS:
        status, body = fetch(opener, url)
        mentions = "meetline" in body.lower()
        print(f"{status}  mentions_meetline={mentions}  bytes={len(body)}  {url}", flush=True)


if __name__ == "__main__":
    main()
