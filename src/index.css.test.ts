import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

function declarationsFor(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const block = styles.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1]

  if (!block) throw new Error(`Missing CSS block for ${selector}`)

  return block
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

describe('application viewport compatibility', () => {
  it('isolates dynamic viewport units so production minification preserves vh fallbacks', () => {
    const bodyDeclarations = declarationsFor('body')
    const rootDeclarations = declarationsFor('#root')
    const viewportDeclarations = declarationsFor('.app-viewport')

    expect(bodyDeclarations).toContain('min-height: 100vh;')
    expect(rootDeclarations).toContain('min-height: 100vh;')
    expect(viewportDeclarations).toContain('height: 100vh;')
    expect(viewportDeclarations).toContain('min-height: 100vh;')
    expect(styles).toMatch(/@supports \(min-height: 100svh\)\s*\{[\s\S]*?min-height: 100svh;/)
    expect(styles).toMatch(/@supports \(height: 100dvh\)\s*\{[\s\S]*?height: 100dvh;/)
  })

  it('keeps the global reduced-motion override', () => {
    expect(styles).toContain('@media (prefers-reduced-motion: reduce)')
    expect(styles).toContain('animation-duration: 0.01ms !important;')
    expect(styles).toContain('animation-iteration-count: 1 !important;')
    expect(styles).toContain('scroll-behavior: auto !important;')
    expect(styles).toContain('transition-duration: 0.01ms !important;')
  })
})
