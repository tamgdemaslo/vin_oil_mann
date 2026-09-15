import { createHash } from "node:crypto";
import data from "./fluid-volvo-source-fuel-data.json";

type SourceRow = { row_id: string; source_url: string; table_index: number };
const hash = (row: SourceRow) => createHash("sha256").update(JSON.stringify(row)).digest("hex");

// Snapshot-specific correction: changed/missing anchors must fail closed.
// Fuel evidence does not verify dates, installed equipment or fluid approvals.
export function volvoSourceFuelCorrection(id: string, row: SourceRow, engineRows: SourceRow[], originalFuel: string | null) {
  const correction = data.corrections.find(c => c.id === id);
  if (!correction || originalFuel !== "gasoline" || correction.sourceRowId !== row.row_id || correction.sourceRowHash !== hash(row)) return null;
  const anchors = correction.anchorIds.map(anchorId => {
    const proof = data.anchors.find(a => a.sourceRowId === anchorId);
    const source = engineRows.find(r => r.row_id === anchorId);
    if (!proof || !source || source.source_url !== row.source_url || source.table_index !== row.table_index || proof.sourceRowHash !== hash(source)) return null;
    return proof;
  });
  if (!anchors.length || anchors.some(a => !a)) return null;
  const ownEngineRow = engineRows.some(r => r.row_id === row.row_id);
  const expectedIds = ownEngineRow ? [row.row_id] : engineRows.map(r => r.row_id);
  if (expectedIds.length !== correction.anchorIds.length || expectedIds.some(id => !correction.anchorIds.includes(id))) return null;
  return { originalFuel, correctedFuel: "diesel", evidenceHash: data.evidenceHash,
    sourceRowHash: correction.sourceRowHash, anchors, documents: data.documents,
    marketReviewRequired: correction.marketReviewRequired, technicalReviewRequired: true,
    scope: "FUEL_IDENTITY_ONLY_NOT_FLUID_OR_EQUIPMENT_APPROVAL" };
}
