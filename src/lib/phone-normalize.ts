/**
 * Нормализация телефона для склейки клиентов в локальной аналитике.
 * Правила: убрать пробелы, скобки, тире, +; 8XXXXXXXXXX → 7XXXXXXXXXX.
 */

export function stripPhoneToDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Возвращает нормализованный ключ или null, если номер не пригоден как идентификатор.
 */
export function normalizePhoneKey(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const digits = stripPhoneToDigits(String(raw).trim());
  if (!digits) return null;
  if (/^8\d{10}$/.test(digits)) return `7${digits.slice(1)}`;
  if (/^7\d{10}$/.test(digits)) return digits;
  if (/^\d{10,15}$/.test(digits)) return digits;
  return null;
}

/**
 * Единый ключ для сравнения телефонов в операционных сценариях.
 * Для РФ сравниваем последние 10 цифр, чтобы +7 и 8 не расходились.
 * Международные номера оставляем в полном нормализованном виде.
 */
export function normalizePhone(raw: string | undefined | null): string | null {
  const key = normalizePhoneKey(raw);
  if (!key) return null;
  if (/^[78]\d{10}$/.test(key)) return key.slice(-10);
  return key;
}

export function phoneKeysEqual(left: string | undefined | null, right: string | undefined | null): boolean {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  return Boolean(a && b && a === b);
}

/** Фрагмент контрагента из локальной отгрузки. */
export type CounterpartyPhoneSource = {
  phone?: string;
  phones?: Array<{ phone?: string } | string>;
  /** MetaArray: при expand=agent.contactpersons приходит { rows: [...] } */
  contactpersons?:
    | { rows?: Array<{ phone?: string }> }
    | Array<{ phone?: string }>
    | Record<string, unknown>
    | null;
} | null | undefined;

function* iterateRawPhoneStringsFromCounterparty(agent: CounterpartyPhoneSource): Generator<string> {
  if (!agent || typeof agent !== "object") return;
  const a = agent as Record<string, unknown>;

  const main = typeof a.phone === "string" ? a.phone.trim() : "";
  if (main) yield main;

  const phonesArr = a.phones;
  if (Array.isArray(phonesArr)) {
    for (const phone of phonesArr) {
      if (typeof phone === "string" && phone.trim()) yield phone.trim();
      if (phone && typeof phone === "object" && typeof (phone as { phone?: string }).phone === "string") {
        const p = String((phone as { phone: string }).phone).trim();
        if (p) yield p;
      }
    }
  }

  const cp = a.contactpersons;
  if (cp && typeof cp === "object") {
    const rows = Array.isArray(cp)
      ? (cp as Array<{ phone?: string }>)
      : Array.isArray((cp as { rows?: unknown }).rows)
        ? ((cp as { rows: Array<{ phone?: string }> }).rows ?? [])
        : [];
    for (const row of rows) {
      if (row && typeof row.phone === "string" && row.phone.trim()) {
        yield row.phone.trim();
      }
    }
  }
}

/**
 * Первый непустой сырой телефон (поле **phone**, массив **phones**, затем **contactpersons**).
 * Для АКСИ/оплаты: контакт для чека.
 */
export function extractRawPhoneFromAgent(agent: CounterpartyPhoneSource): string | undefined {
  for (const s of iterateRawPhoneStringsFromCounterparty(agent)) {
    return s;
  }
  return undefined;
}

/**
 * Нормализованный ключ клиента: перебирает все известные источники,
 * возвращает первый номер, который удаётся нормализовать.
 */
export function pickNormalizedPhoneFromCounterparty(agent: CounterpartyPhoneSource): string | null {
  for (const raw of iterateRawPhoneStringsFromCounterparty(agent)) {
    const key = normalizePhoneKey(raw);
    if (key) return key;
  }
  return null;
}

/** Все непустые сырые номера по порядку приоритета (для отладки / phonesRaw в синке). */
export function listRawPhonesFromCounterparty(agent: CounterpartyPhoneSource): string[] {
  return [...iterateRawPhoneStringsFromCounterparty(agent)];
}

export function normalizedPhoneFromAgent(agent: CounterpartyPhoneSource): string | null {
  return pickNormalizedPhoneFromCounterparty(agent);
}
