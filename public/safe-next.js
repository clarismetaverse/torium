// Single source of truth for the post-login return path.
//
// A value is accepted only when it is unambiguously an internal path. The
// backslash rule matters: browsers normalise "\" to "/" inside a URL, so
// "/\evil.example" becomes the protocol-relative "//evil.example" and leaves
// the site. Anything that is not a plain "/path" falls back to the default
// landing page instead.
(function attachSafeNext(global) {
  var DEFAULT_NEXT = '/home';

  function toriumSafeNextPath(value, fallback) {
    var target = fallback || DEFAULT_NEXT;
    if (typeof value !== 'string' || value === '') return target;
    if (value.length > 512) return target;
    // Control characters are stripped by URL parsers and can be used to
    // smuggle a scheme past a naive prefix check.
    if (/[\x00-\x1f\x7f]/.test(value)) return target;
    if (value.indexOf('\\') !== -1) return target;
    if (value.charAt(0) !== '/') return target;
    if (value.charAt(1) === '/') return target;
    // "/@host" and "/:" are not TORIUM routes; keeping them out holds the
    // allowlist to shapes the router actually serves.
    if (value.charAt(1) === '@' || value.charAt(1) === ':') return target;
    return value;
  }

  global.toriumSafeNextPath = toriumSafeNextPath;
})(typeof globalThis !== 'undefined' ? globalThis : this);
