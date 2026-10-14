/** XML 1.0 permits tabs/newlines and Unicode scalar values, but not controls or lone surrogates. */
export function hasInvalidXmlCharacters(value: string) {
  return /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u.test(value);
}
