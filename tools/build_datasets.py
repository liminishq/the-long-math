#!/usr/bin/env python3
"""
Build local, validated JSON datasets for The Long Math calculators.

Outputs JSON schema:
{
  "source": "...",
  "frequency": "monthly",
  "start": "YYYY-MM",
  "end": "YYYY-MM",
  "series": [{"date":"YYYY-MM","value": <number>}]
}

Commands:
  boc <SERIES_ID> <OUT_JSON> [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--agg mean|last]
  shiller <IE_DATA_XLS_PATH> <OUT_JSON>

Requires: pandas, requests, openpyxl (installed commonly), xlrd may be required for .xls on some setups.
"""

import argparse
import json
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Literal

import pandas as pd
import requests


BOC_VALET_OBS_CSV = "https://www.bankofcanada.ca/valet/observations/{series}/csv"

AggMode = Literal["mean", "last"]


def _to_month(dt: pd.Timestamp) -> str:
    return f"{dt.year:04d}-{dt.month:02d}"


def _ensure_finite(x) -> Optional[float]:
    try:
        v = float(x)
    except Exception:
        return None
    if not math.isfinite(v):
        return None
    return v


def fetch_boc_csv(series: str, start: Optional[str], end: Optional[str]) -> pd.DataFrame:
    params = {}
    if start:
        params["start_date"] = start
    if end:
        params["end_date"] = end

    url = BOC_VALET_OBS_CSV.format(series=series)
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()

    text = r.text
    lines = text.splitlines()

    # Find the real CSV header row that starts the observation table.
    # Bank of Canada Valet CSV often includes metadata lines first.
    header_idx = None
    for i, line in enumerate(lines[:200]):
        s = line.strip().strip('"')
        # Accept common forms: date,FXUSDCAD  OR  "date","FXUSDCAD"
        if s.startswith("date,") or s.startswith('date","') or s.startswith('"date",') or s.startswith("date;"):
            header_idx = i
            break

    if header_idx is None:
        # Helpful debug: show first few lines
        preview = "\n".join(lines[:15])
        raise ValueError(f"Could not locate data header in BOC CSV for {series}. First lines:\n{preview}")

    from io import StringIO
    data_block = "\n".join(lines[header_idx:])

    # Use python engine for robustness
    df = pd.read_csv(StringIO(data_block), engine="python")

    # Normalize column names (strip quotes/whitespace)
    df.columns = [str(c).strip().strip('"') for c in df.columns]

    return df


def boc_to_monthly(series: str, start: Optional[str], end: Optional[str], agg: AggMode) -> list[dict]:
    df = fetch_boc_csv(series, start, end)

    if "date" not in df.columns or series not in df.columns:
        raise ValueError(f"Unexpected BOC CSV columns for {series}: {df.columns.tolist()}")

    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["value"] = df[series].apply(_ensure_finite)

    df = df.dropna(subset=["date"])
    df = df.dropna(subset=["value"])

    if df.empty:
        raise ValueError(f"No valid observations after cleaning for {series}")

    df["month"] = df["date"].dt.to_period("M").dt.to_timestamp()

    if agg == "mean":
        m = df.groupby("month", as_index=False)["value"].mean()
    elif agg == "last":
        m = df.sort_values("date").groupby("month", as_index=False)["value"].last()
    else:
        raise ValueError("agg must be mean or last")

    series_out = [{"date": _to_month(row["month"]), "value": float(row["value"])} for _, row in m.iterrows()]
    return series_out


def shiller_parse_monthly_tr(xls_path: str) -> list[dict]:
    """
    Reads Shiller 'ie_data.xls' and builds a simple monthly total return index:
      TR_0 = 1.0
      TR_t = TR_{t-1} * (P_t + D_t) / P_{t-1}
    Using Shiller columns:
      - Date (year.fraction) in first column
      - P (price)
      - D (dividend)
    Exact column names can vary; we search for likely headers.
    """
    # read_excel may require xlrd for .xls; if it fails, user can re-save as .xlsx
    df = pd.read_excel(xls_path, sheet_name=0)

    # Find date column (often named 'Date' or similar)
    date_col = None
    for c in df.columns:
        if str(c).strip().lower().startswith("date"):
            date_col = c
            break
    if date_col is None:
        # Sometimes first column is the date
        date_col = df.columns[0]

    # Find price/dividend columns
    def _find_col(candidates):
        for cand in candidates:
            for c in df.columns:
                if str(c).strip().lower() == cand:
                    return c
        # fallback: contains match
        for cand in candidates:
            for c in df.columns:
                if cand in str(c).strip().lower():
                    return c
        return None

    p_col = _find_col(["p", "price"])
    d_col = _find_col(["d", "dividend"])

    if p_col is None or d_col is None:
        raise ValueError(f"Could not find price/dividend columns. Found columns: {df.columns.tolist()}")

    # Clean numeric rows
    tmp = df[[date_col, p_col, d_col]].copy()
    tmp.columns = ["date_frac", "P", "D"]

    tmp["P"] = tmp["P"].apply(_ensure_finite)
    tmp["D"] = tmp["D"].apply(_ensure_finite)
    tmp["date_frac"] = tmp["date_frac"].apply(_ensure_finite)
    tmp = tmp.dropna(subset=["date_frac", "P", "D"])

    if tmp.empty:
        raise ValueError("Shiller sheet parsed but no valid rows remained after cleaning.")

    # Convert year.fraction -> month
    # year.fraction is typically like 1871.01, 1871.02 ... representing months.
    # We'll map fractional part to month by rounding to nearest integer month.
    def frac_to_ym(yf: float) -> str:
        year = int(yf)
        frac = yf - year
        # Shiller often encodes months as .01.. .12
        m = int(round(frac * 100))
        if m < 1 or m > 12:
            # fallback: approximate from fraction of year
            m = int(round(frac * 12)) + 1
            m = min(12, max(1, m))
        return f"{year:04d}-{m:02d}"

    tmp["ym"] = tmp["date_frac"].apply(frac_to_ym)
    tmp = tmp.sort_values("ym")

    # Build TR index
    tr = []
    prev_p = None
    tr_val = 1.0
    for _, row in tmp.iterrows():
        p = row["P"]
        d = row["D"]
        ym = row["ym"]
        if prev_p is None:
            prev_p = p
            tr.append({"date": ym, "value": tr_val})
            continue
        if prev_p <= 0:
            raise ValueError("Encountered non-positive prior price in Shiller data.")
        tr_val = tr_val * ((p + d) / prev_p)
        prev_p = p
        tr.append({"date": ym, "value": float(tr_val)})

    # De-duplicate in case of repeats
    out = {}
    for pt in tr:
        out[pt["date"]] = pt["value"]
    series_out = [{"date": k, "value": out[k]} for k in sorted(out.keys())]
    return series_out


def write_json(out_path: str, source: str, frequency: str, series: list[dict]):
    if not series:
        raise ValueError("Refusing to write empty series.")
    start = series[0]["date"]
    end = series[-1]["date"]
    payload = {
        "source": source,
        "frequency": frequency,
        "start": start,
        "end": end,
        "series": series
    }
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Wrote {out_path} ({len(series)} points) [{start} → {end}]")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    ap_boc = sub.add_parser("boc", help="Download + convert a Bank of Canada Valet series to monthly JSON.")
    ap_boc.add_argument("series_id")
    ap_boc.add_argument("out_json")
    ap_boc.add_argument("--start", default=None, help="YYYY-MM-DD")
    ap_boc.add_argument("--end", default=None, help="YYYY-MM-DD")
    ap_boc.add_argument("--agg", default="mean", choices=["mean", "last"], help="Monthly aggregation method")

    ap_sh = sub.add_parser("shiller", help="Convert Shiller ie_data.xls to a monthly total return index JSON.")
    ap_sh.add_argument("xls_path")
    ap_sh.add_argument("out_json")

    args = ap.parse_args()

    if args.cmd == "boc":
        series = boc_to_monthly(args.series_id, args.start, args.end, args.agg)
        write_json(args.out_json, source="Bank of Canada Valet API", frequency="monthly", series=series)
    elif args.cmd == "shiller":
        series = shiller_parse_monthly_tr(args.xls_path)
        write_json(args.out_json, source="Yale / Shiller (ie_data.xls)", frequency="monthly", series=series)


if __name__ == "__main__":
    main()
