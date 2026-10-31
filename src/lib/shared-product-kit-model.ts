import { productIdentityKey, normalizeProductIdentityArticle, normalizeProductIdentityBrand } from "@/lib/product-identity";

export type KitIdentity = {
  name: string; article: string; brand: string; uomName: string;
  packageVolume: string; volume: string; weight: string; modificationCode: string;
};
export type KitTemplateItem = { id: string; quantity: number; identity: KitIdentity; bindings: Record<string, string> };
export type KitIdentityProduct = { id: string; branchId: string; entityType: string; archived: boolean } & Partial<Record<keyof KitIdentity, unknown>>;

export function kitProductIdentity(product: Partial<Record<keyof KitIdentity, unknown>>): KitIdentity {
  return Object.fromEntries(["name", "article", "brand", "uomName", "packageVolume", "volume", "weight", "modificationCode"].map((key) => [key, String(product[key as keyof KitIdentity] ?? "").trim()])) as KitIdentity;
}

export function kitIdentitySignature(identity: KitIdentity) {
  return productIdentityKey(identity);
}

/** An explicit binding wins; an unavailable binding never silently changes to an alternative. */
export function resolveKitProduct<T extends KitIdentityProduct>(item: KitTemplateItem, branchId: string, products: T[]) {
  const local = products.filter((product) => product.branchId === branchId);
  const bound = item.bindings[branchId];
  if (bound) {
    const product = local.find((candidate) => candidate.id === bound);
    if (product) {
      try { assertKitBinding(item.identity, product); }
      catch { return { product: null, issue: "Связанный товар изменился: проверьте соответствие" }; }
    }
    return product && !product.archived && ["product", "variant"].includes(product.entityType)
      ? { product, issue: null } : { product: null, issue: "Связанный товар недоступен" };
  }
  const key = kitIdentitySignature(item.identity);
  const candidates = key ? local.filter((product) => !product.archived && ["product", "variant"].includes(product.entityType) && kitIdentitySignature(kitProductIdentity(product)) === key) : [];
  return candidates.length === 1 ? { product: candidates[0], issue: null }
    : { product: null, issue: candidates.length > 1 ? "Найдено несколько карточек: выберите товар филиала" : "Выберите товар филиала" };
}

export function assertKitBinding(identity: KitIdentity, product: KitIdentityProduct) {
  const local = kitProductIdentity(product);
  const norm = (value: string) => value.normalize("NFKC").trim().toLocaleUpperCase("ru-RU").replace(/\s+/g, " ");
  for (const field of ["uomName", "packageVolume", "volume", "weight", "modificationCode"] as const) {
    if (norm(identity[field]) !== norm(local[field])) throw new Error("Единица учёта или фасовка отличаются от общего комплекта");
  }
  if ((identity.article && local.article && normalizeProductIdentityArticle(identity.article) !== normalizeProductIdentityArticle(local.article)) ||
      (identity.brand && local.brand && normalizeProductIdentityBrand(identity.brand) !== normalizeProductIdentityBrand(local.brand))) {
    throw new Error("Бренд или артикул отличаются. Для замены состава удалите старую позицию и добавьте новую");
  }
}

export function readKitTemplateItems(value: unknown): KitTemplateItem[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error("Повреждён общий состав комплекта");
  const ids = new Set<string>();
  return value.map((row) => {
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id || ids.has(row.id) ||
        !Number.isFinite(row.quantity) || row.quantity <= 0 || row.quantity > 1_000_000 || Math.abs(Math.round(row.quantity * 1000) / 1000 - row.quantity) > 1e-8 ||
        !row.identity || typeof row.identity !== "object" || !row.bindings || typeof row.bindings !== "object" || Array.isArray(row.bindings) ||
        Object.values(row.bindings).some((id) => typeof id !== "string" || !id)) throw new Error("Повреждён общий состав комплекта");
    ids.add(row.id);
    return { id: row.id, quantity: row.quantity, identity: kitProductIdentity(row.identity), bindings: { ...row.bindings } };
  });
}
