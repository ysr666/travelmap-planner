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
  it('keeps vh fallbacks before dynamic viewport units', () => {
    const rootDeclarations = declarationsFor('#root')
    const viewportDeclarations = declarationsFor('.app-viewport')

    expect(rootDeclarations.indexOf('min-height: 100vh;')).toBeLessThan(
      rootDeclarations.indexOf('min-height: 100svh;'),
    )
    expect(viewportDeclarations.indexOf('height: 100vh;')).toBeLessThan(
      viewportDeclarations.indexOf('height: 100dvh;'),
    )
    expect(viewportDeclarations.indexOf('min-height: 100vh;')).toBeLessThan(
      viewportDeclarations.indexOf('min-height: 100svh;'),
    )
  })
})
