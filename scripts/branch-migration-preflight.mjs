const errors = [];
const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!databaseUrl) errors.push("DATABASE_URL is required");
if (/railway/i.test(databaseUrl)) errors.push("DATABASE_URL points to Railway");
if (process.env.RAILWAY_SELECTEL_RECONCILIATION_STATUS !== "VERIFIED") {
  errors.push("RAILWAY_SELECTEL_RECONCILIATION_STATUS must equal VERIFIED");
}
if (process.env.APP_ENV !== "branch-migration-rehearsal") errors.push("APP_ENV must equal branch-migration-rehearsal");
if (process.env.DEPLOYMENT_PROVIDER !== "selectel-rehearsal") errors.push("DEPLOYMENT_PROVIDER must equal selectel-rehearsal");
for (const name of [
  "EXTERNAL_SIDE_EFFECTS_ENABLED",
  "TELEGRAM_SEND_ENABLED",
  "WEBHOOK_PROCESSING_ENABLED",
  "PAYMENT_MUTATIONS_ENABLED",
  "TBANK_MUTATIONS_ENABLED",
  "SUPPLIER_ORDER_ENABLED",
  "EMAIL_SEND_ENABLED",
  "YCLIENTS_MUTATIONS_ENABLED",
  "MOYSKLAD_MUTATIONS_ENABLED",
  "ROSSKO_ORDER_ENABLED",
]) {
  if (process.env[name] !== "false") errors.push(`${name} must equal false`);
}
if (errors.length) {
  console.error(`Branch migration preflight NO-GO:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
const hostname = new URL(databaseUrl).hostname;
console.log(`Branch migration rehearsal preflight passed for ${hostname}. No migration was executed.`);
