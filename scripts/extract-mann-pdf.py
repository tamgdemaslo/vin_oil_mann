#!/usr/bin/env python3
"""Extract MANN passenger-car / transporter applications from the source PDF.

The MANN PDF is a vector table.  Extracting it by text order drops sections when
the reader joins rows differently (Toyota RAV4 was one such loss).  This script
uses the coloured table bands and cell coordinates as the source of truth.

It writes the three files accepted by /inventory/integrations/mann-pdf:
  * mann_pdf_applications.csv
  * mann_pdf_filters_long.csv
  * mann_pdf_catalog_summary.json
"""

from __future__ import annotations

import argparse
import csv
import gc
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Iterable

import pdfplumber


SCRIPT_VERSION = "2026-07-24.1"

# RGB fills used by the source catalogue's make and model title bands.
YELLOW = (1.0, 0.928, 0.0)
MODEL_GREEN = (0.624, 0.783, 0.668)

APPLICATION_COLUMNS = [
    "source_pdf", "row_type", "make", "model", "model_years", "vehicle_text",
    "effective_vehicle_text", "detail", "engine_code", "kw", "hp", "vehicle_years",
    "condition", "air_filter", "air_filter_note", "oil_filter", "oil_filter_note",
    "fuel_filter", "fuel_filter_note", "cabin_or_other_filter", "cabin_or_other_type",
    "cabin_filter", "other_filter", "other_filter_type", "pdf_page", "catalog_page",
    "raw_cells_json",
]

FILTER_COLUMNS = [
    "make", "model", "model_years", "vehicle_text", "effective_vehicle_text", "detail",
    "engine_code", "kw", "hp", "vehicle_years", "condition", "filter_type",
    "filter_subtype", "mann_article", "filter_note", "pdf_page", "catalog_page",
]

REQUIRED_MODELS = {
    "FORD": {"MONDEOIV", "MONDEOV", "MUSTANG", "PUMAII"},
    "TOYOTA": {"RAV4II", "RAV4III", "RAV4IV", "RAV4V"},
}

# Verified against mann-filter-catalog-cars-transporters-2024-26-interactive.pdf.
# These values deliberately live beside the parser, rather than in the import
# endpoint, so a partial rebuild cannot silently replace the production base.
FULL_CATALOG_BASELINE = {
    "processed_pages": 469,
    "unique_makes": 112,
    "unique_models": 1624,
    "filter_rows": 37600,
    "unique_mann_articles": 2066,
}

ARTICLE_PREFIX = re.compile(
    r"^(?:C(?:UK)?|FP|HU|H|W|WK|PU|PF|WP|OC|LS|KX|HD|BF|CS|LB|U|P|E|Z|SP|TG|F)[A-Z0-9/.-]*$",
    re.IGNORECASE,
)
NOTE_MARKERS = (
    "SONDERAUSSTATTUNG", "TEILWEISE", "PARTLY", "MITKLIMA", "OHNEKLIMA",
    "MOTORKODE", "ENGINECODE", "FAHRZEUGIDENTIFIKATIONS", "BISCHASSIS",
    "ABCHASSIS", "FURFAHRZEUGE", "FUR", "WITHOUT", "WITH",
    "EXPORTMODELL", "EXPORTMODELFOR", "KUNSTSTOFFOLFILTERMODUL",
    "PLASTICOILFILTERMODULE", "ALUOLFILTERMODUL", "ALUMINIUMOILFILTERMODULE",
    "CHINA", "CODES",
)


def rgb_close(value: Any, expected: tuple[float, float, float]) -> bool:
    if not isinstance(value, (tuple, list)) or len(value) != 3:
        return False
    return all(abs(float(actual) - wanted) < 0.002 for actual, wanted in zip(value, expected))


def text(value: str | None) -> str:
    """Normalise PDF glyph artefacts without altering MANN article spelling."""
    output = str(value or "")
    output = output.replace("(cid:31)", " -> ").replace("\x1f", " -> ")
    output = output.replace("(cid:30)", " <- ")
    output = re.sub(r"\s+", " ", output).strip()
    return output


def compact(value: str | None) -> str:
    return re.sub(r"[^A-Z0-9]+", "", text(value).upper())


def clean_model(value: str) -> str:
    value = text(value)
    value = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", value)
    value = re.sub(r"(?<=\d)(?=[IVX]{2,}\b)", " ", value)
    return value


def clean_article(value: str) -> str:
    value = text(value).upper().replace(" ", "")
    value = value.strip(".,;:")
    return value


def article_key(value: str | None) -> str:
    """Match the database normalisation: slashes distinguish MANN articles."""
    value = text(value).upper()
    value = re.sub(r"[‐‑‒–—―-]", "", value)
    value = re.sub(r"\s+", "", value)
    return re.sub(r"[^A-ZА-Я0-9/]", "", value)


def article_tokens(words: Iterable[dict[str, Any]]) -> list[str]:
    found: list[str] = []
    for word in words:
        candidate = clean_article(word["text"])
        if not candidate or not any(char.isdigit() for char in candidate):
            continue
        if not ARTICLE_PREFIX.fullmatch(candidate):
            continue
        if candidate not in found:
            found.append(candidate)
    return found


def words_for_interval(words: list[dict[str, Any]], top: float, bottom: float, left: float, right: float) -> list[dict[str, Any]]:
    selected = []
    for word in words:
        center = (float(word["top"]) + float(word["bottom"])) / 2
        if top - 1.2 <= center < bottom - 0.4 and left - 1 <= float(word["x0"]) < right + 1:
            selected.append(word)
    return sorted(selected, key=lambda item: (item["x0"], item["top"]))


def join_words(words: Iterable[dict[str, Any]]) -> str:
    return text(" ".join(text(word["text"]) for word in sorted(words, key=lambda item: item["x0"])))


def choose_model_years(words: list[dict[str, Any]], left: float) -> str:
    return join_words([word for word in words if left + 198 <= float(word["x0"]) < left + 265])


def extract_power(words: list[dict[str, Any]], left: float) -> tuple[str, str]:
    value = join_words([word for word in words if left + 170 <= float(word["x0"]) < left + 228])
    numbers = [int(number) for number in re.findall(r"\d{1,3}", value)]
    kw = next((number for number in numbers if 20 <= number <= 700), None)
    if kw is None:
        return "", ""
    hp_values = [int(number) for number in re.findall(r"\((\d{1,3})\)", value)]
    hp = next((number for number in hp_values if 30 <= number <= 1000), None)
    if hp is None:
        hp = next((number for number in numbers if number != kw and 30 <= number <= 1000), None)
    return str(kw), str(hp) if hp is not None else ""


def is_note(value: str) -> bool:
    upper = compact(value)
    return bool(upper) and any(marker in upper for marker in NOTE_MARKERS)


def make_headers(page: pdfplumber.page.Page) -> list[dict[str, float]]:
    rects = [
        rect for rect in page.rects
        if rgb_close(rect.get("non_stroking_color"), YELLOW)
        and float(rect["height"]) >= 20
        and float(rect["top"]) >= 20
    ]
    # There can be several manufacturers on one page.  One wide yellow rect is
    # enough to represent each manufacturer band.
    headers: list[dict[str, float]] = []
    for rect in sorted(rects, key=lambda item: (item["top"], item["x0"])):
        if headers and abs(headers[-1]["top"] - float(rect["top"])) < 1:
            continue
        headers.append({"top": float(rect["top"]), "bottom": float(rect["bottom"]), "left": float(rect["x0"]), "right": float(rect["x1"])})
    return headers


def model_header_tops(page: pdfplumber.page.Page, left: float, start: float, end: float) -> list[float]:
    tops = {
        round(float(rect["top"]), 3)
        for rect in page.rects
        if rgb_close(rect.get("non_stroking_color"), MODEL_GREEN)
        and abs(float(rect["x0"]) - left) < 1.2
        and float(rect["height"]) >= 10
        and start <= float(rect["top"]) < end
    }
    return sorted(tops)


def physical_row_tops(page: pdfplumber.page.Page, left: float, start: float, end: float) -> list[float]:
    tops = {
        round(float(rect["top"]), 3)
        for rect in page.rects
        if abs(float(rect["x0"]) - left) < 1.2
        and start <= float(rect["top"]) < end
        and float(rect["height"]) >= 5
    }
    return sorted(tops)


@dataclass
class VehicleContext:
    vehicle_text: str = "All models"
    effective_vehicle_text: str = "All models"
    detail: str = "All models"
    engine_code: str = ""
    kw: str = ""
    hp: str = ""
    vehicle_years: str = ""
    condition: str = ""


def catalogue_page_number(page: pdfplumber.page.Page, words: list[dict[str, Any]]) -> int | None:
    # Printed catalogue page number lives in the lower-left or lower-right corner.
    candidates = [word for word in words if float(word["top"]) > page.height - 42 and re.fullmatch(r"\d{1,3}", text(word["text"]))]
    if not candidates:
        return None
    candidate = min(candidates, key=lambda word: float(word["x0"]))
    return int(candidate["text"])


def source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def model_rows(
    page: pdfplumber.page.Page,
    words: list[dict[str, Any]],
    make: str,
    left: float,
    right: float,
    model_top: float,
    model_end: float,
    pdf_page: int,
    catalog_page: int | None,
    source_name: str,
) -> tuple[list[dict[str, str]], list[dict[str, str]], str]:
    title_words = words_for_interval(words, model_top, min(model_top + 12.4, model_end), left, right)
    model = clean_model(join_words([word for word in title_words if float(word["x0"]) < left + 198]))
    model_years = choose_model_years(title_words, left)
    if not model or compact(model).startswith("ALLEMODELLE"):
        return [], [], ""

    row_tops = [top for top in physical_row_tops(page, left, model_top + 11.5, model_end) if top >= model_top + 11.5]
    applications: list[dict[str, str]] = []
    filters: list[dict[str, str]] = []
    context = VehicleContext()
    seen_filters: set[tuple[str, ...]] = set()

    for index, row_top in enumerate(row_tops):
        row_end = row_tops[index + 1] if index + 1 < len(row_tops) else model_end
        row_words = words_for_interval(words, row_top, row_end, left, right)
        if not row_words:
            continue

        vehicle_words = [word for word in row_words if float(word["x0"]) < left + 94]
        engine_words = [word for word in row_words if left + 94 <= float(word["x0"]) < left + 170]
        year_words = [word for word in row_words if left + 225 <= float(word["x0"]) < left + 264]
        vehicle = join_words(vehicle_words)
        engine = join_words(engine_words)
        vehicle_years = join_words(year_words)
        kw, hp = extract_power(row_words, left)

        # The four filter columns are consistent within every vehicle table.
        filter_cells = {
            "air": [word for word in row_words if left + 264 <= float(word["x0"]) < left + 337],
            "oil": [word for word in row_words if left + 337 <= float(word["x0"]) < left + 411],
            "fuel": [word for word in row_words if left + 411 <= float(word["x0"]) < left + 485],
            "cabin": [word for word in row_words if left + 485 <= float(word["x0"]) <= right + 1],
        }
        row_articles = {kind: article_tokens(cell_words) for kind, cell_words in filter_cells.items()}
        has_articles = any(row_articles.values())

        vehicle_compact = compact(vehicle)
        row_context = text(" ".join(part for part in [vehicle, engine, vehicle_years] if part))
        if "ALLEMODELLE" in vehicle_compact or "ALLMODELS" in vehicle_compact:
            context = VehicleContext()
        elif vehicle and not is_note(row_context) and (engine or vehicle_years or kw or hp or has_articles):
            context = VehicleContext(
                vehicle_text=vehicle,
                effective_vehicle_text=vehicle,
                detail=vehicle,
                engine_code=engine,
                kw=kw,
                hp=hp,
                vehicle_years=vehicle_years,
                condition="",
            )
        elif row_context and is_note(row_context):
            context.condition = text(" ".join(part for part in [context.condition, row_context] if part))

        if not vehicle and not has_articles and not engine and not vehicle_years:
            continue

        row_data = {
            "source_pdf": source_name,
            "row_type": "vehicle_application" if context.vehicle_text != "All models" else "all_models_application",
            "make": make,
            "model": model,
            "model_years": model_years,
            "vehicle_text": context.vehicle_text,
            "effective_vehicle_text": context.effective_vehicle_text,
            "detail": context.detail,
            "engine_code": context.engine_code,
            "kw": context.kw,
            "hp": context.hp,
            "vehicle_years": context.vehicle_years,
            "condition": context.condition,
            "air_filter": "; ".join(row_articles["air"]),
            "air_filter_note": "",
            "oil_filter": "; ".join(row_articles["oil"]),
            "oil_filter_note": "",
            "fuel_filter": "; ".join(row_articles["fuel"]),
            "fuel_filter_note": "",
            "cabin_or_other_filter": "; ".join(row_articles["cabin"]),
            "cabin_or_other_type": "cabin" if row_articles["cabin"] else "",
            "cabin_filter": "; ".join(row_articles["cabin"]),
            "other_filter": "",
            "other_filter_type": "",
            "pdf_page": str(pdf_page),
            "catalog_page": str(catalog_page or ""),
            "raw_cells_json": json.dumps({
                "row_top": row_top,
                "vehicle": vehicle,
                "engine": engine,
                "kw": kw,
                "hp": hp,
                "vehicle_years": vehicle_years,
                "filters": {kind: join_words(cell) for kind, cell in filter_cells.items()},
            }, ensure_ascii=False, separators=(",", ":")),
        }
        applications.append(row_data)

        for kind, articles in row_articles.items():
            for article in articles:
                key = (make, model, context.vehicle_text, context.engine_code, context.vehicle_years, kind, article, str(pdf_page), str(row_top))
                if key in seen_filters:
                    continue
                seen_filters.add(key)
                filters.append({
                    "make": make,
                    "model": model,
                    "model_years": model_years,
                    "vehicle_text": context.vehicle_text,
                    "effective_vehicle_text": context.effective_vehicle_text,
                    "detail": context.detail,
                    "engine_code": context.engine_code,
                    "kw": context.kw,
                    "hp": context.hp,
                    "vehicle_years": context.vehicle_years,
                    "condition": context.condition,
                    "filter_type": kind,
                    "filter_subtype": "",
                    "mann_article": article,
                    "filter_note": "",
                    "pdf_page": str(pdf_page),
                    "catalog_page": str(catalog_page or ""),
                })

    return applications, filters, model


def write_csv(path: Path, headers: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as destination:
        writer = csv.DictWriter(destination, fieldnames=headers)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path, help="Source MANN catalogue PDF")
    parser.add_argument("--output-dir", type=Path, default=Path("outputs/mann-pdf-catalog"))
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--end-page", type=int, default=None)
    args = parser.parse_args()

    source_pdf = args.pdf.expanduser().resolve()
    if not source_pdf.is_file():
        parser.error(f"PDF not found: {source_pdf}")
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    applications: list[dict[str, str]] = []
    filters: list[dict[str, str]] = []
    seen_models: set[tuple[str, str]] = set()
    processed_pages = 0
    make_bands = 0
    model_headers = 0

    with pdfplumber.open(source_pdf) as pdf:
        total_pdf_pages = len(pdf.pages)
        # Do not retain the 513 page objects in pdfplumber's cache.  The
        # source document contains several hundred vector rectangles per page.
        pdf.flush_cache()
        end_page = min(args.end_page or total_pdf_pages, total_pdf_pages)
        for pdf_page in range(max(1, args.start_page), end_page + 1):
            page = pdf.pages[pdf_page - 1]
            # An x tolerance of two keeps a table-cell article such as "C 33 18"
            # together as C3318, while still preserving neighbouring columns.
            words = page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False, use_text_flow=False)
            headers = make_headers(page)
            if not headers:
                page.close()
                pdf.flush_cache()
                gc.collect()
                continue
            processed_pages += 1
            catalog_page = catalogue_page_number(page, words)
            for make_index, header in enumerate(headers):
                segment_end = headers[make_index + 1]["top"] if make_index + 1 < len(headers) else float(page.height) - 24
                make_words = words_for_interval(words, header["top"], header["bottom"], header["left"], header["right"])
                make = text(join_words([word for word in make_words if float(word["x0"]) < header["left"] + 250]))
                if not make or make in {"/", "Language selection"}:
                    continue
                make_bands += 1
                model_tops = model_header_tops(page, header["left"], header["bottom"], segment_end)
                for model_index, model_top in enumerate(model_tops):
                    model_end = model_tops[model_index + 1] if model_index + 1 < len(model_tops) else segment_end
                    app_rows, filter_rows, model = model_rows(
                        page, words, make, header["left"], header["right"], model_top, model_end,
                        pdf_page, catalog_page, source_pdf.name,
                    )
                    if not model:
                        continue
                    model_headers += 1
                    seen_models.add((compact(make), compact(model)))
                    applications.extend(app_rows)
                    filters.extend(filter_rows)
            # pdfplumber caches every page's words, rectangles and drawing
            # objects.  This PDF has 513 dense pages; release each page before
            # continuing so a full rebuild has a bounded memory footprint.
            page.close()
            pdf.flush_cache()
            gc.collect()

    filtered_models = {(compact(row["make"]), compact(row["model"])) for row in filters}
    missing_required = {
        make: sorted(expected - {model for row_make, model in filtered_models if row_make == make})
        for make, expected in REQUIRED_MODELS.items()
    }
    missing_required = {make: values for make, values in missing_required.items() if values}
    headers_without_filters = sorted(seen_models - filtered_models)
    type_counts = Counter(row["filter_type"] for row in filters)
    article_count = len({article_key(row["mann_article"]) for row in filters})
    warnings: list[str] = []
    if missing_required:
        warnings.append(f"Missing mandatory coverage: {missing_required}")
    if headers_without_filters:
        warnings.append(f"Model headers without extracted filters: {len(headers_without_filters)}")
    if not filters:
        warnings.append("No filter rows extracted")

    counts = {
        "application_rows": len(applications),
        "filter_rows": len(filters),
        "unique_makes": len({compact(row["make"]) for row in filters}),
        "unique_models": len(filtered_models),
        "unique_mann_articles": article_count,
        "model_headers": model_headers,
        "model_headers_with_filters": len(filtered_models & seen_models),
        "processed_pages": processed_pages,
        "make_bands": make_bands,
    }
    is_full_catalog = args.start_page == 1 and end_page == total_pdf_pages
    baseline_mismatches = {
        key: {"expected": expected, "actual": counts.get(key)}
        for key, expected in FULL_CATALOG_BASELINE.items()
        if is_full_catalog and counts.get(key) != expected
    }
    if baseline_mismatches:
        warnings.append(f"Full catalogue baseline mismatch: {baseline_mismatches}")

    summary = {
        "schema_version": 2,
        "parser": {"name": "extract-mann-pdf.py", "version": SCRIPT_VERSION},
        "source": {"file": source_pdf.name, "sha256": source_hash(source_pdf), "pdf_pages": end_page - args.start_page + 1},
        "counts": counts,
        "filter_type_counts": dict(sorted(type_counts.items())),
        "coverage": {
            "required_models": {make: sorted(models) for make, models in REQUIRED_MODELS.items()},
            "missing_required_models": missing_required,
            "model_headers_without_filters": [f"{make}/{model}" for make, model in headers_without_filters],
            "full_catalog_baseline": FULL_CATALOG_BASELINE if is_full_catalog else None,
            "baseline_mismatches": baseline_mismatches,
        },
        "warnings": warnings,
    }

    applications_path = output_dir / "mann_pdf_applications.csv"
    filters_path = output_dir / "mann_pdf_filters_long.csv"
    summary_path = output_dir / "mann_pdf_catalog_summary.json"
    write_csv(applications_path, APPLICATION_COLUMNS, applications)
    write_csv(filters_path, FILTER_COLUMNS, filters)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(json.dumps({"output_dir": str(output_dir), **summary}, ensure_ascii=False, indent=2))
    return 1 if warnings else 0


if __name__ == "__main__":
    raise SystemExit(main())
