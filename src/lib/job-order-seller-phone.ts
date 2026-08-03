const LEGACY_SELLER_PHONE_RE = /(?:\+?7|8)?\s*\(?999\)?\s*[-\s]?\s*255\s*[-\s]?\s*60\s*[-\s]?\s*31/g;
const SELLER_PHONE_RE = /(?:\+?7|8)\s*\(?995\)?\s*[-\s]?\s*054\s*[-\s]?\s*58\s*[-\s]?\s*59/g;

export const CURRENT_SELLER_PHONE = "8 (995) 054-58-59";

export function normalizeSellerPhonesForPrint(phones: string): string {
  return phones.replace(LEGACY_SELLER_PHONE_RE, CURRENT_SELLER_PHONE).replace(SELLER_PHONE_RE, CURRENT_SELLER_PHONE);
}
