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
import os
import glob
from dataclasses import dataclass
from datetime import datetime
from typing import Optional, Literal

import pandas as pd
import requests


BOC_VALET_OBS_CSV = "https://www.bankofcanada.ca/valet/observations/{series}/csv"
FRED_API_BASE = "https://api.stlouisfed.org/fred/series/observations"
# Note: FRED requires an API key. Get a free key from https://fred.stlouisfed.org/docs/api/api_key.html
# For testing, you can use "demo" but it has rate limits. Set your key as environment variable FRED_API_KEY
# or modify this constant.
FRED_API_KEY = os.environ.get("FRED_API_KEY", "demo")

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
      - Date (year.fraction)
      - P (price)
      - D (dividend)
    """
    # 1. Read sheet "Data" with header=None and nrows=50
    df_preview = pd.read_excel(xls_path, sheet_name="Data", header=None, nrows=50)
    
    # 2. Locate the header row r by finding the first row containing exact (case-insensitive) values "Date", "P", and "D"
    header_row = None
    for idx, row in df_preview.iterrows():
        # Convert row to list of strings (stripped, lowercased)
        row_values = [str(val).strip().lower() for val in row.values if pd.notna(val)]
        
        # Check if this row contains exact matches for "date", "p", and "d" (case-insensitive)
        has_date = "date" in row_values
        has_p = "p" in row_values
        has_d = "d" in row_values
        
        if has_date and has_p and has_d:
            header_row = idx
            break
    
    if header_row is None:
        # 7. If header row not found, raise ValueError that prints the first 15 rows (as lists)
        first_15_rows = []
        for idx in range(min(15, len(df_preview))):
            row = df_preview.iloc[idx]
            row_list = [str(val) if pd.notna(val) else "" for val in row.values]
            first_15_rows.append(f"Row {idx}: {row_list}")
        
        raise ValueError(
            f"Could not find header row with Date, P, D columns in sheet 'Data'.\n"
            f"First 15 rows:\n" + "\n".join(first_15_rows)
        )
    
    # 3. Re-read the same sheet with header=r so pandas uses that row for column names
    df = pd.read_excel(xls_path, sheet_name="Data", header=header_row)
    
    # 4. Map columns (case-insensitive matching)
    col_names_lower = {str(c).strip().lower(): c for c in df.columns}
    
    if "date" not in col_names_lower:
        raise ValueError(f"Column 'Date' not found in sheet 'Data' after header row {header_row}. Columns: {df.columns.tolist()}")
    if "p" not in col_names_lower:
        raise ValueError(f"Column 'P' not found in sheet 'Data' after header row {header_row}. Columns: {df.columns.tolist()}")
    if "d" not in col_names_lower:
        raise ValueError(f"Column 'D' not found in sheet 'Data' after header row {header_row}. Columns: {df.columns.tolist()}")
    
    date_col = col_names_lower["date"]
    p_col = col_names_lower["p"]
    d_col = col_names_lower["d"]
    
    # 5. Extract and clean data
    tmp = df[[date_col, p_col, d_col]].copy()
    tmp.columns = ["date_frac", "P", "D"]
    
    # Coerce Date/P/D to numeric (errors='coerce'), drop NaNs, require non-empty
    tmp["date_frac"] = pd.to_numeric(tmp["date_frac"], errors="coerce")
    tmp["P"] = pd.to_numeric(tmp["P"], errors="coerce")
    tmp["D"] = pd.to_numeric(tmp["D"], errors="coerce")
    
    # Drop rows where any are NaN
    tmp = tmp.dropna(subset=["date_frac", "P", "D"])
    
    # Require non-empty
    if tmp.empty:
        raise ValueError(
            f"After cleaning, no rows remain.\n"
            f"Detected header row: {header_row}\n"
            f"Detected columns: Date='{date_col}', P='{p_col}', D='{d_col}'"
        )
    
    # Ensure at least 1000 rows remain
    if len(tmp) < 1000:
        first_5_rows = tmp.head(5).to_dict('records')
        raise ValueError(
            f"After cleaning, only {len(tmp)} rows remain (expected >= 1000).\n"
            f"Detected header row: {header_row}\n"
            f"Detected columns: Date='{date_col}', P='{p_col}', D='{d_col}'\n"
            f"First 5 rows:\n{first_5_rows}"
        )
    
    # 6. Convert year.fraction -> month (keep existing conversion)
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
    
    # Build TR index: TR_t = TR_{t-1} * (P_t + D_t) / P_{t-1}
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
    
    if not series_out:
        raise ValueError("Shiller TR calculation produced empty series.")
    
    return series_out


def write_json(out_path: str, source: str, frequency: str, series: list[dict]):
    if not series:
        raise ValueError("Refusing to write empty series.")
    
    # Validation: Check length >= 100
    if len(series) < 100:
        raise ValueError(f"Series has only {len(series)} observations, expected >= 100 for long history")
    
    # Validation: Check dates are monotonic
    for i in range(1, len(series)):
        if series[i]["date"] <= series[i-1]["date"]:
            raise ValueError(f"Dates are not monotonic: {series[i-1]['date']} >= {series[i]['date']}")
    
    # Validation: Check for NaN/Infinity
    for item in series:
        if not math.isfinite(item["value"]):
            raise ValueError(f"Non-finite value found in series at {item['date']}: {item['value']}")
    
    start = series[0]["date"]
    end = series[-1]["date"]
    payload = {
        "source": source,
        "frequency": frequency,
        "start": start,
        "end": end,
        "series": series
    }
    
    # Ensure output directory exists
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"Wrote {out_path} ({len(series)} points) [{start} → {end}]")


def find_statcan_fx_csv(raw_dir: str = "tools/raw") -> str:
    """Find StatCan FX CSV file in raw directory."""
    if not os.path.exists(raw_dir):
        raise ValueError(f"Raw data directory not found: {raw_dir}")
    
    # Search for CSV files that might contain StatCan FX data
    patterns = [
        os.path.join(raw_dir, "**", "*.csv"),
        os.path.join(raw_dir, "*.csv")
    ]
    
    candidates = []
    for pattern in patterns:
        candidates.extend(glob.glob(pattern, recursive=True))
    
    if not candidates:
        raise ValueError(f"No CSV files found in {raw_dir}")
    
    # Try each CSV to find one with StatCan FX structure
    for csv_path in candidates:
        try:
            df = pd.read_csv(csv_path, nrows=10)
            # Check if it has StatCan FX structure: REF_DATE, VALUE, and SYMBOL columns
            has_ref_date = any("ref_date" in str(c).lower() for c in df.columns)
            has_value = "VALUE" in df.columns or "Value" in df.columns
            has_symbol = "SYMBOL" in df.columns
            
            if has_ref_date and has_value and has_symbol:
                return csv_path
        except Exception:
            continue
    
    raise ValueError(f"Could not find StatCan FX CSV file in {raw_dir}. Searched: {len(candidates)} files")


def read_fred_csv(csv_path: str) -> pd.DataFrame:
    """
    Read FRED CSV file (downloaded from FRED website).
    FRED CSV format: DATE,VALUE
    """
    if not os.path.exists(csv_path):
        raise FileNotFoundError(f"FRED CSV file not found: {csv_path}")
    
    df = pd.read_csv(csv_path)
    
    # FRED CSV typically has DATE and VALUE columns
    # Handle different possible column names
    date_col = None
    value_col = None
    
    for col in df.columns:
        col_lower = str(col).strip().lower()
        if col_lower in ("date", "observation_date"):
            date_col = col
        elif col_lower != "date" and col_lower != "observation_date":
            # Value column is any column that's not the date column
            value_col = col
            break
    
    # If value_col not found, use second column (after date)
    if value_col is None and len(df.columns) >= 2:
        value_col = df.columns[1]
    
    if date_col is None or value_col is None:
        raise ValueError(f"Could not find DATE and VALUE columns in {csv_path}. Columns: {df.columns.tolist()}")
    
    df = df[[date_col, value_col]].copy()
    df.columns = ["date", "value"]
    
    # FRED uses "." for missing values
    df = df[df["value"] != "."]
    
    if df.empty:
        raise ValueError(f"No valid observations after filtering in {csv_path}")
    
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    
    df = df.dropna(subset=["date", "value"])
    df = df.sort_values("date")
    
    return df


def fred_csv_to_monthly_index(csv_path: str, source_label: str, yield_to_return: bool = False, use_mean: bool = False) -> list[dict]:
    """
    Read FRED CSV and convert to monthly total return index.
    If yield_to_return is True, converts annual yield to monthly return and compounds.
    Otherwise, treats values as monthly returns or levels.
    If use_mean is True, uses monthly mean; otherwise uses last value of month.
    """
    df = read_fred_csv(csv_path)
    
    # Convert to monthly
    df["month"] = df["date"].dt.to_period("M").dt.to_timestamp()
    
    if yield_to_return:
        # Aggregate to monthly (mean of daily values for yields)
        monthly = df.groupby("month", as_index=False)["value"].mean()
        
        # Convert annual yield to monthly return: (1 + y/100)^(1/12) - 1
        monthly["monthly_return"] = monthly["value"].apply(
            lambda y: math.pow(1 + y / 100, 1/12) - 1 if y > 0 else 0
        )
        
        # Build cumulative index starting at 1.0
        index_value = 1.0
        series_out = []
        for _, row in monthly.iterrows():
            index_value *= (1 + row["monthly_return"])
            series_out.append({
                "date": _to_month(row["month"]),
                "value": float(index_value)
            })
    else:
        # For CPI and FX: aggregate to monthly
        if use_mean:
            monthly = df.groupby("month", as_index=False)["value"].mean()
        else:
            monthly = df.groupby("month", as_index=False)["value"].last()  # Use last value of month
        
        series_out = [
            {"date": _to_month(row["month"]), "value": float(row["value"])}
            for _, row in monthly.iterrows()
        ]
    
    return series_out


def build_equities_shiller(xls_path: str) -> list[dict]:
    """Build equities total return index from Shiller data."""
    series = shiller_parse_monthly_tr(xls_path)
    return series


def build_cpi_shiller(xls_path: str) -> list[dict]:
    """Build CPI index from Shiller data."""
    # 1. Read sheet "Data" with header=None, nrows=50
    try:
        df_preview = pd.read_excel(xls_path, sheet_name="Data", header=None, nrows=50)
    except Exception as e:
        # If "Data" sheet doesn't exist, show available sheets
        wb = pd.ExcelFile(xls_path)
        raise ValueError(
            f"Could not read sheet 'Data' from {xls_path}.\n"
            f"Available sheets: {wb.sheet_names}\n"
            f"Error: {e}"
        )
    
    # 2. Find header row r containing "Date" and "CPI" (case-insensitive exact match after stripping)
    header_row = None
    for idx, row in df_preview.iterrows():
        # Convert row to list of strings (stripped, lowercased)
        row_values = [str(val).strip().lower() for val in row.values if pd.notna(val)]
        
        # Check if this row contains exact matches for "date" and "cpi" (case-insensitive)
        has_date = "date" in row_values
        has_cpi = "cpi" in row_values
        
        if has_date and has_cpi:
            header_row = idx
            break
    
    if header_row is None:
        # 6. If header row not found, raise an error that prints sheet names and first 15 rows
        wb = pd.ExcelFile(xls_path)
        first_15_rows = []
        for idx in range(min(15, len(df_preview))):
            row = df_preview.iloc[idx]
            row_list = [str(val) if pd.notna(val) else "" for val in row.values]
            first_15_rows.append(f"Row {idx}: {row_list}")
        
        raise ValueError(
            f"Could not find header row with Date and CPI columns in sheet 'Data'.\n"
            f"Available sheets: {wb.sheet_names}\n"
            f"First 15 rows from 'Data' sheet:\n" + "\n".join(first_15_rows)
        )
    
    # Re-read sheet "Data" with header=r
    df = pd.read_excel(xls_path, sheet_name="Data", header=header_row)
    
    # 2. Column mapping (case-insensitive)
    col_names_lower = {str(c).strip().lower(): c for c in df.columns}
    
    if "date" not in col_names_lower:
        raise ValueError(f"Column 'Date' not found in sheet 'Data' after header row {header_row}. Columns: {df.columns.tolist()}")
    if "cpi" not in col_names_lower:
        raise ValueError(f"Column 'CPI' not found in sheet 'Data' after header row {header_row}. Columns: {df.columns.tolist()}")
    
    date_col = col_names_lower["date"]
    cpi_col = col_names_lower["cpi"]
    
    # 3. Extract and clean data
    tmp = df[[date_col, cpi_col]].copy()
    tmp.columns = ["date_frac", "CPI"]
    
    # Coerce both to numeric (errors='coerce'), drop NaNs
    tmp["date_frac"] = pd.to_numeric(tmp["date_frac"], errors="coerce")
    tmp["CPI"] = pd.to_numeric(tmp["CPI"], errors="coerce")
    tmp = tmp.dropna(subset=["date_frac", "CPI"])
    
    if tmp.empty:
        raise ValueError(
            f"After cleaning, no rows remain.\n"
            f"Detected header row: {header_row}\n"
            f"Detected columns: Date='{date_col}', CPI='{cpi_col}'"
        )
    
    # 4. Convert Shiller date format (year.fraction like 1871.01) to YYYY-MM using same conversion as equities
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
    
    # 5. Return series sorted by date, schema [{"date":"YYYY-MM","value":float}]
    # De-duplicate in case of repeats
    out = {}
    for _, row in tmp.iterrows():
        ym = row["ym"]
        if ym not in out:
            out[ym] = row["CPI"]
    
    series_out = [{"date": k, "value": float(out[k])} for k in sorted(out.keys())]
    
    if not series_out:
        raise ValueError("Shiller CPI calculation produced empty series.")
    
    return series_out


def build_cash_fred(csv_path: str) -> list[dict]:
    """Build cash/T-bill total return index from FRED DTB3 CSV."""
    return fred_csv_to_monthly_index(csv_path, "FRED DTB3 – 3-Month T-Bill (yield → index)", yield_to_return=True)


def build_bonds10y_fred(csv_path: str) -> list[dict]:
    """Build 10-year bonds total return index from FRED GS10 CSV."""
    return fred_csv_to_monthly_index(csv_path, "FRED GS10 – 10-Year Treasury (yield proxy → index)", yield_to_return=True)


def build_gic5y_proxy_fred(csv_path: str) -> list[dict]:
    """Build 5-year GIC proxy total return index from FRED GS5 CSV."""
    return fred_csv_to_monthly_index(csv_path, "FRED GS5 – 5-Year Treasury (GIC proxy, yield → index)", yield_to_return=True)


def build_usdcad_fx_fred(csv_path: str) -> list[dict]:
    """Build USD/CAD exchange rate from FRED DEXCAUS CSV (monthly mean)."""
    return fred_csv_to_monthly_index(csv_path, "FRED DEXCAUS – CAD per USD", yield_to_return=False, use_mean=True)


def statcan_fx_csv_to_series(csv_path: str) -> list[dict]:
    import pandas as pd

    df = pd.read_csv(csv_path)

    # Check if SYMBOL column exists
    if "SYMBOL" not in df.columns:
        raise ValueError(f"SYMBOL column not found in StatCan CSV. Columns: {df.columns.tolist()}")

    # Check if SYMBOL column has any non-null values
    if df["SYMBOL"].isna().all():
        raise ValueError("SYMBOL column exists but contains no values (all NaN) in StatCan CSV. Cannot filter by SYMBOL.")

    # Identify date column
    date_col = None
    for c in df.columns:
        cl = str(c).strip().lower()
        if cl in ("ref_date", "reference period", "refdate"):
            date_col = c
            break
    if date_col is None:
        raise ValueError(f"Could not find date column in StatCan CSV. Columns: {df.columns.tolist()}")

    # Identify value column
    if "VALUE" in df.columns:
        value_col = "VALUE"
    elif "Value" in df.columns:
        value_col = "Value"
    else:
        raise ValueError("Could not find VALUE column in StatCan CSV.")

    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df["value"] = pd.to_numeric(df[value_col], errors="coerce")

    df = df.dropna(subset=[date_col, "value"])

    # Filter to USD rows using SYMBOL column (case-insensitive)
    # Handle NaN values: only check non-null SYMBOL values
    df = df[df["SYMBOL"].notna() & (df["SYMBOL"].astype(str).str.strip().str.upper() == "USD")]
    if df.empty:
        raise ValueError("No rows found with SYMBOL == 'USD' in StatCan CSV")

    df["month"] = df[date_col].dt.to_period("M").dt.to_timestamp()
    df = df.sort_values("month")

    monthly = df.groupby("month", as_index=False)["value"].mean()

    series = [
        {"date": f"{row['month'].year:04d}-{row['month'].month:02d}", "value": float(row["value"])}
        for _, row in monthly.iterrows()
    ]
    
    return series


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

    ap_sc = sub.add_parser(
        "statcan_fx",
        help="Convert StatCan FX table CSV (33-10-0163-01) to monthly JSON for USD/CAD. Auto-detects CSV in tools/raw/."
    )
    ap_sc.add_argument(
        "--csv_path",
        default=None,
        help="Path to StatCan CSV (auto-detected if not provided)"
    )
    ap_sc.add_argument(
        "--out_json",
        default="assets/data/usdcad_monthly.json",
        help="Output JSON path (default: assets/data/usdcad_monthly.json)"
    )
    ap_sc.add_argument(
        "--raw_dir",
        default="tools/raw",
        help="Directory to search for CSV files (default: tools/raw)"
    )

    ap_build = sub.add_parser(
        "build_all",
        help="Build all six investment datasets (equities, cash, bonds, GIC, CPI, FX)"
    )
    ap_build.add_argument(
        "--raw_dir",
        default="tools/raw",
        help="Directory containing raw data files (default: tools/raw)"
    )
    ap_build.add_argument(
        "--out_dir",
        default="assets/data",
        help="Output directory for JSON files (default: assets/data)"
    )

    args = ap.parse_args()

    if args.cmd == "boc":
        series = boc_to_monthly(args.series_id, args.start, args.end, args.agg)
        write_json(args.out_json, source="Bank of Canada Valet API", frequency="monthly", series=series)
    elif args.cmd == "shiller":
        series = shiller_parse_monthly_tr(args.xls_path)
        write_json(args.out_json, source="Yale / Shiller (ie_data.xls)", frequency="monthly", series=series)
    elif args.cmd == "statcan_fx":
        csv_path = args.csv_path
        if csv_path is None:
            csv_path = find_statcan_fx_csv(args.raw_dir)
            print(f"Auto-detected CSV: {csv_path}")
        
        series = statcan_fx_csv_to_series(csv_path)
        write_json(
            args.out_json,
            source="Statistics Canada (Table 33-10-0163-01)",
            frequency="monthly",
            series=series
        )
    elif args.cmd == "build_all":
        raw_dir = args.raw_dir
        out_dir = args.out_dir
        os.makedirs(out_dir, exist_ok=True)
        
        print("Building investment datasets...")
        print("=" * 60)
        
        # File paths
        shiller_xls = os.path.join(raw_dir, "ie_data.xls")
        dtb3_csv = os.path.join(raw_dir, "DTB3.csv")
        dgs10_csv = os.path.join(raw_dir, "DGS10.csv")
        dgs5_csv = os.path.join(raw_dir, "DGS5.csv")
        dexca_us_csv = os.path.join(raw_dir, "DEXCAUS.csv")
        
        # 1. Equities
        print("\n1. Building equities total return index...")
        if not os.path.exists(shiller_xls):
            raise FileNotFoundError(f"Shiller file not found: {shiller_xls}")
        equities_series = build_equities_shiller(shiller_xls)
        write_json(
            os.path.join(out_dir, "equities_us_tr.json"),
            source="Shiller S&P 500 Total Return (P+D)",
            frequency="monthly",
            series=equities_series
        )
        
        # 2. CPI
        print("\n2. Building CPI index...")
        cpi_series = build_cpi_shiller(shiller_xls)
        write_json(
            os.path.join(out_dir, "cpi_us.json"),
            source="Shiller CPI",
            frequency="monthly",
            series=cpi_series
        )
        
        # 3. Cash
        print("\n3. Building cash/T-bill total return index...")
        if not os.path.exists(dtb3_csv):
            raise FileNotFoundError(f"DTB3 CSV not found: {dtb3_csv}")
        cash_series = build_cash_fred(dtb3_csv)
        write_json(
            os.path.join(out_dir, "cash_tr.json"),
            source="FRED DTB3 – 3-Month T-Bill (yield → index)",
            frequency="monthly",
            series=cash_series
        )
        
        # 4. Bonds 10Y
        print("\n4. Building 10-year bonds total return index...")
        if not os.path.exists(dgs10_csv):
            raise FileNotFoundError(f"DGS10 CSV not found: {dgs10_csv}")
        bonds_series = build_bonds10y_fred(dgs10_csv)
        write_json(
            os.path.join(out_dir, "bonds10y_tr.json"),
            source="FRED GS10 – 10-Year Treasury (yield proxy → index)",
            frequency="monthly",
            series=bonds_series
        )
        
        # 5. GIC 5Y Proxy
        print("\n5. Building 5-year GIC proxy total return index...")
        if not os.path.exists(dgs5_csv):
            raise FileNotFoundError(f"DGS5 CSV not found: {dgs5_csv}")
        gic_series = build_gic5y_proxy_fred(dgs5_csv)
        write_json(
            os.path.join(out_dir, "gic5y_proxy_tr.json"),
            source="FRED GS5 – 5-Year Treasury (GIC proxy, yield → index)",
            frequency="monthly",
            series=gic_series
        )
        
        # 6. FX
        print("\n6. Building USD/CAD exchange rate...")
        if not os.path.exists(dexca_us_csv):
            raise FileNotFoundError(f"DEXCAUS CSV not found: {dexca_us_csv}")
        fx_series = build_usdcad_fx_fred(dexca_us_csv)
        write_json(
            os.path.join(out_dir, "usdcad_fx.json"),
            source="FRED DEXCAUS – CAD per USD",
            frequency="monthly",
            series=fx_series
        )
        
        print("\n" + "=" * 60)
        print("All datasets built successfully!")


if __name__ == "__main__":
    main()
