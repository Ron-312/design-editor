import type { Token } from './fields'

const SOURCE_TITLES: Readonly<Record<Token['source'], string>> = {
  'tokens.json': 'Design system',
  ':root': 'CSS variables',
}

const COLOUR_VALUE = /^(#[0-9a-f]{3,8}|(rgb|hsl|hwb|lab|lch|oklab|oklch|color)a?\()/i

export function TokensPanel({ tokens }: { readonly tokens: readonly Token[] }) {
  const sources = (Object.keys(SOURCE_TITLES) as Token['source'][]).filter((source) => tokens.some((token) => token.source === source))
  return (
    <div className="tokens" aria-label="Tokens">
      {sources.map((source) => (
        <section key={source} className="lsec">
          <h3 className="lhead">{SOURCE_TITLES[source]}</h3>
          <ul>
            {tokens
              .filter((token) => token.source === source)
              .map((token) => (
                <li key={token.name} className="token" title={`${token.name}: ${token.value}`}>
                  {COLOUR_VALUE.test(token.value.trim()) ? <span className="sw" style={{ background: token.value }} /> : <span className="sw none" />}
                  <span className="mono nm">{token.name}</span>
                  <span className="mono val">{token.value}</span>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
