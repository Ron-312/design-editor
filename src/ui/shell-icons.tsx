import type { ReactNode } from 'react'

const ICON_PATHS = {
  check: <path d="M3 8.5l3 3 7-7" />,
  'chev-r': <path d="M6 4l4 4-4 4" />,
  'chev-d': <path d="M4 6l4 4 4-4" />,
  push: <path d="M5 12.5h-.5a3 3 0 0 1-.4-6A4 4 0 0 1 11.8 5.5a3 3 0 0 1 .2 7h-1M8 14V8.5M6 10.5l2-2 2 2" />,
  undo: <path d="M5.5 3.5l-3 3 3 3M2.5 6.5h7a4 4 0 0 1 0 8H7" />,
  redo: <path d="M10.5 3.5l3 3-3 3M13.5 6.5h-7a4 4 0 0 0 0 8H9" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="2.75" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
    </>
  ),
  moon: <path d="M13 9.6A5.5 5.5 0 1 1 6.4 3a4.5 4.5 0 0 0 6.6 6.6z" />,
  warn: (
    <>
      <path d="M7.1 2.9a1 1 0 0 1 1.8 0l5.4 9.6a1 1 0 0 1-.9 1.5H2.6a1 1 0 0 1-.9-1.5z" />
      <path d="M8 6.5v3M8 11.6v.1" />
    </>
  ),
  desktop: (
    <>
      <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" />
      <path d="M5.5 13.5h5M8 11v2.5" />
    </>
  ),
  tablet: (
    <>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M7 12h2" />
    </>
  ),
  phone: (
    <>
      <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" />
      <path d="M7.25 12h1.5" />
    </>
  ),
  play: <path d="M5 3.5v9l7-4.5z" />,
  cursor: <path d="M3.5 2.5l9 4-3.9 1.4-1.4 3.9z" />,
  frame: <path d="M5 2v12M11 2v12M2 5h12M2 11h12" />,
  rect: <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />,
  text: <path d="M3.5 4.5V3h9v1.5M8 3v10M6 13h4" />,
  image: (
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <circle cx="6" cy="6.5" r="1.2" />
      <path d="M2.5 11.5l3.5-3 3 2.5 1.8-1.5 2.7 2.2" />
    </>
  ),
  hand: (
    <path d="M5.5 8.5V4a1 1 0 0 1 2 0v3.5M7.5 7V3a1 1 0 0 1 2 0v4M9.5 7.5V4.5a1 1 0 0 1 2 0V9a4.5 4.5 0 0 1-4.5 4.5h-.4a4 4 0 0 1-3.2-1.6L2.7 10a1 1 0 0 1 1.5-1.3l1.3 1.1" />
  ),
  code: <path d="M5.5 4.5L2 8l3.5 3.5M10.5 4.5L14 8l-3.5 3.5" />,
} satisfies Record<string, ReactNode>

export type ShellIconName = keyof typeof ICON_PATHS

export function ShellIcon({ name, className = 'i' }: { readonly name: ShellIconName; readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {ICON_PATHS[name]}
    </svg>
  )
}
