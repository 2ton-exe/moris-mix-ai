import type { ReactNode } from 'react'
import { MoriEmblem } from './Mori'
import { PaperCard } from './Scrapbook'

export function JournalBookplate({ ownerName, art, children }: { ownerName: string; art?: ReactNode; children?: ReactNode }) {
  return <PaperCard className="mm-bookplate" surface="fresh">
    {art ?? <MoriEmblem size={46} />}
    <span className="mm-bookplate__ex-libris">Cooking journal</span>
    <p>This journal belongs to</p>
    <p className="mm-bookplate__title">{ownerName}</p>
    <span className="mm-bookplate__rule" aria-hidden="true" />
    {children}
  </PaperCard>
}
