import { prisma } from "@/lib/db";
import { isSafeStorefrontImageContentType, storefrontPublicImageHref } from "@/lib/storefront-image";

export async function getSelectedPublicStorefrontImage(storefrontProductId: string, photoId: string) {
  const expectedHref = storefrontPublicImageHref(storefrontProductId, photoId);
  const product = await prisma.storefrontProduct.findFirst({
    where: {
      id: storefrontProductId,
      publicationState: "PUBLISHED",
      publicImageHref: expectedHref,
    },
    select: { id: true },
  });
  if (!product) return null;

  const photo = await prisma.localProductPhoto.findFirst({
    where: {
      id: photoId,
      product: {
        storefrontBindings: {
          some: { storefrontProductId: product.id, status: "CONFIRMED" },
        },
      },
    },
    select: { data: true, contentType: true, fileName: true },
  });
  return photo && isSafeStorefrontImageContentType(photo.contentType) ? photo : null;
}
