import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ATTRIBUTE_DEFINITIONS = [
  ["vin номер", 10, false, false],
  ["модель авто", 20, false, false],
  ["год", 30, false, false],
  ["гос. номер", 40, false, false],
  ["пробег", 50, false, false],
  ["Объем", 60, true, false],
  ["Моторное масло", 70, true, false],
  ["Эко пользователь", 1000, false, true],
];

async function upsertAttributeDefinitions() {
  for (const [name, order, required, isSystem] of ATTRIBUTE_DEFINITIONS) {
    await prisma.demandAttributeDefinition.upsert({
      where: { name },
      update: { type: "string", order, required, isSystem },
      create: { name, type: "string", order, required, isSystem },
    });
  }
}

async function upsertByName(model, name, create, update = create) {
  const existing = await model.findFirst({ where: { name } });
  if (existing) return model.update({ where: { id: existing.id }, data: update });
  return model.create({ data: create });
}

async function main() {
  await upsertAttributeDefinitions();

  const defaultOrganizationData = {
    name: "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
    entityType: "ip",
    fullLegalName: "Индивидуальный предприниматель Елисеенко Илья Сергеевич",
    kpp: null,
    isActive: true,
    isDefault: true,
    raw: { seed: true },
  };
  const existingOrganization = await prisma.localOrganization.findFirst({
    where: { OR: [{ name: "ИП ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ" }, { name: "Эко Платформа" }] },
    orderBy: [{ createdAt: "asc" }],
  });
  await prisma.localOrganization.updateMany({
    where: existingOrganization ? { id: { not: existingOrganization.id } } : {},
    data: { isDefault: false },
  });
  const organization = existingOrganization
    ? await prisma.localOrganization.update({
        where: { id: existingOrganization.id },
        data: defaultOrganizationData,
      })
    : await prisma.localOrganization.create({ data: defaultOrganizationData });

  const store = await upsertByName(prisma.localStore, "Основной склад", {
    name: "Основной склад",
    organizationId: organization.id,
    isMain: true,
    archived: false,
    raw: { seed: true },
  }, {
    organizationId: organization.id,
    isMain: true,
    archived: false,
  });

  const counterparties = [
    { name: "Иван Петров", phone: "+7 911 000-11-22", email: "ivan@example.test", companyType: "individual" },
    { name: "ООО Компания", phone: "+7 921 555-33-44", email: "office@example.test", companyType: "legal", legalTitle: "ООО Компания" },
  ];
  for (const cp of counterparties) {
    await upsertByName(prisma.localCounterparty, cp.name, {
      ...cp,
      normalizedPhone: cp.phone.replace(/\D/g, ""),
      phonesRaw: [cp.phone],
      searchText: [cp.name, cp.phone, cp.email, cp.companyType, cp.legalTitle].filter(Boolean).join(" ").toLowerCase(),
      raw: { seed: true },
    }, {
      ...cp,
      normalizedPhone: cp.phone.replace(/\D/g, ""),
      phonesRaw: [cp.phone],
      searchText: [cp.name, cp.phone, cp.email, cp.companyType, cp.legalTitle].filter(Boolean).join(" ").toLowerCase(),
    });
  }

  const products = [
    {
      name: "Масло моторное Eurol 5W-30 C3 1 л",
      article: "EU-5W30-C3-1",
      salePriceCents: 95000,
      buyPriceCents: 65000,
      currencyName: "руб.",
      sae: "5W-30",
      acea: "C3",
      apiSpec: "SN",
      packageVolume: "1 л",
      brand: "Eurol",
      params: "5W-30 C3 1 л",
      cell: "A-01",
      quantity: 24,
      reserve: 2,
    },
    {
      name: "Масло моторное Bardahl 5W-30 C3 4 л",
      article: "BAR-5W30-C3-4",
      salePriceCents: 520000,
      buyPriceCents: 390000,
      currencyName: "руб.",
      sae: "5W-30",
      acea: "C3",
      apiSpec: "SN",
      packageVolume: "4 л",
      brand: "Bardahl",
      params: "5W-30 C3 4 л",
      cell: "A-02",
      quantity: 6,
      reserve: 0,
    },
    {
      name: "Фильтр масляный MANN W 712/95",
      article: "W71295",
      salePriceCents: 125000,
      buyPriceCents: 80000,
      currencyName: "руб.",
      oemParts: "06A115561B; 11427508969; W712/95;",
      params: "масляный фильтр",
      cell: "F-10",
      quantity: 12,
      reserve: 1,
    },
    {
      name: "Фильтр воздушный MANN C 35 154",
      article: "C35154",
      salePriceCents: 180000,
      buyPriceCents: 125000,
      currencyName: "руб.",
      oemParts: "1K0129620D; C35154;",
      params: "воздушный фильтр",
      cell: "F-11",
      quantity: 8,
      reserve: 0,
    },
  ];

  for (const item of products) {
    const { quantity, reserve, ...productData } = item;
    const searchText = Object.values(productData).filter((value) => typeof value === "string").join(" ").toLowerCase();
    const product = await upsertByName(prisma.localProduct, item.name, {
      ...productData,
      entityType: "product",
      searchText,
      raw: { seed: true },
    }, {
      ...productData,
      searchText,
    });

    await prisma.localStockBalance.upsert({
      where: { productId_storeId: { productId: product.id, storeId: store.id } },
      update: {
        quantity,
        reserve,
        available: Math.max(0, quantity - reserve),
        buyPriceCents: item.buyPriceCents,
        slotName: item.cell,
      },
      create: {
        productId: product.id,
        storeId: store.id,
        quantity,
        reserve,
        available: Math.max(0, quantity - reserve),
        buyPriceCents: item.buyPriceCents,
        slotName: item.cell,
      },
    });
  }

  console.log(`Seed complete: organization=${organization.name}, store=${store.name}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
