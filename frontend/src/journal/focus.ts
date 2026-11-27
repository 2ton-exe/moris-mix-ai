export function focusLoadedJournalContent(target: HTMLElement | null) {
  // A cook can open Mori while a route chunk or recipe is still arriving.
  if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.mori-pet-trigger, .mori-pet-bubble')) return
  target?.focus({ preventScroll: true })
}
