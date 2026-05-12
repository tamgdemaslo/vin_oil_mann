import { Inter } from "next/font/google";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { buildJobOrderPosterModel } from "@/lib/job-order-poster-data";
import OrderPoster from "@/components/print/OrderPoster";
import { PosterAutoPrint } from "@/components/print/PosterAutoPrint";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const posterShellCss = `
.poster-print-root {
  min-height: 100vh;
  background: #d9d6cf;
  padding: 24px 0;
}
.poster-sheet {
  width: 794px;
  min-height: 1123px;
  margin: 24px auto;
  background: #f5f2ed;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.1);
}
@media print {
  /* Иначе Chrome/PDF рисуют «рамку» полей страницы и серые полосы по краям */
  @page {
    size: A4;
    margin: 0;
  }
  html,
  body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
  }
  .poster-print-root {
    background: white;
    padding: 0;
    min-height: auto;
  }
  .poster-sheet {
    width: 210mm;
    min-height: 297mm;
    margin: 0;
    box-shadow: none !important;
  }
  body > *:not(#poster-print-mount) {
    display: none !important;
  }
  body > #poster-print-mount {
    display: block !important;
  }
  #poster-print-mount,
  #poster-print-mount * {
    outline: none !important;
    box-shadow: none !important;
  }
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`;

export default async function ShipmentPosterPrintPage({
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
    redirect(`/login?from=${encodeURIComponent(`/shipment/${id}/poster`)}`);
  }

  const data = await buildJobOrderPosterModel(id);
  if (!data) {
    return (
      <div id="poster-print-mount" className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Не удалось открыть макет печати
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
    <div id="poster-print-mount" className={`poster-print-root ${inter.className}`}>
      <style dangerouslySetInnerHTML={{ __html: posterShellCss }} />
      <PosterAutoPrint enabled={autoprint} />
      <div className="poster-sheet">
        <OrderPoster data={data} />
      </div>
    </div>
  );
}
