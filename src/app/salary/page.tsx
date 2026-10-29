import { redirect } from "next/navigation";
export default async function SalaryPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams ?? {})) {
    for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) params.append(key, item);
  }
  redirect(`/employees/salary${params.size ? `?${params}` : ""}`);
}
