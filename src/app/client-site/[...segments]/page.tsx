import ClientSiteApp from "../ClientSiteApp";

export default async function ClientSiteRoute({
  params,
}: {
  params: Promise<{ segments: string[] }>;
}) {
  const { segments } = await params;
  return <ClientSiteApp initialPath={`/${segments.join("/")}`} />;
}
