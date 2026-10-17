/** Reading follows visible frames, not a wall-clock deadline. Lost frames must not
 * accumulate a catch-up debt. Shared by reflowable books and PDF reading.
 */
export class AutoScrollClock {
  #at: number | null = null
  #speed = 0

  reset() { this.#at = null; this.#speed = 0 }

  /** Timestamp from requestAnimationFrame; speed in CSS pixels/second. */
  step(at: number, targetSpeed: number): number {
    if (!Number.isFinite(at) || !Number.isFinite(targetSpeed) || targetSpeed <= 0) {
      this.reset()
      return 0
    }
    const previous = this.#at
    this.#at = at
    if (previous === null || at - previous > 250 || at < previous) {
      this.#speed = targetSpeed
      return 0
    }
    // At most two 60 Hz frames. Supports 30/60/90/120/144 Hz without fixed-step drift.
    const dt = Math.min(at - previous, 1000 / 30) / 1000
    // Exact integral of an exponential velocity transition (120 ms time constant).
    // Changing a slider updates the target without resetting time or subpixel position.
    const decay = Math.exp(-dt / 0.12)
    const difference = this.#speed - targetSpeed
    this.#speed = targetSpeed + difference * decay
    return targetSpeed * dt + difference * 0.12 * (1 - decay)
  }
}

/** Retain fractional distance even when a native scrollTop setter quantizes it.
 * Rebase immediately if the reader, layout or navigation changed the actual position.
 */
export class ScrollAccumulator {
  #actual: number | null = null
  #target = 0
  reset() { this.#actual = null }
  move(el: { scrollTop: number; scrollHeight: number; clientHeight: number }, dy: number) {
    const current = el.scrollTop
    if (current !== this.#actual) this.#target = current
    this.#target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, this.#target + dy))
    el.scrollTop = this.#target
    this.#actual = el.scrollTop
  }
}
