import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getScopedBranchId } from "@/lib/request-tenant-store";
import type { User } from "@/lib/auth";
import { resolveBranchPrintContext } from "@/lib/branch-print-context";

export type ClosingDocumentType = "closing_work_order" | "work_act" | "upd_print";
export type ClosingDocumentStatus = "draft" | "issued" | "signed" | "cancelled";

export const CLOSING_DOCUMENT_TYPES: Record<ClosingDocumentType, { title: string; shortTitle: string; prefix: string }> = {
  closing_work_order: {
    title: "Заказ-наряд — закрывающий документ",
    shortTitle: "Закрывающий заказ-наряд",
    prefix: "ЗНЗ",
  },
  work_act: {
    title: "Акт выполненных работ",
    shortTitle: "Акт",
    prefix: "АКТ",
  },
  upd_print: {
    title: "УПД",
    shortTitle: "УПД",
    prefix: "УПД",
  },
};

export const DEFAULT_ACCEPTANCE_TEXT =
  "Работы выполнены полностью и в установленный срок. Запчасти и материалы переданы заказчику и использованы при выполнении работ согласно настоящему документу. Заказчик результат работ и автомобиль принял, претензий по объёму, качеству, стоимости и срокам выполнения не имеет.";

type JsonRecord = Record<string, unknown>;

export type ClosingPartySnapshot = {
  name: string;
  shortName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  ogrnip: string;
  legalAddress: string;
  actualAddress: string;
  bankName: string;
  bankLocation: string;
  bik: string;
  checkingAccount: string;
  correspondentAccount: string;
  phone: string;
  email: string;
  signatoryPosition: string;
  signatoryName: string;
  signatoryBasis: string;
  companyType?: string;
};

export type ClosingVehicleSnapshot = {
  makeModel: string;
  plate: string;
  vin: string;
  mileage: string;
  transferredAt: string;
  returnedAt: string;
};

export type ClosingPositionSnapshot = {
  id: string;
  kind: "work" | "material";
  name: string;
  article: string;
  code: string;
  uomName: string;
  quantity: number;
  priceCents: number;
  discountPercent: number;
  subtotalCents: number;
  discountCents: number;
  amountWithoutVatCents: number;
  vatEnabled: boolean;
  vatRate: number;
  vatCents: number;
  totalCents: number;
};

export type ClosingTotalsSnapshot = {
  worksCents: number;
  materialsCents: number;
  discountCents: number;
  amountWithoutVatCents: number;
  vatCents: number;
  totalCents: number;
  totalInWords: string;
  worksCount: number;
  materialsCount: number;
};

export type ClosingVatSnapshot = {
  mode: "without_vat" | "vat" | "mixed";
  label: string;
  rates: Array<{ rate: number; amountCents: number; vatCents: number }>;
};

export type ClosingTransferSnapshot = {
  vehicleTransferredBy: string;
  vehicleAcceptedBy: string;
  completeness: string;
  keysCount: string;
  additionalNotes: string;
  transferredAt: string;
};

export type ClosingUpdSnapshot = {
  functionCode: "1" | "2";
  functionLabel: string;
  seller: string;
  buyer: string;
  shipper: string;
  consignee: string;
  transferBasis: string;
  paymentDocument: string;
  currencyName: string;
  currencyCode: string;
  vatLabel: string;
  transferInfo: string;
  receiptInfo: string;
  transferDate: string;
  receiptDate: string;
};

export type ClosingDocumentSnapshot = {
  id?: string;
  shipmentId: string;
  organizationId: string | null;
  type: ClosingDocumentType;
  number: string;
  revision: number;
  status: ClosingDocumentStatus;
  documentDate: string;
  completionDate: string;
  shipmentNumber: string;
  shipmentApplicable: boolean;
  shipmentUpdatedAt?: string;
  sourceHash: string;
  isOutdated?: boolean;
  sellerSnapshot: ClosingPartySnapshot;
  buyerSnapshot: ClosingPartySnapshot;
  vehicleSnapshot: ClosingVehicleSnapshot;
  positionsSnapshot: ClosingPositionSnapshot[];
  totalsSnapshot: ClosingTotalsSnapshot;
  vatSnapshot: ClosingVatSnapshot;
  acceptanceText: string;
  customerRemarks: string;
  transferSnapshot: ClosingTransferSnapshot;
  updSnapshot?: ClosingUpdSnapshot;
  performerSignatorySnapshot: { position: string; name: string; basis: string };
  customerSignatorySnapshot: { position: string; name: string; basis: string };
  createdByName?: string;
  createdAt?: string;
  issuedAt?: string | null;
  cancelledAt?: string | null;
};

export type ClosingValidation = {
  canIssue: boolean;
  missing: string[];
  warnings: string[];
};

export type ClosingDocumentPayload = {
  document: ClosingDocumentSnapshot;
  validation: ClosingValidation;
  existing: Array<{
    id: string;
    type: ClosingDocumentType;
    number: string;
    revision: number;
    status: ClosingDocumentStatus;
    documentDate: string;
    createdByName: string;
    createdAt: string;
    isOutdated: boolean;
  }>;
};

type BuildOptions = {
  type: ClosingDocumentType;
  documentDate?: string;
  completionDate?: string;
  acceptanceText?: string;
  customerRemarks?: string;
  transfer?: Partial<ClosingTransferSnapshot>;
  upd?: Partial<ClosingUpdSnapshot>;
  sellerSignatory?: Partial<{ position: string; name: string; basis: string }>;
  customerSignatory?: Partial<{ position: string; name: string; basis: string }>;
};

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function firstFilled(...values: unknown[]): string {
  for (const value of values) {
    const text = clean(value);
    if (text) return text;
  }
  return "";
}

const DEFAULT_SELLER_REQUISITES: ClosingPartySnapshot = {
  name: "ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ ЕЛИСЕЕНКО ИЛЬЯ СЕРГЕЕВИЧ",
  shortName: "ИП Елисеенко Илья Сергеевич",
  inn: "392302838630",
  kpp: "",
  ogrn: "",
  ogrnip: "319392600035915",
  legalAddress: "238410, Россия, Калининградская обл, Правдинский р-н, пгт Железнодорожный, ул Деповская, д 1, кв 7",
  actualAddress: "238410, Россия, Калининградская обл, Правдинский р-н, пгт Железнодорожный, ул Деповская, д 1, кв 7",
  bankName: "АО «Тинькофф Банк»",
  bankLocation: "127287, г. Москва, ул. Хуторская 2-я, д. 38А, стр. 26",
  bik: "044525974",
  checkingAccount: "40802810000001162610",
  correspondentAccount: "30101810145250000974",
  phone: "",
  email: "",
  signatoryPosition: "Индивидуальный предприниматель",
  signatoryName: "Елисеенко Илья Сергеевич",
  signatoryBasis: "ОГРНИП 319392600035915",
};

function defaultSellerRequisites(): ClosingPartySnapshot {
  return {
    name: firstFilled(process.env.CLOSING_SELLER_LEGAL_NAME, DEFAULT_SELLER_REQUISITES.name),
    shortName: firstFilled(process.env.CLOSING_SELLER_SHORT_NAME, DEFAULT_SELLER_REQUISITES.shortName),
    inn: firstFilled(process.env.CLOSING_SELLER_INN, process.env.JOB_ORDER_SELLER_INN, DEFAULT_SELLER_REQUISITES.inn),
    kpp: firstFilled(process.env.CLOSING_SELLER_KPP, process.env.JOB_ORDER_SELLER_KPP, DEFAULT_SELLER_REQUISITES.kpp),
    ogrn: firstFilled(process.env.CLOSING_SELLER_OGRN, DEFAULT_SELLER_REQUISITES.ogrn),
    ogrnip: firstFilled(process.env.CLOSING_SELLER_OGRNIP, process.env.JOB_ORDER_SELLER_OGRN, DEFAULT_SELLER_REQUISITES.ogrnip),
    legalAddress: firstFilled(process.env.CLOSING_SELLER_ADDRESS, process.env.JOB_ORDER_SELLER_ADDRESS, DEFAULT_SELLER_REQUISITES.legalAddress),
    actualAddress: firstFilled(process.env.CLOSING_SELLER_ACTUAL_ADDRESS, process.env.CLOSING_SELLER_ADDRESS, process.env.JOB_ORDER_SELLER_ADDRESS, DEFAULT_SELLER_REQUISITES.actualAddress),
    bankName: firstFilled(process.env.CLOSING_SELLER_BANK_NAME, DEFAULT_SELLER_REQUISITES.bankName),
    bankLocation: firstFilled(process.env.CLOSING_SELLER_BANK_LOCATION, DEFAULT_SELLER_REQUISITES.bankLocation),
    bik: firstFilled(process.env.CLOSING_SELLER_BIK, DEFAULT_SELLER_REQUISITES.bik),
    checkingAccount: firstFilled(process.env.CLOSING_SELLER_CHECKING_ACCOUNT, DEFAULT_SELLER_REQUISITES.checkingAccount),
    correspondentAccount: firstFilled(process.env.CLOSING_SELLER_CORRESPONDENT_ACCOUNT, DEFAULT_SELLER_REQUISITES.correspondentAccount),
    phone: "",
    email: firstFilled(process.env.CLOSING_SELLER_EMAIL, DEFAULT_SELLER_REQUISITES.email),
    signatoryPosition: firstFilled(process.env.CLOSING_SELLER_SIGNATORY_POSITION, DEFAULT_SELLER_REQUISITES.signatoryPosition),
    signatoryName: firstFilled(process.env.CLOSING_SELLER_SIGNATORY_NAME, DEFAULT_SELLER_REQUISITES.signatoryName),
    signatoryBasis: firstFilled(process.env.CLOSING_SELLER_SIGNATORY_BASIS, DEFAULT_SELLER_REQUISITES.signatoryBasis),
  };
}

function isPlaceholderOrganizationName(value: unknown): boolean {
  const normalized = clean(value).toLowerCase().replace(/ё/g, "е").replace(/[\s._-]+/g, "");
  return normalized === "экоплатформа" || normalized === "ecoplatform";
}

function shouldUseDefaultSeller(rowName: unknown, raw: JsonRecord): boolean {
  const hasLegalRequisites = Boolean(firstFilled(raw.inn, raw.ogrn, raw.ogrnip, raw.legalTitle));
  return isPlaceholderOrganizationName(rowName) && !hasLegalRequisites;
}

function hasExplicitSellerEnv(): boolean {
  return Boolean(
    firstFilled(
      process.env.CLOSING_SELLER_LEGAL_NAME,
      process.env.CLOSING_SELLER_SHORT_NAME,
      process.env.CLOSING_SELLER_INN,
      process.env.CLOSING_SELLER_OGRN,
      process.env.CLOSING_SELLER_OGRNIP,
      process.env.CLOSING_SELLER_ADDRESS,
      process.env.CLOSING_SELLER_BANK_NAME,
      process.env.CLOSING_SELLER_CHECKING_ACCOUNT
    )
  );
}

function normalizeSellerSnapshot(snapshot: ClosingPartySnapshot): ClosingPartySnapshot {
  const fallback = defaultSellerRequisites();
  if (isPlaceholderOrganizationName(snapshot.name) || isPlaceholderOrganizationName(snapshot.shortName)) {
    return fallback;
  }
  return snapshot;
}

function dateOnly(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function normalizeDateInput(value: string | undefined, fallback: string): string {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback;
}

function updFunctionLabel(code: unknown): string {
  return clean(code) === "1" ? "Счет-фактура и передаточный документ (акт)" : "Передаточный документ (акт)";
}

function partyDisplay(party: ClosingPartySnapshot): string {
  const requisites = [
    party.inn ? `ИНН ${party.inn}` : "",
    party.kpp ? `КПП ${party.kpp}` : "",
    party.ogrnip ? `ОГРНИП ${party.ogrnip}` : party.ogrn ? `ОГРН ${party.ogrn}` : "",
  ].filter(Boolean);
  return [party.name || party.shortName, requisites.join(", ")].filter(Boolean).join(", ");
}

function partyAddressLine(party: ClosingPartySnapshot): string {
  return [party.name || party.shortName, party.legalAddress || party.actualAddress].filter(Boolean).join(", ");
}

function attrValue(attributes: unknown, matcher: RegExp): string {
  const list = Array.isArray(attributes) ? attributes : [];
  for (const item of list) {
    const record = jsonRecord(item);
    const name = clean(record.name);
    if (!matcher.test(name)) continue;
    return clean(record.value);
  }
  return "";
}

function formatAttributeValue(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (value && typeof value === "object") {
    const record = jsonRecord(value);
    return firstFilled(record.name, record.value, record.text, record.title);
  }
  return "";
}

function looksLikeVinValue(value: string): boolean {
  const text = value.replace(/\s/g, "");
  if (!text) return false;
  if (/[А-Яа-яЁё]{2,}/.test(value)) return false;
  if (/^[A-HJ-NPR-Z0-9]{17}$/i.test(text)) return true;
  return text.length >= 11 && text.length <= 19 && /^[A-HJ-NPR-Z0-9]+$/i.test(text);
}

function findVehiclePlate(attributes: unknown): string {
  const list = Array.isArray(attributes) ? attributes : [];
  const plateLabelRes = [
    /гос\.?\s*номер|госномер|государственн|регистрационн|рег\s*знак|license\s*plate|^\s*plate\s*$/i,
    /гос(?!\w)|номер\s*а\/м|номер\s*авто/i,
  ];
  for (const re of plateLabelRes) {
    for (const item of list) {
      const record = jsonRecord(item);
      const label = clean(record.name);
      if (!label || /vin|вин/i.test(label)) continue;
      if (!re.test(label)) continue;
      const value = formatAttributeValue(record.value);
      if (value && !looksLikeVinValue(value)) return value;
    }
  }
  for (const item of list) {
    const record = jsonRecord(item);
    const label = clean(record.name).toLowerCase().replace(/ё/g, "е");
    if (/vin|вин|кузов|двигател|шасси|рамы|frame/i.test(label)) continue;
    if (!/номер/.test(label)) continue;
    const value = formatAttributeValue(record.value);
    if (value && !looksLikeVinValue(value) && /[А-Яа-яЁёA-Za-z]/.test(value)) return value;
  }
  return "";
}

function findVehicleVin(attributes: unknown): string {
  const list = Array.isArray(attributes) ? attributes : [];
  for (const item of list) {
    const record = jsonRecord(item);
    const label = clean(record.name).toLowerCase();
    if (/^vin|^вин\b|vin\s*номер|идентификатор\s*тс/i.test(label)) {
      const value = formatAttributeValue(record.value);
      if (value) return value;
    }
  }
  return attrValue(attributes, /vin|вин/i);
}

function nested(record: JsonRecord, key: string): JsonRecord {
  return jsonRecord(record[key]);
}

function partyFromOrganization(row: {
  name: string;
  fullLegalName?: string | null;
  inn?: string | null;
  kpp?: string | null;
  ogrn?: string | null;
  ogrnip?: string | null;
  legalAddress?: string | null;
  actualAddress?: string | null;
  bankName?: string | null;
  bik?: string | null;
  checkingAccount?: string | null;
  correspondentAccount?: string | null;
  phone?: string | null;
  email?: string | null;
  signatoryName?: string | null;
  signatoryPosition?: string | null;
  signatoryAuthority?: string | null;
  raw: Prisma.JsonValue | null;
} | null): ClosingPartySnapshot {
  const raw = jsonRecord(row?.raw);
  const fallback = defaultSellerRequisites();
  if (shouldUseDefaultSeller(row?.name, raw)) return fallback;
  const useEnvFallback = hasExplicitSellerEnv();
  const company = nested(raw, "company");
  const bank = nested(raw, "bankAccount");
  const signatoryName = firstFilled(
    row?.signatoryName,
    company.director,
    raw.director,
    useEnvFallback ? process.env.CLOSING_SELLER_SIGNATORY_NAME : "",
    row?.fullLegalName,
    row?.name,
    useEnvFallback ? fallback.signatoryName : ""
  );
  return {
    name: firstFilled(row?.fullLegalName, raw.legalTitle, raw.name, row?.name, useEnvFallback ? process.env.CLOSING_SELLER_LEGAL_NAME : "", useEnvFallback ? fallback.name : ""),
    shortName: firstFilled(row?.name, raw.name, raw.legalTitle, useEnvFallback ? process.env.CLOSING_SELLER_SHORT_NAME : "", useEnvFallback ? fallback.shortName : ""),
    inn: firstFilled(row?.inn, raw.inn, useEnvFallback ? fallback.inn : ""),
    kpp: firstFilled(row?.kpp, raw.kpp, useEnvFallback ? fallback.kpp : ""),
    ogrn: firstFilled(row?.ogrn, raw.ogrn, useEnvFallback ? fallback.ogrn : ""),
    ogrnip: firstFilled(row?.ogrnip, raw.ogrnip, useEnvFallback ? fallback.ogrnip : ""),
    legalAddress: firstFilled(row?.legalAddress, raw.legalAddress, raw.actualAddress, useEnvFallback ? fallback.legalAddress : ""),
    actualAddress: firstFilled(row?.actualAddress, raw.actualAddress, raw.legalAddress, useEnvFallback ? fallback.actualAddress : ""),
    bankName: firstFilled(row?.bankName, bank.bankName, raw.bankName, useEnvFallback ? fallback.bankName : ""),
    bankLocation: firstFilled(bank.bankLocation, raw.bankLocation, useEnvFallback ? fallback.bankLocation : ""),
    bik: firstFilled(row?.bik, bank.bik, raw.bik, useEnvFallback ? fallback.bik : ""),
    checkingAccount: firstFilled(row?.checkingAccount, bank.accountNumber, raw.checkingAccount, useEnvFallback ? fallback.checkingAccount : ""),
    correspondentAccount: firstFilled(row?.correspondentAccount, bank.correspondentAccount, raw.correspondentAccount, useEnvFallback ? fallback.correspondentAccount : ""),
    phone: firstFilled(row?.phone, raw.phone, useEnvFallback ? fallback.phone : ""),
    email: firstFilled(row?.email, raw.email, useEnvFallback ? fallback.email : ""),
    signatoryPosition: firstFilled(row?.signatoryPosition, useEnvFallback ? process.env.CLOSING_SELLER_SIGNATORY_POSITION : "", useEnvFallback ? fallback.signatoryPosition : "Руководитель"),
    signatoryName: firstFilled(signatoryName),
    signatoryBasis: firstFilled(row?.signatoryAuthority, useEnvFallback ? process.env.CLOSING_SELLER_SIGNATORY_BASIS : "", useEnvFallback ? fallback.signatoryBasis : "Устава"),
  };
}

function partyFromCounterparty(row: {
  name: string;
  phone: string | null;
  email: string | null;
  companyType: string | null;
  counterpartyTypeName: string | null;
  legalTitle: string | null;
  legalAddress: string | null;
  inn: string | null;
  kpp: string | null;
  bik: string | null;
  bankName: string | null;
  bankLocation: string | null;
  checkingAccount: string | null;
  correspondentAccount: string | null;
  ogrn: string | null;
  ogrnip: string | null;
  raw: Prisma.JsonValue | null;
} | null): ClosingPartySnapshot {
  const raw = jsonRecord(row?.raw);
  const contact = nested(raw, "contactpersons");
  const firstContact = Array.isArray(raw.contactpersons) ? jsonRecord(raw.contactpersons[0]) : contact;
  const companyType = firstFilled(row?.companyType, row?.counterpartyTypeName, raw.companyType);
  return {
    name: firstFilled(row?.legalTitle, raw.legalTitle, raw.name, row?.name),
    shortName: firstFilled(row?.name, raw.name, row?.legalTitle),
    inn: firstFilled(row?.inn, raw.inn),
    kpp: firstFilled(row?.kpp, raw.kpp),
    ogrn: firstFilled(row?.ogrn, raw.ogrn),
    ogrnip: firstFilled(row?.ogrnip, raw.ogrnip),
    legalAddress: firstFilled(row?.legalAddress, raw.legalAddress, raw.actualAddress),
    actualAddress: firstFilled(raw.actualAddress, row?.legalAddress, raw.legalAddress),
    bankName: firstFilled(row?.bankName, raw.bankName),
    bankLocation: firstFilled(row?.bankLocation, raw.bankLocation),
    bik: firstFilled(row?.bik, raw.bik),
    checkingAccount: firstFilled(row?.checkingAccount, raw.checkingAccount),
    correspondentAccount: firstFilled(row?.correspondentAccount, raw.correspondentAccount),
    phone: firstFilled(row?.phone, raw.phone),
    email: firstFilled(row?.email, raw.email),
    signatoryPosition: firstFilled(firstContact.position, raw.signatoryPosition, "Представитель"),
    signatoryName: firstFilled(firstContact.name, raw.signatoryName, row?.name),
    signatoryBasis: firstFilled(raw.signatoryBasis, raw.powerOfAttorney),
    companyType,
  };
}

function lineAmounts(priceCents: number, quantity: number, discountPercent: number, vatEnabled: boolean, vatRate: number) {
  const gross = Math.round(priceCents * quantity);
  const discountCents = Math.round(gross * (discountPercent / 100));
  const totalCents = Math.max(0, gross - discountCents);
  const rate = vatEnabled ? Math.max(0, vatRate) : 0;
  const vatCents = rate > 0 ? Math.round(totalCents * rate / (100 + rate)) : 0;
  return {
    subtotalCents: gross,
    discountCents,
    totalCents,
    vatCents,
    amountWithoutVatCents: totalCents - vatCents,
  };
}

function classifyPosition(position: { assortmentType: string; product?: { entityType: string } | null }): "work" | "material" {
  const type = (position.product?.entityType || position.assortmentType || "").toLowerCase();
  return type.includes("service") ? "work" : "material";
}

function positionRawRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function buildVatSnapshot(positions: ClosingPositionSnapshot[]): ClosingVatSnapshot {
  const vatLines = positions.filter((p) => p.vatEnabled && p.vatRate > 0);
  if (vatLines.length === 0) return { mode: "without_vat", label: "Без НДС", rates: [] };
  const hasWithoutVat = positions.some((p) => !p.vatEnabled || p.vatRate <= 0);
  const grouped = new Map<number, { rate: number; amountCents: number; vatCents: number }>();
  for (const line of vatLines) {
    const current = grouped.get(line.vatRate) ?? { rate: line.vatRate, amountCents: 0, vatCents: 0 };
    current.amountCents += line.totalCents;
    current.vatCents += line.vatCents;
    grouped.set(line.vatRate, current);
  }
  const rates = [...grouped.values()].sort((a, b) => a.rate - b.rate);
  return {
    mode: hasWithoutVat || rates.length > 1 ? "mixed" : "vat",
    label: hasWithoutVat || rates.length > 1 ? "Смешанный НДС" : `НДС ${rates[0]?.rate ?? 0}%`,
    rates,
  };
}

const ONES_MALE = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_FEMALE = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

function pluralRu(value: number, one: string, few: string, many: string): string {
  const n = Math.abs(value) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return many;
  if (n1 > 1 && n1 < 5) return few;
  if (n1 === 1) return one;
  return many;
}

function triadToWords(value: number, female = false): string[] {
  const out: string[] = [];
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;
  if (hundreds) out.push(HUNDREDS[hundreds] ?? "");
  if (tens === 1) {
    out.push(TEENS[ones] ?? "");
  } else {
    if (tens) out.push(TENS[tens] ?? "");
    if (ones) out.push((female ? ONES_FEMALE : ONES_MALE)[ones] ?? "");
  }
  return out.filter(Boolean);
}

export function amountInWordsRu(cents: number): string {
  const rubles = Math.floor(Math.max(0, cents) / 100);
  const kopecks = Math.max(0, cents) % 100;
  const rubleParts: string[] = [];
  const millions = Math.floor(rubles / 1_000_000) % 1000;
  const thousands = Math.floor(rubles / 1000) % 1000;
  const rest = rubles % 1000;
  if (millions) rubleParts.push(...triadToWords(millions), pluralRu(millions, "миллион", "миллиона", "миллионов"));
  if (thousands) rubleParts.push(...triadToWords(thousands, true), pluralRu(thousands, "тысяча", "тысячи", "тысяч"));
  if (rest) rubleParts.push(...triadToWords(rest));
  if (rubleParts.length === 0) rubleParts.push("ноль");
  rubleParts.push(pluralRu(rubles, "рубль", "рубля", "рублей"));

  const kopeckParts = kopecks === 0 ? ["ноль"] : triadToWords(kopecks, true);
  kopeckParts.push(pluralRu(kopecks, "копейка", "копейки", "копеек"));
  return [...rubleParts, ...kopeckParts].join(" ");
}

function buildSourceHash(input: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function validate(document: ClosingDocumentSnapshot): ClosingValidation {
  const missing: string[] = [];
  const warnings: string[] = [];
  const buyerIsBusiness = Boolean(document.buyerSnapshot.inn || document.buyerSnapshot.kpp || /юр|ип|company|legal/i.test(document.buyerSnapshot.companyType ?? ""));
  if (!document.organizationId) missing.push("организация-исполнитель");
  if (!document.buyerSnapshot.name) missing.push("клиент");
  if (buyerIsBusiness) {
    if (!document.buyerSnapshot.inn) missing.push("ИНН клиента");
    if (!document.buyerSnapshot.kpp && !document.buyerSnapshot.ogrnip) missing.push("КПП");
    if (!document.buyerSnapshot.name) missing.push("полное наименование");
    if (!document.customerSignatorySnapshot.name) missing.push("представитель заказчика");
  }
  if (document.positionsSnapshot.length === 0) missing.push("позиции отгрузки");
  if (document.totalsSnapshot.totalCents <= 0) warnings.push("Итоговая сумма нулевая или не определена");
  if (!document.shipmentApplicable) warnings.push("Отгрузка ещё не проведена");
  if (!document.vehicleSnapshot.vin && !(document.vehicleSnapshot.makeModel && document.vehicleSnapshot.plate)) {
    warnings.push("Автомобиль указан без VIN, модели или госномера");
  }
  if (document.type === "upd_print") {
    if (!document.sellerSnapshot.name) missing.push("наименование продавца");
    if (!document.sellerSnapshot.inn) missing.push("ИНН продавца");
    if (!document.sellerSnapshot.legalAddress) missing.push("адрес продавца");
    if (!document.sellerSnapshot.kpp && !document.sellerSnapshot.ogrnip) missing.push("КПП или ОГРНИП продавца");
    if (!document.buyerSnapshot.name) missing.push("наименование покупателя");
    if (!document.buyerSnapshot.inn) missing.push("ИНН покупателя");
    if (!document.buyerSnapshot.legalAddress) missing.push("адрес покупателя");
    if (!document.buyerSnapshot.kpp && !document.buyerSnapshot.ogrnip) missing.push("КПП или ОГРНИП покупателя");
    if (!document.updSnapshot?.transferBasis) missing.push("основание передачи");
    if (!document.performerSignatorySnapshot.name) missing.push("подписант продавца");
    if (!document.customerSignatorySnapshot.name) missing.push("подписант покупателя");
  }
  return { canIssue: missing.length === 0, missing, warnings };
}

export async function buildClosingDocumentPayload(
  shipmentId: string,
  options: BuildOptions
): Promise<ClosingDocumentPayload | null> {
  const demand = await prisma.localDemand.findFirst({
    where: { OR: [{ id: shipmentId }, { id: shipmentId }] },
    include: {
      organization: true,
      counterparty: true,
      positions: { include: { product: true }, orderBy: { id: "asc" } },
    },
  });
  if (!demand) return null;

  const today = dateOnly(new Date());
  const documentDate = normalizeDateInput(options.documentDate, today);
  const completionDate = normalizeDateInput(options.completionDate, dateOnly(demand.momentAt));
  const organizationSeller = partyFromOrganization(demand.organization);
  const branchPrint = await resolveBranchPrintContext(demand.branchId);
  const seller: ClosingPartySnapshot = {
    ...organizationSeller,
    phone: branchPrint?.phone || "",
    email: branchPrint?.email || organizationSeller.email,
  };
  const buyer = partyFromCounterparty(demand.counterparty);
  const sellerSignatory = {
    position: firstFilled(options.sellerSignatory?.position, seller.signatoryPosition),
    name: firstFilled(options.sellerSignatory?.name, seller.signatoryName),
    basis: firstFilled(options.sellerSignatory?.basis, seller.signatoryBasis),
  };
  const customerSignatory = {
    position: firstFilled(options.customerSignatory?.position, buyer.signatoryPosition),
    name: firstFilled(options.customerSignatory?.name, buyer.signatoryName),
    basis: firstFilled(options.customerSignatory?.basis, buyer.signatoryBasis),
  };

  const positions: ClosingPositionSnapshot[] = demand.positions.map((position) => {
    const oneOffProduct = positionRawRecord(positionRawRecord(position.raw).oneOffProduct);
    const oneOffText = (key: string) => typeof oneOffProduct[key] === "string" ? String(oneOffProduct[key]).trim() : "";
    const quantity = position.quantity.toNumber();
    const discountPercent = position.discount.toNumber();
    const priceCents = position.priceCentsPerUnit;
    const vatRate = Number(position.vat) || 0;
    const amounts = lineAmounts(priceCents, quantity, discountPercent, position.vatEnabled, vatRate);
    return {
      id: position.id,
      kind: classifyPosition(position),
      name: position.name,
      article: position.product?.article ?? oneOffText("articleDisplay") ?? "",
      code: position.product?.code ?? position.product?.externalCode ?? "",
      uomName: position.product?.uomName ?? (oneOffText("uomLabel") || "шт"),
      quantity,
      priceCents,
      discountPercent,
      vatEnabled: position.vatEnabled,
      vatRate,
      ...amounts,
    };
  });

  const works = positions.filter((position) => position.kind === "work");
  const materials = positions.filter((position) => position.kind === "material");
  const totalCents = positions.reduce((sum, position) => sum + position.totalCents, 0);
  const totals: ClosingTotalsSnapshot = {
    worksCents: works.reduce((sum, position) => sum + position.totalCents, 0),
    materialsCents: materials.reduce((sum, position) => sum + position.totalCents, 0),
    discountCents: positions.reduce((sum, position) => sum + position.discountCents, 0),
    amountWithoutVatCents: positions.reduce((sum, position) => sum + position.amountWithoutVatCents, 0),
    vatCents: positions.reduce((sum, position) => sum + position.vatCents, 0),
    totalCents,
    totalInWords: amountInWordsRu(totalCents),
    worksCount: works.length,
    materialsCount: materials.length,
  };

  const makeModel = attrValue(demand.attributes, /модель|марка/i);
  const vehicle: ClosingVehicleSnapshot = {
    makeModel,
    plate: findVehiclePlate(demand.attributes),
    vin: findVehicleVin(demand.attributes),
    mileage: attrValue(demand.attributes, /пробег/i),
    transferredAt: attrValue(demand.attributes, /передач.*авто|дата.*передач/i),
    returnedAt: attrValue(demand.attributes, /возврат|выдач/i),
  };

  const transfer: ClosingTransferSnapshot = {
    vehicleTransferredBy: options.transfer?.vehicleTransferredBy ?? "",
    vehicleAcceptedBy: options.transfer?.vehicleAcceptedBy ?? "",
    completeness: options.transfer?.completeness ?? "",
    keysCount: options.transfer?.keysCount ?? "",
    additionalNotes: options.transfer?.additionalNotes ?? "",
    transferredAt: options.transfer?.transferredAt ?? "",
  };
  const vatSnapshot = buildVatSnapshot(positions);
  const functionCode = clean(options.upd?.functionCode) === "1" ? "1" : "2";
  const upd: ClosingUpdSnapshot = {
    functionCode,
    functionLabel: updFunctionLabel(functionCode),
    seller: firstFilled(options.upd?.seller, partyDisplay(seller)),
    buyer: firstFilled(options.upd?.buyer, partyDisplay(buyer)),
    shipper: firstFilled(options.upd?.shipper, partyAddressLine(seller), "Он же"),
    consignee: firstFilled(options.upd?.consignee, partyAddressLine(buyer)),
    transferBasis: firstFilled(options.upd?.transferBasis, `Отгрузка ${demand.name} от ${completionDate}`),
    paymentDocument: firstFilled(options.upd?.paymentDocument),
    currencyName: firstFilled(options.upd?.currencyName, "Российский рубль"),
    currencyCode: firstFilled(options.upd?.currencyCode, "643"),
    vatLabel: firstFilled(options.upd?.vatLabel, vatSnapshot.label),
    transferInfo: firstFilled(options.upd?.transferInfo),
    receiptInfo: firstFilled(options.upd?.receiptInfo, "Товары, работы и услуги получены без замечаний"),
    transferDate: normalizeDateInput(options.upd?.transferDate, completionDate),
    receiptDate: normalizeDateInput(options.upd?.receiptDate, completionDate),
  };

  const sourceHash = buildSourceHash({
    id: demand.id,
    updatedAt: demand.updatedAt.toISOString(),
    applicable: demand.applicable,
    sumCents: demand.sumCents,
    organizationId: demand.organizationId,
    counterpartyId: demand.counterpartyId,
    attributes: demand.attributes,
    positions: demand.positions.map((position) => ({
      id: position.id,
      name: position.name,
      quantity: position.quantity.toString(),
      priceCentsPerUnit: position.priceCentsPerUnit,
      discount: position.discount.toString(),
      vat: position.vat,
      vatEnabled: position.vatEnabled,
      productId: position.productId,
    })),
  });
  const documentYear = Number(documentDate.slice(0, 4)) || new Date().getFullYear();
  const sequenceOrganizationId = demand.organizationId ?? "global";
  const sequence = await prisma.closingDocumentNumberSequence.findUnique({
    where: {
      branchId_organizationId_type_year: {
        branchId: getScopedBranchId(),
        organizationId: sequenceOrganizationId,
        type: options.type,
        year: documentYear,
      },
    },
  });
  const previewNumber = `${typePrefix(options.type)}-${documentYear}-${String((sequence?.lastNumber ?? 0) + 1).padStart(4, "0")}`;

  const document: ClosingDocumentSnapshot = {
    shipmentId: demand.id,
    organizationId: demand.organizationId,
    type: options.type,
    number: previewNumber,
    revision: 1,
    status: "draft",
    documentDate,
    completionDate,
    shipmentNumber: demand.name,
    shipmentApplicable: demand.applicable,
    shipmentUpdatedAt: demand.updatedAt.toISOString(),
    sourceHash,
    sellerSnapshot: { ...seller, signatoryName: sellerSignatory.name, signatoryPosition: sellerSignatory.position, signatoryBasis: sellerSignatory.basis },
    buyerSnapshot: { ...buyer, signatoryName: customerSignatory.name, signatoryPosition: customerSignatory.position, signatoryBasis: customerSignatory.basis },
    vehicleSnapshot: vehicle,
    positionsSnapshot: positions,
    totalsSnapshot: totals,
    vatSnapshot,
    acceptanceText: clean(options.acceptanceText) || DEFAULT_ACCEPTANCE_TEXT,
    customerRemarks: clean(options.customerRemarks),
    transferSnapshot: transfer,
    updSnapshot: upd,
    performerSignatorySnapshot: sellerSignatory,
    customerSignatorySnapshot: customerSignatory,
  };

  const existingRows = await prisma.closingDocument.findMany({
    where: { shipmentId: demand.id },
    orderBy: [{ createdAt: "desc" }],
  });

  return {
    document,
    validation: validate(document),
    existing: existingRows.map((row) => ({
      id: row.id,
      type: row.type as ClosingDocumentType,
      number: row.number,
      revision: row.revision,
      status: row.status as ClosingDocumentStatus,
      documentDate: row.documentDate,
      createdByName: row.createdByName ?? row.createdById,
      createdAt: row.createdAt.toISOString(),
      isOutdated: row.sourceHash !== sourceHash,
    })),
  };
}

function typePrefix(type: ClosingDocumentType): string {
  return CLOSING_DOCUMENT_TYPES[type].prefix;
}

export async function issueClosingDocument(
  shipmentId: string,
  options: BuildOptions,
  user: User,
  opts: { allowIncomplete?: boolean; newRevision?: boolean } = {}
): Promise<{ ok: true; document: ClosingDocumentSnapshot } | { ok: false; error: string; validation?: ClosingValidation }> {
  const payload = await buildClosingDocumentPayload(shipmentId, options);
  if (!payload) return { ok: false, error: "Отгрузка не найдена" };
  if (!payload.validation.canIssue && !opts.allowIncomplete) {
    return { ok: false, error: "Для закрывающего документа не хватает обязательных данных", validation: payload.validation };
  }
  if (!opts.allowIncomplete && user.role === "master") {
    return { ok: false, error: "У мастера нет права выпускать закрывающие документы" };
  }

  const issued = await prisma.$transaction(async (tx) => {
    const documentYear = Number(payload.document.documentDate.slice(0, 4)) || new Date().getFullYear();
    const sequenceOrganizationId = payload.document.organizationId ?? "global";
    const sequence = await tx.closingDocumentNumberSequence.upsert({
      where: {
        branchId_organizationId_type_year: {
          branchId: getScopedBranchId(),
          organizationId: sequenceOrganizationId,
          type: payload.document.type,
          year: documentYear,
        },
      },
      update: { lastNumber: { increment: 1 } },
      create: {
        organizationId: sequenceOrganizationId,
        type: payload.document.type,
        year: documentYear,
        lastNumber: 1,
      },
    });
    const number = `${typePrefix(payload.document.type)}-${documentYear}-${String(sequence.lastNumber).padStart(4, "0")}`;
    const previousSameType = await tx.closingDocument.findMany({
      where: { shipmentId: payload.document.shipmentId, type: payload.document.type },
      select: { revision: true },
      orderBy: { revision: "desc" },
      take: 1,
    });
    const revision = opts.newRevision ? (previousSameType[0]?.revision ?? 0) + 1 : Math.max(1, previousSameType[0]?.revision ?? 0);
    const transferSnapshot = payload.document.updSnapshot
      ? { ...payload.document.transferSnapshot, updSnapshot: payload.document.updSnapshot }
      : payload.document.transferSnapshot;
    return tx.closingDocument.create({
      data: {
        organizationId: payload.document.organizationId,
        shipmentId: payload.document.shipmentId,
        type: payload.document.type,
        number,
        revision,
        status: "issued",
        documentDate: payload.document.documentDate,
        completionDate: payload.document.completionDate,
        sellerSnapshot: payload.document.sellerSnapshot,
        buyerSnapshot: payload.document.buyerSnapshot,
        vehicleSnapshot: payload.document.vehicleSnapshot,
        positionsSnapshot: payload.document.positionsSnapshot,
        totalsSnapshot: payload.document.totalsSnapshot,
        vatSnapshot: payload.document.vatSnapshot,
        acceptanceText: payload.document.acceptanceText,
        customerRemarks: payload.document.customerRemarks || null,
        transferSnapshot,
        performerSignatorySnapshot: payload.document.performerSignatorySnapshot,
        customerSignatorySnapshot: payload.document.customerSignatorySnapshot,
        sourceHash: payload.document.sourceHash,
        createdById: user.login,
        createdByName: user.name,
      },
    });
  });

  return { ok: true, document: closingRowToSnapshot(issued, payload.document.shipmentApplicable, payload.document.shipmentNumber, payload.document.shipmentUpdatedAt) };
}

export async function loadClosingDocument(id: string): Promise<ClosingDocumentSnapshot | null> {
  const row = await prisma.closingDocument.findUnique({
    where: { id },
    include: { shipment: { select: { name: true, applicable: true, updatedAt: true } } },
  });
  if (!row) return null;
  const snapshot = closingRowToSnapshot(row, row.shipment.applicable, row.shipment.name, row.shipment.updatedAt.toISOString());
  const branchPrint = await resolveBranchPrintContext(row.branchId);
  snapshot.sellerSnapshot = {
    ...snapshot.sellerSnapshot,
    phone: branchPrint?.phone || "",
    email: branchPrint?.email || snapshot.sellerSnapshot.email,
  };
  return snapshot;
}

export async function cancelClosingDocument(id: string, user: User, reason?: string): Promise<boolean> {
  if (user.role === "master") return false;
  await prisma.closingDocument.update({
    where: { id },
    data: {
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledById: user.login,
      cancelledByName: user.name,
      cancelReason: clean(reason) || null,
    },
  });
  return true;
}

function closingRowToSnapshot(
  row: {
    id: string;
    shipmentId: string;
    organizationId: string | null;
    type: string;
    number: string;
    revision: number;
    status: string;
    documentDate: string;
    completionDate: string;
    sellerSnapshot: Prisma.JsonValue;
    buyerSnapshot: Prisma.JsonValue;
    vehicleSnapshot: Prisma.JsonValue;
    positionsSnapshot: Prisma.JsonValue;
    totalsSnapshot: Prisma.JsonValue;
    vatSnapshot: Prisma.JsonValue;
    acceptanceText: string;
    customerRemarks: string | null;
    transferSnapshot: Prisma.JsonValue | null;
    performerSignatorySnapshot: Prisma.JsonValue | null;
    customerSignatorySnapshot: Prisma.JsonValue | null;
    sourceHash: string;
    createdByName: string | null;
    createdAt: Date;
    issuedAt: Date | null;
    cancelledAt: Date | null;
  },
  shipmentApplicable: boolean,
  shipmentNumber: string,
  shipmentUpdatedAt?: string
): ClosingDocumentSnapshot {
  const currentSourceHash = row.sourceHash;
  const transferRecord = jsonRecord(row.transferSnapshot);
  const updSnapshot = jsonRecord(transferRecord.updSnapshot);
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    organizationId: row.organizationId,
    type: row.type as ClosingDocumentType,
    number: row.number,
    revision: row.revision,
    status: row.status as ClosingDocumentStatus,
    documentDate: row.documentDate,
    completionDate: row.completionDate,
    shipmentNumber,
    shipmentApplicable,
    shipmentUpdatedAt,
    sourceHash: row.sourceHash,
    isOutdated: currentSourceHash !== row.sourceHash,
    sellerSnapshot: normalizeSellerSnapshot(row.sellerSnapshot as ClosingPartySnapshot),
    buyerSnapshot: row.buyerSnapshot as ClosingPartySnapshot,
    vehicleSnapshot: row.vehicleSnapshot as ClosingVehicleSnapshot,
    positionsSnapshot: row.positionsSnapshot as ClosingPositionSnapshot[],
    totalsSnapshot: row.totalsSnapshot as ClosingTotalsSnapshot,
    vatSnapshot: row.vatSnapshot as ClosingVatSnapshot,
    acceptanceText: row.acceptanceText,
    customerRemarks: row.customerRemarks ?? "",
    transferSnapshot: {
      vehicleTransferredBy: clean(transferRecord.vehicleTransferredBy),
      vehicleAcceptedBy: clean(transferRecord.vehicleAcceptedBy),
      completeness: clean(transferRecord.completeness),
      keysCount: clean(transferRecord.keysCount),
      additionalNotes: clean(transferRecord.additionalNotes),
      transferredAt: clean(transferRecord.transferredAt),
    },
    updSnapshot: Object.keys(updSnapshot).length > 0 ? {
      functionCode: clean(updSnapshot.functionCode) === "1" ? "1" : "2",
      functionLabel: firstFilled(updSnapshot.functionLabel, updFunctionLabel(updSnapshot.functionCode)),
      seller: clean(updSnapshot.seller),
      buyer: clean(updSnapshot.buyer),
      shipper: clean(updSnapshot.shipper),
      consignee: clean(updSnapshot.consignee),
      transferBasis: clean(updSnapshot.transferBasis),
      paymentDocument: clean(updSnapshot.paymentDocument),
      currencyName: clean(updSnapshot.currencyName),
      currencyCode: clean(updSnapshot.currencyCode),
      vatLabel: clean(updSnapshot.vatLabel),
      transferInfo: clean(updSnapshot.transferInfo),
      receiptInfo: clean(updSnapshot.receiptInfo),
      transferDate: clean(updSnapshot.transferDate),
      receiptDate: clean(updSnapshot.receiptDate),
    } : undefined,
    performerSignatorySnapshot: (row.performerSignatorySnapshot as { position: string; name: string; basis: string } | null) ?? {
      position: "",
      name: "",
      basis: "",
    },
    customerSignatorySnapshot: (row.customerSignatorySnapshot as { position: string; name: string; basis: string } | null) ?? {
      position: "",
      name: "",
      basis: "",
    },
    createdByName: row.createdByName ?? "",
    createdAt: row.createdAt.toISOString(),
    issuedAt: row.issuedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
  };
}
