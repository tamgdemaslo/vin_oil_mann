import { prisma } from "@/lib/db";

export class PublicStorefrontUnavailableError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "ambiguous" | "incomplete"
  ) {
    super(message);
    this.name = "PublicStorefrontUnavailableError";
  }
}

/**
 * Resolves public tenant scope only from server configuration and database
 * allowlists. Browser branch ids are intentionally not accepted.
 */
export async function resolvePublicStorefront() {
  const configuredSlug = process.env.PUBLIC_STOREFRONT_SLUG?.trim();
  const storefronts = await prisma.storefront.findMany({
    where: {
      status: "ACTIVE",
      ...(configuredSlug ? { slug: configuredSlug } : {}),
    },
    include: {
      businessGroup: { select: { id: true, status: true } },
      branches: {
        where: { status: "ACTIVE", branch: { status: "active" } },
        include: {
          branch: true,
          stores: { where: { store: { archived: false } }, include: { store: true } },
        },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      },
    },
    take: 2,
  });
  if (storefronts.length === 0) {
    throw new PublicStorefrontUnavailableError("Публичная витрина ещё не настроена.", "not_configured");
  }
  if (storefronts.length > 1) {
    throw new PublicStorefrontUnavailableError(
      "Публичный контекст витрины неоднозначен. Настройте PUBLIC_STOREFRONT_SLUG.",
      "ambiguous"
    );
  }
  const storefront = storefronts[0];
  if (
    storefront.businessGroup.status !== "active" ||
    !storefront.branches.length ||
    storefront.branches.some((branch) => branch.stores.length === 0)
  ) {
    throw new PublicStorefrontUnavailableError("Публичные филиалы и склады витрины настроены не полностью.", "incomplete");
  }
  return storefront;
}

export type PublicStorefrontContext = Awaited<ReturnType<typeof resolvePublicStorefront>>;
