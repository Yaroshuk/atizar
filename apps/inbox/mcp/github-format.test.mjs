import { describe, it, expect } from 'vitest'
import { mapSearchNodes } from './github-format.mjs'

// Shape of one `search` node from the GraphQL query in github-tools.mjs.
const node = (over) => ({
  number: 1,
  title: 't',
  body: 'b',
  url: 'u',
  repository: { nameWithOwner: 'matteappen/teachers-web' },
  comments: { nodes: [] },
  projectItems: { nodes: [{ project: { number: 8 }, status: { name: 'Todo' }, priority: null }] },
  ...over,
})

const opts = {
  project: 8,
  allowedStatuses: ['Todo', 'In progress', 'On pluto', 'Ready for mars'],
  max: 20,
  assignee: 'Yaroshuk',
  bodyMax: 1500,
}

describe('mapSearchNodes', () => {
  it('keeps only allowed statuses read from the project #8 item', () => {
    const out = mapSearchNodes(
      {
        nodes: [
          node({
            number: 5381,
            projectItems: { nodes: [{ project: { number: 8 }, status: { name: 'In progress' } }] },
          }),
          node({
            number: 1,
            projectItems: { nodes: [{ project: { number: 8 }, status: { name: 'Done' } }] },
          }),
          node({
            number: 7,
            projectItems: { nodes: [{ project: { number: 8 }, status: { name: 'Backlog' } }] },
          }),
          node({
            number: 3,
            projectItems: { nodes: [{ project: { number: 8 }, status: { name: 'Todo' } }] },
          }),
        ],
      },
      opts
    )
    expect(out.map((t) => t.number)).toEqual([5381, 3])
  })

  it('ignores items that are not on project #8', () => {
    const out = mapSearchNodes(
      {
        nodes: [
          node({
            number: 2,
            projectItems: { nodes: [{ project: { number: 99 }, status: { name: 'Todo' } }] },
          }),
        ],
      },
      opts
    )
    expect(out).toEqual([])
  })

  it('maps fields, reads status + priority from project #8, truncates body', () => {
    const [t] = mapSearchNodes(
      {
        nodes: [
          node({
            number: 5381,
            title: 'Launch tab',
            body: 'x'.repeat(3000),
            url: 'https://github.com/matteappen/teachers-web/issues/5381',
            projectItems: {
              nodes: [
                {
                  project: { number: 8 },
                  status: { name: 'In progress' },
                  priority: { name: 'High' },
                },
              ],
            },
          }),
        ],
      },
      opts
    )
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

  it('derives needsReply from the last comment author vs the assignee', () => {
    const out = mapSearchNodes(
      {
        nodes: [
          node({
            number: 1,
            comments: { nodes: [{ author: { login: 'someone' }, body: 'any update?' }] },
          }),
          node({
            number: 2,
            comments: { nodes: [{ author: { login: 'Yaroshuk' }, body: 'fixed' }] },
          }),
          node({ number: 3, comments: { nodes: [] } }),
        ],
      },
      opts
    )
    expect(out.find((t) => t.number === 1)).toMatchObject({
      needsReply: true,
      lastComment: { author: 'someone', body: 'any update?' },
    })
    expect(out.find((t) => t.number === 2)?.needsReply).toBe(false)
    expect(out.find((t) => t.number === 3)).toMatchObject({ needsReply: false, lastComment: null })
  })

  it('defaults a missing priority to empty string', () => {
    const [t] = mapSearchNodes({ nodes: [node({})] }, opts)
    expect(t.priority).toBe('')
  })

  it('caps the result at max', () => {
    const nodes = [1, 2, 3].map((n) => node({ number: n }))
    expect(mapSearchNodes({ nodes }, { ...opts, max: 2 })).toHaveLength(2)
  })
})
