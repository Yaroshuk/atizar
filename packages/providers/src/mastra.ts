// @atizar/providers/mastra — the Mastra-backed provider + runner, behind a SUBPATH so the main
// `@atizar/providers` entry stays free of `@mastra/*`. mastraRunner statically imports
// `@mastra/core`/`@mastra/pg`/`@ai-sdk/anthropic` (runtime values, not just types), so re-exporting
// it from the main index would force EVERY consumer (mock, claude-cli) to install Mastra just to
// import a provider. Mastra users import from here; `@mastra/*` + `@ai-sdk/anthropic` are optional
// peerDependencies. (Mirrors the `@atizar/server/mastra` split.)
export * from './mastra-types.js'
export * from './mastra-stream.js'
export * from './mastra-provider.js'
export * from './mastraRunner.js'
