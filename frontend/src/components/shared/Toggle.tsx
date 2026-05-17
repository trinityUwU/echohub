interface ToggleProps {
  on: boolean
  onChange: (v: boolean) => void
}

export function Toggle({ on, onChange }: ToggleProps): React.ReactElement {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative w-[30px] h-4 rounded-full cursor-pointer transition-colors duration-200 outline-none focus:outline-none ${
        on ? 'bg-accent' : 'bg-overlay'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform duration-200 ${
          on ? 'translate-x-[14px]' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
