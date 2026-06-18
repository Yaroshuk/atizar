import {
  defineProviders,
  type Provider,
  type ProviderFactory,
  type ProviderRegistry,
} from '@atizar/core'
import { PROVIDERS } from '@atizar/providers/ids'

// Demo provider registry — DELIBERATELY Mastra/Gmail-free. The demo replays committed cassettes:
// withRecordReplay intercepts every run/resume (a cassette miss throws DemoCassetteMissing), so the
// underlying provider is NEVER invoked. Registering inert providers lets registry.resolve() succeed
// for whatever id an agent declares while keeping the heavy real providers (Mastra + the AI SDK)
// OUT of the demo boot — the demo runs on a ~512MB instance, and loading Mastra at startup tips it
// into OOM. `@atizar/providers/ids` is the client-safe, dependency-free id map.
const inert: Provider = {
  async *run() {},
  async *resume() {},
}
const factory: ProviderFactory = () => inert

export const providerRegistry: ProviderRegistry = defineProviders({
  [PROVIDERS.mock]: factory,
  [PROVIDERS.claudeCli]: factory,
  [PROVIDERS.mastra]: factory,
})
