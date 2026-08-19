#!/usr/bin/env node

import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { "@": resolve(process.cwd(), "src") },
});

const [{ ensureAnonymousRetailCounterpartiesForExistingBranches }, { prisma }] = await Promise.all([
  jiti.import("../src/lib/anonymous-retail-counterparty.ts"),
  jiti.import("../src/lib/db.ts"),
]);

try {
  const count = await ensureAnonymousRetailCounterpartiesForExistingBranches();
  console.log(`Anonymous retail counterparties ensured for ${count} branches.`);
} finally {
  await prisma.$disconnect();
}
