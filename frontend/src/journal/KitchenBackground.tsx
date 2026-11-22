import flourUrl from '../assets/journal/props/flour.webp'
import spoonUrl from '../assets/journal/props/spoon.webp'
import whiskUrl from '../assets/journal/props/whisk.webp'
import sprigUrl from '../assets/journal/props/sprig.webp'

import './KitchenBackground.css'

export function KitchenBackground() {
  return (
    <div className="kitchen-background" aria-hidden="true">
      <div className="kitchen-background__light" />
      <img
        src={flourUrl}
        alt=""
        className="kitchen-background__prop kitchen-background__prop--flour"
        draggable={false}
        decoding="async"
      />
      <img
        src={spoonUrl}
        alt=""
        className="kitchen-background__prop kitchen-background__prop--spoon"
        draggable={false}
        decoding="async"
      />
      <img
        src={whiskUrl}
        alt=""
        className="kitchen-background__prop kitchen-background__prop--whisk"
        draggable={false}
        decoding="async"
      />
      <img
        src={sprigUrl}
        alt=""
        className="kitchen-background__prop kitchen-background__prop--sprig"
        draggable={false}
        decoding="async"
      />
    </div>
  )
}
