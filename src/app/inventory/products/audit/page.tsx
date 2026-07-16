import Link from "next/link";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

type AuditField = {
  key: Prisma.LocalProductScalarFieldEnum;
  label: string;
  area: string;
  hideFromMainUi: boolean;
};

const auditFields: AuditField[] = [
  { key: "name", label: "Название", area: "Главное", hideFromMainUi: false },
  { key: "article", label: "Артикул", area: "Главное", hideFromMainUi: false },
  { key: "code", label: "Код / штрихкод", area: "Главное", hideFromMainUi: false },
  { key: "groupPath", label: "Группа", area: "Главное", hideFromMainUi: false },
  { key: "brand", label: "Бренд", area: "Главное", hideFromMainUi: false },
  { key: "uomName", label: "Единица", area: "Главное", hideFromMainUi: false },
  { key: "supplierName", label: "Поставщик", area: "Главное", hideFromMainUi: false },
  { key: "cell", label: "Ячейка", area: "Склад", hideFromMainUi: false },
  { key: "barcodeEan13", label: "EAN-13", area: "Доп. коды", hideFromMainUi: true },
  { key: "barcodeEan8", label: "EAN-8", area: "Доп. коды", hideFromMainUi: true },
  { key: "barcodeCode128", label: "Code128", area: "Доп. коды", hideFromMainUi: true },
  { key: "externalCode", label: "Внешний код", area: "Доп. коды", hideFromMainUi: true },
  { key: "sae", label: "SAE", area: "Масла", hideFromMainUi: true },
  { key: "apiSpec", label: "API", area: "Масла", hideFromMainUi: true },
  { key: "acea", label: "ACEA", area: "Масла", hideFromMainUi: true },
  { key: "ilsac", label: "ILSAC", area: "Масла", hideFromMainUi: true },
  { key: "atf", label: "ATF", area: "Масла", hideFromMainUi: true },
  { key: "packageVolume", label: "Фасовка", area: "Масла", hideFromMainUi: true },
  { key: "volume", label: "Объём", area: "Масла", hideFromMainUi: true },
  { key: "oem", label: "OEM", area: "Фильтры", hideFromMainUi: true },
  { key: "oemParts", label: "OEM Parts / кросс-номера / аналоги", area: "Фильтры", hideFromMainUi: true },
  { key: "mannCharacteristicName", label: "Применимость", area: "Фильтры", hideFromMainUi: true },
  { key: "markingEnabled", label: "Товар маркируется", area: "Маркировка", hideFromMainUi: false },
  { key: "markingMode", label: "Сценарий маркировки", area: "Маркировка", hideFromMainUi: false },
  { key: "markingStatus", label: "Статус маркировки", area: "Маркировка", hideFromMainUi: false },
  { key: "description", label: "Описание", area: "Служебные", hideFromMainUi: true },
  { key: "tnvedCode", label: "ТН ВЭД", area: "Служебные", hideFromMainUi: true },
  { key: "countryName", label: "Страна", area: "Служебные", hideFromMainUi: true },
  { key: "supplierAttribute", label: "Supplier raw", area: "Тех. поля", hideFromMainUi: true },
  { key: "raw", label: "Raw JSON", area: "Тех. поля", hideFromMainUi: true },
  { key: "searchText", label: "Search text", area: "Тех. поля", hideFromMainUi: true },
];

const decimalFields = new Set<Prisma.LocalProductScalarFieldEnum>([
  "minimumBalance",
  "weight",
  "volume",
]);

function filledWhere(field: Prisma.LocalProductScalarFieldEnum): Prisma.LocalProductWhereInput {
  if (field === "markingEnabled") return { markingEnabled: true };
  if (field === "raw" || field === "markingSettings") return { [field]: { not: Prisma.JsonNull } } as Prisma.LocalProductWhereInput;
  if (decimalFields.has(field)) return { [field]: { not: null } } as Prisma.LocalProductWhereInput;
  return {
    AND: [
      { [field]: { not: null } },
      { [field]: { not: "" } },
    ],
  } as Prisma.LocalProductWhereInput;
}

export default async function ProductFieldsAuditPage() {
  const session = await getSession();
  if (!session) redirect("/login?from=/inventory/products/audit");
  if (session.user.role !== "owner" && session.user.role !== "admin") redirect("/inventory/products");

  const total = await prisma.localProduct.count();
  const rows = await Promise.all(
    auditFields.map(async (field) => {
      const filled = await prisma.localProduct.count({ where: filledWhere(field.key) });
      const percent = total ? Math.round((filled / total) * 100) : 0;
      return { ...field, filled, empty: Math.max(0, total - filled), percent };
    })
  );

  return (
    <main className="space-y-5">
      <section className="eco-products-shell">
        <div className="eco-products-head">
          <div>
            <div className="eco-products-breadcrumb">Главная / Склад / Товары</div>
            <h2 className="eco-page-title">Аудит полей товара</h2>
            <p className="l-meta">Всего товаров: {total.toLocaleString("ru-RU")}</p>
          </div>
          <Link className="eco-btn" href="/inventory/products">Вернуться к товарам</Link>
        </div>

        <div className="eco-table-wrap">
          <table className="eco-table">
            <thead>
              <tr>
                <th>Поле</th>
                <th>Блок</th>
                <th style={{ textAlign: "right" }}>Заполнено</th>
                <th style={{ textAlign: "right" }}>Пусто</th>
                <th style={{ textAlign: "right" }}>%</th>
                <th>UI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <strong>{row.label}</strong>
                    <div className="l-meta">{row.key}</div>
                  </td>
                  <td>{row.area}</td>
                  <td className="eco-product-number">{row.filled.toLocaleString("ru-RU")}</td>
                  <td className="eco-product-number">{row.empty.toLocaleString("ru-RU")}</td>
                  <td className="eco-product-number">{row.percent}%</td>
                  <td>{row.hideFromMainUi ? "Скрыто / контекстно" : "Основной UI"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
