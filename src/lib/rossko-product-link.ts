import { mergeProductCrossReferences, productCrossReferenceKey } from "@/lib/product-cross-references";

/** Only the public product identifier is used; session parameters are discarded. */
export function parseRosskoProductLink(value: unknown): string {
  if (typeof value !== "string" || value.length > 4096) throw new Error("Вставьте ссылку на товар ROSSKO");
  let url: URL;
  try { url = new URL(value.trim().replace(/&amp;/g, "&")); }
  catch { throw new Error("Вставьте полную ссылку на товар ROSSKO"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !/^(?:[a-z0-9-]+\.)?rossko\.ru$/i.test(url.hostname) || !/^\/product\/?$/.test(url.pathname)) {
    throw new Error("Нужна ссылка вида https://kgd.rossko.ru/product/?text=NSIN…");
  }
  const identifiers = url.searchParams.getAll("text");
  const guid = identifiers[0]?.trim().toUpperCase() ?? "";
  if (identifiers.length !== 1 || !/^NSI[IN]\d{10}$/.test(guid)) {
    throw new Error("В ссылке нет однозначного кода товара ROSSKO (NSIN или NSII)");
  }
  return guid;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : value == null ? [] : [value]; }
function text(value: unknown) { return typeof value === "string" || typeof value === "number" ? String(value).trim() : ""; }

/** Never substitute an analogue for the exact linked product. */
export function rosskoProductFromSearch(data: unknown, guid: string) {
  const parts = list(record(record(data).PartsList).Part);
  const queue = [...parts];
  const seen = new Set<unknown>();
  const matches: Record<string, unknown>[] = [];
  while (queue.length && seen.size < 2000) {
    const candidate = queue.shift();
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const part = record(candidate);
    if (text(part.guid).toUpperCase() === guid.toUpperCase()) matches.push(part);
    queue.push(...list(record(part.crosses).Part));
  }
  const part = matches[0];
  if (!part) throw new Error("ROSSKO не вернул товар по этой ссылке. Проверьте доступность товара и настройки интеграции.");
  const brand = text(part.brand);
  const article = text(part.partnumber);
  const sourceName = text(part.name);
  if (!brand || !article || !sourceName) throw new Error("ROSSKO вернул неполную карточку: нет названия, бренда или артикула");
  if (matches.some((row) => text(row.brand) !== brand || text(row.partnumber) !== article)) {
    throw new Error("ROSSKO вернул неоднозначную карточку товара");
  }
  // Stocks are already sorted by the branch's configured offer priority.
  const prices = matches.flatMap((row) => list(record(row.stocks).stock)).map((stock) => {
    const row = record(stock);
    const priceText = text(row.price).replace(",", ".");
    const price = Number(priceText);
    const count = Number(text(row.count).replace(",", "."));
    return priceText && Number.isFinite(price) && price > 0 && count > 0 ? Math.round(price * 100) : null;
  });
  const additions: string[] = [];
  const crossQueue: unknown[] = [...matches];
  const crossSeen = new Set<unknown>();
  const ownArticleKey = productCrossReferenceKey(article);
  while (crossQueue.length && crossSeen.size < 2000) {
    const current = crossQueue.shift();
    if (!current || crossSeen.has(current)) continue;
    crossSeen.add(current);
    const row = record(current);
    for (const key of ["oem", "OEM", "oemParts"]) {
      const value = text(row[key]);
      if (value) additions.push(value);
    }
    const crossArticle = text(row.partnumber);
    if (crossArticle && text(row.guid).toUpperCase() !== guid.toUpperCase() && productCrossReferenceKey(crossArticle) !== ownArticleKey) additions.push(crossArticle);
    crossQueue.push(...list(record(row.crosses).Part));
  }
  return { guid, brand, article, sourceName, purchasePriceCents: prices.find((price) => price != null) ?? null,
    oemParts: mergeProductCrossReferences("", additions) ?? "" };
}
/** An article search can return other brands; still require the linked GUID. */
export async function completeRosskoProductLinkOem(
  product: ReturnType<typeof rosskoProductFromSearch>,
  search: (query: string) => Promise<unknown>,
) {
  if (product.oemParts) return { oemParts: product.oemParts, warning: "" };
  try {
    const result = rosskoProductFromSearch(await search(product.article), product.guid);
    if (productCrossReferenceKey(result.article) !== productCrossReferenceKey(product.article) ||
        result.brand.toLocaleLowerCase("ru-RU") !== product.brand.toLocaleLowerCase("ru-RU")) throw new Error("Product identity changed");
    return result.oemParts
      ? { oemParts: result.oemParts, warning: "" }
      : { oemParts: "", warning: "ROSSKO не вернул OEM Parts. Их можно заполнить отдельно в карточке." };
  } catch {
    return { oemParts: "", warning: "Не удалось получить OEM Parts из ROSSKO. Повторите поиск в карточке товара." };
  }
}

export function defaultGreenlightSupplier<T extends { id: string; name: string; displayName: string; fullName?: string | null }>(suppliers: T[]): T | null {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("ru-RU")
    .replace(/(?:^|\s)(?:ооо|оао|зао|ао|ип|llc|ltd)(?=\s|$)/g, " ").replace(/[^\p{L}\p{N}]/gu, "");
  const matches = suppliers.filter((supplier) => [supplier.name, supplier.displayName, supplier.fullName ?? ""]
    .some((name) => ["greenlight", "гринлайт"].includes(normalize(name.replace(/[«»"']/g, " ")))));
  const unique = [...new Map(matches.map((supplier) => [supplier.id, supplier])).values()];
  return unique.length === 1 ? unique[0] : null;
}
