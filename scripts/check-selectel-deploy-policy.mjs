import { readFile } from "node:fs/promises";

const files = {
  workflow: ".github/workflows/deploy-selectel.yml",
  migrationWorkflow: ".github/workflows/migrate-selectel.yml",
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

requirePattern("workflow", /\n  push:\n    branches:\n      - "\*\*"/, "push CI trigger is missing");
requirePattern("workflow", /\n  pull_request:/, "pull-request CI trigger is missing");
requirePattern("workflow", /\n  workflow_dispatch:/, "manual BUILD_ONLY mode is missing");
requirePattern("workflow", /default: BUILD_ONLY/, "manual workflow must default to BUILD_ONLY");
requirePattern("workflow", /docker\/build-push-action@/, "image must be built with buildx in CI");
requirePattern("workflow", /git status --porcelain/, "CI must reject a dirty checkout");
requirePattern(
  "workflow",
  /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/,
  "automatic image publication and deployment must be restricted to main pushes"
);
requirePattern(
  "workflow",
  /group:.*production-deploy/,
  "production deployment concurrency group is missing"
);
requirePattern(
  "workflow",
  /git merge-base --is-ancestor "\$active_commit" "\$CANDIDATE_COMMIT"/,
  "active production must be an ancestor of the candidate"
);
requirePattern("workflow", /status=migration_approval_required/, "new migrations must stop automatic deployment");
requirePattern("workflow", /status=migration_history_violation/, "changed migration history must fail closed");
requirePattern("workflow", /SELECTEL_AUTO_DEPLOY_ENABLED == 'true'/, "automatic deploy requires the one-time activation guard");
requirePattern("workflow", /candidate_not_in_main/, "candidate commit must be present in main");
requirePattern("workflow", /deployment_lock_busy/, "deployment gate must check the shared server lock");
requirePattern("workflow", /name: migration_approval_required/, "migration approval blocker job is missing");
requirePattern(
  "workflow",
  /needs\.deployment_gate\.outputs\.status == 'deploy_allowed'/,
  "production deploy must require a successful deployment gate"
);
requirePattern("workflow", /test "\$\{\{ github\.ref \}\}" = refs\/heads\/main/, "deploy job must enforce main");
requirePattern("workflow", /deploy-image\.sh/, "deployment must call the server-side digest deploy script");
requirePattern("workflow", /IMAGE_DIGEST: \$\{\{ needs\.image\.outputs\.app_digest \}\}/, "deploy must use the immutable build digest");
requirePattern("workflow", /needs\.deploy\.result == 'success'/, "Git tag must only follow a successful switch");
forbidPattern("workflow", /prisma migrate deploy/, "application release workflow must never execute migrations");
forbidPattern("workflow", /\brsync\b/, "source uploads are forbidden");
forbidPattern("workflow", /docker compose[^\n]*--build/, "production server builds are forbidden");
forbidPattern("workflow", /railway/i, "Railway is forbidden in the Selectel production workflow");

requirePattern("migrationWorkflow", /environment: production-migration/, "migrations require a separately protected environment");
requirePattern("migrationWorkflow", /group: production-deploy/, "migration and deployment must share a lock");
requirePattern("migrationWorkflow", /migrate-image\.sh/, "approved migrations must use the migration-only server script");

forbidPattern("compose", /^\s+build:/m, "production Compose services must use registry images");
forbidPattern("compose", /prisma migrate deploy/, "ordinary application startup must not run migrations");
requirePattern("compose", /app_blue:/, "blue slot is missing");
requirePattern("compose", /app_green:/, "green slot is missing");
requirePattern("compose", /worker_notifications_blue:/, "blue notification worker role is missing");
requirePattern("compose", /worker_notifications_green:/, "green notification worker role is missing");
requirePattern("compose", /CLIENT_NOTIFICATIONS_WORKER_DISABLED: "1"/, "web slots must disable notification workers");
requirePattern("compose", /QUEUE_CONSUMER_ENABLED: "false"/, "web and notification roles must disable queue consumers");

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
console.info("Selectel automatic immutable deployment policy: PASS");
