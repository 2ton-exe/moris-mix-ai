import { useEffect, useRef, type ReactNode } from 'react'
import { useAuth } from '../auth/context'
import { JournalShell } from '../journal/JournalShell'
import { JournalFacingPage } from '../journal/JournalFacingPage'
import { Link, useLocation } from 'react-router'
import { journalReturnTo } from '../journal/indexNavigation'
import { UnsavedChangesDialog } from './UnsavedChangesDialog'
import './recipe-form.css'

type NavigationConfirmation = {
  open: boolean
  keepEditing: () => void
  discardChanges: () => void
}

export function RecipeEditorFrame({ mode, connected, children, navigationConfirmation, backTo, backState, backLabel = 'Back to journal', headingEyebrow, headingTitle, headingIntro }: {
  mode: 'create' | 'edit'; connected: boolean; children: ReactNode
  navigationConfirmation?: NavigationConfirmation
  backTo?: string
  backState?: unknown
  backLabel?: string
  headingEyebrow?: string
  headingTitle?: string
  headingIntro?: ReactNode
}) {
  const { user } = useAuth()
  const location = useLocation()
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const visibleHeading = document.querySelector<HTMLElement>('.mm-writing-mobile-title') ?? heading.current
    visibleHeading?.focus()
  }, [mode])
  return <JournalShell mode="writing" account={<div className="journal-account"><span>{user?.email}</span></div>} pageClassName="mm-journal-editor">
    <JournalFacingPage className="mm-facing-content--editor">
    <nav className="mm-recipe-detail__back" aria-label="Sheet navigation"><Link to={backTo ?? journalReturnTo(location.state)} {...(backState === undefined ? {} : { state: backState })}><span aria-hidden="true">←</span> {backLabel}</Link><span className="mm-recipe-page-number">Recipe sheet</span></nav>
    <header className="mm-recipe-editor-heading">
      <p className="mm-recipe-index__eyebrow">{headingEyebrow ?? (mode === 'create' ? 'A fresh sheet' : 'Revisiting a favorite')}</p>
      <h1 ref={heading} tabIndex={-1}>{headingTitle ?? (mode === 'create' ? 'A recipe of your own.' : 'Make it your own.')}</h1>
      {headingIntro}
    </header>
    {!connected && <p className="recipe-form-notice" role="note">Recipe saving is not connected yet. Nothing on this page is saved to your journal.</p>}
    </JournalFacingPage>
    <div className="recipe-form-content" key={user?.id ?? 'signed-out'}>
      {children}
    </div>
    {navigationConfirmation?.open && <UnsavedChangesDialog onKeepEditing={navigationConfirmation.keepEditing} onDiscardChanges={navigationConfirmation.discardChanges} />}
  </JournalShell>
}
