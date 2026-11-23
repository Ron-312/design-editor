// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../../src/ui/ErrorBoundary'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

let crashing = true

function Fragile() {
  if (crashing) throw new Error('flow is undefined')
  return <p>panel</p>
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ErrorBoundary', () => {
  it('shows the crash in place of one area, keeps its siblings, and renders it again on Retry', () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    crashing = true
    act(() =>
      root.render(
        <>
          <ErrorBoundary area="properties panel">
            <Fragile />
          </ErrorBoundary>
          <p>canvas</p>
        </>,
      ),
    )

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('properties panel hit an error: flow is undefined')
    expect(container.textContent).toContain('canvas')

    crashing = false
    act(() => container.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('panel')
    expect(container.querySelector('[role="alert"]')).toBeNull()
    act(() => root.unmount())
  })
})
