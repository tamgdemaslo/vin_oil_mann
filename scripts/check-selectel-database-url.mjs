const raw = process.env.DATABASE_URL?.trim();

if (!raw) {
  console.error("DATABASE_URL is required");
  process.exit(2);
}

let databaseUrl;
try {
  databaseUrl = new URL(raw);
} catch {
  console.error("DATABASE_URL is invalid");
  process.exit(2);
}

const hostname = databaseUrl.hostname.toLowerCase();
const forbidden = ["railway", "rlwy", "proxy.rlwy.net"];
if (forbidden.some((fragment) => hostname.includes(fragment))) {
  console.error("Refusing production migration: DATABASE_URL points to Railway");
  process.exit(3);
}

const allowedHosts = (process.env.SELECTEL_DATABASE_HOSTS || "postgres,localhost,127.0.0.1")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

if (!allowedHosts.includes(hostname)) {
  console.error("Refusing production migration: database host is not in SELECTEL_DATABASE_HOSTS");
  process.exit(4);
}

console.info(`Selectel database policy passed for host ${hostname}`);
