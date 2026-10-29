"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
export default function EmployeesNav({ canManage }: { canManage: boolean }) {
  const pathname = usePathname();
  return <nav className="eco-employees-nav" aria-label="Сотрудники">
    <strong>Сотрудники</strong>
    <Link href="/employees/salary" aria-current={pathname === "/employees/salary" ? "page" : undefined}>Зарплата</Link>
    {canManage && <Link href="/employees/roles" aria-current={pathname === "/employees/roles" ? "page" : undefined}>Роли</Link>}
  </nav>;
}
