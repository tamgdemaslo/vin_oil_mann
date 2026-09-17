#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile("src/app/shipment/new/NewShipmentPageClient.tsx", "utf8");

assert.match(
  source,
  /if \(!authChecked \|\| !localDraftHydrated \|\| isExistingDraft \|\| demandIdLocal \|\| draftActivity\) return;[\s\S]*?if \(!selectedOrg \|\| !selectedStore\) return;[\s\S]*?markDraftDirty\(\);/,
  "a new shipment must create a server draft as soon as its default organization and store are ready",
);
assert.match(
  source,
  /if \(!snapshot\?\.organization \|\| !snapshot\.store\) return;/,
  "autosave must not wait for a manually selected counterparty",
);
assert.match(
  source,
  /agent: snapshot\.agent \? \{ meta: snapshot\.agent\.meta \} : undefined/,
  "the create request must allow the server to assign the anonymous retail counterparty",
);
assert.doesNotMatch(
  source,
  /if \(!selectedOrg \|\| !selectedStore \|\| !selectedAgent\) return;/,
  "the autosave timer must not be blocked by a missing counterparty",
);
assert.match(source, /keepalive: true/, "autosave requests must survive navigation and tab closing");
assert.match(source, /window\.addEventListener\("pagehide", flushAutosaveOnPageHide\)/, "page closing must flush the latest server draft");

console.log("Shipment server-draft autosave contract — passed");
