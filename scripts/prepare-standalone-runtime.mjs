import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");
const standaloneServer = path.join(standaloneRoot, "server.js");

await access(standaloneServer);

const staticSource = path.join(projectRoot, ".next", "static");
const staticTarget = path.join(standaloneRoot, ".next", "static");
await mkdir(path.dirname(staticTarget), { recursive: true });
await cp(staticSource, staticTarget, { recursive: true, force: true });

const publicSource = path.join(projectRoot, "public");
const publicTarget = path.join(standaloneRoot, "public");
await cp(publicSource, publicTarget, { recursive: true, force: true });

console.log("Standalone runtime assets prepared");
