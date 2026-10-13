import type { AvitoOilType, AvitoProductSource, AvitoSettings } from "./types";

export const AVITO_TEMPLATE_VARIABLES = [
  { key: "название", label: "Название товара", title: true },
  { key: "описание", label: "Описание товара", title: false },
  { key: "заголовок", label: "Заголовок Авито", title: false },
  { key: "бренд", label: "Производитель", title: true },
  { key: "артикул", label: "Артикул", title: true },
  { key: "вязкость", label: "SAE", title: true },
  { key: "объём", label: "Объём", title: true },
  { key: "цена", label: "Цена, ₽", title: false },
  { key: "адрес", label: "Адрес филиала", title: false },
  { key: "телефон", label: "Телефон", title: false },
] as const;

export const AVITO_CONTENT_DEFAULTS = {
  titleTemplate: "{название}",
  titleRemovePhrases: ["моторное масло", "масло моторное", "трансмиссионное масло", "масло трансмиссионное"],
  autoShortenTitles: true,
  descriptionTemplate: "{описание}",
  categoryDescriptionTemplates: { motor: "", transmission: "" },
};

export function avitoTemplateIssues(template: string, title = false): string[] {
  const allowed = new Set<string>(AVITO_TEMPLATE_VARIABLES.filter((entry) => !title || entry.title).map((entry) => entry.key));
  const keys = [...template.matchAll(/\{([^{}]*)\}/gu)].map((match) => match[1].trim());
  const issues = [...new Set(keys.filter((key) => !allowed.has(key)))].map((key) => `Неизвестная переменная {${key}}`);
  if (/[{}]/u.test(template.replace(/\{[^{}]*\}/gu, ""))) issues.push("Проверьте скобки переменных в шаблоне");
  return issues;
}

/** Single-pass substitution: product text is data, never another template. */
export function renderAvitoTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{([^{}]*)\}/gu, (whole, key: string) => variables[key.trim()] ?? whole).trim();
}

export function shortenAvitoTitle(title: string, phrases: readonly string[], limit = 50): string {
  let result = title.replace(/\s+/gu, " ").trim();
  for (const phrase of phrases) {
    if ([...result].length <= limit) break;
    const pattern = phrase.trim().split(/\s+/u).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
    if (pattern) result = result.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${pattern}(?=$|[^\\p{L}\\p{N}])`, "giu"), "$1").replace(/\s+/gu, " ").replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/gu, "");
  }
  if ([...result].length <= limit) return result;
  const chars = [...result];
  let end = limit;
  if (chars[limit] !== " ") {
    const boundary = chars.slice(0, limit + 1).lastIndexOf(" ");
    if (boundary > 0) end = boundary;
  }
  return chars.slice(0, end).join("").replace(/[\s,;:–—-]+$/gu, "");
}

export function avitoBranchAddress(address: string | null | undefined, branchName: string): string {
  if (address?.trim()) return address.trim();
  const name = branchName.toLocaleLowerCase("ru-RU").replace(/[\s,]+/gu, " ").trim();
  if (/^(?:ул\. )?дачная(?: 6[вvb])?$/u.test(name)) return "Калининград, ул. Дачная, 6В";
  if (/^(?:ул\. )?(?:юрия )?гагарина(?: 116)?$/u.test(name)) return "Калининград, ул. Юрия Гагарина, 116";
  return "";
}

export function avitoSourceDescription(source: AvitoProductSource, type: AvitoOilType): string {
  if (source.description?.trim()) return source.description.trim();
  const lines = [source.name];
  if (source.brand) lines.push(`Производитель: ${source.brand}`);
  if (source.sae) lines.push(`SAE: ${source.sae}`);
  if (source.packageVolume) lines.push(`Объём: ${source.packageVolume}`);
  if (type === "motor" && (source.acea || source.aceaExtra)) lines.push(`ACEA: ${[source.acea, source.aceaExtra].filter(Boolean).join("; ")}`);
  if (type === "transmission" && source.atf) lines.push(`ATF: ${source.atf}`);
  if (source.apiSpec) lines.push(`API: ${source.apiSpec}`);
  const oem = type === "motor" ? source.oem : source.oemAtf;
  if (oem) lines.push(`Допуски производителя: ${oem}`);
  if (source.article) lines.push(`Артикул: ${source.article}`);
  return lines.join("\n");
}

export function avitoContentVariables(source: AvitoProductSource, settings: AvitoSettings, values: { title: string; brand: string; sae: string; volume: string; priceRubles: number | null }, type: AvitoOilType): Record<string, string> {
  return {
    название: source.name, описание: avitoSourceDescription(source, type), заголовок: values.title,
    бренд: values.brand, артикул: source.article ?? "", вязкость: values.sae, объём: values.volume,
    цена: values.priceRubles === null ? "" : new Intl.NumberFormat("ru-RU").format(values.priceRubles), адрес: settings.address, телефон: settings.phone,
  };
}
