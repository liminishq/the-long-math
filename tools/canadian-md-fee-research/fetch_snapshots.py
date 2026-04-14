#!/usr/bin/env python3
"""
Download fee-related pages (and optional PDFs) for all Canadian MD faculties.

Why snapshots instead of parsing HTML:
  Official fee tables differ per site (HTML, PDF, multi-page). Saving raw
  responses gives you a dated archive to cite while you transcribe numbers
  into a spreadsheet for your essay.

Usage (from this directory):
  python fetch_snapshots.py
  python fetch_snapshots.py --output-dir ./snapshots/2026-04-14

Requires: Python 3.9+ (stdlib only — no pip packages).

TLS: If you see SSL certificate errors on some .ca sites (corporate proxy, custom
roots), re-run with --insecure-tls (data is still read over HTTPS, but host
verification is disabled — use only on a network you trust).
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_UA = (
    "Mozilla/5.0 (compatible; CanadianMDFeeResearch/1.0; +local research snapshot)"
)


def slugify(s: str) -> str:
    s = s.lower().strip()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-") or "file"


def load_schools(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def fetch_url(
    url: str,
    timeout: float,
    insecure_tls: bool,
) -> tuple[int, str | None, bytes]:
    ctx = ssl.create_default_context()
    if insecure_tls:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(
        url,
        headers={"User-Agent": DEFAULT_UA, "Accept": "*/*"},
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            status = resp.getcode() or 0
            ctype = resp.headers.get("Content-Type")
            body = resp.read()
            return status, ctype, body
    except urllib.error.HTTPError as e:
        body = e.read() if e.fp else b""
        return e.code, e.headers.get("Content-Type"), body
    except urllib.error.URLError as e:
        msg = str(e.reason) if e.reason else str(e)
        return 0, None, msg.encode("utf-8", errors="replace")


def extension_for(url: str, content_type: str | None, body: bytes) -> str:
    u = url.lower().split("?", 1)[0]
    if u.endswith(".pdf"):
        return ".pdf"
    if content_type and "pdf" in content_type.lower():
        return ".pdf"
    if body.startswith(b"%PDF"):
        return ".pdf"
    return ".html"


def main() -> int:
    ap = argparse.ArgumentParser(description="Snapshot Canadian MD fee pages.")
    ap.add_argument(
        "--schools",
        type=Path,
        default=Path(__file__).resolve().parent / "schools.json",
        help="Path to schools.json",
    )
    ap.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Output directory (default: ./snapshots/<UTC date>)",
    )
    ap.add_argument("--timeout", type=float, default=45.0)
    ap.add_argument(
        "--insecure-tls",
        action="store_true",
        help="Disable TLS certificate verification (only if your network MITMs TLS).",
    )
    args = ap.parse_args()

    data = load_schools(args.schools)
    utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    out: Path = args.output_dir or (Path(__file__).resolve().parent / "snapshots" / utc)
    out.mkdir(parents=True, exist_ok=True)

    manifest: list[dict[str, Any]] = []

    def record_one(school_id: str, label: str, url: str) -> None:
        status, ctype, body = fetch_url(url, args.timeout, args.insecure_tls)
        ext = extension_for(url, ctype, body)
        safe = slugify(f"{school_id}-{label}")
        fname = f"{safe}{ext}"
        fpath = out / fname
        fpath.write_bytes(body if isinstance(body, (bytes, bytearray)) else body)
        manifest.append(
            {
                "school_id": school_id,
                "label": label,
                "url": url,
                "saved_path": str(fpath.resolve()),
                "http_status": status,
                "content_type": ctype,
                "bytes": len(body) if isinstance(body, (bytes, bytearray)) else 0,
            }
        )
        print(f"[{status or 'ERR'}] {school_id}/{label} -> {fname}")

    for src in data.get("aggregate_sources", []):
        sid = src.get("id", "source")
        record_one(sid, "hub", src["url"])

    for sch in data.get("schools", []):
        sid = sch["id"]
        record_one(sid, "primary", sch["primary_url"])
        sec = sch.get("secondary_url")
        if sec:
            record_one(sid, "secondary", sec)

    manifest_path = out / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "generated_at_utc": datetime.now(timezone.utc).isoformat(),
                "entries": manifest,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"\nWrote {manifest_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
