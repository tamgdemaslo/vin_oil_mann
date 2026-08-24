import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

const truthPath = path.resolve(argument("truth", "benchmarks/mann-fluid-review-truth-v1.json"));
const decisionsPathArg = argument("decisions");
if (!decisionsPathArg) throw new Error("Usage: node scripts/score-mann-fluid-review-truth.mjs --decisions=<decisions.ndjson> [--output=<score.json>]");
const decisionsPath = path.resolve(decisionsPathArg);
const outputPathArg = argument("output");

const truth = JSON.parse(await fs.readFile(truthPath, "utf8"));
const expected = new Map(truth.cases.map((item) => [item.requirementId, item]));
if (expected.size !== truth.cases.length) throw new Error("Truth set contains duplicate requirement IDs");

const observed = new Map();
const input = readline.createInterface({ input: createReadStream(decisionsPath), crlfDelay: Infinity });
for await (const line of input) {
  if (!line.trim()) continue;
  const decision = JSON.parse(line);
  if (!expected.has(decision.requirementId)) continue;
  const status = decision.match?.status ?? "UNKNOWN";
  const autoMaterialized = ["CONFIRMED_SINGLE", "CONFIRMED_MULTI_APPLICABILITY"].includes(status)
    && decision.capacity?.needsReview !== true;
  observed.set(decision.requirementId, {
    matcherVersion: decision.match?.matcherVersion ?? null,
    status,
    capacityNeedsReview: decision.capacity?.needsReview === true,
    autoMaterialized,
  });
}

const rows = truth.cases.map((item) => ({
  ...item,
  expectedAutoMaterialization: item.verdict === "APPROVE",
  observed: observed.get(item.requirementId) ?? null,
}));
const missing = rows.filter((item) => !item.observed);
const falsePositives = rows.filter((item) => item.observed?.autoMaterialized && !item.expectedAutoMaterialization);
const truePositives = rows.filter((item) => item.observed?.autoMaterialized && item.expectedAutoMaterialization);
const falseNegatives = rows.filter((item) => !item.observed?.autoMaterialized && item.expectedAutoMaterialization);
const autoCount = rows.filter((item) => item.observed?.autoMaterialized).length;
const precision = autoCount === 0 ? null : truePositives.length / autoCount;
const approvedCount = rows.filter((item) => item.expectedAutoMaterialization).length;
const recall = approvedCount === 0 ? null : truePositives.length / approvedCount;

const report = {
  truthVersion: truth.version,
  matcherVersion: rows.find((item) => item.observed)?.observed?.matcherVersion ?? null,
  decisionsPath,
  gate: missing.length === 0 && falsePositives.length === 0 ? "PASS" : "FAIL",
  counts: {
    cases: rows.length,
    observed: observed.size,
    approvedByReviewer: approvedCount,
    autoMaterialized: autoCount,
    truePositives: truePositives.length,
    falsePositives: falsePositives.length,
    falseNegatives: falseNegatives.length,
    missing: missing.length,
  },
  precision,
  recall,
  falsePositives,
  falseNegatives,
  missing,
};

const serialized = `${JSON.stringify(report, null, 2)}\n`;
if (outputPathArg) await fs.writeFile(path.resolve(outputPathArg), serialized, "utf8");
process.stdout.write(serialized);
if (report.gate !== "PASS") process.exitCode = 1;
