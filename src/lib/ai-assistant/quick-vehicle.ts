import type { AIAssistantAccess } from "./access";
import { buildTechnicalCustomerAnswer } from "./technical-answer";
import { mannContext, mannResolutionDiagnostic, technicalSystems, verifiedLocalTechnicalInput } from "./technical-context";
import { parseQuoteAndTechCardInput } from "./quote-and-tech-card";
import { getFiltersFromPartsCatalogs } from "@/lib/parts-catalogs-filters";
import { normalizeVehicleMake } from "@/lib/vehicle-normalization";
import { lookupVehicle } from "@/lib/vehicle-identity";
import type { QuickAnswer } from "@/lib/quick-assistant";

export async function answerQuickVehicle(access: AIAssistantAccess, question: string, requestedSystem: unknown, expectedMakeHint = ""): Promise<QuickAnswer> {
  const vin = question.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/u)?.[0];
  if (!vin) return { text: "Укажите VIN из 17 символов и нужные расходники или агрегат.", sources: [] };

  const expectedMake = normalizeVehicleMake(expectedMakeHint);
  const wantsOriginal = /оригинал|\b(?:OEM|OE)\b/iu.test(question) && /фильтр/iu.test(question);
  const requestedTypes = [
    /маслян/iu.test(question) && "oil", /воздуш/iu.test(question) && "air",
    /топлив/iu.test(question) && "fuel", /салон/iu.test(question) && "cabin",
  ].filter(Boolean);
  if (wantsOriginal && process.env.PARTS_CATALOGS_API_KEY?.trim()) {
    const oem = await getFiltersFromPartsCatalogs(vin, { strictVin: true, signal: AbortSignal.timeout(10_000) }).catch(() => null);
    const catalogMake = normalizeVehicleMake(oem?.make);
    if (oem && catalogMake && (!expectedMake || catalogMake === expectedMake)) {
      const entries = [
        { kind: "oil", label: "Масляный", numbers: oem.oilFilterOem },
        { kind: "air", label: "Воздушный", numbers: oem.airFilterOem },
        { kind: "fuel", label: "Топливный", numbers: oem.fuelFilterOem },
        { kind: "cabin", label: "Салонный", numbers: oem.cabinFilterOem },
      ].filter(entry => !requestedTypes.length || requestedTypes.includes(entry.kind));
      if (entries.some(entry => entry.numbers)) {
        return { text: [
          [oem.make, oem.model, oem.modelYear].filter(Boolean).join(" "),
          ...entries.map(entry => `${entry.label} фильтр: ${entry.numbers ?? "оригинальный номер не найден"}${entry.numbers?.includes(",") ? " (несколько вариантов, нужен выбор по комплектации)" : ""}.`),
          "Источник: Parts Catalogs, поиск по VIN.",
        ].join("\n"), sources: [] };
      }
    }
  }

  const decoded = await lookupVehicle({
    organizationId: access.organizationId, input: vin, inputType: "vin", actorLogin: access.actorId,
  });
  const vehicle = decoded.vehicle;
  if (decoded.status !== "found" || !vehicle || decoded.candidates.length !== 1) {
    return { text: "Не удалось однозначно определить автомобиль по VIN. Проверьте VIN или уточните модификацию в каталоге.", sources: [] };
  }

  const decodedMake = normalizeVehicleMake(vehicle.makeCanonical || vehicle.makeRaw);
  if (expectedMake && decodedMake && expectedMake !== decodedMake) {
    return { text: `В запросе указана марка ${expectedMakeHint}, а по VIN найден ${[vehicle.makeRaw || decodedMake, vehicle.modelRaw].filter(Boolean).join(" ")}. Проверьте VIN или уточните автомобиль.`, sources: [] };
  }

  const { resolution } = await mannContext(access.organizationId, vehicle);
  const label = [vehicle.makeRaw, vehicle.modelRaw, vehicle.year, vehicle.engineCode].filter(Boolean).join(" ");
  if (resolution.status !== "resolved") {
    return { text: [label, mannResolutionDiagnostic(resolution).message].filter(Boolean).join("\n\n"), sources: [] };
  }

  const wantsFilters = /расходник|фильтр|(?:подбер|подбор).{0,30}vin/iu.test(question);
  const wantsFacts = /допуск|спецификац|вязкост|объ[её]м|сколько\s+литр/iu.test(question);
  const lines = [label].filter(Boolean);
  const sources: QuickAnswer["sources"] = [];
  if (wantsFilters) {
    if (wantsOriginal) lines.push("Оригинальный номер фильтра по VIN не подтверждён.");
    const types: Record<string, string> = { oil: "Масляный", air: "Воздушный", fuel: "Топливный", cabin: "Салонный" };
    const filters = resolution.filters
      .filter(filter => !requestedTypes.length || requestedTypes.includes(filter.filterType));
    const articles = [...new Set(filters.map(filter => {
      const conditions = [filter.filterNote?.trim(), filter.condition?.trim()].filter(Boolean).join("; ");
      return `${types[filter.filterType] ?? filter.filterType}: ${filter.mannArticle}${conditions ? ` (${conditions})` : ""}`;
    }))].slice(0, 20);
    lines.push(articles.length
      ? `${wantsOriginal ? "Аналоги по каталогу MANN" : "Фильтры по каталогу MANN"}:\n${articles.join("\n")}`
      : "В MANN нет подтверждённых фильтров для этой модификации.");
    const selectedArticles = new Set(filters.map(filter => filter.mannArticle));
    const products = [...new Map((resolution.localMatches ?? [])
      .filter(match => selectedArticles.has(match.mannArticle))
      .flatMap(match => match.compatibleProducts)
      .filter(product => product.available > 0)
      .map(product => [product.id, product])).values()].slice(0, 8);
    if (products.length) {
      lines.push("Подтверждённые варианты фильтров в наличии:", ...products.map(product =>
        `${product.name} · ${product.article || "артикул не указан"} · доступно ${product.available} шт.${product.price > 0 ? ` · ${product.price} ₽` : ""}`));
      sources.push(...products.map(product => ({
        label: product.name, href: `/inventory/products?product=${encodeURIComponent(product.id)}`,
      })));
    }
  }
  if (wantsFacts) {
    const system = typeof requestedSystem === "string" && Object.hasOwn(technicalSystems, requestedSystem) ? requestedSystem : null;
    if (!system) {
      lines.push("Уточните, для какого агрегата нужен допуск или объём: двигатель, коробка, раздатка или другая система.");
    } else {
      const aggregate = system === "engine_oil" ? vehicle.engineCode : null;
      const { facts } = await verifiedLocalTechnicalInput(parseQuoteAndTechCardInput({
        vehicle: { snapshot: vehicle, aggregateCode: aggregate ?? null },
        service: { type: system, name: "Технический вопрос" },
      }), access.organizationId);
      const answer = buildTechnicalCustomerAnswer(question, facts);
      lines.push(answer.text);
      for (const fact of answer.verifiedFacts) {
        if (fact.url && /^https:\/\//i.test(fact.url) && !sources.some(source => source.href === fact.url)) {
          sources.push({ label: fact.source, href: fact.url });
        }
      }
    }
  }
  if (!wantsFacts && !wantsFilters) lines.push("Уточните, какие фильтры, допуск или объём нужно проверить.");
  return { text: lines.join("\n\n"), sources };
}
