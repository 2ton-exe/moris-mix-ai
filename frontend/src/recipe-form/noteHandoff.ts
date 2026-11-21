type NoteHandoff = {
  id: string
  userId: string
  destination: string
  title: string
  text: string
  baseChanged: boolean
}

// Keep private text out of the URL, browser history, and browser storage.
let pending: NoteHandoff | null = null

export function queueNoteHandoff(note: Omit<NoteHandoff, 'id'>) {
  pending = { ...note, id: crypto.randomUUID() }
  return pending.id
}

export function readNoteHandoff(state: unknown, userId: string | undefined, destination: string) {
  return pending && pending.userId === userId && pending.destination === destination &&
    typeof state === 'object' && state !== null && 'noteHandoff' in state && state.noteHandoff === pending.id
    ? pending : undefined
}

export function clearNoteHandoff(id: string) {
  if (pending?.id === id) pending = null
}

export function appendPersonalNote(notes: string, text: string) {
  return notes ? notes + '\n\n' + text : text
}
