#!/usr/bin/env python3
"""Merge bounded-memory MANN PDF extraction chunks into one import package.

``extract-mann-pdf.py`` can be run for consecutive page ranges when the source
PDF is too dense for a single process.  This utility verifies that every page
range is present, concatenates the importer-compatible CSV files in PDF order,
and applies the same full-catalogue control totals before producing a package.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path


SCRIPT_VERSION = "2026-07-16.1"
TOTAL_PDF_PAGES = 513
FULL_CATALOG_BASELINE = {
    "processed_pages": 469,
    "unique_makes": 112,
    "unique_models": 1624,
    "filter_rows": 37600,
    "unique_mann_articles": 2066,
}
REQUIRED_MODELS = {
    "FORD": {"MONDEOIV", "MONDEOV", "MUSTANG", "PUMAII"},
    "TOYOTA": {"RAV4II", "RAV4III", "RAV4IV", "RAV4V"},
}
CHUNK_NAME = re.compile(r"^(\d{3})-(\d{3})$")


def compact(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]+", "", str(value or "").upper())


def article_key(value: str | None) -> str:
    value = str(value or "").upper()
    value = re.sub(r"[‐‑‒–—―-]", "", value)
    value = re.sub(r"\s+", "", value)
    return re.sub(r"[^A-ZА-Я0-9/]", "", value)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def chunks_in_order(chunks_dir: Path) -> list[tuple[int, int, Path]]:
    chunks: list[tuple[int, int, Path]] = []
    expected_ranges = {
        (start, min(start + 24, TOTAL_PDF_PAGES))
        for start in range(1, TOTAL_PDF_PAGES + 1, 25)
    }
    for entry in chunks_dir.iterdir():
        if not entry.is_dir():
            continue
        match = CHUNK_NAME.fullmatch(entry.name)
        if not match:
            continue
        start, end = int(match.group(1)), int(match.group(2))
        # A failed experimental run can leave an overlapping folder in /tmp.
        # Only the explicitly requested fixed-size page ranges participate in
        # a reproducible build; every one is checked below.
        if (start, end) in expected_ranges:
            chunks.append((start, end, entry))
    chunks.sort()
    if not chunks:
        raise ValueError(f"No chunk folders found in {chunks_dir}")

    expected_start = 1
    for start, end, directory in chunks:
        if start != expected_start or end < start:
            raise ValueError(f"Expected pages {expected_start}-..., found invalid chunk {directory.name}")
        expected_start = end + 1
    if expected_start != TOTAL_PDF_PAGES + 1:
        raise ValueError(f"Page coverage ends at {expected_start - 1}; expected {TOTAL_PDF_PAGES}")
    return chunks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunks-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--source-pdf", type=Path, required=True)
    args = parser.parse_args()

    chunks = chunks_in_order(args.chunks_dir.resolve())
    source_pdf = args.source_pdf.expanduser().resolve()
    if not source_pdf.is_file():
        parser.error(f"PDF not found: {source_pdf}")

    summaries: list[dict] = []
    application_headers: list[str] | None = None
    filter_headers: list[str] | None = None
    applications: list[dict[str, str]] = []
    filters: list[dict[str, str]] = []
    source_hashes: set[str] = set()

    for _start, _end, directory in chunks:
        summary_path = directory / "mann_pdf_catalog_summary.json"
        applications_path = directory / "mann_pdf_applications.csv"
        filters_path = directory / "mann_pdf_filters_long.csv"
        if not (summary_path.is_file() and applications_path.is_file() and filters_path.is_file()):
            raise ValueError(f"Incomplete chunk: {directory}")
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        summaries.append(summary)
        source_hashes.add(str(summary.get("source", {}).get("sha256", "")))
        with applications_path.open(newline="", encoding="utf-8") as input_file:
            reader = csv.DictReader(input_file)
            if application_headers is None:
                application_headers = reader.fieldnames
            elif reader.fieldnames != application_headers:
                raise ValueError(f"Application CSV header differs in {directory}")
            applications.extend(reader)
        with filters_path.open(newline="", encoding="utf-8") as input_file:
            reader = csv.DictReader(input_file)
            if filter_headers is None:
                filter_headers = reader.fieldnames
            elif reader.fieldnames != filter_headers:
                raise ValueError(f"Filter CSV header differs in {directory}")
            filters.extend(reader)

    if len(source_hashes) != 1 or "" in source_hashes:
        raise ValueError("Chunk summaries do not reference one source PDF")

    filtered_models = {(compact(row["make"]), compact(row["model"])) for row in filters}
    missing_required = {
        make: sorted(expected - {model for row_make, model in filtered_models if row_make == make})
        for make, expected in REQUIRED_MODELS.items()
    }
    missing_required = {make: values for make, values in missing_required.items() if values}
    type_counts = Counter(row["filter_type"] for row in filters)
    counts = {
        "application_rows": len(applications),
        "filter_rows": len(filters),
        "unique_makes": len({compact(row["make"]) for row in filters}),
        "unique_models": len(filtered_models),
        "unique_mann_articles": len({article_key(row["mann_article"]) for row in filters}),
        "model_headers": sum(int(summary["counts"].get("model_headers", 0)) for summary in summaries),
        "model_headers_with_filters": sum(int(summary["counts"].get("model_headers_with_filters", 0)) for summary in summaries),
        "processed_pages": sum(int(summary["counts"].get("processed_pages", 0)) for summary in summaries),
        "make_bands": sum(int(summary["counts"].get("make_bands", 0)) for summary in summaries),
    }
    baseline_mismatches = {
        key: {"expected": expected, "actual": counts.get(key)}
        for key, expected in FULL_CATALOG_BASELINE.items()
        if counts.get(key) != expected
    }
    warnings: list[str] = []
    if missing_required:
        warnings.append(f"Missing mandatory coverage: {missing_required}")
    if baseline_mismatches:
        warnings.append(f"Full catalogue baseline mismatch: {baseline_mismatches}")

    summary = {
        "schema_version": 2,
        "parser": {"name": "merge-mann-pdf-chunks.py", "version": SCRIPT_VERSION},
        "source": {"file": source_pdf.name, "sha256": sha256(source_pdf), "pdf_pages": TOTAL_PDF_PAGES},
        "counts": counts,
        "filter_type_counts": dict(sorted(type_counts.items())),
        "coverage": {
            "required_models": {make: sorted(models) for make, models in REQUIRED_MODELS.items()},
            "missing_required_models": missing_required,
            "model_headers_without_filters": [],
            "full_catalog_baseline": FULL_CATALOG_BASELINE,
            "baseline_mismatches": baseline_mismatches,
        },
        "warnings": warnings,
    }

    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, headers, rows in (
        ("mann_pdf_applications.csv", application_headers, applications),
        ("mann_pdf_filters_long.csv", filter_headers, filters),
    ):
        if not headers:
            raise ValueError(f"No CSV header found for {name}")
        with (output_dir / name).open("w", newline="", encoding="utf-8") as destination:
            writer = csv.DictWriter(destination, fieldnames=headers)
            writer.writeheader()
            writer.writerows(rows)
    (output_dir / "mann_pdf_catalog_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps({"output_dir": str(output_dir), **summary}, ensure_ascii=False, indent=2))
    return 1 if warnings else 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2)
