import { parseStoredAttributeValues } from "@/lib/product-attribute-values";

type ClientOilMetadataSource = {
  name?: string;
  acea?: string;
  apiSpec?: string;
  ilsac?: string;
  oem?: string;
};

export function getClientOilOemApprovals(card: ClientOilMetadataSource) {
  return parseStoredAttributeValues(card.oem ?? "", "engineOem");
}

export function inferClientOilType(card: ClientOilMetadataSource) {
  const name = String(card.name ?? "");
  const api = String(card.apiSpec ?? "").toUpperCase();
  const acea = String(card.acea ?? "").toUpperCase();
  const ilsac = String(card.ilsac ?? "").toUpperCase();
  const combined = `${name} ${api} ${acea} ${ilsac}`;
  const parts: string[] = [];

  const hasGasoline = (
    /(?:^|[^A-Z0-9])S[A-Z](?:[^A-Z0-9]|$)/.test(api)
    || /(?:^|[^A-Z0-9])A\d(?:[^A-Z0-9]|$)/.test(acea)
    || /(?:^|[^A-Z0-9])C\d(?:[^A-Z0-9]|$)/.test(acea)
    || /GF[- ]?\d/.test(ilsac)
    || /бензин|gasoline|petrol/i.test(name)
  );
  const hasDiesel = (
    /(?:^|[^A-Z0-9])C(?:F(?:-?\d)?|G-?\d|H-?\d|I-?\d|J-?\d|K-?\d)(?:[^A-Z0-9]|$)/.test(api)
    || /(?:^|[^A-Z0-9])[BE]\d(?:[^A-Z0-9]|$)/.test(acea)
    || /(?:^|[^A-Z0-9])C\d(?:[^A-Z0-9]|$)/.test(acea)
    || /diesel|диз|dpf/i.test(name)
  );

  if (hasGasoline) parts.push("Бензин");
  if (hasDiesel) parts.push("Дизель");
  if (/hybrid|гибрид/i.test(combined)) parts.push("Гибрид");
  if (/(?:^|[^A-Z0-9])C\d(?:[^A-Z0-9]|$)/.test(acea) || /dpf|low[ -]?saps|mid[ -]?saps/i.test(combined)) parts.push("DPF");

  return parts.length ? [...new Set(parts)].join(" · ") : "Не указан";
}
