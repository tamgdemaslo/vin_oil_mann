/**
 * Read JSON from a fetch Response without relying on Response#json().
 * Safari/WebKit often reports JSON parse failures as SyntaxError:
 * "The string did not match the expected pattern."
 */
export async function safeReadJson<T = unknown>(response: Response): Promise<T | undefined> {
  try {
    const text = await response.text();
    if (!text.trim()) return undefined;
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}
