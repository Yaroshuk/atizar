// Maps a failed dynamic import of an OPTIONAL peer dependency into an actionable
// error. Returns the friendly Error when the module was simply not installed,
// or null for any other failure (so the caller rethrows the original).
export function optionalPeerError(err, { name, install }) {
  if (err?.code === 'ERR_MODULE_NOT_FOUND') {
    return new Error(`Missing optional peer '${name}'. Install it:  ${install}`)
  }
  return null
}
