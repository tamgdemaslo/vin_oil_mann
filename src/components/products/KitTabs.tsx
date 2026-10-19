import Link from "next/link";
import styles from "./ProductKits.module.css";

export default function KitTabs({ section, kits = false }: { section: "catalog" | "restock"; kits?: boolean }) {
  const base = section === "catalog" ? "/inventory/products" : "/inventory/restock";
  return <nav className={styles.tabs} aria-label={section === "catalog" ? "Каталог" : "Пополнение"}>
    <Link href={base} aria-current={!kits ? "page" : undefined}>{section === "catalog" ? "Товары" : "Товары к пополнению"}</Link>
    <Link href={`${base}?tab=kits`} aria-current={kits ? "page" : undefined}>Комплекты</Link>
  </nav>;
}
