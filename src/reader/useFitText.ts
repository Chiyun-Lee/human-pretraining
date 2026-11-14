import { useLayoutEffect, type RefObject } from 'react'
import { handFontReady } from './handFont'

const MIN_PX = 5
const MAX_PX = 30
/** Upper limit for an element, from its --fit-max style (in px), else the default. */
const maxFor = (element: HTMLElement) => parseFloat(getComputedStyle(element).getPropertyValue('--fit-max')) || MAX_PX

/** Sets the element's font size to the largest value at which its content still fits. */
export function useFitText(ref: RefObject<HTMLElement | null>, content: unknown) {
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const fit = () => {
      let low = MIN_PX
      let high = maxFor(element)
      while (high - low > 0.5) {
        const mid = (low + high) / 2
        element.style.fontSize = `${mid}px`
        const fits = element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth
        if (fits) low = mid
        else high = mid
      }
      element.style.fontSize = `${low}px`
    }

    fit()
    // The font arriving changes how much text fits.
    let current = true
    void handFontReady.then(() => current && fit())
    const observer = new ResizeObserver(fit)
    observer.observe(element)
    return () => {
      current = false
      observer.disconnect()
    }
  }, [ref, content])
}
