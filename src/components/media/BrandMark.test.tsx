// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { BrandMark } from './BrandMark'

describe('BrandMark', () => {
  it('resolves a registered brand from structured codes', async () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => root.render(<BrandMark code="CA" namespace="airline" />))

    const mark = container.querySelector('[role="img"]')
    expect(mark?.getAttribute('data-brand-code')).toBe('CA')
    expect(mark?.getAttribute('aria-label')).toBe('中国国际航空')
    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/)
    await act(async () => root.unmount())
  })

  it('does not accept a URL as a brand identity and uses a generic icon', async () => {
    const container = document.createElement('div')
    const root: Root = createRoot(container)

    await act(async () => root.render(
      <BrandMark name="https://evil.example/logo.svg" namespace="insurance" />,
    ))

    const mark = container.querySelector('[role="img"]')
    expect(mark?.getAttribute('data-brand-code')).toBe('generic')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('svg')).not.toBeNull()
    await act(async () => root.unmount())
  })
})
