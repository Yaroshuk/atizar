// The DECLARED auth contract for the gmail integration (auth sub-stage 5). The integration
// never reads a secret itself — it declares this AuthSpec and receives a ResolvedCredential via
// deps.credential. The per-user token comes from the in-app Connect flow; the oauth2 app
// registration is ATIZAR_GOOGLE_CLIENT_ID / ATIZAR_GOOGLE_CLIENT_SECRET (resolved by the
// framework, never here).
export const auth = {
  kind: 'oauth2',
  provider: 'google',
  scopes: ['https://www.googleapis.com/auth/gmail.modify'],
}
