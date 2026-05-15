interface Props {
  vramEstimateGb: number
  vramFreeGb: number
  paramsBillion: number | null
}

export function VramBadge({ vramEstimateGb, vramFreeGb, paramsBillion }: Props) {
  const pct = vramFreeGb > 0 ? (vramEstimateGb / vramFreeGb) * 100 : 999

  let color: string
  let label: string

  if (pct <= 75) {
    color = 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
    label = `~${Math.round(pct)}%`
  } else if (pct <= 95) {
    color = 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'
    label = `~${Math.round(pct)}%`
  } else if (pct <= 115) {
    color = 'bg-orange-500/20 text-orange-300 border-orange-500/30'
    label = `~${Math.round(pct)}% tight`
  } else {
    color = 'bg-red-500/20 text-red-400 border-red-500/30'
    label = `~${Math.round(pct)}% OOM`
  }

  const title = paramsBillion
    ? `${paramsBillion}B params · ~${vramEstimateGb} GB VRAM needed · ${vramFreeGb.toFixed(1)} GB free`
    : `~${vramEstimateGb} GB VRAM needed`

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded border font-mono ${color}`}
      title={title}
    >
      {paramsBillion ? `${paramsBillion}B · ` : ''}{label}
    </span>
  )
}
