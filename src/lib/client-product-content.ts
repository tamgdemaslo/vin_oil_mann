import type { PublicOilCard } from "@/lib/public-oil";

/** Factual storefront copy; never infer approvals, oil base or vehicle fitment. */
export function buildClientProductContent(card: PublicOilCard) {
  const name = card.name.replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim();
  const brand = card.brand?.trim();
  const displayName = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;
  const specifications = [
    card.sae && `вязкость SAE ${card.sae}`,
    card.apiSpec && `API ${card.apiSpec.replace(/^API\s*/i, "")}`,
    card.acea && `ACEA ${card.acea.replace(/^ACEA\s*/i, "")}`,
    card.ilsac && `ILSAC ${card.ilsac.replace(/^ILSAC\s*/i, "")}`,
  ].filter(Boolean).join("; ");
  const paragraphs = [
    `${displayName}. Заказать масло и записаться на замену можно в сервисе «Там где масло» в Калининграде.`,
    card.description?.trim() || (specifications ? `Характеристики этой позиции: ${specifications}.` : ""),
    card.oem?.trim() ? `В карточке указаны спецификации производителей: ${card.oem.trim()}. Перед применением сверьте требуемый допуск с руководством вашего автомобиля.` : "Выбирайте масло по требованиям руководства автомобиля: одной вязкости для подбора недостаточно.",
    /розлив/i.test(name)
      ? "Масло на розлив: необходимое количество для замены согласуйте с мастером по объёму системы смазки вашего двигателя."
      : card.packageVolume ? `Фасовка этой позиции — ${card.packageVolume}. Необходимый объём для замены зависит от двигателя и учитывает замену масляного фильтра.` : "",
    "Цены и наличие в филиалах показаны отдельно на этой странице. Для подбора масла и записи на замену сообщите VIN или данные автомобиля.",
  ].filter(Boolean);
  return {
    name: displayName,
    paragraphs,
    description: paragraphs.join("\n\n"),
    title: `${displayName} — цена в Калининграде | Там где масло`,
    metaDescription: `${displayName}. ${card.sae ? `SAE ${card.sae}. ` : ""}Цены и наличие по филиалам в Калининграде, характеристики и подбор масла для замены.`,
  };
}
