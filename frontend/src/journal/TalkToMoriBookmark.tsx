import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { MoriEmblem } from './Mori'
import { MoriDialogue } from './MoriDialogue'
import type { MoriDialogueChoice, MoriDialogueLine } from './MoriDialogue'
import { useReducedMotionPreference } from './useReducedMotionPreference'
import { journalReturnFromLocation } from './indexNavigation'

const talkLines: readonly MoriDialogueLine[] = [{
  id: 'feature-selection',
  speaker: 'Mori',
  text: 'Hey, chef! What are we cooking up today?',
  expression: 'wave',
  choices: [
    { id: 'quick-entry', label: 'Help me organize my cooking notes.' },
    { id: 'ai-chef', label: "Let's figure out what to cook!" },
    { id: 'maybe-later', label: 'Maybe later!' },
  ],
}]

export function TalkToMoriBookmark() {
  const location = useLocation()
  const navigate = useNavigate()
  const dialogueId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<number | null>(null)
  const wasOpen = useRef(false)
  const reducedMotion = useReducedMotionPreference()
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  const activeFeature = /^\/app\/(?:quick-entry|chef)(?:\/|$)/.test(location.pathname)

  useLayoutEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useEffect(() => () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
  }, [])

  function closeImmediately() {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    closeTimer.current = null
    setClosing(false)
    setOpen(false)
  }

  function requestClose() {
    if (!open || closing) return
    if (reducedMotion) {
      closeImmediately()
      return
    }
    setClosing(true)
    closeTimer.current = window.setTimeout(closeImmediately, 180)
  }

  function chooseFeature(choice: MoriDialogueChoice) {
    if (choice.id === 'maybe-later') {
      requestClose()
      return
    }

    // Close before routing so an unsaved-change confirmation stays interactive
    // above its page rather than behind the modal dialogue.
    closeImmediately()
    if (choice.id === 'quick-entry') {
      navigate('/app/quick-entry', { state: { journalReturn: journalReturnFromLocation(location) } })
    } else if (choice.id === 'ai-chef') {
      navigate('/app/chef')
    }
  }

  function toggle() {
    if (open) requestClose()
    else {
      setClosing(false)
      setOpen(true)
    }
  }

  return <>
    <button
      ref={triggerRef}
      className="mm-bookmark mm-bookmark--cream mm-bookmark--button"
      type="button"
      aria-current={activeFeature ? 'page' : undefined}
      aria-expanded={open}
      aria-controls={open ? dialogueId : undefined}
      onClick={toggle}
    >
      <MoriEmblem size={16} />
      <span>Talk to Mori</span>
    </button>
    {open && <MoriDialogue
      id={dialogueId}
      lines={talkLines}
      modal
      numberedChoices
      showContinue={false}
      eyebrow="Talk to Mori"
      closeLabel="Close Talk to Mori"
      closing={closing}
      onChoice={chooseFeature}
      onClose={requestClose}
    />}
  </>
}
