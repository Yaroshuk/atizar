// The integration AUTHENTICATION contract (spec 2026-06-11 §1). TYPES ONLY — no base class, no
// runtime registration, no fs/env/engine import (pure, like ./integration.ts). The `kind` is an
// OPEN string, NOT a sealed union: built-in kinds ('apiKey'/'oauth2') get framework resolvers; a
// custom integration ships its OWN resolver for any other kind, WITHOUT editing core (invariant
// I5). An integration DECLARES its AuthSpec and RECEIVES a ResolvedCredential — it never reads a
// secret itself.

export type AuthSpec =
  | { kind: 'none' }
  | { kind: 'apiKey' }
  | { kind: 'oauth2'; provider: string; scopes: string[] }
  // Escape hatch: any custom kind. Extra fields carry whatever the custom resolver needs.
  | { kind: string; [key: string]: unknown }

// The live credential handed to an integration function (via `deps.credential`). Discriminated by
// kind so a function reads exactly what its kind produced; open for custom kinds.
export type ResolvedCredential =
  | { kind: 'apiKey'; apiKey: string }
  | {
      kind: 'oauth2'
      accessToken: string
      refreshToken?: string
      expiresAt?: number
      raw?: unknown
    }
  | { kind: string; [key: string]: unknown }

// Resolve a live credential for a (integration, connection) pair. `connectionId` is a
// developer-chosen connection LABEL ('default' | 'home' | 'work' | …) — NOT a user account; it
// lets two workflows reuse one integration under two credentials (e.g. home vs work mailbox).
// Built-in resolvers (apiKey/oauth2) ship in @platform/server; a custom-kind integration registers
// its own — core only defines this interface.
export type CredentialResolver = (ctx: {
  integration: string
  connectionId: string
  auth: AuthSpec
}) => Promise<ResolvedCredential | null> // null = not connected / no usable credential

// Narrow an AuthSpec to the built-in oauth2 shape.
export function isOAuth2(
  auth: AuthSpec
): auth is { kind: 'oauth2'; provider: string; scopes: string[] } {
  return auth.kind === 'oauth2'
}
