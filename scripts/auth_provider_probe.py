#!/usr/bin/env python3
import urllib.parse
import urllib.request
import urllib.error
import sys

PROJECT = "https://dlgzfcrwxrpqublvyxzn.supabase.co"
REDIRECT = "https://gabiarbex.github.io/an-album-a-day/"
url = PROJECT + "/auth/v1/authorize?" + urllib.parse.urlencode({
    "provider": "google",
    "redirect_to": REDIRECT,
})

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirect())
request = urllib.request.Request(url, headers={"User-Agent": "album-a-day-auth-probe/1.0"})

try:
    response = opener.open(request, timeout=30)
    status = response.status
    location = response.headers.get("Location", "")
except urllib.error.HTTPError as error:
    status = error.code
    location = error.headers.get("Location", "")
    body = error.read().decode("utf-8", "replace")[:1200]
    if status not in (301, 302, 303, 307, 308):
        print(f"unexpected HTTP {status}: {body}")
        sys.exit(1)
except Exception as error:
    print(f"request failed: {error}")
    sys.exit(1)

print(f"status={status}")
print(f"location={location}")

assert status in (301, 302, 303, 307, 308), status
parsed = urllib.parse.urlparse(location)
assert parsed.hostname in {"accounts.google.com", "accounts.googleusercontent.com"}, location

query = urllib.parse.parse_qs(parsed.query)
redirect_uri = (query.get("redirect_uri") or [""])[0]
assert redirect_uri == PROJECT + "/auth/v1/callback", redirect_uri

print("google oauth provider probe passed")
