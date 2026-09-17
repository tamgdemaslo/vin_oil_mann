#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/app/shipment/new/NewShipmentPageClient.tsx", "utf8");
const draftRoute = await readFile("src/app/api/demands/draft/route.ts", "utf8");
const localDemandWrite = await readFile("src/lib/local-demand-write.ts", "utf8");

assert.match(
  source,
  /if \(!authChecked \|\| !localDraftHydrated \|\| isExistingDraft \|\| demandIdLocal \|\| draftActivity\) return;[\s\S]*?markDraftDirty\(\);/,
  "a new shipment must start creating a server draft immediately after authentication and hydration",
);
assert.match(
  source,
  /fetch\("\/api\/demands\/draft", \{[\s\S]*?method: "POST"/,
  "autosave must create an empty server draft through the dedicated endpoint",
);
assert.match(
  source,
  /agent: snapshot\.agent \? \{ meta: snapshot\.agent\.meta \} : undefined/,
  "the create request must allow the server to assign the anonymous retail counterparty",
);
assert.match(source, /if \(response\.status === 404\) \{[\s\S]*?createServerDraft\(\)/, "a stale local draft id must recover by creating a new server draft");
assert.match(source, /if \(!snapshot\.organization \|\| !snapshot\.store\) \{[\s\S]*?setSaveState\("saved"\)/, "the empty server draft must be enough while form defaults are still loading");
assert.doesNotMatch(
  source,
  /if \(!selectedOrg \|\| !selectedStore \|\| !selectedAgent\) return;/,
  "the autosave timer must not be blocked by a missing counterparty",
);
assert.match(source, /keepalive: true/, "autosave requests must survive navigation and tab closing");
assert.match(source, /window\.addEventListener\("pagehide", flushAutosaveOnPageHide\)/, "page closing must flush the latest server draft");
assert.match(draftRoute, /createEmptyLocalDemandDraft/, "the draft endpoint must create a real local shipment draft");
assert.match(localDemandWrite, /export async function createEmptyLocalDemandDraft/, "the server must resolve default organization and store for a new draft");

console.log("Shipment server-draft autosave contract — passed");
