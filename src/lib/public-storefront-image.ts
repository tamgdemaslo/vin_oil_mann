import { prisma } from "@/lib/db";
import { isSafeStorefrontImageContentType, storefrontPublicImageHref } from "@/lib/storefront-image";

export async function getSelectedPublicStorefrontImage(storefrontProductId: string, photoId: string) {
  const expectedHref = storefrontPublicImageHref(storefrontProductId, photoId);
  const photo = await prisma.localProductPhoto.findFirst({
    where: {
      id: photoId,
      purpose: "STOREFRONT",
      product: {
        storefrontBindings: {
          some: {
            storefrontProductId,
            status: "CONFIRMED",
            storefrontProduct: {
              publicationState: "PUBLISHED",
              publicImageHref: expectedHref,
            },
          },
        },
      },
    },
    select: { data: true, contentType: true, fileName: true },
  });
  return photo && isSafeStorefrontImageContentType(photo.contentType) ? photo : null;
}
