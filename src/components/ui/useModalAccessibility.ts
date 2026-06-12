import { useEffect, type RefObject } from 'react'

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

type ModalAccessibilityOptions = {
  containerRef: RefObject<HTMLElement | null>
  initialFocusRef?: RefObject<HTMLElement | null>
  onClose: () => void
  open: boolean
}

export function useModalAccessibility({
  containerRef,
  initialFocusRef,
  onClose,
  open,
}: ModalAccessibilityOptions) {
  useEffect(() => {
    if (!open) return undefined

    const container = containerRef.current
    const previousActiveElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const scheduleFrame = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0)
    const cancelFrame = typeof window.cancelAnimationFrame === 'function'
      ? window.cancelAnimationFrame.bind(window)
      : window.clearTimeout.bind(window)

    const focusInitialElement = scheduleFrame(() => {
      const target = initialFocusRef?.current ?? getFocusableElements(container)[0] ?? container
      target?.focus()
    })

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab' || !container) return

      const focusable = getFocusableElements(container)
      if (focusable.length === 0) {
        event.preventDefault()
        container.focus()
        return
      }

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const active = document.activeElement

      if (!container.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }

      if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
        return
      }

      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelFrame(focusInitialElement)
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
      if (previousActiveElement && document.contains(previousActiveElement)) {
        previousActiveElement.focus()
      }
    }
  }, [containerRef, initialFocusRef, onClose, open])
}

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return []
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => {
      const style = window.getComputedStyle(element)
      return !element.hidden &&
        element.getAttribute('aria-hidden') !== 'true' &&
        style.display !== 'none' &&
        style.visibility !== 'hidden'
    })
}
