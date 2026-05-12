/**
 * Безопасный разбор тел ответа fetch.
 * WebKit при невалидном JSON в `res.json()` бросает SyntaxError:
 * «The string did not match the expected pattern».
 */

export async function responseJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Пустой ответ сервера (${res.status}).`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const hint = text.trimStart().startsWith("<") ? "получен HTML вместо JSON" : "невалидный JSON";
    throw new Error(
      `Ответ API не разобран (${res.status}, ${hint}). Частая причина — страница ошибки Next.js или прокси.`
    );
  }
}

/** Если статус не ok или тело не JSON — null (для виджетов без жёсткой ошибки). */
export async function tryResponseJson<T = unknown>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
