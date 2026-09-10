import type { VerifiedTechnicalFact } from "./quote-and-tech-card";

export type TechnicalCustomerAnswer = {
  version: 1;
  status: "verified" | "needs_verification";
  text: string;
  missingFields: string[];
  verifiedFacts: VerifiedTechnicalFact[];
};

// The researched prose is deliberately not an input. A source URL and the
// model's assertion cannot authorize a vehicle-specific technical statement.
export function buildTechnicalCustomerAnswer(question: string, facts: VerifiedTechnicalFact[]): TechnicalCustomerAnswer {
  const fields = [
    /адаптац|сброс\S*\s+(?:обуч|настро)/iu.test(question) && "adaptation",
    /температур/iu.test(question) && "temperature",
    /момент[\s\S]*затяж/iu.test(question) && "torque",
    /допуск|спецификац|вязкост/iu.test(question) && "specification",
    /объ[её]м|сколько\s+литр/iu.test(question) && "capacity",
  ].filter((field): field is string => Boolean(field));
  if (!fields.length) fields.push("procedure");
  const capacityProcedure = /частич/iu.test(question) ? "partial" : /полн\S*\s+объ[её]м|общ\S*\s+объ[её]м/iu.test(question) ? "machine" : null;
  const verifiedFacts = fields.flatMap(field => {
    // Only specification/capacity have a verified canonical field contract.
    // Procedure, adaptation, torque and temperature remain unknown until a
    // reviewed, applicable procedure source is represented by that contract.
    if (field !== "specification" && field !== "capacity") return [];
    const candidates = facts.filter(fact => fact.field === field && fact.source && fact.vehicleVariantKey && (field !== "capacity" || !capacityProcedure || fact.procedure === capacityProcedure));
    const unique = [...new Map(candidates.map(fact => [`${fact.vehicleVariantKey}:${fact.aggregate}:${fact.procedure}:${fact.value}`, fact])).values()];
    return unique.length === 1 ? unique : [];
  });
  const missingFields = fields.filter(field => !verifiedFacts.some(fact => fact.field === field));
  const lines = verifiedFacts.map(fact => fact.field === "specification"
    ? `Подтверждённая спецификация для установленной модификации: ${fact.value}.`
    : `${fact.procedure === "machine" ? "Полный технический объём (это не расход на замену)" : fact.procedure === "partial" ? "Объём для частичной замены" : "Сервисный объём"}: ${fact.value} л.`);
  const unknown: Record<string, string> = {
    adaptation: "Пока не удалось подтвердить, обязательна ли адаптация именно для вашей коробки после обычной замены масла. Уточним точное исполнение коробки и применимую заводскую процедуру, после чего дадим окончательный ответ.",
    temperature: "Температура проверки уровня для вашего агрегата пока не подтверждена. Уточним её по применимой заводской процедуре.",
    torque: "Момент затяжки для этого соединения пока не подтверждён. Уточним его по применимой заводской документации.",
    specification: "Точный допуск для вашей модификации пока не подтверждён. Уточним данные автомобиля и агрегата перед подбором жидкости.",
    capacity: "Объём для выбранного способа обслуживания пока не подтверждён. Уточним его по вашей модификации и процедуре замены.",
    procedure: "Применимая процедура для вашего автомобиля пока не подтверждена. Уточним исполнение агрегата и заводские требования, после чего дадим точный ответ.",
  };
  return { version: 1, status: missingFields.length ? "needs_verification" : "verified", text: [...lines, ...missingFields.map(field => unknown[field])].join("\n\n"), missingFields, verifiedFacts };
}
