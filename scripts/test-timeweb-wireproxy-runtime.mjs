#!/usr/bin/env node

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dockerfile = readFileSync(resolve(root, "Dockerfile"), "utf8");
const startupPath = resolve(root, "deploy/timeweb/start-app.sh");
const startup = readFileSync(startupPath, "utf8");

const shellCheck = spawnSync("sh", ["-n", startupPath], { encoding: "utf8" });
assert.equal(shellCheck.status, 0, shellCheck.stderr || "start-app.sh syntax check failed");

assert.match(dockerfile, /WIREPROXY_VERSION=v1\.1\.3/);
assert.match(dockerfile, /wireproxy_linux_\$\{TARGETARCH\}\.tar\.gz/);
assert.match(dockerfile, /e88c1d090740373fc606c1bafd81d9a5eadc642cce5667616e20e9d7a444f51c/);
assert.match(dockerfile, /370e00bd2167960d1ecd1c3c1439715bbaa94a0a110a2040468670c9af6021b6/);
assert.match(dockerfile, /COPY --from=wireproxy \/usr\/local\/bin\/wireproxy \/usr\/local\/bin\/wireproxy/);

assert.match(startup, /BindAddress = 127\.0\.0\.1:8888/);
assert.doesNotMatch(startup, /BindAddress\s*=\s*(?:0\.0\.0\.0|\[::\])/);
assert.match(startup, /unset WIREPROXY_CONFIG/);
assert.match(startup, /section != "\[interface\]" && section != "\[peer\]"/);
assert.match(startup, /--proxy "\$local_proxy_url"/);
assert.match(startup, /https:\/\/api\.openai\.com\/v1\/models/);
assert.match(startup, /if \[ "\$openai_status" = "401" \]/);
assert.match(startup, /if \[ "\$openai_status" = "403" \]/);

console.info("Timeweb WireGuard proxy runtime guard: PASS");
