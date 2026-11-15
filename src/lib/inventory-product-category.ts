const PREFIX = "category:";

function normalized(value: string) {
  return value.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
}

type CategoryProduct = { name: string; groupPath: string | null };

function knownCategory({ name, groupPath }: CategoryProduct) {
  const group = normalized(groupPath ?? "");
  const title = normalized(name);
  const category = normalized(group.split("/").at(-1) ?? "");
  const filter = /фильтр/;
  const transmission = /акпп|мкпп|кпп|cvt|dsg|вариатор|коробк|трансмис/;
  if ((filter.test(title) && transmission.test(title)) || (filter.test(group) && transmission.test(group))) return "Фильтры АКПП и трансмиссии";
  if ((/воздушн/.test(category) && filter.test(category)) || /^(?:воздушный фильтр|фильтр воздушный)(?:\s|$)/.test(title)) return "Воздушные фильтры";
  if ((/салонн/.test(category) && filter.test(category)) || /^(?:салонный фильтр|фильтр салонный)(?:\s|$)/.test(title)) return "Салонные фильтры";
  if ((/топливн/.test(category) && filter.test(category)) || /^(?:топливный фильтр|фильтр топливный)(?:\s|$)/.test(title)) return "Топливные фильтры";
  if ((/маслян/.test(category) && filter.test(category)) || /^(?:масляный фильтр|фильтр масляный)(?:\s|$)/.test(title)) return "Масляные фильтры ДВС";
  if (/^((масло|масло в канистрах) )?трансмис+ионно[еы]/.test(category)) {
    return /бочк|разлив/.test(category) ? "Трансмиссионное масло на разлив" : "Трансмиссионное масло";
  }
  if (/^((масло|масло в канистрах) )?моторно[еы]/.test(category)) {
    return /бочк|разлив/.test(category) ? "Моторное масло на разлив" : "Моторное масло";
  }
  return null;
}

export function inventoryCategoryFacet(product: CategoryProduct) {
  const label = knownCategory(product);
  return label ? PREFIX + label : product.groupPath?.trim() ?? "";
}

export function isInventoryCategoryFacet(value: string) {
  return value.startsWith(PREFIX);
}

export function inventoryCategoryLabel(value: string) {
  return isInventoryCategoryFacet(value) ? value.slice(PREFIX.length) : value;
}
