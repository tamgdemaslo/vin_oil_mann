const PUBLIC_STOREFRONT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function isSafeStorefrontImageContentType(value: string) {
  return PUBLIC_STOREFRONT_IMAGE_TYPES.has(value.trim().toLowerCase());
}

export function storefrontPublicImageHref(storefrontProductId: string, photoId: string) {
  return `/api/public/oils/${encodeURIComponent(storefrontProductId)}/image/${encodeURIComponent(photoId)}`;
}

export function selectedStorefrontPublicPhotoId(storefrontProductId: string, href: string | null | undefined) {
  if (!href) return null;
  const prefix = `/api/public/oils/${encodeURIComponent(storefrontProductId)}/image/`;
  if (!href.startsWith(prefix)) return null;
  const value = href.slice(prefix.length);
  if (!value || value.includes("/") || value.includes("?") || value.includes("#")) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
