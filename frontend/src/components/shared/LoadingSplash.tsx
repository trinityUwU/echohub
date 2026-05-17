export function LoadingSplash(): React.ReactElement {
  return (
    <div className="h-screen bg-base flex flex-col items-center justify-center gap-4 select-none">
      <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
        <svg className="w-5 h-5" viewBox="0 0 20 20" fill="none">
          <path d="M3 10 C3 5.5 6.5 2 11 2 s8 3.5 8 8 -3.5 8-8 8" stroke="white" strokeWidth="2" strokeLinecap="round"/>
          <circle cx="7" cy="10" r="1" fill="white"/>
          <circle cx="11" cy="10" r="1" fill="white"/>
          <circle cx="15" cy="10" r="1" fill="white"/>
        </svg>
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-accent/40 animate-pulse"
            style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  )
}
