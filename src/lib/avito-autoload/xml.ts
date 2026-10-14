import { AVITO_MAX_ADS, AVITO_TYPE_LABELS, splitAvitoStandards } from "./domain";
import type { AvitoListing, AvitoSettings } from "./types";
import { hasInvalidXmlCharacters } from "./xml-text";

function text(value: string | number) {
  const source = String(value);
  if (hasInvalidXmlCharacters(source)) throw new Error("Недопустимые символы в XML Авито");
  return source.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function element(tag: string, value: string | number | null) {
  return value === null || value === "" ? "" : `    <${tag}>${text(value)}</${tag}>\n`;
}

function options(tag: string, value: string) {
  const values = splitAvitoStandards(value);
  return values.length ? `    <${tag}>\n${values.map((option) => `      <Option>${text(option)}</Option>\n`).join("")}    </${tag}>\n` : "";
}

/** Avito XML v3. IDs are the same branch/product IDs used in the CSV and snapshots. */
export function buildAvitoXml(listings: AvitoListing[], settings: AvitoSettings, photoUrl: (photoId: string) => string) {
  const included = listings.filter((listing) => listing.included);
  if (included.length > AVITO_MAX_ADS) throw new Error("В одном файле может быть не больше 50 000 объявлений");
  const ids = new Set<string>();
  const ads = included.map((listing) => {
    if (!listing.adId || [...listing.adId].length > 100 || ids.has(listing.adId)) throw new Error("У каждого объявления XML должен быть уникальный непустой Id");
    ids.add(listing.adId);
    const value = listing.values;
    if (hasInvalidXmlCharacters(value.description)) throw new Error("Недопустимые символы в описании XML Авито");
    const fields: Array<[string, string | number | null]> = [
      ["Id", listing.adId], ["AvitoId", value.avitoId], ["Category", "Запчасти и аксессуары"],
      ["GoodsType", "Масла и автохимия"], ["ProductType", AVITO_TYPE_LABELS[listing.type]], ["AdType", "Товар приобретен на продажу"],
      ["Title", value.title], ["Price", value.priceRubles],
      ["Address", settings.sellerAddressId ? "" : settings.address], ["SellerAddressID", settings.sellerAddressId],
      ["ManagerName", settings.contactPerson], ["ContactPhone", settings.phone], ["ContactMethod", settings.contactMethod],
      ["Brand", value.brand], ["SAE", value.sae], ["Volume", value.volume], ["Condition", value.condition],
      ["VendorCode", listing.article && /^[A-Za-z0-9-]{1,50}$/.test(listing.article) ? listing.article : ""],
      ["MultiItem", value.multiItem ? "Да" : "Нет"], ["MultiName", value.multiItem ? value.multiName : ""],
      ["ListingFee", settings.listingFee], ["AdStatus", "Free"],
    ];
    const description = `    <Description><![CDATA[${value.description.replace(/\]\]>/g, "]]]]><![CDATA[>")}]]></Description>\n`;
    const standards = options(listing.type === "motor" ? "ACEA" : "ATF", listing.type === "motor" ? value.acea : value.atf)
      + options("API", value.api) + options("OEMOil", value.oem);
    const photos = listing.photos.length ? `    <Images>\n${listing.photos.map((photo) => `      <Image url="${text(photoUrl(photo.id))}"/>\n`).join("")}    </Images>\n` : "";
    return `  <Ad>\n${fields.map(([tag, value]) => element(tag, value)).join("")}${description}${standards}${photos}  </Ad>\n`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Ads formatVersion="3" target="Avito.ru">\n${ads.join("")}</Ads>\n`;
}
