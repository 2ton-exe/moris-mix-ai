import { ScrapbookSticker } from './ScrapbookSticker'
// Original decorative SVG stationery from the verified Figma Make desk scene.
export function DeskStationery() {
  return (
    <div aria-hidden="true">
      <svg className="mm-stationery mm-stationery--pencil" viewBox="0 0 430 26">
        <polygon points="0,13 26,4 26,22" fill="#e8c9a0" />
        <polygon points="0,13 9,10 9,16" fill="#3a3330" />
        <rect x="26" y="4" width="320" height="6" fill="#6f8360" />
        <rect x="26" y="10" width="320" height="6" fill="#596a4b" />
        <rect x="26" y="16" width="320" height="6" fill="#46543c" />
        <rect x="346" y="3" width="34" height="20" fill="#c9a24f" />
        <path d="M352 3v20M358 3v20M364 3v20M370 3v20" stroke="#8b6a2b" strokeWidth="1.5" />
        <rect x="380" y="3.5" width="40" height="19" rx="6" fill="#d98a8a" />
        <text x="120" y="17" fontSize="9" fill="#e9d9a8" fontFamily="Figtree, sans-serif" letterSpacing="2">HB · MORI&apos;S MIX</text>
      </svg>
      <svg className="mm-stationery mm-stationery--clips" viewBox="0 0 120 80">
        {[
          [10, 6, -18],
          [56, 22, 24],
        ].map(([x, y, r], i) => (
          <g key={i} transform={`translate(${x} ${y}) rotate(${r} 18 24)`}>
            <path d="M10 14 V38 a5 5 0 0 0 10 0 V8 a8 8 0 0 0 -16 0 V40 a10 10 0 0 0 20 0 V18" fill="none" stroke="#9a7a3a" strokeWidth="3.2" strokeLinecap="round" />
            <path d="M10 14 V38 a5 5 0 0 0 10 0 V8 a8 8 0 0 0 -16 0 V40 a10 10 0 0 0 20 0 V18" fill="none" stroke="#f1dc9e" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        ))}
      </svg>
      <svg className="mm-stationery mm-stationery--tape" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r="60" fill="#a9b896" />
        <circle cx="64" cy="64" r="60" fill="none" stroke="#8c9e78" strokeWidth="2" />
        {Array.from({ length: 24 }).map((_, i) => {
          const a = (i / 24) * Math.PI * 2
          return <circle key={i} cx={64 + Math.cos(a) * 46} cy={64 + Math.sin(a) * 46} r="3" fill="#f4efe2" opacity=".75" />
        })}
        <circle cx="64" cy="64" r="34" fill="#e9dcc0" />
        <circle cx="64" cy="64" r="28" fill="#a07850" />
        <circle cx="64" cy="64" r="28" fill="none" stroke="#6b4a2c" strokeWidth="2" opacity=".5" />
      </svg>
      <ScrapbookSticker decorative name="herb-sprig" className="mm-stationery mm-stationery--sprig" />
      <svg className="mm-stationery mm-stationery--ring-stain" viewBox="0 0 150 150">
        <circle cx="75" cy="75" r="56" fill="none" stroke="#5a3519" strokeWidth="5" opacity=".18" />
        <circle cx="75" cy="75" r="52" fill="none" stroke="#5a3519" strokeWidth="1.5" opacity=".14" strokeDasharray="60 12 30 8" />
      </svg>
    </div>
  )
}
