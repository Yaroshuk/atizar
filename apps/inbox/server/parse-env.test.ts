import { describe, it, expect } from 'vitest'
import { parseEnvFile } from './parse-env.js'

describe('parseEnvFile', () => {
  it('parses simple KEY=value lines', () => {
    expect(parseEnvFile('FOO=bar\nBAZ=qux')).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('skips blank lines and # comments', () => {
    expect(parseEnvFile('\n# a comment\nFOO=bar\n   \n#another\nBAZ=qux')).toEqual({
      FOO: 'bar',
      BAZ: 'qux',
    })
  })

  it('strips matching surrounding single or double quotes', () => {
    expect(parseEnvFile('A="double"\nB=\'single\'\nC=bare')).toEqual({
      A: 'double',
      B: 'single',
      C: 'bare',
    })
  })

  it('keeps = signs inside the value (e.g. a connection URL)', () => {
    expect(parseEnvFile('DATABASE_URL=postgres://u:p@h:5432/db?x=1')).toEqual({
      DATABASE_URL: 'postgres://u:p@h:5432/db?x=1',
    })
  })

  it('trims whitespace around key and value and tolerates an export prefix', () => {
    expect(parseEnvFile('  KEY = value \nexport TOKEN=abc')).toEqual({
      KEY: 'value',
      TOKEN: 'abc',
    })
  })

  it('ignores lines without an = and empty keys', () => {
    expect(parseEnvFile('justtext\n=novalue\nGOOD=1')).toEqual({ GOOD: '1' })
  })
})
