/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'surface-0': '#07090f',
        'surface-1': '#0d1117',
        'surface-2': '#121820',
        'surface-3': '#1a2130',
        'surface-4': '#212c3d',
        'accent': '#4A9EBF',
        'accent-dim': '#3A7A96',
        'accent-muted': '#2A5A70',
        'muted': 'rgba(255,255,255,0.35)',
        'border': 'rgba(255,255,255,0.07)',
      },
      boxShadow: {
        'echo': '0 0 0 1px rgba(74,158,191,0.30), 0 0 20px rgba(74,158,191,0.08)',
        'echo-strong': '0 0 0 1px rgba(74,158,191,0.50), 0 0 30px rgba(74,158,191,0.15)',
        'glass': '0 4px 24px rgba(0,0,0,0.40), 0 1px 0 rgba(255,255,255,0.04) inset',
        'modal': '0 24px 80px rgba(0,0,0,0.70), 0 1px 0 rgba(255,255,255,0.06) inset',
        'panel': '0 2px 12px rgba(0,0,0,0.30)',
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', { lineHeight: '1.4' }],
        'xs':  ['12px', { lineHeight: '1.5' }],
        'sm':  ['13px', { lineHeight: '1.6' }],
        'base':['14px', { lineHeight: '1.6' }],
        'md':  ['15px', { lineHeight: '1.5' }],
      },
      borderRadius: {
        'sm': '4px',
        DEFAULT: '6px',
        'md': '8px',
        'lg': '10px',
        'xl': '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
      keyframes: {
        'echo-ripple': {
          '0%':   { transform: 'scale(0.95)', opacity: '0' },
          '50%':  { transform: 'scale(1.02)', opacity: '1' },
          '100%': { transform: 'scale(1)',    opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(74,158,191,0)' },
          '50%':      { boxShadow: '0 0 0 4px rgba(74,158,191,0.15)' },
        },
      },
      animation: {
        'echo-ripple': 'echo-ripple 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'fade-in': 'fade-in 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
