"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/inventory/products", label: "Товары" },
  { href: "/inventory/receipts", label: "Приёмка" },
  { href: "/inventory/writeoffs", label: "Списание" },
  { href: "/inventory/restock", label: "Пополнение" },
];

export default function InventoryNav() {
  const pathname = usePathname();
  return (
    <div className="eco-actions mb-4 border-b border-[var(--eco-line)] pb-3">
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`eco-btn eco-btn--sm ${active ? "eco-btn--primary" : ""}`}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
