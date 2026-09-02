import fs from "node:fs";
import path from "node:path";

function unquote(value) {
  return value.trim().replace(/^(["'])(.*)\1$/u, "$2");
}

export function loadLocalProductAttributeDatabaseUrl(root) {
  const explicit = process.env.PRODUCT_ATTRIBUTE_AUDIT_DATABASE_URL?.trim();
  if (explicit) return unquote(explicit);
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(root, fileName);
    if (!fs.existsSync(filePath)) continue;
    const value = fs.readFileSync(filePath, "utf8").match(/^DATABASE_URL=(.+)$/mu)?.[1];
    if (value?.trim()) return unquote(value);
  }
  throw new Error("DATABASE_URL не найден. Укажите PRODUCT_ATTRIBUTE_AUDIT_DATABASE_URL для локально восстановленной копии БД.");
}

export function assertLocalProductAttributeDatabase(databaseUrl) {
  const parsed = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname.toLowerCase())) {
    throw new Error("Команда разрешена только для локально восстановленной копии БД; прямой доступ к production запрещён.");
  }
  return { host: parsed.hostname, database: parsed.pathname.replace(/^\//u, "") };
}
