export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  // UA regex catches phones; maxTouchPoints catches iPads on iPadOS 13+ which
  // present a desktop UA by default but still block setTimeout-based window.open.
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || navigator.maxTouchPoints > 0
}
