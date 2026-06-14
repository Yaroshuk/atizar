import '@testing-library/jest-dom/vitest'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { Markdown } from './Markdown.js'

describe('Markdown', () => {
  it('renders **bold** as a <strong> element', () => {
    const { container } = render(<Markdown>{'Hello **world**'}</Markdown>)
    const strong = container.querySelector('strong')
    expect(strong).not.toBeNull()
    expect(strong).toHaveTextContent('world')
  })

  it('renders *italic* as an <em> element', () => {
    const { container } = render(<Markdown>{'an *important* note'}</Markdown>)
    const em = container.querySelector('em')
    expect(em).not.toBeNull()
    expect(em).toHaveTextContent('important')
  })

  it('renders a markdown list as <ul><li> items', () => {
    const { container } = render(<Markdown>{'- one\n- two'}</Markdown>)
    const items = container.querySelectorAll('li')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('one')
    expect(items[1]).toHaveTextContent('two')
  })

  it('renders inline code as a <code> element', () => {
    const { container } = render(<Markdown>{'use `npm test`'}</Markdown>)
    const code = container.querySelector('code')
    expect(code).not.toBeNull()
    expect(code).toHaveTextContent('npm test')
  })

  it('hardens links with rel + target', () => {
    const { container } = render(<Markdown>{'[site](https://example.com)'}</Markdown>)
    const link = container.querySelector('a')
    expect(link).not.toBeNull()
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  it('renders raw HTML inert — no <script> element is created and no markup is injected', () => {
    const payload = 'before <script>window.__pwned = true</script> after <b>x</b>'
    const { container } = render(<Markdown>{payload}</Markdown>)
    // No live elements from the raw HTML reach the DOM (skipHtml drops them; nothing executes).
    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('b')).toBeNull()
    // The surrounding plain text still renders (the content is neutralized, not lost).
    expect(container.textContent).toContain('before')
    expect(container.textContent).toContain('after')
  })

  it('renders nothing extra for empty content', () => {
    const { container } = render(<Markdown>{''}</Markdown>)
    expect(container.querySelector('strong')).toBeNull()
  })

  it('neutralizes protocol-relative URLs (phishing vector)', () => {
    const { container } = render(<Markdown>{'[x](//evil.example.com)'}</Markdown>)
    const link = container.querySelector('a')
    // href dropped → not navigable off-site
    expect(link?.getAttribute('href') ?? '').toBe('')
  })
})
