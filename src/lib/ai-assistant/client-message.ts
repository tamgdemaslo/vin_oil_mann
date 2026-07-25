import { quoteItems, quoteStrings } from "./quotes";

export type ClientMessageMode = "short_with_price" | "short_without_price" | "detailed_with_price" | "only_final_price" | "recommendation";

type QuoteForClientMessage = {
  id: string;
  status: string;
  vehicleDisplayName: string | null;
  serviceName: string | null;
  selectedScenario: string | null;
  includedItemsJson: unknown;
  optionalItemsJson: unknown;
  baseTotalCents: number;
  maximumTotalCents: number | null;
  priceRangeJson: unknown;
  assumptionsJson: unknown;
  internalWarningsJson: unknown;
  customerSafeWarningsJson: unknown;
  validUntil: Date | null;
};

export type ClientMessageResult = {
  message: string;
  quoteId: string;
  mode: ClientMessageMode;
  includedPrice: boolean;
  usedBaseTotal: number;
  usedMaximumTotal: number | null;
  includedInternalWarnings: string[];
  includedCustomerWarnings: string[];
  callToAction: string;
};

function normalized(value: string) {
  return value.toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

function requestedMode(value: string): ClientMessageMode | null {
  const command = normalized(value);
  const refersToClientText = /(клиент|сообщени|текст)/.test(command);
  const correctionWithPrice = /^(?:не|нет|неа|не так)[,.! ]*(?:с )?(?:расчет|цен)/.test(command);
  if (!refersToClientText && !correctionWithPrice) return null;
  if (/(?:рекомендац|посоветуй)/.test(command)) return "recommendation";
  if (/(?:только|лишь).*(?:цен|итог)|итогов(?:ая|ую)?.*цен/.test(command)) return "only_final_price";
  if (/(?:подробн|развернут)/.test(command)) return "detailed_with_price";
  if (/(?:без цены|без цен|без расчет|без расч)/.test(command)) return "short_without_price";
  return "short_with_price";
}

export function detectClientMessageMode(message: string, requested?: string | null) {
  const requestedValue = normalized(requested ?? "");
  if (["short_with_price", "short_without_price", "detailed_with_price", "only_final_price", "recommendation"].includes(requestedValue)) return requestedValue as ClientMessageMode;
  // A natural-language request may ask for both a calculation and a future
  // customer text.  It must enter the research/quote workflow first rather
  // than being mistaken for a request to format a quote that does not exist.
  if (/(?:рассч|подбор|техническ|vin\b|вина\b|замен\w*\s+(?:масл|фильтр)|акпп|вариатор|\bcvt\b|\bdsg\b)/i.test(message)) return null;
  return requestedMode(message);
}

export function explicitCustomerRecommendation(message: string) {
  const source = message.trim().replace(/\s+/g, " ");
  const recommendationIndex = source.search(/рекомендац(?:ию|ия)?/i);
  const tail = recommendationIndex >= 0
    ? source.slice(recommendationIndex).replace(/^рекомендац(?:ию|ия)?/i, "")
    : (source.match(/добав(?:ь|ить)\s+(.+)$/i)?.[1] ?? "");
  const value = tail
    .replace(/^\s*(?:(?:к|для)\s+)?сообщени\w*(?:\s+клиент\w*)?\s*[:—-]?\s*/i, "")
    .trim()
    .replace(/[.。]+$/, "");
  if (!value || /^(?:к|для)\s+(?:сообщени\w*|клиент\w*)$/i.test(value)) return null;
  return value.slice(0, 260);
}

function roundStepRubles() {
  const configured = Number(process.env.AI_ASSISTANT_CLIENT_PRICE_ROUNDING_RUBLES);
  return Number.isInteger(configured) && configured >= 1 && configured <= 1_000 ? configured : 100;
}

function formatPrice(cents: number) {
  const roundedRubles = Math.round(cents / 100 / roundStepRubles()) * roundStepRubles();
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(roundedRubles)} ₽`;
}

function listItems(quote: QuoteForClientMessage, detailed: boolean) {
  const names = quoteItems(quote.includedItemsJson).map((item) => item.name).filter(Boolean);
  if (!names.length) return "работа и материалы по расчёту";
  const limit = detailed ? 6 : 4;
  const visible = names.slice(0, limit);
  return names.length > limit ? `${visible.join(", ")} и другие расходники` : visible.join(", ");
}

function oneSafeWarning(quote: QuoteForClientMessage) {
  return quoteStrings(quote.customerSafeWarningsJson, 1)[0] || "Перед началом работ окончательно сверим комплект и необходимый объём.";
}

function priceSentence(quote: QuoteForClientMessage) {
  const base = formatPrice(quote.baseTotalCents);
  const maximum = quote.maximumTotalCents && quote.maximumTotalCents > quote.baseTotalCents ? quote.maximumTotalCents : null;
  if (!maximum) return `Стоимость — ${base}.`;
  const configuredCondition = String((quote.priceRangeJson && typeof quote.priceRangeJson === "object" && !Array.isArray(quote.priceRangeJson) ? quote.priceRangeJson as Record<string, unknown> : {}).maximumPriceSentence || "").trim().replace(/[.]+$/, "");
  const condition = configuredCondition || "Если потребуется дополнительный объём жидкости";
  return `Стоимость — от ${base}. ${condition}, итог составит до ${formatPrice(maximum)}.`;
}

export function buildClientMessage(quote: QuoteForClientMessage, mode: ClientMessageMode, recommendation?: string | null): ClientMessageResult {
  if (quote.status !== "draft" || !quote.vehicleDisplayName || !quote.serviceName) {
    throw new Error("В выбранном расчёте не хватает автомобиля или состава работ. Сначала уточните расчёт.");
  }
  const callToAction = "Подобрать удобное время?";
  const warning = oneSafeWarning(quote);
  const includedPrice = mode !== "short_without_price" && mode !== "recommendation";
  const lines: string[] = [];
  const detail = mode === "detailed_with_price";

  if (mode === "only_final_price") {
    lines.push(`Предварительная стоимость ${quote.serviceName.toLocaleLowerCase("ru-RU")} для ${quote.vehicleDisplayName} — ${priceSentence(quote).replace(/^Стоимость — /, "").replace(/\.$/, "")}.`);
  } else if (mode === "recommendation") {
    lines.push(`Для вашего ${quote.vehicleDisplayName} рекомендуем ${quote.serviceName.toLocaleLowerCase("ru-RU")}.`);
    lines.push(`В предварительный расчёт входят: ${listItems(quote, false)}.`);
    if (recommendation) lines.push(`Рекомендуем: ${recommendation}.`);
  } else {
    lines.push(`Добрый день! Для вашего ${quote.vehicleDisplayName} предварительно рассчитали ${quote.serviceName.toLocaleLowerCase("ru-RU")}.`);
    lines.push(`${detail ? "В расчёт включили" : "Включили"}: ${listItems(quote, detail)}.`);
    if (includedPrice) lines.push(priceSentence(quote));
    if (detail) {
      const optional = quoteStrings(quote.optionalItemsJson, 4);
      if (optional.length) lines.push(`Отдельно, по желанию: ${optional.join(", ")}.`);
    }
  }

  lines.push(`${warning} ${callToAction}`);
  const message = lines.join("\n\n");
  return {
    message,
    quoteId: quote.id,
    mode,
    includedPrice,
    usedBaseTotal: quote.baseTotalCents,
    usedMaximumTotal: quote.maximumTotalCents && quote.maximumTotalCents > quote.baseTotalCents ? quote.maximumTotalCents : null,
    includedInternalWarnings: [],
    includedCustomerWarnings: [warning],
    callToAction,
  };
}
