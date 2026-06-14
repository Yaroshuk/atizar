import clsx from 'clsx'
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import s from './Markdown.module.scss'

// The ONE constrained markdown renderer every surface shares (assistant bubble +
// card free-text reason fields). SAFE by construction:
//   - react-markdown ESCAPES raw HTML by default; `skipHtml` additionally DROPS raw
//     HTML nodes — and we do NOT enable `rehype-raw` and never touch
//     dangerouslySetInnerHTML, so an injected <script>/<img onerror> can never render.
//   - `allowedElements` pins the output to a safe inline + block subset (bold, italic,
//     lists, inline code, links, code blocks, paragraphs). Anything outside the list is
//     stripped (its text children survive via `unwrapDisallowed`).
//   - every <a> is hardened with rel="noopener noreferrer" target="_blank".
// `remark-gfm` adds GFM niceties (autolinks, task lists) on the SOURCE side; it does not
// weaken the HTML-safety guarantees above.

// Block protocol-relative URLs (//host): defaultUrlTransform lets them through
// (no colon → treated as relative), but they navigate off-site — a phishing
// vector for adversarial inbound content. Everything else keeps react-markdown's
// default sanitization (javascript:/data: → dropped).
const safeUrlTransform = (url: string): string =>
  url.startsWith('//') ? '' : defaultUrlTransform(url)

// The safe inline + block element subset. Headings/tables/images/blockquotes are
// intentionally omitted — a thread bubble and a card body want prose, not document chrome.
const ALLOWED = ['p', 'strong', 'em', 'del', 'ul', 'ol', 'li', 'code', 'pre', 'a', 'br']

type MarkdownProps = {
  // The markdown source string (e.g. an assistant message or a card reason field).
  children: string
  // Extra class on the wrapper (e.g. to inherit a bubble/card text color).
  className?: string
}

export const Markdown = ({ children, className }: MarkdownProps) => (
  <div className={clsx(s.root, className)}>
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm]}
      allowedElements={ALLOWED}
      unwrapDisallowed
      urlTransform={safeUrlTransform}
      components={{
        // Strip the non-DOM `node` prop (react-markdown ExtraProps) before forwarding.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        a: ({ node: _node, ...props }) => (
          <a {...props} target='_blank' rel='noopener noreferrer' />
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  </div>
)
