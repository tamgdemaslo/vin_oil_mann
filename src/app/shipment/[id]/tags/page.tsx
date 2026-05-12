import { Inter } from "next/font/google";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { buildJobOrderPosterModel } from "@/lib/job-order-poster-data";
import UnderHoodTags from "@/components/print/UnderHoodTags";
import { PosterAutoPrint } from "@/components/print/PosterAutoPrint";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const tagsShellCss = `
.tags-print-root {
  min-height: 100vh;
  background: #d9d6cf;
  padding: 24px 0;
}
.tags-sheet {
  margin: 0 auto;
  max-width: 220px;
  padding-bottom: 24px;
}
@media print {
  @page {
    margin: 0;
    size: auto;
  }
  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }
  .tags-print-root {
    background: white;
    padding: 0;
    min-height: auto;
  }
  .tags-sheet {
    max-width: none;
    padding: 0;
    margin: 0;
  }
  body > *:not(#tags-print-mount) {
    display: none !important;
  }
  body > #tags-print-mount {
    display: block !important;
  }
  #tags-print-mount,
  #tags-print-mount * {
    outline: none !important;
    box-shadow: none !important;
  }
  #tags-print-mount .under-hood-tag-card {
    border: none !important;
  }
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`;

export default async function ShipmentUnderHoodTagsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ autoprint?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const autoprint = sp.autoprint !== "0";

  const session = await getSession();
  if (!session) {
    redirect(`/login?from=${encodeURIComponent(`/shipment/${id}/tags`)}`);
  }

  const data = await buildJobOrderPosterModel(id);
  if (!data) {
    return (
      <div id="tags-print-mount" className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Не удалось открыть бирку
        </h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Отгрузка не загрузилась из МойСклад или нет доступа. Проверьте id документа и авторизацию.
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
    <div id="tags-print-mount" className={`tags-print-root ${inter.className}`}>
      <style dangerouslySetInnerHTML={{ __html: tagsShellCss }} />
      <PosterAutoPrint enabled={autoprint} />
      <div className="tags-sheet">
        <UnderHoodTags data={data} />
      </div>
    </div>
  );
}
