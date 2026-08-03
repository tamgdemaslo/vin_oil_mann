import { readFile } from "node:fs/promises";

const files = {
  workflow: ".github/workflows/deploy-selectel.yml",
  compose: "docker-compose.selectel.yml",
  dockerfile: "Dockerfile",
  deploy: "deploy/selectel/deploy-image.sh",
};

const source = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readFile(file, "utf8")]))
);

const errors = [];
function requirePattern(file, pattern, reason) {
  if (!pattern.test(source[file])) errors.push(`${files[file]}: ${reason}`);
}
function forbidPattern(file, pattern, reason) {
  if (pattern.test(source[file])) errors.push(`${files[file]}: ${reason}`);
}

requirePattern("workflow", /docker\/build-push-action@/, "image must be built with buildx in CI");
requirePattern("workflow", /deploy-image\.sh/, "deployment must call the server-side digest deploy script");
requirePattern("workflow", /git status --porcelain/, "CI must reject a dirty checkout");
requirePattern("workflow", /default: BUILD_ONLY/, "workflow must default to build/push without switching traffic");
requirePattern(
  "workflow",
  /if: \$\{\{ inputs\.deployment_mode == 'DEPLOY_PRODUCTION' \}\}/,
  "production switch must require explicit DEPLOY_PRODUCTION mode"
);
forbidPattern("workflow", /\brsync\b/, "source uploads are forbidden");
forbidPattern("workflow", /docker compose[^\n]*--build/, "production server builds are forbidden");
forbidPattern("workflow", /railway/i, "Railway is forbidden in the Selectel production workflow");

forbidPattern("compose", /^\s+build:/m, "production Compose services must use registry images");
forbidPattern("compose", /prisma migrate deploy/, "ordinary application startup must not run migrations");
requirePattern("compose", /app_blue:/, "blue slot is missing");
requirePattern("compose", /app_green:/, "green slot is missing");

requirePattern("dockerfile", /\.next\/standalone/, "runtime must use Next.js standalone output");
forbidPattern("dockerfile", /npm install/, "Docker build must use deterministic npm ci only");
requirePattern("deploy", /cr\.selcloud\.ru\//, "deploy script must enforce Selectel Container Registry");
requirePattern("deploy", /flock -n/, "server-side deployment lock is missing");
requirePattern("deploy", /automatic-rollback/, "automatic rollback is missing");
requirePattern(
  "deploy",
  /docker compose -p "\$COMPOSE_PROJECT_NAME"/,
  "deployment must reuse the canonical Compose project network and volumes"
);

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.info("Selectel immutable deployment policy: PASS");
