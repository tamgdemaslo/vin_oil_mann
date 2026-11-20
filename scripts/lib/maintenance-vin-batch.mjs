import { createHash } from 'node:crypto';

export const batchHash = value => createHash('sha256').update(value).digest('hex');
export function batchInputRows(payload) {
  const rows = Array.isArray(payload) ? payload : payload.rows ?? payload.results ?? payload.vehicles ?? payload.vins;
  if (!Array.isArray(rows)) throw new Error('Input must be an array or contain rows/results/vehicles/vins');
  const seen = new Set(), valid = [], rejected = [];
  for (const [index, row] of rows.entries()) {
    const vin = String(typeof row === 'string' ? row : row.vin ?? row.vehicle?.vin ?? row.providerTrace?.vin ?? '').trim().toUpperCase();
    if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) { rejected.push({ index, reason: 'INVALID_VIN' }); continue; }
    if (seen.has(vin)) { rejected.push({ index, reason: 'DUPLICATE_VIN' }); continue; }
    seen.add(vin); valid.push({ vin, ...(typeof row === 'object' && row ? { vehicle: row.normalizedVehicle ?? row.normalizedVehicleJson ?? row.vehicle } : {}) });
  }
  return { rows: valid, rejected };
}
export function batchSummary(results) {
  const statusCounts = {};
  for (const row of results) statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
  return { processed: results.length, statusCounts,
    matched: results.filter(row => row.variantKeys?.length).length,
    filterReferences: results.reduce((sum,row) => sum + (row.filters?.length ?? 0),0),
    savedResearchItems: results.reduce((sum,row) => sum + (row.research?.reduce((n,g) => n + (g.status === 'saved' ? g.items.length : 0),0) ?? 0),0) };
}

export function isBatchNormalizedVehicle(vehicle) {
  return vehicle && typeof vehicle==='object' && !Array.isArray(vehicle)
    && typeof vehicle.vin==='string' && ['high','medium','low'].includes(vehicle.confidence)
    && Array.isArray(vehicle.sourceMethods) && Array.isArray(vehicle.rawResultIds)
    && Boolean(vehicle.makeRaw || vehicle.makeCanonical) && Boolean(vehicle.modelRaw || vehicle.modelCanonical);
}

export function parseBatchInput(raw) {
  try { return JSON.parse(raw); } catch (error) {
    const lines=raw.split(/\r?\n/).filter(line=>line.trim());
    if(!lines.length)throw error;
    return lines.map((line,index)=>{try{return JSON.parse(line);}catch{throw new Error(`Invalid JSONL record ${index+1}`);}});
  }
}
