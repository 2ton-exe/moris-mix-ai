// Visual-only artwork from the verified Figma Make reference; no services or state providers.
import type { CSSProperties } from 'react'

export type MoriMood = 'wave' | 'cheer' | 'stir' | 'worried' | 'sleep' | 'happy' | 'think'

const O = '#2f211a'
const FUR = '#a39388'
const FUR_LIGHT = '#eadfd5'
const PINK = '#e7a5a0'
const MITT = '#e0ac45'
const APRON = '#93a77e'
const HAT = '#fbf8f1'

interface MoriProps {
  /** Motion is opt-in and respects the system reduced-motion preference. */
  animated?: boolean
  mood?: MoriMood
  size?: number
  className?: string
  style?: CSSProperties
  /** Accessible label; omit for purely decorative placements. */
  label?: string
}

function Arm({ side, angle }: { side: 'l' | 'r'; angle: number }) {
  const sx = side === 'l' ? 72 : 128
  const dir = side === 'l' ? -1 : 1
  const hx = sx + dir * 20
  return (
    <g className={side === 'r' ? 'mori-arm-r' : 'mori-arm-l'} transform={`rotate(${angle} ${sx} 168)`}>
      <path d={`M${sx} 168 C${sx + dir * 8} 176 ${sx + dir * 15} 186 ${hx} 194`} stroke={O} strokeWidth="11" strokeLinecap="round" fill="none" />
      <path d={`M${sx} 168 C${sx + dir * 8} 176 ${sx + dir * 15} 186 ${hx} 194`} stroke={FUR} strokeWidth="5.5" strokeLinecap="round" fill="none" />
      <path
        d={`M${hx - 12} ${196} C${hx - 14} ${184} ${hx - 4} ${178} ${hx + 4} ${183} C${hx + 12} ${179} ${hx + 17} ${191} ${hx + 11} ${203} C${hx + 7} ${211} ${hx - 9} ${211} ${hx - 12} ${196}Z`}
        fill={MITT}
        stroke={O}
        strokeWidth="3.2"
        strokeLinejoin="round"
      />
      <path d={`M${hx - 9} ${200} Q${hx} ${205} ${hx + 9} ${199}`} stroke="#b07f25" strokeWidth="2" fill="none" strokeLinecap="round" />
      <rect x={hx - 9} y={184} width="15" height="6" rx="3" fill="#f6ead2" stroke={O} strokeWidth="2.4" transform={`rotate(${dir * -20} ${hx} 187)`} />
    </g>
  )
}

const ARMS: Record<MoriMood, [number, number]> = {
  wave: [0, -118],
  cheer: [118, -118],
  stir: [-6, 18],
  worried: [-28, 28],
  sleep: [6, -6],
  happy: [0, 0],
  think: [0, -70],
}

/**
 * Mori — the rat chef. A flat, bold-outlined cartoon (no gradients or ids)
 * so he can sit on photoreal paper and survive DOM snapshots during page turns.
 */
export function Mori({ mood = 'happy', size = 120, className = '', style, label, animated = false }: MoriProps) {
  const [leftArm, rightArm] = ARMS[mood]
  const closedHappy = mood === 'cheer'
  const sleeping = mood === 'sleep'
  return (
    <svg
      viewBox="0 0 200 240"
      width={size}
      height={size * 1.2}
      className={`mm-mori ${className}`}
      data-mood={mood}
      data-animated={animated || undefined}
      focusable="false"
      style={style}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g className="mori-body-all">
        {/* tail */}
        <g className="mori-tail">
          <path d="M126 200 C160 204 180 188 175 165 C171 148 155 147 152 160" stroke={O} strokeWidth="10" fill="none" strokeLinecap="round" />
          <path d="M126 200 C160 204 180 188 175 165 C171 148 155 147 152 160" stroke={PINK} strokeWidth="4.5" fill="none" strokeLinecap="round" />
        </g>
        {/* feet */}
        <ellipse cx="84" cy="222" rx="13" ry="7" fill="#d2bcb1" stroke={O} strokeWidth="3.2" />
        <ellipse cx="116" cy="222" rx="13" ry="7" fill="#d2bcb1" stroke={O} strokeWidth="3.2" />
        {/* body */}
        <path d="M68 168 C64 200 74 222 100 222 C126 222 136 200 132 168 C128 150 72 150 68 168Z" fill={FUR} stroke={O} strokeWidth="3.5" />
        {/* apron */}
        <path d="M87 148 L80 138 M113 148 L120 138" stroke={O} strokeWidth="2.6" strokeLinecap="round" />
        <path d="M80 162 L120 162 C125 182 125 204 119 218 L81 218 C75 204 75 182 80 162Z" fill={APRON} stroke={O} strokeWidth="3.2" strokeLinejoin="round" />
        <rect x="87" y="147" width="26" height="19" rx="4" fill={APRON} stroke={O} strokeWidth="3" />
        <rect x="90" y="186" width="20" height="14" rx="3" fill={MITT} stroke={O} strokeWidth="2.6" />
        <path d="M80 172 C70 174 66 178 64 182" stroke="#7d2a39" strokeWidth="3" strokeLinecap="round" fill="none" />

        {mood === 'stir' && (
          <g>
            <g className="mori-steam" stroke="#f3eadb" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".9">
              <path d="M86 176 C82 168 90 164 86 156" />
              <path d="M100 174 C96 166 104 162 100 154" />
              <path d="M114 176 C110 168 118 164 114 156" />
            </g>
            <g className="mori-spoon">
              <path d="M142 150 L112 196" stroke={O} strokeWidth="8" strokeLinecap="round" />
              <path d="M142 150 L112 196" stroke="#c99a62" strokeWidth="4" strokeLinecap="round" />
            </g>
            <rect x="66" y="186" width="68" height="9" rx="4.5" fill="#5c463a" stroke={O} strokeWidth="3" />
            <path d="M70 194 L130 194 L126 224 C125 228 75 228 74 224Z" fill="#4a382a" stroke={O} strokeWidth="3.2" strokeLinejoin="round" />
            <path d="M80 204 L120 204" stroke="#6e5646" strokeWidth="2.5" strokeLinecap="round" />
          </g>
        )}

        <Arm side="l" angle={leftArm} />
        <Arm side="r" angle={rightArm} />

        {/* ears */}
        <g className="mori-ear-l">
          <circle cx="56" cy="84" r="24" fill={FUR} stroke={O} strokeWidth="3.5" />
          <circle cx="58" cy="86" r="14" fill={PINK} />
        </g>
        <g>
          <circle cx="144" cy="84" r="24" fill={FUR} stroke={O} strokeWidth="3.5" />
          <circle cx="142" cy="86" r="14" fill={PINK} />
        </g>
        {/* head */}
        <ellipse cx="100" cy="112" rx="46" ry="41" fill={FUR} stroke={O} strokeWidth="3.5" />
        <ellipse cx="100" cy="129" rx="25" ry="17" fill={FUR_LIGHT} />
        <ellipse cx="72" cy="125" rx="7" ry="4.5" fill="#e48f8d" opacity=".7" />
        <ellipse cx="128" cy="125" rx="7" ry="4.5" fill="#e48f8d" opacity=".7" />

        {/* eyes */}
        {closedHappy ? (
          <g stroke={O} strokeWidth="3.6" fill="none" strokeLinecap="round">
            <path d="M74 111 Q82 99 90 111" />
            <path d="M110 111 Q118 99 126 111" />
          </g>
        ) : sleeping ? (
          <g stroke={O} strokeWidth="3.4" fill="none" strokeLinecap="round">
            <path d="M74 108 Q82 114 90 108" />
            <path d="M110 108 Q118 114 126 108" />
          </g>
        ) : (
          <g className="mori-eyes">
            <ellipse cx="82" cy={mood === 'think' ? 105 : 108} rx="7.5" ry="10" fill={O} />
            <ellipse cx="118" cy={mood === 'think' ? 105 : 108} rx="7.5" ry="10" fill={O} />
            <circle cx="84.5" cy={mood === 'think' ? 100 : 103.5} r="2.9" fill="#fff" />
            <circle cx="120.5" cy={mood === 'think' ? 100 : 103.5} r="2.9" fill="#fff" />
            <circle cx="80" cy="112" r="1.3" fill="#fff" />
            <circle cx="116" cy="112" r="1.3" fill="#fff" />
          </g>
        )}
        {mood === 'worried' && (
          <g stroke={O} strokeWidth="3" strokeLinecap="round">
            <path d="M73 97 L88 92" />
            <path d="M127 97 L112 92" />
          </g>
        )}
        {/* whiskers */}
        <g stroke={O} strokeWidth="1.8" strokeLinecap="round" opacity=".75">
          <path d="M77 128 L55 123 M77 133 L56 137" />
          <path d="M123 128 L145 123 M123 133 L144 137" />
        </g>
        {/* nose + mouth */}
        <path d="M94 119 Q100 115 106 119 Q104 125 100 126 Q96 125 94 119Z" fill="#d9767d" stroke={O} strokeWidth="2.4" strokeLinejoin="round" />
        {mood === 'cheer' || mood === 'wave' ? (
          <path d="M91 132 Q100 147 109 132 Z" fill="#7a2e34" stroke={O} strokeWidth="2.6" strokeLinejoin="round" />
        ) : mood === 'worried' ? (
          <path d="M92 138 Q96 134 100 138 Q104 134 108 138" stroke={O} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        ) : sleeping ? (
          <ellipse cx="100" cy="135" rx="3" ry="2.6" fill="#7a2e34" />
        ) : (
          <path d="M92 132 Q96 137 100 132 Q104 137 108 132" stroke={O} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        )}

        {/* oversized chef's hat */}
        <g transform="rotate(-7 100 70)">
          <path
            d="M66 72 C48 60 52 28 76 30 C78 6 124 4 127 28 C150 24 156 58 134 72 Z"
            fill={HAT}
            stroke={O}
            strokeWidth="3.5"
            strokeLinejoin="round"
          />
          <path d="M88 66 C85 52 87 40 92 32 M110 66 C112 52 112 42 108 30" stroke="#d7cdbf" strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <rect x="63" y="64" width="74" height="20" rx="7" fill={HAT} stroke={O} strokeWidth="3.5" />
          <path d="M78 68 L78 80 M100 68 L100 80 M122 68 L122 80" stroke="#d7cdbf" strokeWidth="2" strokeLinecap="round" />
        </g>

        {mood === 'worried' && (
          <path className="mori-sweat" d="M146 96 C142 104 142 108 146 110 C150 108 150 104 146 96Z" fill="#a9cfe3" stroke={O} strokeWidth="2" />
        )}
        {mood === 'think' && (
          <g fill="#fbf8f1" stroke={O} strokeWidth="2.4">
            <circle cx="162" cy="58" r="4" />
            <circle cx="172" cy="44" r="6" />
            <circle cx="184" cy="26" r="9" />
          </g>
        )}
      </g>
      {sleeping && (
        <g className="mori-z" fill={O} fontFamily="Caveat, cursive" fontWeight="700">
          <text x="150" y="70" fontSize="24">z</text>
          <text x="164" y="52" fontSize="18">z</text>
        </g>
      )}
    </svg>
  )
}

/** Line-art emblem used for the debossed cover mark and the bookplate. */
export function MoriEmblem({ size = 64, className = '', color = 'currentColor' }: { size?: number; className?: string; color?: string }) {
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={className} aria-hidden="true">
      <g fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="50" cy="50" r="46" />
        <circle cx="50" cy="50" r="40.5" strokeWidth="1.4" />
        <circle cx="30" cy="52" r="10" />
        <circle cx="70" cy="52" r="10" />
        <path d="M30 64 C30 80 70 80 70 64 C70 52 30 52 30 64Z" />
        <path d="M35 44 C26 38 28 22 40 23 C41 12 59 11 61 22 C72 20 75 37 65 44 Z" />
        <path d="M35 44 L65 44" />
        <circle cx="43" cy="64" r="1.8" fill={color} />
        <circle cx="57" cy="64" r="1.8" fill={color} />
        <path d="M47 70 Q50 72 53 70" />
      </g>
    </svg>
  )
}
