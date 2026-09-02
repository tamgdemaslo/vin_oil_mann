#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": resolve(workspaceRoot, "src") } });
const {
  MANN_TECHNICAL_ASSOCIATION_DENYLIST_VERSION,
  parseMannTechnicalAssociationDenylist,
  partitionMannTechnicalAssociations,
} = await jiti.import("../src/lib/mann-technical-association-policy.ts");

const raw = JSON.parse(await readFile(resolve(workspaceRoot, "data/mann-technical-association-denylist-v1.json"), "utf8"));
const denylist = parseMannTechnicalAssociationDenylist(raw);
assert.equal(denylist.version, MANN_TECHNICAL_ASSOCIATION_DENYLIST_VERSION);
assert.equal(denylist.rejectedAssociationFingerprints.length, 33);

const rejectedFingerprint = denylist.rejectedAssociationFingerprints[0];
const safeFingerprint = "f".repeat(64);
const partition = partitionMannTechnicalAssociations([
  { associationFingerprint: rejectedFingerprint, id: "rejected" },
  { associationFingerprint: safeFingerprint, id: "eligible" },
], denylist);
assert.deepEqual(partition.rejected.map((item) => item.id), ["rejected"]);
assert.deepEqual(partition.eligible.map((item) => item.id), ["eligible"]);

assert.throws(
  () => parseMannTechnicalAssociationDenylist({ ...raw, rejectedAssociationFingerprints: ["invalid"] }),
  /invalid association fingerprint/u,
);
assert.throws(
  () => parseMannTechnicalAssociationDenylist({ ...raw, independentHumanSignoff: true }),
  /must not claim independent human sign-off/u,
);

console.log("MANN technical association denylist policy tests — passed");
