import { describe, it, expect } from 'vitest'
import { mapItems } from './github-format.mjs'

const fixture = {
  items: [
    {
      assignees: ['Yaroshuk'],
      status: 'In progress',
      priority: 'High',
      content: {
        type: 'Issue',
        number: 5381,
        repository: 'matteappen/teachers-web',
        title: 'Launch tab',
        body: 'x'.repeat(3000),
        url: 'https://github.com/matteappen/teachers-web/issues/5381',
      },
    },
    {
      assignees: ['Yaroshuk'],
      status: 'Done',
      priority: null,
      content: { type: 'Issue', number: 1, repository: 'm/r', title: 'old', body: 'b', url: 'u' },
    },
    {
      assignees: ['someoneElse'],
      status: 'Todo',
      priority: 'Low',
      content: {
        type: 'Issue',
        number: 2,
        repository: 'm/r',
        title: 'theirs',
        body: 'b',
        url: 'u',
      },
    },
    {
      assignees: ['Yaroshuk'],
      status: 'Todo',
      priority: 'Low',
      content: { type: 'DraftIssue', title: 'draft, no number' },
    },
  ],
}

describe('mapItems', () => {
  const opts = { assignee: 'Yaroshuk', excludeStatuses: ['Done'], bodyMax: 1500 }

  it('keeps only the assignee’s real issues, excluding Done and draft (no number)', () => {
    const out = mapItems(fixture, opts)
    expect(out.map((t) => t.number)).toEqual([5381])
  })

  it('maps fields and truncates the body', () => {
    const [t] = mapItems(fixture, opts)
    expect(t).toMatchObject({
      repo: 'matteappen/teachers-web',
      number: 5381,
      title: 'Launch tab',
      status: 'In progress',
      priority: 'High',
      url: 'https://github.com/matteappen/teachers-web/issues/5381',
    })
    expect(t.body.length).toBe(1500)
  })

  it('defaults a null priority to empty string', () => {
    const out = mapItems(
      { items: [{ ...fixture.items[2], assignees: ['Yaroshuk'], priority: null }] },
      opts
    )
    expect(out[0].priority).toBe('')
  })
})
