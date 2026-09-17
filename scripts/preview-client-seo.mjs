import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": resolve("src") } });
const { buildClientProductContent } = await jiti.import("../src/lib/client-product-content.ts");
const files = process.argv.slice(2);
if (!files.length) throw new Error("Pass saved public /api/public/oils JSON pages.");
const cards = (await Promise.all(files.map(async file => JSON.parse(await readFile(file, "utf8")).oils))).flat();
const unique = [...new Map(cards.map(card => [card.id, card])).values()];
process.stdout.write(JSON.stringify({
  total: unique.length,
  emptyDescriptionsBefore: unique.filter(card => !card.description?.trim()).length,
  items: unique.map(card => ({ id: card.id, article: card.article, existingDescription: card.description || "", ...buildClientProductContent(card) })),
}, null, 2));
