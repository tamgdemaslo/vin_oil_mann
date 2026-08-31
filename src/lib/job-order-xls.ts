import * as fs from "node:fs";
import * as path from "node:path";
import * as XLSX from "xlsx";
import type { DemandDetailAttribute, DemandDetailPayload, DemandDetailPosition } from "@/lib/demand-detail-load";
import { fetchOrganizationRecord, sellerFromOrg } from "@/lib/job-order-poster-org";
import { resolveBranchPrintContext } from "@/lib/branch-print-context";

const SHEET_NAMES_PREFERRED = ["Заказ-наряд"];

function formatDemandDate(momentStr: string): string {
  const normalized = momentStr.includes("T") ? momentStr : momentStr.replace(" ", "T");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return momentStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function formatAttrValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "да" : "нет";
  return JSON.stringify(value);
}

function findAttr(attributes: DemandDetailAttribute[], templateLabel: string): string {
  const want = templateLabel.trim().toLowerCase();
  for (const a of attributes) {
    const n = (a.name ?? "").trim().toLowerCase();
    if (n === want) return formatAttrValue(a.value);
  }
  for (const a of attributes) {
    const n = (a.name ?? "").trim().toLowerCase();
    if (!n) continue;
    if (n.includes(want) || want.includes(n)) return formatAttrValue(a.value);
  }
  return "";
}

function replacePlaceholders(
  raw: string,
  payload: DemandDetailPayload,
  seller: ReturnType<typeof sellerFromOrg>
): string {
  if (typeof raw !== "string" || !raw.includes("${")) return raw;
  const { header, attributes } = payload;
  const sumRub = (header.sum / 100).toLocaleString("ru-RU", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const docDate = formatDemandDate(header.moment);

  let out = raw;
  out = out.replace(/\$\{o\.name\}/g, header.name);
  out = out.replace(/\$\{o\.agent\.name\}/g, header.agentName || "");
  out = out.replace(/\$\{o\.sum\.sumInCurrency \/ 100\} руб\./g, `${sumRub} руб.`);
  out = out.replace(
    /\$\{formatter\.format\("%1\$td\.%1\$tm\.%1\$tY",\s*formatter\.getExcelDate\(o\.moment\)\)\}/g,
    docDate
  );
  out = out.replace(/\$\{o\.sourceAgentRequisite\.agent\.director\}/g, seller.director);
  out = out.replace(/\$\{o\.sourceAgentRequisite\.INN\}/g, seller.inn);
  out = out.replace(/\$\{o\.sourceAgentRequisite\.ogrn\}/g, seller.ogrn);
  out = out.replace(/\$\{o\.sourceAgentRequisite\.legalAddress\}/g, seller.legalAddress);
  out = out.replace(/\$\{o\.sourceAgentRequisite\.agent\.contact\.phones\}/g, seller.phones);

  out = out.replace(
    /\$\{formatter\.findAttribute\(o,\s*"([^"]+)"\)\.valueString\}/g,
    (_, label: string) => findAttr(attributes, label)
  );
  out = out.replace(
    /\$\{formatter\.findAttribute\(o,\s*"([^"]+)"\)\.valueText\}/g,
    (_, label: string) => findAttr(attributes, label)
  );
  out = out.replace(
    /\$\{formatter\.findAttribute\(o,\s*"([^"]+)"\)\.longValue\}/g,
    (_, label: string) => findAttr(attributes, label)
  );

  out = out.replace(
    /\$\{formatter\.round\(position\.price\.sumInCurrency \* position\.quantity\) \/ 100\.0\}/g,
    ""
  );
  out = out.replace(/\$\{position\.printName\}/g, "");
  out = out.replace(/\$\{position\.basePrice\.sumInCurrency \/ 100\}/g, "");
  out = out.replace(/\$\{position\.quantity\}/g, "");
  out = out.replace(/\$\{position\.discount\}%/g, "");
  out = out.replace(/\$\{status\.index \+ 1\}/g, "");

  return out;
}

function padRow(row: unknown[], len: number): unknown[] {
  const next = row.slice(0, len);
  while (next.length < len) next.push("");
  return next;
}

function expandPositionsBlock(grid: unknown[][], positions: DemandDetailPosition[]): void {
  const start = grid.findIndex(
    (row) => row[0] != null && String(row[0]).includes("<jx:forEach")
  );
  const end = grid.findIndex((row) => row[0] != null && String(row[0]).includes("</jx:forEach>"));
  if (start < 0 || end < 0 || end < start) return;

  const templateRow = padRow(grid[start] as unknown[], 7);
  const width = templateRow.length;

  const built: unknown[][] = [];
  if (positions.length === 0) {
    const empty = padRow([], width);
    empty[0] = "";
    empty[1] = "—";
    empty[2] = "Нет позиций в отгрузке";
    empty[3] = "";
    empty[4] = "";
    empty[5] = "";
    empty[6] = "";
    built.push(empty);
  } else {
    for (let i = 0; i < positions.length; i++) {
      const p = positions[i];
      const unitRub = (p.price || 0) / 100;
      const disc = typeof p.discount === "number" ? p.discount : 0;
      const lineSum = p.quantity * unitRub * (1 - disc / 100);
      const row = padRow([], width);
      row[0] = "";
      row[1] = String(i + 1);
      row[2] = p.name;
      row[3] = unitRub.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      row[4] = String(p.quantity);
      row[5] = `${disc}%`;
      row[6] = lineSum.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      built.push(row);
    }
  }

  grid.splice(start, end - start + 1, ...built);
}

function pickSheetName(wb: XLSX.WorkBook): string {
  for (const n of SHEET_NAMES_PREFERRED) {
    if (wb.SheetNames.includes(n)) return n;
  }
  return wb.SheetNames[0] ?? "";
}

export async function buildJobOrderXlsBuffer(payload: DemandDetailPayload): Promise<Buffer> {
  const templatePath = path.join(process.cwd(), "templates", "zakaz-naryad.xls");
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Не найден шаблон заказ-наряда: ${templatePath}`);
  }

  const org = await fetchOrganizationRecord(payload.raw);
  const organizationSeller = sellerFromOrg(org);
  const branchPrint = await resolveBranchPrintContext(payload.branchId);
  const seller = { ...organizationSeller, phones: branchPrint?.phone || "" };

  const wb = XLSX.readFile(templatePath, { cellDates: true });
  const sheetName = pickSheetName(wb);
  if (!sheetName) throw new Error("В шаблоне Excel нет листов");

  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  }) as unknown[][];

  expandPositionsBlock(grid, payload.positions);

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (typeof cell === "string") {
        row[c] = replacePlaceholders(cell, payload, seller);
      }
    }
  }

  const outWs = XLSX.utils.aoa_to_sheet(grid);
  wb.Sheets[sheetName] = outWs;

  return XLSX.write(wb, { bookType: "biff8", type: "buffer" }) as Buffer;
}
