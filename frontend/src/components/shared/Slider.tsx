interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  formatValue?: (v: number) => string
}

export function Slider({ label, value, min, max, step, onChange, formatValue }: SliderProps): React.ReactElement {
  const display = formatValue ? formatValue(value) : value.toFixed(step < 1 ? 2 : 0)

  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1.5 text-sm text-text-secondary">
        <span>{label}</span>
        <span className="text-xs text-text-muted font-mono">{display}</span>
      </div>
      <input
        type="range"
        min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
    </div>
  )
}
