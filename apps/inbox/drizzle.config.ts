import { defineConfig } from 'drizzle-kit'

// Defaults to the docker-compose creds so the standard dev setup needs no env file.
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://aiworkflow:aiworkflow@localhost:5432/aiworkflow'

export default defineConfig({
  dialect: 'postgresql',
  schema: '../../packages/server/src/db/schema.ts',
  out: '../../packages/server/src/db/migrations',
  dbCredentials: { url: DATABASE_URL },
})
