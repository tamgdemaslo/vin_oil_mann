export type ExternalSideEffect =
  | "telegram_send"
  | "webhook_processing"
  | "payment_mutation"
  | "tbank_mutation"
  | "supplier_order"
  | "email_send"
  | "yclients_mutation"
  | "legacy_mutation"
  | "rossko_order";

const flags: Record<ExternalSideEffect, string> = {
  telegram_send: "TELEGRAM_SEND_ENABLED",
  webhook_processing: "WEBHOOK_PROCESSING_ENABLED",
  payment_mutation: "PAYMENT_MUTATIONS_ENABLED",
  tbank_mutation: "TBANK_MUTATIONS_ENABLED",
  supplier_order: "SUPPLIER_ORDER_ENABLED",
  email_send: "EMAIL_SEND_ENABLED",
  yclients_mutation: "YCLIENTS_MUTATIONS_ENABLED",
  legacy_mutation: "LEGACY_MUTATIONS_ENABLED",
  rossko_order: "ROSSKO_ORDER_ENABLED",
};

function enabled(name: string) {
  return process.env[name]?.trim().toLowerCase() !== "false";
}

export function externalSideEffectAllowed(effect: ExternalSideEffect) {
  if (!enabled("EXTERNAL_SIDE_EFFECTS_ENABLED")) return false;
  if (!enabled(flags[effect])) return false;
  if (process.env.APP_ENV === "branch-migration-rehearsal" && process.env.EXTERNAL_SIDE_EFFECTS_ENABLED !== "true") {
    return false;
  }
  return true;
}

export function assertExternalSideEffectAllowed(effect: ExternalSideEffect) {
  if (!externalSideEffectAllowed(effect)) throw new Error(`External side effect blocked: ${effect}`);
}
