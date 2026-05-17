/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        base:     '#111113',
        surface:  '#18181b',
        elevated: '#1e1e22',
        overlay:  '#26262c',
        accent:   '#7c6aff',
        'accent-hover': '#9584ff',
        'accent-dim':   'rgba(124,106,255,0.15)',
        green:    '#3dba72',
        yellow:   '#e8b84b',
        red:      '#e05252',
        blue:     '#4a9eff',
        border:          'rgba(255,255,255,0.07)',
        'border-hover':  'rgba(255,255,255,0.14)',
        'text-primary':   '#f0f0f0',
        'text-secondary': '#8b8b9a',
        'text-muted':     '#50505f',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px',  { lineHeight: '1.4' }],
        'xs':  ['11px',  { lineHeight: '1.4' }],
        'sm':  ['12px',  { lineHeight: '1.5' }],
        'base':['13px',  { lineHeight: '1.6' }],
        'md':  ['13.5px',{ lineHeight: '1.65' }],
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '14px',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in-right': {
          from: { opacity: '0', transform: 'translateX(10px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        'blink': {
          '0%,100%': { opacity: '1' },
          '50%':     { opacity: '0' },
        },
        'load-progress': {
          '0%':   { width: '0%' },
          '20%':  { width: '25%' },
          '50%':  { width: '55%' },
          '80%':  { width: '78%' },
          '100%': { width: '88%' },
        },
      },
      animation: {
        'fade-in':         'fade-in 0.15s cubic-bezier(0.16,1,0.3,1)',
        'slide-up':        'slide-up 0.2s cubic-bezier(0.16,1,0.3,1)',
        'slide-in-right':  'slide-in-right 0.2s cubic-bezier(0.16,1,0.3,1)',
        'blink':         'blink 1s infinite',
        'load-progress': 'load-progress 6s ease-out forwards',
      },
    },
  },
  plugins: [],
}
