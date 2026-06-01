"""
Probe script — investigates alternative data sources before resorting to OCR.

Checks:
  1. HLS manifest (.m3u8) — looks for custom EXT-X tags or timed metadata
  2. .ts segment        — scans for ID3 tags, SCTE-35 markers, or JSON data
  3. Common API paths   — tries likely REST/JSON endpoints on the same domains
  4. WebSocket hints    — prints instructions to find WS from browser DevTools

Usage:
    source venv/bin/activate
    python3 probe.py
"""

import io
import re
import json
import struct
import requests
import m3u8

STREAM_URL = "https://8s.genesis01.live/hls100/stream1.m3u8"

# Full browser headers — identical to what Chrome sends when loading the stream
HEADERS = {
    "Referer":                   "https://genesis02.site/",
    "Origin":                    "https://genesis02.site",
    "User-Agent":                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept":                    "*/*",
    "Accept-Language":           "en-US,en;q=0.9",
    "Accept-Encoding":           "gzip, deflate, br",
    "Connection":                "keep-alive",
    "Sec-Fetch-Dest":            "empty",
    "Sec-Fetch-Mode":            "cors",
    "Sec-Fetch-Site":            "cross-site",
    "Sec-Ch-Ua":                 '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile":          "?0",
    "Sec-Ch-Ua-Platform":        '"Windows"',
}

SEP  = "─" * 60
TICK = "  ✅"
CROSS= "  ❌"
WARN = "  ⚠️ "
INFO = "  ℹ️ "

def section(title):
    print(f"\n{'━' * 60}")
    print(f"  {title}")
    print('━' * 60)

# ── 1. HLS Manifest ───────────────────────────────────────────────────────────

def probe_manifest():
    section("1. HLS MANIFEST — looking for custom tags")
    try:
        resp = requests.get(STREAM_URL, headers=HEADERS, timeout=8)
        resp.raise_for_status()
        raw = resp.text
        print(f"{TICK} Fetched manifest ({len(raw)} bytes)\n")

        playlist = m3u8.loads(raw, uri=STREAM_URL)

        # Variant playlist → follow first stream
        if playlist.is_variant:
            print(f"{INFO} Master playlist — following first variant…")
            variant_url = playlist.playlists[0].absolute_uri
            resp2 = requests.get(variant_url, headers=HEADERS, timeout=8)
            raw = resp2.text
            playlist = m3u8.loads(raw, uri=variant_url)

        print("  All tags found in manifest:")
        for line in raw.splitlines():
            if line.startswith("#"):
                print(f"    {line}")

        # Known metadata indicators
        has_daterange    = "#EXT-X-DATERANGE"      in raw
        has_scte35       = "#EXT-X-SCTE35"         in raw
        has_custom       = bool(re.search(r"#EXT-X-(?!TARGETDURATION|VERSION|MEDIA-SEQUENCE|DISCONTINUITY|PROGRAM-DATE-TIME|KEY|STREAM-INF|PLAYLIST-TYPE|ENDLIST|ALLOW-CACHE|INDEPENDENT-SEGMENTS|MAP)", raw))

        print()
        print(f"{'  EXT-X-DATERANGE (timed metadata)':<45} {'✅' if has_daterange else '❌'}")
        print(f"{'  EXT-X-SCTE35 (ad/event markers)':<45} {'✅' if has_scte35 else '❌'}")
        print(f"{'  Custom EXT-X tags':<45} {'✅' if has_custom else '❌'}")

        return playlist

    except Exception as e:
        print(f"{CROSS} Manifest fetch failed: {e}")
        return None

# ── 2. .ts Segment — ID3 / raw data scan ─────────────────────────────────────

def probe_segment(playlist):
    section("2. .ts SEGMENT — scanning for embedded data")
    if not playlist or not playlist.segments:
        print(f"{CROSS} No segments to probe")
        return

    seg_url = playlist.segments[-1].absolute_uri
    print(f"{INFO} Downloading segment: {seg_url}")
    try:
        resp = requests.get(seg_url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        data = resp.content
        print(f"{TICK} Downloaded {len(data):,} bytes\n")

        # ID3 tag signature: "ID3"
        id3_offsets = [i for i in range(len(data) - 3) if data[i:i+3] == b"ID3"]
        print(f"{'  ID3 tags found':<45} {'✅  at offsets: ' + str(id3_offsets) if id3_offsets else '❌'}")

        if id3_offsets:
            for off in id3_offsets[:3]:
                chunk = data[off:off+512]
                printable = "".join(chr(b) if 32 <= b < 127 else "." for b in chunk)
                print(f"    [{off}] {printable[:120]}")

        # SCTE-35 splice info
        scte_sig = bytes([0xFC, 0x30])
        has_scte = scte_sig in data
        print(f"{'  SCTE-35 splice markers':<45} {'✅' if has_scte else '❌'}")

        # JSON-like content anywhere in segment
        json_matches = re.findall(rb'\{[^\x00]{10,200}\}', data)
        printable_json = [m for m in json_matches if all(32 <= b < 127 for b in m)]
        print(f"{'  JSON-like strings':<45} {'✅' if printable_json else '❌'}")
        for m in printable_json[:3]:
            print(f"    {m.decode(errors='replace')[:120]}")

        # Any readable ASCII blocks > 20 chars
        ascii_blocks = re.findall(rb'[ -~]{20,}', data)
        interesting = [b for b in ascii_blocks if any(kw in b.lower() for kw in [b"game", b"fight", b"meron", b"wala", b"status", b"odd"])]
        print(f"{'  Game-related text strings':<45} {'✅' if interesting else '❌'}")
        for b in interesting[:5]:
            print(f"    {b.decode(errors='replace')[:120]}")

    except Exception as e:
        print(f"{CROSS} Segment probe failed: {e}")

# ── 3. Common API paths on the same domains ───────────────────────────────────

def probe_endpoints():
    section("3. COMMON API ENDPOINTS — scanning same domains")

    candidates = [
        # Same path prefix as the stream (/hls100/)
        "https://8s.genesis01.live/hls100/status.json",
        "https://8s.genesis01.live/hls100/game.json",
        "https://8s.genesis01.live/hls100/data.json",
        "https://8s.genesis01.live/hls100/info.json",
        "https://8s.genesis01.live/hls100/odds.json",
        # Root level
        "https://8s.genesis01.live/status.json",
        "https://8s.genesis01.live/game.json",
        "https://8s.genesis01.live/data.json",
        "https://8s.genesis01.live/info.json",
        # API paths
        "https://8s.genesis01.live/api/status",
        "https://8s.genesis01.live/api/game",
        "https://8s.genesis01.live/api/odds",
        "https://8s.genesis01.live/api/live",
        "https://8s.genesis01.live/api/info",
        # genesis02.site paths
        "https://genesis02.site/api/status",
        "https://genesis02.site/api/game",
        "https://genesis02.site/api/game_status",
        "https://genesis02.site/api/odds",
        "https://genesis02.site/api/live",
        "https://genesis02.site/status.json",
        "https://genesis02.site/play/game_status.php",
        "https://genesis02.site/game_status.php",
        "https://genesis02.site/live/status",
        "https://genesis02.site/live/game",
    ]

    found = []
    for url in candidates:
        try:
            resp = requests.get(url, headers=HEADERS, timeout=5)
            ct      = resp.headers.get("Content-Type", "")
            preview = resp.text[:200].replace("\n", " ").strip()
            if resp.status_code == 200:
                print(f"{TICK} {resp.status_code}  {url}")
                print(f"       Content-Type : {ct}")
                print(f"       Preview      : {preview}")
                found.append(url)
            else:
                # Still show body — a 403 might reveal the real path or auth hint
                print(f"{CROSS} {resp.status_code}  {url}")
                if preview and len(preview) > 5:
                    print(f"       Body         : {preview[:120]}")
        except Exception as e:
            print(f"{WARN} ERR  {url}  ({type(e).__name__})")

    return found

# ── 4. WebSocket hint ─────────────────────────────────────────────────────────

def print_websocket_hint():
    section("4. WEBSOCKET — how to check manually")
    print(f"""
  Open genesis02.site in Chrome, then:
    1. DevTools (F12) → Network tab
    2. Filter by "WS" (WebSocket)
    3. Reload the page
    4. Click any WS connection → Messages tab
    5. If you see game data flowing → paste the wss:// URL here

  Also check:
    1. Network tab → filter "XHR" or "Fetch"
    2. Look for requests returning JSON with fight/odds/status
    3. Paste the URL here — we can replicate it in Python directly
""")

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\n{'━' * 60}")
    print("  SABONG LIVE — DATA SOURCE PROBE")
    print(f"{'━' * 60}")

    playlist = probe_manifest()
    probe_segment(playlist)
    found    = probe_endpoints()

    print_websocket_hint()

    section("SUMMARY")
    if found:
        print(f"{TICK} Live API endpoints found:")
        for u in found:
            print(f"    {u}")
    else:
        print(f"{CROSS} No live API endpoints found on genesis domains")
        print(f"{INFO} OCR remains the best available approach")
    print()
