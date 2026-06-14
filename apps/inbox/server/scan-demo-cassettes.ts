import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { scanCassette } from './record-replay.js'

// CI gate: scan every committed synthetic demo cassette for accidental REAL PII
// (emails/phones/secrets patterns) via the shared scanCassette. Exit 1 on any finding.
// scanCassette flags ALL email-shaped strings, but synthetic cassettes intentionally use
// RFC-2606 reserved domains (*.example/.test/.invalid/.localhost) — these can never be real,
// so we drop those email findings (a real email like foo@gmail.com is still flagged).
// Names/postal addresses are not regex-detectable — the synthetic-authoring discipline + review
// cover those. scanCassette itself is left untouched (it gates real-cassette sharing).
const RESERVED_TLD = /@[\w-]+\.(?:example|test|invalid|localhost)\b/i
const dir = fileURLToPath(new URL('../demo-cassettes/', import.meta.url))
let files: string[]
try {
  files = (await readdir(dir)).filter((f) => f.endsWith('.jsonl'))
} catch (err) {
  console.error(`[demo:scan-cassettes] cannot read ${dir}: ${(err as Error).message}`)
  process.exit(1)
}
let findings = 0
for (const f of files) {
  const text = await readFile(new URL(`../demo-cassettes/${f}`, import.meta.url), 'utf8')
  const hits = scanCassette(text).filter(
    (h) => !(h.kind === 'email' && RESERVED_TLD.test(h.snippet))
  )
  for (const h of hits) {
    findings++
    console.error(`${f}:${h.line} [${h.kind}] ${h.snippet}`)
  }
}
if (findings > 0) {
  console.error(
    `\n[demo:scan-cassettes] ${findings} potential REAL PII finding(s) — fix before commit.`
  )
  process.exit(1)
}
console.log(`[demo:scan-cassettes] ${files.length} cassette(s) clean.`)
