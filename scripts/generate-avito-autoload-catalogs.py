"""Read Avito's XLSX dictionaries; never edit the supplied workbooks.

Usage: python generate-avito-autoload-catalogs.py MOTOR.xlsx TRANSMISSION.xlsx
"""
import hashlib
import json
import pathlib
import sys

import openpyxl

root = pathlib.Path(__file__).resolve().parents[1]
result = {"version": "2026-10-12", "sources": {}, "types": {}}
for kind, filename in zip(("motor", "transmission"), sys.argv[1:], strict=True):
    path = pathlib.Path(filename)
    # Avito templates have sparse sheet dimensions; the read-only iterator can
    # omit dictionary columns. Load cells normally, without saving the workbook.
    workbook = openpyxl.load_workbook(path, read_only=False, data_only=True)
    sheet = workbook["Справочники"]
    rows = list(sheet.values)
    dictionaries = {
        str(key): [str(row[column]) for row in rows[1:] if column < len(row) and row[column] is not None]
        for column, key in enumerate(rows[0]) if key is not None
    }
    result["sources"][kind] = {"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
    result["types"][kind] = {key: dictionaries[key] for key in ("Brand", "SAE", "Volume", "ProductType")}
    workbook.close()
if len(result["types"]) != 2:
    raise SystemExit("Provide both motor and transmission XLSX files")
destination = root / "src/lib/avito-autoload/catalogs.generated.json"
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print("Generated Avito dictionaries: " + ", ".join(
    f"{kind}: {len(data['Brand'])} brands, {len(data['SAE'])} SAE, {len(data['Volume'])} volumes"
    for kind, data in result["types"].items()
))
