// OAuth provider endpoints (spec §3/§4). Beta ships google; add a provider = one entry here.
// Shared by resolveCredential's refresh (sub-stage 2) and the connect flow (sub-stage 3).
export interface OAuthProvider {
  authUrl: string
  tokenUrl: string
}

const PROVIDERS: Record<string, OAuthProvider> = {
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
  },
}

export function oauthProvider(provider: string): OAuthProvider | undefined {
  return PROVIDERS[provider]
}
