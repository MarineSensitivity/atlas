// A twin of R's `URLencode(x, reserved = TRUE)` (base `utils`), used everywhere tiles.ts/point.ts
// build a titiler `?url=` parameter (atlas-refs/"parity species app.md" §2.4's worked example:
// `?mdl_key=<URLencode(mdl_key, reserved=TRUE)>` -> `ms_merge|WORMS:137209` becomes
// `ms_merge%7CWORMS%3A137209`). It differs from a bare `encodeURIComponent` in exactly one place:
// RFC 3986 (what `reserved = TRUE` follows) treats `! * ' ( )` as RESERVED sub-delimiters, so
// `URLencode(reserved = TRUE)` escapes them, but `encodeURIComponent` (written against the older
// RFC 2396, where those five were unreserved) leaves them bare. None of today's COG object keys
// contain those characters, but the byte-for-byte titiler URL contract (plan atlas-2 `raster/`)
// should not depend on that staying true.
const JS_UNRESERVED_BUT_RFC3986_RESERVED = /[!*'()]/g;

/** percent-encode every character outside RFC 3986's `unreserved` set (`A-Za-z0-9-_.~`), matching
 * R's `URLencode(x, reserved = TRUE)` byte-for-byte, including its uppercase hex digits. */
export function encodeUrlReserved(value: string): string {
  return encodeURIComponent(value).replace(
    JS_UNRESERVED_BUT_RFC3986_RESERVED,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}
