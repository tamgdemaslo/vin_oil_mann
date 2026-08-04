import { Inter } from "next/font/google";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { runWithBranchApiContext } from "@/lib/branch-api";
import { requireBranchContext } from "@/lib/branch-context";
import { buildJobOrderPosterModel, posterModelOptsFromVariant } from "@/lib/job-order-poster-data";
import UnderHoodTags from "@/components/print/UnderHoodTags";
import { PosterAutoPrint } from "@/components/print/PosterAutoPrint";

import "./tags-print.css";

export const dynamic = "force-dynamic";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const tagPageCss = `
@media print {
  @page {
    size: 50mm 80mm;
    margin: 0;
  }
}
`;

export default async function ShipmentUnderHoodTagsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string; variant?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const autoprint = sp.autoprint !== "0";
  const intervalOpts = posterModelOptsFromVariant(sp.variant);

  const session = await getSession();
  if (!session) {
    const fromQs = new URLSearchParams();
    if (sp.autoprint === "0") fromQs.set("autoprint", "0");
    if (sp.variant?.trim()) fromQs.set("variant", sp.variant.trim());
    const suffix = fromQs.toString() ? `?${fromQs.toString()}` : "";
    redirect(`/login?from=${encodeURIComponent(`/shipment/${id}/tags${suffix}`)}`);
  }

  const branch = await requireBranchContext({ allowAll: false, requireActive: true });
  const data = await runWithBranchApiContext(branch, () => buildJobOrderPosterModel(id, intervalOpts));
  if (!data) {
    return (
      <div id="tags-print-mount" className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Не удалось открыть бирку
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Отгрузка не загрузилась из локальной БД или нет доступа. Проверьте id документа и авторизацию.
        </p>
        <Link
          href={`/shipment/${encodeURIComponent(id)}`}
          className="mt-6 inline-block rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600"
        >
          Вернуться к отгрузке
        </Link>
      </div>
    );
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: tagPageCss }} />
      <div id="tags-print-mount" className={`tags-print-root ${inter.className}`}>
        <PosterAutoPrint enabled={autoprint} />
        <div className="tags-sheet">
          <UnderHoodTags data={data} />
        </div>
      </div>
    </>
  );
}
