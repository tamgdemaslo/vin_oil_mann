import { kitProductIdentity, kitIdentitySignature, type KitTemplateItem } from "@/lib/shared-product-kit-model";
import type { ProductIdentityInput } from "@/lib/product-identity";

type LegacyRow = {
  id: string; branchId: string; name: string; archived: boolean; version?: number;
  items: { id: string; productId: string; quantity: unknown; product: ProductIdentityInput & { name: string; id: string; branchId: string } }[];
  targets: { storeId: string; quantity: number }[];
};
/** Pure migration plan; incomplete identities are never guessed or merged by name alone. */
export function planSharedKitMigration(rows: LegacyRow[], branches: { id: string; businessGroupId: string }[]) {
  const groups = new Map<string, { id: string; businessGroupId: string; name: string; archived: boolean; version: number; items: KitTemplateItem[]; targets: Record<string, number>; legacyIds: string[] }>();
  const warnings: string[] = [];
  for (const row of [...rows].sort((a, b) => a.id.localeCompare(b.id))) {
    const groupId = branches.find((branch) => branch.id === row.branchId)?.businessGroupId;
    if (!groupId || !row.items.length) throw new Error(`Не удалось определить сеть или состав комплекта ${row.id}`);
    const items = row.items.map((item) => {
      if (item.product.branchId !== row.branchId) throw new Error(`Межфилиальная ссылка в ${row.id}`);
      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || Math.abs(Math.round(quantity * 1000) / 1000 - quantity) > 1e-8) throw new Error(`Неверное количество в ${row.id}`);
      return { id: item.id, quantity, identity: kitProductIdentity(item.product), bindings: { [row.branchId]: item.productId } };
    });
    const ingredient = (item: KitTemplateItem) => JSON.stringify([kitIdentitySignature(item.identity) || `${row.branchId}:${Object.values(item.bindings)[0]}`, item.quantity]);
    const ingredients = items.map(ingredient);
    const ambiguousComposition = new Set(ingredients).size !== ingredients.length;
    if (ambiguousComposition) warnings.push(`Похожие карточки внутри комплекта ${row.id}: автоматическое объединение отключено`);
    const signature = JSON.stringify([groupId, row.archived, ambiguousComposition ? row.id : null, row.name.trim().normalize('NFKC').toLocaleUpperCase('ru-RU'), items.map(ingredient).sort()]);
    let entry = groups.get(signature);
    // Do not collapse two local cards for one ingredient within the same branch.
    if (entry && items.some((item) => {
      const prior = entry!.items.find((candidate) => ingredient(candidate) === ingredient(item));
      return prior?.bindings[row.branchId] && prior.bindings[row.branchId] !== item.bindings[row.branchId];
    })) {
      warnings.push(`Не объединены неоднозначные карточки: ${entry.id}, ${row.id}`);
      entry = undefined;
    }
    if (!entry) {
      entry = { id: row.id, businessGroupId: groupId, name: row.name, archived: row.archived, version: (row.version ?? 1) + 1, items, targets: {}, legacyIds: [] };
      groups.set(entry.id === row.id && groups.has(signature) ? `${signature}:${row.id}` : signature, entry);
    } else {
      for (const item of items) {
        const prior = entry.items.find((candidate) => ingredient(candidate) === ingredient(item))!;
        Object.assign(prior.bindings, item.bindings);
      }
    }
    entry.version = Math.max(entry.version, (row.version ?? 1) + 1);
    entry.legacyIds.push(row.id);
    for (const target of row.targets) {
      if (entry.targets[target.storeId] !== undefined && entry.targets[target.storeId] !== target.quantity) warnings.push(`Целевой запас ${target.storeId}: сохранено максимальное значение`);
      entry.targets[target.storeId] = Math.max(entry.targets[target.storeId] || 0, target.quantity);
    }
  }
  return { sourceCount: rows.length, sharedCount: groups.size, mergedCount: rows.length - groups.size, warnings, kits: [...groups.values()] };
}
