"""
Sabong Live — Python OCR detector
Reads HLS stream directly (no proxy needed), detects fight#, odds, and result.

Usage:
    source venv/bin/activate
    pip install -r requirements.txt
    python3 detect.py
"""

import io
import re
import time
import sys
from pathlib import Path

import av
import m3u8
import numpy as np
import requests
import easyocr
from PIL import Image  # pip install Pillow

# ── Stream config ─────────────────────────────────────────────────────────────

STREAM_URL = "https://8s.genesis01.live/hls100/stream1.m3u8"
HEADERS = {
    "Referer":    "https://genesis02.site/",
    "Origin":     "https://genesis02.site",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
}
POLL_EVERY  = 2.0   # seconds between detections
DEBUG       = True  # saves cropped images to debug/ folder so you can inspect what OCR sees
DEBUG_DIR   = Path(__file__).parent / "debug"

# ── OCR regions (mirrors OCR_REGIONS in useVideoOCR.ts) ──────────────────────
# (x, y, w, h) as fractions of frame size

REGIONS = {
    "meron":  (0.04, 0.77, 0.30, 0.21),
    "fight":  (0.40, 0.77, 0.22, 0.21),
    "wala":   (0.68, 0.77, 0.28, 0.21),
    "result": (0.17, 0.08, 0.65, 0.55),
}

# ── HLS helpers ───────────────────────────────────────────────────────────────

def get_latest_segment_url() -> str | None:
    """Parse the m3u8 playlist and return the URL of the latest segment."""
    try:
        resp = requests.get(STREAM_URL, headers=HEADERS, timeout=8)
        resp.raise_for_status()
        playlist = m3u8.loads(resp.text, uri=STREAM_URL)

        # Handle master playlist → pick first variant stream
        if playlist.is_variant:
            variant_url = playlist.playlists[0].absolute_uri
            resp = requests.get(variant_url, headers=HEADERS, timeout=8)
            playlist = m3u8.loads(resp.text, uri=variant_url)

        if not playlist.segments:
            return None
        return playlist.segments[-1].absolute_uri
    except Exception as e:
        print(f"[warn] Playlist fetch failed: {e}")
        return None


def download_segment(url: str) -> bytes | None:
    """Download a .ts segment and return raw bytes."""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=10)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        print(f"[warn] Segment download failed: {e}")
        return None


def decode_first_frame(ts_bytes: bytes) -> np.ndarray | None:
    """Decode the first video frame from a .ts segment into a BGR numpy array."""
    try:
        buf = io.BytesIO(ts_bytes)
        container = av.open(buf, format="mpegts")
        for frame in container.decode(video=0):
            # Convert to BGR (OpenCV convention) for our color filters
            rgb = frame.to_ndarray(format="rgb24")
            return rgb[:, :, ::-1]  # RGB → BGR
    except Exception as e:
        print(f"[warn] Frame decode failed: {e}")
    return None

# ── Image helpers ─────────────────────────────────────────────────────────────

def crop(frame: np.ndarray, region: tuple) -> np.ndarray:
    h, w = frame.shape[:2]
    x, y, rw, rh = region
    x1, y1 = int(x * w),        int(y * h)
    x2, y2 = int((x + rw) * w), int((y + rh) * h)
    return frame[y1:y2, x1:x2]


def filter_color(frame: np.ndarray, color: str) -> np.ndarray:
    """
    Keep only pixels matching the target color → black on white background.
    Mirrors filterByColor() in useVideoOCR.ts.
    """
    b = frame[:, :, 0].astype(np.float32)
    g = frame[:, :, 1].astype(np.float32)
    r = frame[:, :, 2].astype(np.float32)

    if color == "red":
        mask = (r > 140) & (r > g * 1.6) & (r > b * 1.6)
    elif color == "green":
        mask = (g > 100) & (g > r * 1.3) & (g > b * 1.0)
    else:  # blue / purple
        mask = ((b > 120) & (b > g * 1.4)) | ((r > 100) & (b > 120) & (g < 100))

    out = np.full(frame.shape[:2], 255, dtype=np.uint8)
    out[mask] = 0
    return out


# ── OCR ───────────────────────────────────────────────────────────────────────

def ocr_digits(reader: easyocr.Reader, img: np.ndarray) -> str:
    results = reader.readtext(img, allowlist="0123456789", detail=0)
    text = " ".join(results)
    # Take only the first contiguous digit sequence — ignores any leaked team-name digits
    match = re.search(r"\d+", text)
    return match.group() if match else ""


def ocr_text(reader: easyocr.Reader, img: np.ndarray) -> str:
    results = reader.readtext(img, allowlist="MERONWLADTAWIC ", detail=0)
    return " ".join(results).upper()


def detect_winner(text: str) -> str | None:
    t = text.replace(" ", "")
    if "CANCEL" in t: return "Cancel"
    if "MERON"  in t: return "Meron"
    if "WALA"   in t: return "Wala"
    return None


def infer_status(fight_no, meron_odds, wala_odds, winner) -> str:
    if winner == "Cancel":                    return "CANCELLED"
    if winner:                                return "CLOSED"
    if fight_no and meron_odds and wala_odds: return "OPEN"
    if fight_no:                              return "WAITING"
    return "UNKNOWN"


# ── Terminal colours ──────────────────────────────────────────────────────────

R  = "\033[31m"   # red
G  = "\033[32m"   # green
B  = "\033[34m"   # blue
Y  = "\033[33m"   # yellow
M  = "\033[35m"   # magenta
C  = "\033[36m"   # cyan
W  = "\033[37m"   # white
DIM= "\033[2m"    # dim
BD = "\033[1m"    # bold
RS = "\033[0m"    # reset

STATUS_STYLE = {
    "OPEN":      f"{BD}{G}",
    "WAITING":   f"{BD}{Y}",
    "CLOSED":    f"{BD}{R}",
    "CANCELLED": f"{BD}{M}",
    "UNKNOWN":   f"{DIM}{W}",
}

WINNER_STYLE = {
    "Meron":  f"{BD}{R}",
    "Wala":   f"{BD}{B}",
    "Cancel": f"{BD}{M}",
}

def print_banner():
    print(f"\n{BD}{C}{'━' * 52}{RS}")
    print(f"{BD}{C}  🐓  SABONG LIVE — OCR DETECTOR{RS}")
    print(f"{BD}{C}{'━' * 52}{RS}\n")
    print(f"  {BD}Stream :{RS} {DIM}{STREAM_URL}{RS}")
    print(f"  {BD}Poll   :{RS} every {POLL_EVERY}s\n")
    print(f"  {BD}Possible results:{RS}")
    print(f"    {G}● OPEN{RS}       — Betting open, odds visible")
    print(f"    {Y}● WAITING{RS}    — Fight in progress")
    print(f"    {R}● CLOSED{RS}     — {R}Meron{RS} or {B}Wala{RS} wins")
    print(f"    {M}● CANCELLED{RS}  — Match cancelled")
    print(f"    {DIM}● UNKNOWN{RS}    — Transitioning / no data yet")
    print(f"\n{BD}{C}{'━' * 52}{RS}\n")

def print_detection(fight_no, meron_odds, wala_odds, winner, status, ts):
    s = STATUS_STYLE.get(status, DIM)

    # Pad raw values BEFORE applying colors so alignment is correct
    f_val = (fight_no   or "---" ).center(10)
    m_val = (meron_odds or "----").center(12)
    w_val = (wala_odds  or "----").center(12)
    t_val = ts.ljust(10)
    st_val = status.ljust(11)

    print(f"  ┌────────────────────────────────────────────────┐")
    print(f"  │  {DIM}{t_val}{RS}              {s}● {BD}{st_val}{RS}        │")
    print(f"  ├────────────┬──────────────┬────────────────────┤")
    print(f"  │  {'FIGHT #':^10}  │  {'MERON':^12}  │  {'WALA':^12}      │")
    print(f"  │  {G}{BD}{f_val}{RS}  │  {R}{BD}{m_val}{RS}  │  {B}{BD}{w_val}{RS}      │")
    if winner:
        w = WINNER_STYLE.get(winner, BD)
        result_text = f"🏆  {winner.upper()} WIN"
        print(f"  ├────────────────────────────────────────────────┤")
        print(f"  │  {w}{BD}{result_text:<46}{RS}│")
    print(f"  └────────────┴──────────────┴────────────────────┘")
    print()

# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    print(f"\n{DIM}Loading EasyOCR model (first run downloads ~100 MB)…{RS}")
    reader = easyocr.Reader(["en"], gpu=False, verbose=False)
    print(f"{G}EasyOCR ready.{RS}")

    print_banner()
    print(f"  {DIM}Press Ctrl+C to stop.{RS}\n")

    last_seg_url = ""

    while True:
        seg_url = get_latest_segment_url()
        if not seg_url:
            time.sleep(2)
            continue

        # Skip if we already processed this segment
        if seg_url == last_seg_url:
            time.sleep(0.5)
            continue
        last_seg_url = seg_url

        ts_bytes = download_segment(seg_url)
        if not ts_bytes:
            time.sleep(2)
            continue

        frame = decode_first_frame(ts_bytes)
        if frame is None:
            time.sleep(2)
            continue

        # Crop + color-filter → OCR
        meron_img  = filter_color(crop(frame, REGIONS["meron"]),  "red")
        fight_img  = filter_color(crop(frame, REGIONS["fight"]),  "green")
        wala_img   = filter_color(crop(frame, REGIONS["wala"]),   "blue")
        result_img = crop(frame, REGIONS["result"])

        # Raw OCR text (before digit extraction) — helps diagnose wrong reads
        raw_meron  = " ".join(reader.readtext(meron_img,  detail=0))
        raw_fight  = " ".join(reader.readtext(fight_img,  detail=0))
        raw_wala   = " ".join(reader.readtext(wala_img,   detail=0))
        raw_result = ocr_text(reader, result_img)

        def first_number(s: str) -> str:
            m = re.search(r"\d+", s)
            return m.group() if m else ""

        meron_odds = first_number(raw_meron)
        fight_no   = first_number(raw_fight)
        wala_odds  = first_number(raw_wala)
        winner     = detect_winner(raw_result)
        status     = infer_status(fight_no, meron_odds, wala_odds, winner)

        if DEBUG:
            DEBUG_DIR.mkdir(exist_ok=True)
            # Save the color-filtered crops (what EasyOCR actually reads)
            Image.fromarray(meron_img).save(DEBUG_DIR / "meron.png")
            Image.fromarray(fight_img).save(DEBUG_DIR / "fight.png")
            Image.fromarray(wala_img).save(DEBUG_DIR / "wala.png")
            # Save the result region in colour
            Image.fromarray(result_img[:, :, ::-1]).save(DEBUG_DIR / "result.png")
            # Save the full frame
            Image.fromarray(frame[:, :, ::-1]).save(DEBUG_DIR / "frame.png")

        ts = time.strftime("%H:%M:%S")
        print_detection(fight_no, meron_odds, wala_odds, winner, status, ts)

        if DEBUG and raw_result:
            print(f"  {DIM}  raw: {raw_result}{RS}")

        time.sleep(POLL_EVERY)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{Y}Detector stopped.{RS}\n")
