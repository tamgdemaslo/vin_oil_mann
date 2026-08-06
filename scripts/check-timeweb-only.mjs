#!/usr/bin/env node

/**
 * Fails closed when an active Selectel deployment surface reappears.
 *
 * Historical evidence may be retained only under docs/legacy/selectel/ and in
 * docs/SELECTEL_DECOMMISSIONED.md. Those files must never contain runnable
 * deployment instructions or credentials.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const failures = [];

const ignoredDirectories = new Set([
  ".git",
  ".next",
  "node_modules",
  ".data",
  "coverage",
  "outputs",
]);

const allowedLegacyPaths = new Set([
  "docs/SELECTEL_DECOMMISSIONED.md",
  "scripts/check-timeweb-only.mjs",
]);

const restrictedPaths = [
  ".github/workflows/deploy-selectel.yml",
  ".github/workflows/deploy-selectel.yaml",
  ".github/workflows/migrate-selectel.yml",
  ".github/workflows/migrate-selectel.yaml",
  "docker-compose.selectel.yml",
  "docker-compose.selectel.yaml",
  "docker-compose.selectel.wireguard.yml",
  "docker-compose.selectel.wireguard.yaml",
  "deploy/selectel",
  "scripts/check-selectel-deploy-policy.mjs",
  "scripts/check-selectel-database-url.mjs",
  "scripts/test-selectel-deploy-flow.sh",
];

function toRelative(path) {
  return relative(root, path).split(sep).join("/");
}

function isAllowedLegacy(relativePath) {
  return allowedLegacyPaths.has(relativePath) || relativePath.startsWith("docs/legacy/selectel/");
}

function mustBeSelectelFree(relativePath) {
  return (
    relativePath.startsWith(".github/") ||
    relativePath.startsWith("deploy/") ||
    relativePath.startsWith("docs/") ||
    relativePath.startsWith("scripts/") ||
    relativePath.startsWith("src/") ||
    ["README.md", "Dockerfile", "package.json", ".env.example", ".env.local.template"].includes(relativePath)
  );
}

function collectFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith("._") || entry.name === ".DS_Store") continue;
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;

    const absolutePath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

for (const restrictedPath of restrictedPaths) {
  if (existsSync(resolve(root, restrictedPath))) {
    failures.push(`${restrictedPath}: legacy Selectel deployment surface must be removed or archived outside the active checkout`);
  }
}

const activePatterns = [
  [/(?:^|\n)\s*DEPLOYMENT_PROVIDER\s*=\s*['"]?selectel/i, "DEPLOYMENT_PROVIDER=selectel"],
  [/(?:^|\n)\s*SELECTEL_[A-Z0-9_]*\s*=/i, "SELECTEL_* runtime variable"],
  [/\bcr\.selcloud\.ru\b/i, "Selectel Container Registry endpoint"],
  [/\bdeploy\/selectel\b|\bcheck-selectel-database-url\b/i, "Selectel deployment implementation"],
  [/\b(?:ssh:\/\/)?(?:[a-z0-9-]+\.)?selectel\.(?:ru|com)\b/i, "Selectel SSH endpoint"],
  [/\b(?:postgres(?:ql)?|db)[^\n\s"']*selectel[^\n\s"']*/i, "Selectel database endpoint"],
  [/"(?:check|test|deploy|migrate):selectel[^"]*"\s*:/i, "Selectel npm task"],
  [/NEXT_PUBLIC_OPENAI_API_KEY\s*=/i, "public OpenAI API key variable"],
];

for (const file of collectFiles(root)) {
  const relativePath = toRelative(file);
  if (isAllowedLegacy(relativePath)) continue;

  const stat = statSync(file);
  if (stat.size > 1_000_000) continue;

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const [pattern, label] of activePatterns) {
    if (pattern.test(content)) failures.push(`${relativePath}: contains ${label}`);
  }

  if (mustBeSelectelFree(relativePath) && /\bselectel\b/i.test(content)) {
    failures.push(`${relativePath}: contains an active Selectel reference`);
  }
}

if (failures.length) {
  console.error("Timeweb-only guard: FAIL");
  for (const failure of [...new Set(failures)].sort()) console.error(`- ${failure}`);
  process.exit(1);
}

console.info("Timeweb-only guard: PASS");
