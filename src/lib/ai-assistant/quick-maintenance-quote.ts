import { normalizeVehicleMake } from "@/lib/vehicle-normalization";
import { prisma } from "@/lib/db";
import { lookupVehicle } from "@/lib/vehicle-identity";
import { addMannResearchCatalogToProfile } from "@/lib/mann-research-catalog";
import { researchMissingMannFluids } from "@/lib/mann-fluid-research";
import { loadMaintenanceQuoteStock } from "@/lib/maintenance-quote-stock";
import { groupQuoteOils, quoteExtraCents, quoteRequirementChoices, quoteRub, quoteVariantAmount, sortQuoteFilterOffers, type QuoteExtra } from "@/lib/maintenance-quote";
import { normalizeSAE } from "@/lib/oil-normalizer";
import { getAgentSettings } from "@/lib/ai-agent/settings";
import { rosskoConfig, rosskoSearch } from "@/lib/rossko";
import { quoteRosskoFilters } from "@/lib/maintenance-quote-rossko";
import type { QuickAnswer } from "@/lib/quick-assistant";
import type { AIAssistantAccess } from "./access";
import { resolveLaborPrice } from "./labor-pricing";
import { assistantTariffContext } from "./tariff-context";
import { mannContext, mannResolutionDiagnostic } from "./technical-context";

const filterLabels = { oil: "Масляный", air: "Воздушный", cabin: "Салонный", fuel: "Топливный" } as const;
type FilterKind = keyof typeof filterLabels;

export async function quickMaintenanceQuote(access: AIAssistantAccess, input: {
  vin: string; expectedMake: string; viscosities: string[]; filterTypes: string[]; warehouse: string;
}): Promise<QuickAnswer> {
  const sources: QuickAnswer["sources"] = [];
  const answer = (text: string): QuickAnswer => ({ text, sources });
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(input.vin)) return answer("Укажите VIN из 17 символов для расчёта ТО.");
  const stores = await prisma.localStore.findMany({
    where: { branchId: access.branchId, archived: false },
    select: { id: true, name: true, isMain: true },
  });
  const choices = input.warehouse
    ? stores.filter(store => store.id === input.warehouse || store.name.toLowerCase() === input.warehouse.toLowerCase())
    : stores.length === 1 ? stores : stores.filter(store => store.isMain);
  if (choices.length !== 1) {
    return answer(stores.length ? `Выберите склад: ${stores.map(store => store.name).join(", ")}.` : "В выбранном филиале нет активных складов.");
  }
  const store = choices[0];
  const decoded = await lookupVehicle({
    organizationId: access.organizationId, inputType: "vin", input: input.vin, actorLogin: access.actorId,
  });
  if (decoded.status !== "found" || !decoded.vehicle || decoded.candidates.length !== 1) {
    return answer("По VIN не удалось однозначно определить автомобиль. Проверьте модификацию перед расчётом ТО.");
  }
  const vehicle = decoded.vehicle;
  const expectedMake = normalizeVehicleMake(input.expectedMake);
  const decodedMake = normalizeVehicleMake(vehicle.makeCanonical || vehicle.makeRaw);
  if (expectedMake && decodedMake && expectedMake !== decodedMake) {
    const decodedLabel = [vehicle.makeRaw || decodedMake, vehicle.modelRaw].filter(Boolean).join(" ");
    return answer(`В запросе указана марка ${input.expectedMake}, а по VIN найден ${decodedLabel}. Проверьте VIN или выберите автомобиль в каталоге для расчёта ТО.`);
  }
  const { resolution, profile } = await mannContext(access.organizationId, vehicle, store.id);
  if (resolution.status !== "resolved" || !resolution.selectedApplication) {
    const diagnostic = mannResolutionDiagnostic(resolution);
    if (diagnostic.code === "MANN_CONFIRMATION_REQUIRED") {
      const vehicleLabel = [vehicle.makeRaw, vehicle.modelRaw, vehicle.year, vehicle.engineCode].filter(Boolean).join(" ");
      return answer(`${vehicleLabel || input.vin}: VIN распознан, но модификация в MANN ещё не подтверждена. Подтвердите соответствие в каталоге MANN, чтобы подобрать расходники и рассчитать цену.`);
    }
    return answer(diagnostic.message);
  }
  const variantKeys = resolution.selectedApplication.variantIds;
  const profileInput = { organizationId: access.organizationId, variantKeys, profile };
  let currentProfile = await addMannResearchCatalogToProfile(profileInput);
  let requirements = quoteRequirementChoices(currentProfile, null);
  if (!requirements.specifications.length || !requirements.automaticVolume) {
    const research = await researchMissingMannFluids({ ...profileInput, profile: currentProfile, group: "basic" });
    currentProfile = await addMannResearchCatalogToProfile(profileInput);
    requirements = quoteRequirementChoices(currentProfile, research);
  }

  const vehicleLabel = [vehicle.makeRaw, vehicle.modelRaw, vehicle.year, vehicle.engineCode].filter(Boolean).join(" ");
  const lines = [`Расчёт ТО · ${vehicleLabel || input.vin} · ${store.name}`];
  const extras: QuoteExtra[] = [];
  let complete = true;
  const selectedFilters = [...new Set(input.filterTypes.filter((value): value is FilterKind => Object.hasOwn(filterLabels, value)))];
  const requestedFilters: FilterKind[] = selectedFilters.length ? selectedFilters : ["oil"];
  const fallback = async (article: string) => {
    try {
      const [cfg, settings] = await Promise.all([rosskoConfig(), getAgentSettings(access.organizationId)]);
      if (!cfg.deliveryId?.trim()) return null;
      const data = await rosskoSearch(cfg, { text: `MANN ${article}`, deliveryId: cfg.deliveryId, addressId: cfg.addressId });
      return sortQuoteFilterOffers(quoteRosskoFilters(data, article, access.branchId, settings.rosskoMarkupRules, access.context.branch?.timezone), "price")[0] ?? null;
    } catch {
      return null;
    }
  };

  const filterResults = await Promise.all(requestedFilters.map(async kind => {
    const articles = [...new Set(resolution.filters.filter(filter => filter.filterType === kind).map(filter => filter.mannArticle))];
    if (articles.length !== 1) return { kind, articles, offer: null };
    const [article] = articles;
    const stock = sortQuoteFilterOffers(resolution.localMatches
      .filter(match => match.mannArticle === article)
      .flatMap(match => match.compatibleProducts)
      .filter(product => product.available >= 1 && product.price > 0)
      .map(product => ({ ...product, brand: product.brand ?? undefined })), "price")[0];
    return { kind, articles, offer: stock ?? await fallback(article) };
  }));

  for (const { kind, articles, offer } of filterResults) {
    const label = `${filterLabels[kind]} фильтр`;
    if (!offer) {
      complete = false;
      lines.push(articles.length > 1 ? `${label}: MANN ${articles.join(", ")}. Требуется уточнить вариант.`
        : `${label}: ${articles.length ? `MANN ${articles[0]}, цена и наличие не подтверждены` : "артикул MANN не подтверждён"}.`);
      continue;
    }
    extras.push({ id: offer.id, name: offer.name, quantity: 1, price: offer.price });
    lines.push(`${label}: MANN ${articles[0]} · ${offer.name} · ${quoteRub(Math.round(offer.price * 100))}${offer.source === "rossko" ? ` · ROSSKO, ${offer.deliveryLabel ?? "под заказ"}` : ""}.`);
    if (offer.source !== "rossko") sources.push({ label: offer.name, href: `/inventory/products?product=${encodeURIComponent(offer.id)}` });
  }

  const tariff = await assistantTariffContext(access.organizationId);
  const laborBase = {
    organizationId: access.organizationId, locationId: tariff.locationId ?? "",
    materialsOwner: "service", aggregateCode: vehicle.engineCode,
    vehicle: { ...vehicle, make: vehicle.makeRaw, model: vehicle.modelRaw },
  };
  const labor = await resolveLaborPrice({
    ...laborBase, serviceFamily: "engine_oil", procedureType: "oil_change",
  });
  if (labor.requiresHumanConfirmation || labor.laborPriceCents == null || labor.priceFromCents != null || labor.priceToCents != null) {
    complete = false;
    lines.push("Работа: точный тариф не подтверждён.");
  } else {
    extras.push({ id: "engine-oil-labor", name: "Замена моторного масла", quantity: 1, price: labor.laborPriceCents / 100 });
    lines.push(`Работа по замене масла: ${labor.laborPriceCents === 0 ? "включена" : quoteRub(labor.laborPriceCents)}.`);
  }
  for (const kind of requestedFilters.filter(kind => kind !== "oil")) {
    const label = `Замена фильтра (${filterLabels[kind].toLowerCase()})`;
    const labor = await resolveLaborPrice({ ...laborBase, serviceFamily: `${kind}_filter`, procedureType: "replace" });
    if (labor.requiresHumanConfirmation || labor.laborPriceCents == null || labor.priceFromCents != null || labor.priceToCents != null) {
      complete = false;
      lines.push(`${label}: точный тариф не подтверждён.`);
    } else {
      extras.push({ id: `${kind}-filter-labor`, name: label, quantity: 1, price: labor.laborPriceCents / 100 });
      lines.push(`${label}: ${quoteRub(labor.laborPriceCents)}.`);
    }
  }

  const litres = Number(requirements.automaticVolume);
  if (!requirements.specifications.length || !litres) {
    complete = false;
    lines.push(`Для расчёта масла уточните ${[!requirements.specifications.length && "допуск", !litres && "сервисный объём"].filter(Boolean).join(" и ")}.`);
    if (requirements.specifications.length) lines.push(`По профилю: ${requirements.specifications.join(", ")}.`);
    if (requirements.volumes.length) lines.push(`В профиле указаны объёмы: ${requirements.volumes.join(", ")} л.`);
    if (extras.length) lines.push(`Подтверждённые позиции: ${quoteRub(quoteExtraCents(extras))}.`);
    if (!requirements.specifications.length) return answer(lines.join("\n"));
  }

  const requestedViscosities = normalizeSAE(input.viscosities.join("; ")).slice(0, 4);
  const viscosities = requestedViscosities.length ? requestedViscosities : requirements.viscosities.length ? requirements.viscosities.slice(0, 4) : [""];
  const specification = requirements.specifications.join("; ");
  lines.push(`Масло: ${specification}${litres ? ` · ${litres} л` : ""}.`);
  const rows = await Promise.all(viscosities.map(async viscosity => {
    const oils = await loadMaintenanceQuoteStock({ branchId: access.branchId, storeId: store.id, specification, viscosity });
    if (!litres) return { viscosity, stockOnly: oils.slice(0, 3), best: undefined };
    const options = groupQuoteOils(oils).flatMap(variant => {
      const amount = quoteVariantAmount(variant, litres);
      return amount?.enough ? [{ variant, amount }] : [];
    }).sort((a, b) => a.amount.cents - b.amount.cents);
    return { viscosity, best: options[0] };
  }));
  for (const { viscosity, best, stockOnly } of rows) {
    const label = viscosity || "Масло";
    if (stockOnly?.length) {
      lines.push(`${label}: ${stockOnly.map(oil => `${oil.name} · ${oil.available} ${oil.unit} · ${quoteRub(Math.round(oil.price * 100))}`).join(" / ")}.`);
      continue;
    }
    if (!best) {
      lines.push(`${label}: ${litres ? "подходящего объёма на складе нет" : "позиций с этим допуском на складе нет"}.`);
      continue;
    }
    const { variant, amount } = best;
    const packageLines = amount.lines.map(line => `${line.quantity} ${line.product.unit} × ${quoteRub(Math.round(line.product.price * 100))}`).join(" + ");
    lines.push(`${label}: ${variant.name} (${packageLines}), ${amount.suppliedLitres} л. ${complete ? "Итого" : "Подтверждённая часть"}: ${quoteRub(amount.cents + quoteExtraCents(extras))}.`);
    for (const { product } of amount.lines) sources.push({ label: product.name, href: `/inventory/products?product=${encodeURIComponent(product.id)}` });
  }
  return answer(lines.join("\n"));
}
