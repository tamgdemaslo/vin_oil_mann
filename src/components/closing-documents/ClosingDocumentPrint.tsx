import type { ClosingDocumentSnapshot, ClosingDocumentType, ClosingPartySnapshot, ClosingPositionSnapshot, ClosingUpdSnapshot } from "@/lib/closing-documents";
import { CLOSING_DOCUMENT_TYPES } from "@/lib/closing-documents";

function money(cents: number): string {
  return (cents / 100).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qty(value: number): string {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function dateRu(value: string): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function dateLongRu(value: string): string {
  if (!value) return "«___» __________ ____ г.";
  const [year, month, day] = value.slice(0, 10).split("-");
  const months = ["", "января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const monthName = months[Number(month)] || "__________";
  return year && month && day ? `«${day}» ${monthName} ${year} г.` : value;
}

function field(label: string, value: string | undefined) {
  return value ? (
    <div className="cdoc-field">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  ) : null;
}

function PartyBlock({ title, party }: { title: string; party: ClosingPartySnapshot }) {
  return (
    <section className="cdoc-party">
      <h2>{title}</h2>
      <dl>
        {field("Наименование", party.name || party.shortName)}
        {field("ИНН", party.inn)}
        {field("КПП", party.kpp)}
        {field("ОГРН", party.ogrn || party.ogrnip)}
        {field("Юридический адрес", party.legalAddress)}
        {field("Фактический адрес", party.actualAddress && party.actualAddress !== party.legalAddress ? party.actualAddress : "")}
        {field("Банк", party.bankName)}
        {field("БИК", party.bik)}
        {field("Р/с", party.checkingAccount)}
        {field("К/с", party.correspondentAccount)}
        {field("Телефон", party.phone)}
        {field("Email", party.email)}
      </dl>
    </section>
  );
}

function PositionsTable({
  title,
  rows,
  showArticle,
}: {
  title: string;
  rows: ClosingPositionSnapshot[];
  showArticle?: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="cdoc-section cdoc-table-section">
      <h2>{title}</h2>
      <table className="cdoc-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Наименование</th>
            {showArticle ? <th>Артикул / код</th> : null}
            <th>Ед.</th>
            <th>Кол-во</th>
            <th>Цена</th>
            <th>Скидка</th>
            <th>Сумма</th>
            <th>НДС</th>
            <th>Сумма НДС</th>
            <th>Итого</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.id}>
              <td>{index + 1}</td>
              <td>{row.name}</td>
              {showArticle ? <td>{[row.article, row.code].filter(Boolean).join(" / ") || "—"}</td> : null}
              <td>{row.uomName || "шт"}</td>
              <td>{qty(row.quantity)}</td>
              <td>{money(row.priceCents)}</td>
              <td>{row.discountPercent ? `${qty(row.discountPercent)}%` : "—"}</td>
              <td>{money(row.amountWithoutVatCents)}</td>
              <td>{row.vatEnabled && row.vatRate > 0 ? `${row.vatRate}%` : "Без НДС"}</td>
              <td>{money(row.vatCents)}</td>
              <td>{money(row.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function SignatureBlock({ title, position, name }: { title: string; position: string; name: string }) {
  return (
    <div className="cdoc-signature">
      <h3>{title}</h3>
      <div className="cdoc-sign-line">
        <span>{position || "Должность"}</span>
        <b />
        <span>{name || "Ф. И. О."}</span>
      </div>
      <div className="cdoc-sign-caption">
        <span>должность</span>
        <span>подпись</span>
        <span>расшифровка</span>
      </div>
      <div className="cdoc-stamp">М. П.</div>
    </div>
  );
}

function documentTitle(type: ClosingDocumentType): string {
  return CLOSING_DOCUMENT_TYPES[type]?.title ?? "Закрывающий документ";
}

function partyRequisites(party: ClosingPartySnapshot): string {
  return [
    party.inn ? `ИНН ${party.inn}` : "",
    party.kpp ? `КПП ${party.kpp}` : "",
    party.ogrnip ? `ОГРНИП ${party.ogrnip}` : party.ogrn ? `ОГРН ${party.ogrn}` : "",
  ].filter(Boolean).join(", ");
}

function updFallback(document: ClosingDocumentSnapshot): ClosingUpdSnapshot {
  const seller = [document.sellerSnapshot.name || document.sellerSnapshot.shortName, partyRequisites(document.sellerSnapshot)].filter(Boolean).join(", ");
  const buyer = [document.buyerSnapshot.name || document.buyerSnapshot.shortName, partyRequisites(document.buyerSnapshot)].filter(Boolean).join(", ");
  return {
    functionCode: "2",
    functionLabel: "Передаточный документ (акт)",
    seller,
    buyer,
    shipper: [document.sellerSnapshot.name || document.sellerSnapshot.shortName, document.sellerSnapshot.legalAddress].filter(Boolean).join(", "),
    consignee: [document.buyerSnapshot.name || document.buyerSnapshot.shortName, document.buyerSnapshot.legalAddress].filter(Boolean).join(", "),
    transferBasis: `Отгрузка ${document.shipmentNumber} от ${document.completionDate}`,
    paymentDocument: "",
    currencyName: "Российский рубль",
    currencyCode: "643",
    vatLabel: document.vatSnapshot.label,
    transferInfo: "",
    receiptInfo: "Товары, работы и услуги получены без замечаний",
    transferDate: document.completionDate,
    receiptDate: document.completionDate,
  };
}

function unitCode(row: ClosingPositionSnapshot): string {
  const name = row.uomName.toLowerCase();
  if (name.includes("шт")) return "796";
  if (name.includes("л")) return "112";
  if (name.includes("кг")) return "166";
  return "";
}

function UpdSignatureLine({ position, name }: { position: string; name: string }) {
  return (
    <div className="upd-signature-line">
      <span>{position || "Должность"}</span>
      <i />
      <span>{name || "Ф. И. О."}</span>
    </div>
  );
}

function UpdDocumentPrint({ document }: { document: ClosingDocumentSnapshot }) {
  const upd = document.updSnapshot ?? updFallback(document);
  const sellerAddress = document.sellerSnapshot.legalAddress || document.sellerSnapshot.actualAddress;
  const buyerAddress = document.buyerSnapshot.legalAddress || document.buyerSnapshot.actualAddress;
  const sellerInnKpp = document.sellerSnapshot.kpp ? `${document.sellerSnapshot.inn} / ${document.sellerSnapshot.kpp}` : document.sellerSnapshot.inn;
  const buyerInnKpp = document.buyerSnapshot.kpp ? `${document.buyerSnapshot.inn} / ${document.buyerSnapshot.kpp}` : document.buyerSnapshot.inn;
  const withoutVat = document.vatSnapshot.mode === "without_vat";

  return (
    <article className="cdoc-sheet cdoc-upd-sheet" data-closing-document-ready="true">
      <div className="upd-top">
        <div className="upd-title-block">
          <strong>Универсальный<br />передаточный<br />документ</strong>
          <div className="upd-status">
            <span>Статус:</span>
            <b>{upd.functionCode}</b>
            <small>1 - счет-фактура и передаточный документ (акт)<br />2 - передаточный документ (акт)</small>
          </div>
        </div>
        <div className="upd-invoice-block">
          <div><span>Счет-фактура №</span><b>{document.number}</b><span>от</span><b>{dateRu(document.documentDate)}</b><em>(1)</em></div>
          <div><span>Исправление №</span><b>--</b><span>от</span><b>--</b><em>(1а)</em></div>
          <p>Приложение № 1 к постановлению Правительства Российской Федерации от 26.12.2011 № 1137</p>
        </div>
      </div>

      <table className="upd-requisites">
        <tbody>
          <tr><th>Продавец</th><td>{document.sellerSnapshot.name || document.sellerSnapshot.shortName}</td><td>(2)</td></tr>
          <tr><th>Адрес</th><td>{sellerAddress}</td><td>(2а)</td></tr>
          <tr><th>ИНН/КПП продавца</th><td>{sellerInnKpp || (document.sellerSnapshot.ogrnip ? `ОГРНИП ${document.sellerSnapshot.ogrnip}` : "")}</td><td>(2б)</td></tr>
          <tr><th>Грузоотправитель и его адрес</th><td>{upd.shipper || "Он же"}</td><td>(3)</td></tr>
          <tr><th>Грузополучатель и его адрес</th><td>{upd.consignee}</td><td>(4)</td></tr>
          <tr><th>К платежно-расчетному документу</th><td>{upd.paymentDocument || "--"}</td><td>(5)</td></tr>
          <tr><th>Покупатель</th><td>{document.buyerSnapshot.name || document.buyerSnapshot.shortName}</td><td>(6)</td></tr>
          <tr><th>Адрес</th><td>{buyerAddress}</td><td>(6а)</td></tr>
          <tr><th>ИНН/КПП покупателя</th><td>{buyerInnKpp || (document.buyerSnapshot.ogrnip ? `ОГРНИП ${document.buyerSnapshot.ogrnip}` : "")}</td><td>(6б)</td></tr>
          <tr><th>Валюта: наименование, код</th><td>{upd.currencyName}, {upd.currencyCode}</td><td>(7)</td></tr>
        </tbody>
      </table>

      {withoutVat ? <div className="upd-vat-note">Без НДС</div> : null}

      <table className="upd-items">
        <thead>
          <tr>
            <th rowSpan={2}>№ п/п</th>
            <th rowSpan={2}>Код товара / работ, услуг</th>
            <th rowSpan={2}>Наименование товара (описание выполненных работ, оказанных услуг), имущественного права</th>
            <th colSpan={2}>Единица измерения</th>
            <th rowSpan={2}>Количество</th>
            <th rowSpan={2}>Цена (тариф) за единицу измерения</th>
            <th rowSpan={2}>Стоимость товаров (работ, услуг), имущественных прав без налога</th>
            <th rowSpan={2}>Акциз</th>
            <th rowSpan={2}>Налоговая ставка</th>
            <th rowSpan={2}>Сумма налога</th>
            <th rowSpan={2}>Стоимость товаров (работ, услуг), имущественных прав с налогом</th>
            <th colSpan={2}>Страна происхождения товара</th>
            <th rowSpan={2}>Номер таможенной декларации</th>
          </tr>
          <tr>
            <th>код</th>
            <th>условное обозначение</th>
            <th>цифровой код</th>
            <th>краткое наименование</th>
          </tr>
          <tr className="upd-column-codes">
            {["А", "Б", "1", "2", "2а", "3", "4", "5", "6", "7", "8", "9", "10", "10а", "11"].map((code) => <th key={code}>{code}</th>)}
          </tr>
        </thead>
        <tbody>
          {document.positionsSnapshot.map((row, index) => (
            <tr key={row.id}>
              <td>{index + 1}</td>
              <td>{[row.article, row.code].filter(Boolean).join(" / ") || "--"}</td>
              <td><span className="upd-kind">{row.kind === "work" ? "Работа/услуга" : "Товар/материал"}</span>{row.name}</td>
              <td>{unitCode(row)}</td>
              <td>{row.uomName || "шт"}</td>
              <td>{qty(row.quantity)}</td>
              <td>{money(row.priceCents)}</td>
              <td>{money(row.amountWithoutVatCents)}</td>
              <td>без акциза</td>
              <td>{row.vatEnabled && row.vatRate > 0 ? `${row.vatRate}%` : "Без НДС"}</td>
              <td>{money(row.vatCents)}</td>
              <td>{money(row.totalCents)}</td>
              <td>--</td>
              <td>--</td>
              <td>--</td>
            </tr>
          ))}
          <tr className="upd-total-row">
            <td colSpan={7}>Всего к оплате</td>
            <td>{money(document.totalsSnapshot.amountWithoutVatCents)}</td>
            <td>Х</td>
            <td>Х</td>
            <td>{money(document.totalsSnapshot.vatCents)}</td>
            <td>{money(document.totalsSnapshot.totalCents)}</td>
            <td colSpan={3}>Х</td>
          </tr>
        </tbody>
      </table>

      <div className="upd-amount-words">Всего наименований {document.positionsSnapshot.length}, на сумму {money(document.totalsSnapshot.totalCents)} руб. ({document.totalsSnapshot.totalInWords}).</div>

      <section className="upd-accounting-signatures">
        <div><b>Руководитель организации или иное уполномоченное лицо</b><UpdSignatureLine position={document.performerSignatorySnapshot.position} name={document.performerSignatorySnapshot.name} /></div>
        <div><b>Главный бухгалтер или иное уполномоченное лицо</b><UpdSignatureLine position="" name="" /></div>
        <div><b>Индивидуальный предприниматель или иное уполномоченное лицо</b><UpdSignatureLine position={document.performerSignatorySnapshot.position} name={document.performerSignatorySnapshot.name} /><p>{document.sellerSnapshot.ogrnip ? `ОГРНИП ${document.sellerSnapshot.ogrnip}` : document.performerSignatorySnapshot.basis}</p></div>
      </section>

      <section className="upd-transfer-grid">
        <div>
          <p><b>Основание передачи (сдачи) / получения (приемки)</b> <em>[8]</em></p>
          <div className="upd-line">{upd.transferBasis}</div>
          <p><b>Данные о транспортировке и грузе</b> <em>[9]</em></p>
          <div className="upd-line">{upd.transferInfo || "--"}</div>
          <p><b>Товар (груз) передал / услуги, результаты работ, права сдал</b> <em>[10]</em></p>
          <UpdSignatureLine position={document.performerSignatorySnapshot.position} name={document.performerSignatorySnapshot.name} />
          <p><b>Дата отгрузки, передачи (сдачи)</b> <em>[11]</em></p>
          <div className="upd-line">{dateLongRu(upd.transferDate)}</div>
          <p><b>Иные сведения об отгрузке, передаче</b> <em>[12]</em></p>
          <div className="upd-line">{withoutVat ? "Организация работает без НДС. " : ""}{document.customerRemarks || "--"}</div>
          <p><b>Ответственный за правильность оформления факта хозяйственной жизни</b> <em>[13]</em></p>
          <UpdSignatureLine position={document.performerSignatorySnapshot.position} name={document.performerSignatorySnapshot.name} />
          <p><b>Наименование экономического субъекта - составителя документа</b> <em>[14]</em></p>
          <div className="upd-line">{document.sellerSnapshot.name || document.sellerSnapshot.shortName}</div>
          <span className="upd-stamp">М. П.</span>
        </div>
        <div>
          <p><b>Товар (груз) получил / услуги, результаты работ, права принял</b> <em>[15]</em></p>
          <UpdSignatureLine position={document.customerSignatorySnapshot.position} name={document.customerSignatorySnapshot.name} />
          <p><b>Дата получения (приемки)</b> <em>[16]</em></p>
          <div className="upd-line">{dateLongRu(upd.receiptDate)}</div>
          <p><b>Иные сведения о получении, приемке</b> <em>[17]</em></p>
          <div className="upd-line">{upd.receiptInfo || "--"}</div>
          <p><b>Ответственный за правильность оформления факта хозяйственной жизни</b> <em>[18]</em></p>
          <UpdSignatureLine position={document.customerSignatorySnapshot.position} name={document.customerSignatorySnapshot.name} />
          <p><b>Наименование экономического субъекта - составителя документа</b> <em>[19]</em></p>
          <div className="upd-line">{document.buyerSnapshot.name || document.buyerSnapshot.shortName}</div>
          <span className="upd-stamp">М. П.</span>
        </div>
      </section>
    </article>
  );
}

export function ClosingDocumentPrint({ document }: { document: ClosingDocumentSnapshot }) {
  if (document.type === "upd_print") return <UpdDocumentPrint document={document} />;

  const works = document.positionsSnapshot.filter((row) => row.kind === "work");
  const materials = document.positionsSnapshot.filter((row) => row.kind === "material");
  const showMaterialsInAct = document.type !== "work_act" || materials.length > 0;

  return (
    <article className="cdoc-sheet" data-closing-document-ready="true">
      <header className="cdoc-header">
        <div>
          <p className="cdoc-kicker">Отгрузка {document.shipmentNumber}</p>
          <h1>{documentTitle(document.type)}</h1>
          <p className="cdoc-subtitle">
            № {document.number} от {dateRu(document.documentDate)} · редакция {document.revision} · статус {statusRu(document.status)}
          </p>
        </div>
        <dl className="cdoc-meta">
          <div>
            <dt>Дата выполнения</dt>
            <dd>{dateRu(document.completionDate)}</dd>
          </div>
          <div>
            <dt>НДС</dt>
            <dd>{document.vatSnapshot.label}</dd>
          </div>
        </dl>
      </header>

      <div className="cdoc-parties">
        <PartyBlock title="Исполнитель" party={document.sellerSnapshot} />
        <PartyBlock title="Заказчик" party={document.buyerSnapshot} />
      </div>

      <section className="cdoc-section">
        <h2>Автомобиль</h2>
        <dl className="cdoc-vehicle">
          {field("Марка и модель", document.vehicleSnapshot.makeModel)}
          {field("Госномер", document.vehicleSnapshot.plate)}
          {field("VIN", document.vehicleSnapshot.vin)}
          {field("Пробег", document.vehicleSnapshot.mileage)}
          {field("Дата передачи", document.vehicleSnapshot.transferredAt)}
          {field("Дата возврата", document.vehicleSnapshot.returnedAt)}
        </dl>
      </section>

      <PositionsTable title="Работы" rows={works} />
      {showMaterialsInAct ? <PositionsTable title="Запчасти и материалы" rows={materials} showArticle /> : null}

      <section className="cdoc-section cdoc-totals-section">
        <h2>Итоги</h2>
        <dl className="cdoc-totals">
          <div><dt>Стоимость работ</dt><dd>{money(document.totalsSnapshot.worksCents)} ₽</dd></div>
          <div><dt>Стоимость запчастей и материалов</dt><dd>{money(document.totalsSnapshot.materialsCents)} ₽</dd></div>
          <div><dt>Скидка</dt><dd>{money(document.totalsSnapshot.discountCents)} ₽</dd></div>
          <div><dt>Сумма без НДС</dt><dd>{money(document.totalsSnapshot.amountWithoutVatCents)} ₽</dd></div>
          <div><dt>НДС</dt><dd>{money(document.totalsSnapshot.vatCents)} ₽</dd></div>
          <div className="is-total"><dt>Итого</dt><dd>{money(document.totalsSnapshot.totalCents)} ₽</dd></div>
          <div className="is-words"><dt>Сумма прописью</dt><dd>{document.totalsSnapshot.totalInWords}</dd></div>
          <div><dt>Кол-во работ</dt><dd>{document.totalsSnapshot.worksCount}</dd></div>
          <div><dt>Кол-во материалов</dt><dd>{document.totalsSnapshot.materialsCount}</dd></div>
        </dl>
      </section>

      <section className="cdoc-section cdoc-acceptance">
        <h2>Приёмка результата</h2>
        <p>{document.acceptanceText}</p>
        {document.customerRemarks ? (
          <div className="cdoc-remarks">
            <strong>Замечания заказчика:</strong>
            <span>{document.customerRemarks}</span>
          </div>
        ) : null}
      </section>

      <section className="cdoc-section cdoc-transfer">
        <h2>Передача автомобиля</h2>
        <dl>
          {field("Автомобиль передал", document.transferSnapshot.vehicleTransferredBy)}
          {field("Автомобиль принял", document.transferSnapshot.vehicleAcceptedBy)}
          {field("Комплектность", document.transferSnapshot.completeness)}
          {field("Количество ключей", document.transferSnapshot.keysCount)}
          {field("Дата и время передачи", document.transferSnapshot.transferredAt)}
          {field("Дополнительные замечания", document.transferSnapshot.additionalNotes)}
        </dl>
      </section>

      <section className="cdoc-signatures">
        <SignatureBlock title="Исполнитель" position={document.performerSignatorySnapshot.position} name={document.performerSignatorySnapshot.name} />
        <SignatureBlock title="Заказчик" position={document.customerSignatorySnapshot.position} name={document.customerSignatorySnapshot.name} />
      </section>
      <div className="cdoc-received">Документ получил: ________________________________________________</div>
    </article>
  );
}

export function ClosingDocumentStyles() {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
.cdoc-screen {
  min-height: 100vh;
  background: #eef1f3;
  color: #111827;
  padding: 20px;
  font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.cdoc-toolbar {
  width: min(210mm, calc(100vw - 32px));
  margin: 0 auto 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.cdoc-toolbar a,
.cdoc-toolbar button {
  display: inline-flex;
  min-height: 36px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: #111827;
  border-radius: 6px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 700;
  text-decoration: none;
}
.cdoc-toolbar .is-primary {
  background: #1f2937;
  border-color: #1f2937;
  color: #fff;
}
.cdoc-sheet {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto 20px;
  background: #fff;
  padding: 15mm 13mm 16mm;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.14);
  color: #111827;
  font-size: 11px;
  line-height: 1.35;
}
.cdoc-sheet * {
  box-sizing: border-box;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.cdoc-header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 60mm;
  gap: 10mm;
  align-items: start;
  border-bottom: 2px solid #111827;
  padding-bottom: 7mm;
}
.cdoc-kicker {
  margin: 0 0 3mm;
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0;
}
.cdoc-header h1 {
  margin: 0;
  font-size: 22px;
  line-height: 1.05;
  font-weight: 900;
}
.cdoc-subtitle {
  margin: 3mm 0 0;
  color: #475569;
  font-size: 11px;
}
.cdoc-meta {
  display: grid;
  gap: 2mm;
  margin: 0;
}
.cdoc-meta div,
.cdoc-totals div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 4mm;
}
.cdoc-meta dt,
.cdoc-totals dt,
.cdoc-field dt {
  color: #64748b;
  font-weight: 600;
}
.cdoc-meta dd,
.cdoc-totals dd,
.cdoc-field dd {
  margin: 0;
  font-weight: 700;
}
.cdoc-notice {
  margin-top: 5mm;
  padding: 3mm 4mm;
  border: 1px solid #a16207;
  background: #fef3c7;
  color: #713f12;
  font-weight: 800;
}
.cdoc-parties {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6mm;
  margin-top: 7mm;
}
.cdoc-party,
.cdoc-section {
  break-inside: avoid;
  page-break-inside: avoid;
}
.cdoc-party h2,
.cdoc-section h2 {
  margin: 0 0 3mm;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}
.cdoc-party dl,
.cdoc-vehicle,
.cdoc-transfer dl {
  display: grid;
  gap: 1.4mm;
  margin: 0;
}
.cdoc-field {
  display: grid;
  grid-template-columns: 28mm minmax(0, 1fr);
  gap: 3mm;
}
.cdoc-field dd {
  overflow-wrap: anywhere;
}
.cdoc-section {
  margin-top: 7mm;
}
.cdoc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9px;
}
.cdoc-table thead {
  display: table-header-group;
}
.cdoc-table th,
.cdoc-table td {
  border: 1px solid #cbd5e1;
  padding: 1.5mm 1.3mm;
  vertical-align: top;
}
.cdoc-table th {
  background: #e5e7eb;
  color: #111827;
  font-weight: 800;
  text-align: left;
}
.cdoc-table tr {
  break-inside: avoid;
  page-break-inside: avoid;
}
.cdoc-table td:nth-child(1),
.cdoc-table td:nth-child(4),
.cdoc-table td:nth-child(5),
.cdoc-table td:nth-child(6),
.cdoc-table td:nth-child(7),
.cdoc-table td:nth-child(8),
.cdoc-table td:nth-child(9),
.cdoc-table td:nth-child(10),
.cdoc-table td:nth-child(11) {
  white-space: nowrap;
}
.cdoc-totals-section {
  width: 98mm;
  margin-left: auto;
}
.cdoc-totals {
  display: grid;
  gap: 1.7mm;
  margin: 0;
}
.cdoc-totals .is-total {
  border-top: 1px solid #111827;
  padding-top: 2mm;
  font-size: 13px;
}
.cdoc-totals .is-words {
  display: block;
}
.cdoc-totals .is-words dt {
  margin-bottom: 0.8mm;
}
.cdoc-totals .is-words dd {
  overflow-wrap: anywhere;
  line-height: 1.25;
}
.cdoc-acceptance p {
  margin: 0;
}
.cdoc-remarks {
  margin-top: 3mm;
  padding: 3mm;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
}
.cdoc-remarks span {
  display: block;
  margin-top: 1mm;
}
.cdoc-signatures {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10mm;
  margin-top: 10mm;
  break-inside: avoid;
  page-break-inside: avoid;
}
.cdoc-signature h3 {
  margin: 0 0 6mm;
  font-size: 12px;
}
.cdoc-sign-line {
  display: grid;
  grid-template-columns: 28mm 1fr 34mm;
  gap: 3mm;
  align-items: end;
}
.cdoc-sign-line b {
  display: block;
  border-bottom: 1px solid #111827;
  height: 7mm;
}
.cdoc-sign-caption {
  display: grid;
  grid-template-columns: 28mm 1fr 34mm;
  gap: 3mm;
  color: #64748b;
  font-size: 8px;
  text-align: center;
}
.cdoc-stamp {
  margin-top: 5mm;
  color: #64748b;
}
.cdoc-received {
  margin-top: 8mm;
  break-inside: avoid;
  page-break-inside: avoid;
}
.cdoc-upd-sheet {
  width: 297mm;
  min-height: 210mm;
  padding: 4mm 5mm;
  font-family: Arial, "Helvetica Neue", sans-serif;
  font-size: 6px;
  line-height: 1.08;
  page: cdoc-upd-landscape;
}
.cdoc-upd-sheet table {
  width: 100%;
  border-collapse: collapse;
}
.upd-top {
  display: grid;
  grid-template-columns: 52mm 1fr;
  gap: 4mm;
  align-items: start;
  break-inside: avoid;
  page-break-inside: avoid;
}
.upd-title-block {
  display: grid;
  grid-template-columns: 22mm 1fr;
  gap: 2mm;
  align-items: start;
}
.upd-title-block strong {
  display: block;
  font-size: 14px;
  line-height: 1.05;
  text-transform: uppercase;
}
.upd-status {
  display: grid;
  grid-template-columns: auto 9mm;
  gap: 0.8mm;
  align-items: start;
  padding-top: 6mm;
}
.upd-status span {
  font-weight: 700;
}
.upd-status b {
  min-height: 7mm;
  border: 1px solid #111;
  font-size: 12px;
  line-height: 7mm;
  text-align: center;
}
.upd-status small {
  grid-column: 1 / -1;
  font-size: 5px;
  line-height: 1.12;
}
.upd-invoice-block {
  display: grid;
  gap: 1mm;
}
.upd-invoice-block div {
  display: grid;
  grid-template-columns: 27mm 42mm 6mm 31mm 7mm;
  gap: 1mm;
  align-items: end;
}
.upd-invoice-block span {
  font-weight: 700;
}
.upd-invoice-block b {
  min-height: 4mm;
  border-bottom: 1px solid #111;
  font-size: 8px;
  font-weight: 700;
  text-align: center;
}
.upd-invoice-block em {
  font-style: normal;
}
.upd-invoice-block p {
  margin: 0;
  color: #333;
  font-size: 5px;
  text-align: right;
}
.upd-requisites {
  margin-top: 1mm;
  break-inside: avoid;
  page-break-inside: avoid;
}
.upd-requisites th,
.upd-requisites td {
  padding: 0.25mm 0.6mm;
  vertical-align: top;
}
.upd-requisites th {
  width: 55mm;
  font-weight: 700;
  text-align: left;
}
.upd-requisites td:nth-child(2) {
  border-bottom: 1px solid #111;
}
.upd-requisites td:nth-child(3) {
  width: 8mm;
  text-align: right;
}
.upd-vat-note {
  margin: 1mm 0;
  border: 1px solid #111;
  padding: 0.6mm 2mm;
  font-size: 8px;
  font-weight: 700;
  text-align: center;
  break-inside: avoid;
  page-break-inside: avoid;
}
.upd-items {
  margin-top: 1mm;
  table-layout: fixed;
}
.upd-items thead {
  display: table-header-group;
}
.upd-items tbody {
  display: table-row-group;
}
.upd-items tr {
  break-inside: avoid;
  page-break-inside: avoid;
}
.upd-items th,
.upd-items td {
  border: 1px solid #111;
  padding: 0.45mm 0.5mm;
  vertical-align: top;
  overflow-wrap: anywhere;
}
.upd-items th {
  font-size: 5px;
  font-weight: 700;
  text-align: center;
}
.upd-items td {
  font-size: 6px;
}
.upd-items th:nth-child(1),
.upd-items td:nth-child(1) { width: 7mm; text-align: center; }
.upd-items th:nth-child(2),
.upd-items td:nth-child(2) { width: 19mm; }
.upd-items th:nth-child(3),
.upd-items td:nth-child(3) { width: 57mm; }
.upd-items th:nth-child(4),
.upd-items td:nth-child(4) { width: 9mm; text-align: center; }
.upd-items th:nth-child(5),
.upd-items td:nth-child(5) { width: 13mm; text-align: center; }
.upd-items th:nth-child(6),
.upd-items td:nth-child(6) { width: 14mm; text-align: right; }
.upd-items th:nth-child(7),
.upd-items td:nth-child(7),
.upd-items th:nth-child(8),
.upd-items td:nth-child(8),
.upd-items th:nth-child(11),
.upd-items td:nth-child(11),
.upd-items th:nth-child(12),
.upd-items td:nth-child(12) { width: 18mm; text-align: right; }
.upd-items th:nth-child(9),
.upd-items td:nth-child(9),
.upd-items th:nth-child(10),
.upd-items td:nth-child(10) { width: 15mm; text-align: center; }
.upd-column-codes th {
  font-size: 5px;
  font-weight: 400;
}
.upd-kind {
  display: inline-block;
  margin: 0 1mm 0.4mm 0;
  border: 1px solid #111;
  padding: 0.1mm 0.8mm;
  font-size: 5px;
  font-weight: 700;
  text-transform: uppercase;
}
.upd-total-row td {
  font-weight: 700;
}
.upd-amount-words {
  margin-top: 0.8mm;
  font-weight: 700;
  break-inside: avoid;
  page-break-inside: avoid;
}
.upd-accounting-signatures {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5mm 5mm;
  margin-top: 1.4mm;
  break-inside: avoid;
  page-break-inside: avoid;
}
.upd-accounting-signatures > div:nth-child(3) {
  grid-column: 1 / -1;
}
.upd-accounting-signatures b,
.upd-transfer-grid b {
  font-weight: 700;
}
.upd-accounting-signatures p {
  margin: 0.3mm 0 0;
}
.upd-signature-line {
  display: grid;
  grid-template-columns: 37mm 28mm 42mm;
  gap: 1.5mm;
  align-items: end;
  margin-top: 0.7mm;
}
.upd-signature-line i {
  display: block;
  height: 3.6mm;
  border-bottom: 1px solid #111;
}
.upd-signature-line span {
  min-height: 3.2mm;
  border-bottom: 1px solid #111;
  overflow-wrap: anywhere;
}
.upd-signature-line::after {
  content: "(должность)                  (подпись)                  (ф.и.о.)";
  grid-column: 1 / -1;
  color: #555;
  font-size: 4.5px;
  text-align: center;
}
.upd-transfer-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4mm;
  margin-top: 1.4mm;
  border-top: 2px solid #111;
  padding-top: 1mm;
  break-inside: avoid;
  page-break-inside: avoid;
}
.upd-transfer-grid p {
  margin: 0.7mm 0 0.25mm;
}
.upd-transfer-grid em {
  float: right;
  font-style: normal;
}
.upd-line {
  min-height: 3mm;
  border-bottom: 1px solid #111;
  padding: 0.2mm 0;
  overflow-wrap: anywhere;
}
.upd-stamp {
  display: inline-block;
  margin-top: 0.8mm;
  color: #333;
  font-weight: 700;
}
.cdoc-sheet:not(.cdoc-upd-sheet) {
  padding: 10mm 11mm 11mm;
  font-size: 9.5px;
  line-height: 1.22;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-header {
  grid-template-columns: minmax(0, 1fr) 52mm;
  gap: 7mm;
  padding-bottom: 5mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-header h1 {
  font-size: 18px;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-subtitle {
  margin-top: 2mm;
  font-size: 9.5px;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-kicker {
  margin-bottom: 2mm;
  font-size: 8.5px;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-parties {
  gap: 5mm;
  margin-top: 5mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-party h2,
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-section h2 {
  margin-bottom: 2mm;
  font-size: 10px;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-party dl,
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-vehicle,
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-transfer dl {
  gap: 0.8mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-field {
  grid-template-columns: 25mm minmax(0, 1fr);
  gap: 2mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-section {
  margin-top: 4mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-table {
  font-size: 8px;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-table th,
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-table td {
  padding: 0.85mm 0.75mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-totals-section {
  width: 88mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-totals {
  gap: 0.9mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-totals .is-total {
  padding-top: 1mm;
  font-size: 11px;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-totals .is-words {
  padding-top: 0.5mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-remarks {
  margin-top: 1.6mm;
  padding: 1.8mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-transfer,
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-acceptance,
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-signatures,
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-received {
  break-inside: avoid;
  page-break-inside: avoid;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-signatures {
  gap: 7mm;
  margin-top: 6mm;
  break-before: avoid-page;
  page-break-before: auto;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-signature h3 {
  margin-bottom: 3mm;
  font-size: 10px;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-sign-line {
  grid-template-columns: 25mm 1fr 31mm;
  gap: 2mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-sign-line b {
  height: 5mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-sign-caption {
  grid-template-columns: 25mm 1fr 31mm;
  gap: 2mm;
  font-size: 7px;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-stamp {
  margin-top: 3mm;
}
.cdoc-sheet:not(.cdoc-upd-sheet) .cdoc-received {
  margin-top: 5mm;
}
@page {
  size: A4;
  margin: 0;
}
@page cdoc-upd-landscape {
  size: A4 landscape;
  margin: 0;
}
@media print {
  html,
  body {
    width: auto;
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }
  .cdoc-screen {
    padding: 0;
    background: #fff;
  }
  .cdoc-toolbar,
  .no-print,
  nextjs-portal,
  script[data-nextjs-dev-overlay],
  [data-nextjs-toast],
  [data-nextjs-dev-overlay],
  [data-nextjs-dev-tools-button],
  [data-nextjs-dev-tools-panel] {
    display: none !important;
  }
  .cdoc-sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 0;
    box-shadow: none;
  }
  .cdoc-sheet:not(.cdoc-upd-sheet) {
    min-height: 297mm;
    padding: 9mm 10mm 10mm;
  }
  .cdoc-upd-sheet {
    width: 297mm;
    min-height: 210mm;
    box-shadow: none;
  }
}
@media screen and (max-width: 820px) {
  .cdoc-screen {
    padding: 12px;
    overflow-x: auto;
  }
  .cdoc-toolbar {
    width: 100%;
    min-width: 210mm;
  }
  .cdoc-upd-sheet,
  .cdoc-upd-sheet + .cdoc-toolbar {
    min-width: 297mm;
  }
}
        `,
      }}
    />
  );
}

function statusRu(status: string): string {
  if (status === "draft") return "черновик";
  if (status === "signed") return "подписан";
  if (status === "cancelled") return "аннулирован";
  return "сформирован";
}
