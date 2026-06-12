// @vitest-environment jsdom

import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button'
import { BottomSheet } from './BottomSheet'
import { Card } from './Card'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState } from './EmptyState'
import { ListRow } from './ListRow'
import { SectionHeader } from './SectionHeader'
import { SkeletonLine } from './SkeletonLine'

vi.stubGlobal('__APP_VERSION__', '0.0.0-test')

let container: HTMLDivElement | null = null
let root: Root | null = null

async function waitForModalFocus() {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 25))
  })
}

beforeEach(() => {
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  container = null
  root = null
})

describe('Button', () => {
  it('renders children', async () => {
    await act(async () => {
      root?.render(<Button>点击</Button>)
    })
    expect(container?.textContent).toContain('点击')
  })

  it('renders with icon', async () => {
    await act(async () => {
      root?.render(<Button icon={<span>🎯</span>}>带图标</Button>)
    })
    expect(container?.textContent).toContain('🎯')
    expect(container?.textContent).toContain('带图标')
  })

  it('renders loading state', async () => {
    await act(async () => {
      root?.render(<Button loading>加载中</Button>)
    })
    const button = container?.querySelector('button')
    expect(button?.disabled).toBe(true)
  })

  it('renders disabled state', async () => {
    await act(async () => {
      root?.render(<Button disabled>禁用</Button>)
    })
    const button = container?.querySelector('button')
    expect(button?.disabled).toBe(true)
  })

  it('renders primary variant', async () => {
    await act(async () => {
      root?.render(<Button variant="primary">主要</Button>)
    })
    const button = container?.querySelector('button')
    expect(button?.className).toContain('bg-primary-container')
  })

  it('renders secondary variant', async () => {
    await act(async () => {
      root?.render(<Button variant="secondary">次要</Button>)
    })
    const button = container?.querySelector('button')
    expect(button?.className).toContain('bg-surface-container')
  })

  it('renders ghost variant', async () => {
    await act(async () => {
      root?.render(<Button variant="ghost">幽灵</Button>)
    })
    const button = container?.querySelector('button')
    expect(button?.className).toContain('bg-transparent')
  })

  it('renders destructive variant', async () => {
    await act(async () => {
      root?.render(<Button variant="destructive">删除</Button>)
    })
    const button = container?.querySelector('button')
    expect(button?.className).toContain('bg-error-container')
  })

  it('calls onClick', async () => {
    const onClick = vi.fn()
    await act(async () => {
      root?.render(<Button onClick={onClick}>点击</Button>)
    })
    const button = container?.querySelector('button')
    await act(async () => {
      button?.click()
    })
    expect(onClick).toHaveBeenCalled()
  })

  it('has min-h-12 for touch target', async () => {
    await act(async () => {
      root?.render(<Button>按钮</Button>)
    })
    const button = container?.querySelector('button')
    expect(button?.className).toContain('min-h-12')
  })
})

describe('ConfirmDialog', () => {
  it('has an accessible name and focuses the cancel action', async () => {
    await act(async () => {
      root?.render(
        <ConfirmDialog
          body="删除后不可恢复。"
          onCancel={() => {}}
          onConfirm={() => {}}
          open
          title="确认删除"
        />,
      )
    })
    await waitForModalFocus()

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-labelledby')).toBeTruthy()
    expect(dialog?.getAttribute('aria-describedby')).toBeTruthy()
    expect(document.activeElement?.textContent).toContain('取消')
  })

  it('traps tab focus and closes with Escape', async () => {
    const onCancel = vi.fn()
    await act(async () => {
      root?.render(
        <ConfirmDialog
          body="删除后不可恢复。"
          confirmLabel="删除"
          onCancel={onCancel}
          onConfirm={() => {}}
          open
          title="确认删除"
        />,
      )
    })
    await waitForModalFocus()

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab', shiftKey: true }))
    expect(document.activeElement?.textContent).toContain('删除')
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }))
    expect(document.activeElement?.textContent).toContain('取消')
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    expect(onCancel).toHaveBeenCalled()
  })

  it('restores focus to the opener when closed', async () => {
    const opener = document.createElement('button')
    opener.textContent = '打开弹窗'
    document.body.appendChild(opener)
    opener.focus()

    await act(async () => {
      root?.render(
        <ConfirmDialog
          body="删除后不可恢复。"
          onCancel={() => {}}
          onConfirm={() => {}}
          open
          title="确认删除"
        />,
      )
    })
    await waitForModalFocus()

    await act(async () => {
      root?.render(
        <ConfirmDialog
          body="删除后不可恢复。"
          onCancel={() => {}}
          onConfirm={() => {}}
          open={false}
          title="确认删除"
        />,
      )
    })

    expect(document.activeElement).toBe(opener)
    opener.remove()
  })
})

describe('BottomSheet', () => {
  it('requires an accessible name and focuses close', async () => {
    await act(async () => {
      root?.render(
        <BottomSheet ariaLabel="更多操作" onClose={() => {}} open>
          <button type="button">旅行总览</button>
        </BottomSheet>,
      )
    })
    await waitForModalFocus()

    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute('aria-label')).toBe('更多操作')
    expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭')
  })
})

describe('Card', () => {
  it('renders children', async () => {
    await act(async () => {
      root?.render(<Card>内容</Card>)
    })
    expect(container?.textContent).toContain('内容')
  })

  it('renders default variant', async () => {
    await act(async () => {
      root?.render(<Card data-testid="card">内容</Card>)
    })
    const card = container?.querySelector('[data-testid="card"]')
    expect(card?.className).toContain('rounded-xl')
    expect(card?.className).toContain('bg-surface-container')
  })

  it('renders grouped variant', async () => {
    await act(async () => {
      root?.render(<Card variant="grouped" data-testid="card">内容</Card>)
    })
    const card = container?.querySelector('[data-testid="card"]')
    expect(card?.className).toContain('rounded-xl')
  })

  it('renders flat variant', async () => {
    await act(async () => {
      root?.render(<Card variant="flat" data-testid="card">内容</Card>)
    })
    const card = container?.querySelector('[data-testid="card"]')
    expect(card?.className).toContain('border-transparent')
  })

  it('applies padding', async () => {
    await act(async () => {
      root?.render(<Card padding="lg" data-testid="card">内容</Card>)
    })
    const card = container?.querySelector('[data-testid="card"]')
    expect(card?.className).toContain('p-5')
  })

  it('respects padding override in className', async () => {
    await act(async () => {
      root?.render(<Card className="px-6" data-testid="card">内容</Card>)
    })
    const card = container?.querySelector('[data-testid="card"]')
    expect(card?.className).toContain('px-6')
    expect(card?.className).not.toContain('p-4')
  })
})

describe('EmptyState', () => {
  it('renders title and body', async () => {
    await act(async () => {
      root?.render(
        <EmptyState icon={<span>📭</span>} title="暂无内容" body="请添加一些内容" />,
      )
    })
    expect(container?.textContent).toContain('暂无内容')
    expect(container?.textContent).toContain('请添加一些内容')
  })

  it('renders icon', async () => {
    await act(async () => {
      root?.render(
        <EmptyState icon={<span>📭</span>} title="暂无内容" body="请添加一些内容" />,
      )
    })
    expect(container?.textContent).toContain('📭')
  })
})

describe('ListRow', () => {
  it('renders title', async () => {
    await act(async () => {
      root?.render(<ListRow title="东京旅行" />)
    })
    expect(container?.textContent).toContain('东京旅行')
  })

  it('renders detail', async () => {
    await act(async () => {
      root?.render(<ListRow title="东京旅行" detail="5天4夜" />)
    })
    expect(container?.textContent).toContain('5天4夜')
  })

  it('renders meta', async () => {
    await act(async () => {
      root?.render(<ListRow title="东京旅行" meta="2026-04-01" />)
    })
    expect(container?.textContent).toContain('2026-04-01')
  })

  it('renders icon', async () => {
    await act(async () => {
      root?.render(<ListRow icon={<span>🗼</span>} title="东京旅行" />)
    })
    expect(container?.textContent).toContain('🗼')
  })

  it('renders as button when onClick provided', async () => {
    const onClick = vi.fn()
    await act(async () => {
      root?.render(<ListRow title="东京旅行" onClick={onClick} />)
    })
    const button = container?.querySelector('button')
    expect(button).toBeTruthy()
    await act(async () => {
      button?.click()
    })
    expect(onClick).toHaveBeenCalled()
  })

  it('renders as div when no onClick', async () => {
    await act(async () => {
      root?.render(<ListRow title="东京旅行" />)
    })
    const button = container?.querySelector('button')
    expect(button).toBeNull()
  })

  it('renders separator', async () => {
    await act(async () => {
      root?.render(<ListRow title="东京旅行" separator />)
    })
    const separator = container?.querySelector('.bg-outline-variant\\/30')
    expect(separator).toBeTruthy()
  })

  it('renders chevron when clickable', async () => {
    await act(async () => {
      root?.render(<ListRow title="东京旅行" onClick={() => {}} />)
    })
    const chevron = container?.querySelector('.text-outline-variant')
    expect(chevron).toBeTruthy()
  })
})

describe('SectionHeader', () => {
  it('renders title', async () => {
    await act(async () => {
      root?.render(<SectionHeader title="行程列表" />)
    })
    expect(container?.textContent).toContain('行程列表')
  })

  it('renders eyebrow', async () => {
    await act(async () => {
      root?.render(<SectionHeader eyebrow="第 1 天" title="行程列表" />)
    })
    expect(container?.textContent).toContain('第 1 天')
    expect(container?.textContent).toContain('行程列表')
  })

  it('renders action button', async () => {
    const onAction = vi.fn()
    await act(async () => {
      root?.render(<SectionHeader title="行程列表" action="查看全部" onAction={onAction} />)
    })
    const button = container?.querySelector('button')
    expect(button?.textContent).toContain('查看全部')
    await act(async () => {
      button?.click()
    })
    expect(onAction).toHaveBeenCalled()
  })

  it('does not render action when not provided', async () => {
    await act(async () => {
      root?.render(<SectionHeader title="行程列表" />)
    })
    const button = container?.querySelector('button')
    expect(button).toBeNull()
  })
})

describe('SkeletonLine', () => {
  it('renders skeleton', async () => {
    await act(async () => {
      root?.render(<SkeletonLine />)
    })
    const skeleton = container?.querySelector('.animate-pulse')
    expect(skeleton).toBeTruthy()
  })

  it('applies custom className', async () => {
    await act(async () => {
      root?.render(<SkeletonLine className="w-2/3" />)
    })
    const skeleton = container?.querySelector('.w-2\\/3')
    expect(skeleton).toBeTruthy()
  })
})
