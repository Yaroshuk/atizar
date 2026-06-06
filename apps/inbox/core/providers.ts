import type { RunAgentInput, BaseEvent } from '@ag-ui/client'

// A provider is the model/runtime seam: given the run input it yields a stream of
// AG-UI events. CLI and API providers will implement this later; for now there is
// one fake provider (see mock-provider.ts).
export interface Provider {
  run(input: RunAgentInput): AsyncIterable<BaseEvent>
}

export interface ProviderRegistry {
  resolve(name: string): Provider
}

// Providers are defined once; agents reference one by name. resolve throws on an
// unknown name so a bad `provider` reference fails loudly at wiring time.
export function defineProviders(map: Record<string, Provider>): ProviderRegistry {
  return {
    resolve(name: string): Provider {
      const provider = map[name]
      if (!provider) throw new Error(`Unknown provider: ${name}`)
      return provider
    },
  }
}
