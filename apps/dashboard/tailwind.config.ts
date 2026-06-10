import type { Config } from 'tailwindcss';

// Tailwind config including Tremor's class surface so its components style
// correctly. The dashboard renders exclusively in dark mode ("cost console"
// aesthetic): carbon surfaces, terminal-amber brand accent, mono numerals.
const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './node_modules/@tremor/**/*.{js,ts,jsx,tsx,mjs}',
  ],
  theme: {
    transparent: 'transparent',
    current: 'currentColor',
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        display: ['var(--font-display)', 'var(--font-sans)', 'sans-serif'],
      },
      colors: {
        // CostObs console palette
        carbon: {
          950: '#07090B',
          900: '#0B0D10',
          850: '#11151A',
          800: '#161B21',
          700: '#1E252D',
          600: '#232B33',
        },
        ember: {
          DEFAULT: '#FFB224',
          bright: '#FFC95C',
          dim: '#8A6210',
          faint: '#231B0A',
        },
        // Tremor light theme tokens (unused at runtime; kept for safety)
        tremor: {
          brand: {
            faint: '#fffbeb',
            muted: '#fde68a',
            subtle: '#fbbf24',
            DEFAULT: '#d97706',
            emphasis: '#b45309',
            inverted: '#ffffff',
          },
          background: {
            muted: '#f9fafb',
            subtle: '#f3f4f6',
            DEFAULT: '#ffffff',
            emphasis: '#374151',
          },
          border: { DEFAULT: '#e5e7eb' },
          ring: { DEFAULT: '#e5e7eb' },
          content: {
            subtle: '#9ca3af',
            DEFAULT: '#6b7280',
            emphasis: '#374151',
            strong: '#111827',
            inverted: '#ffffff',
          },
        },
        'dark-tremor': {
          brand: {
            faint: '#231B0A',
            muted: '#3A2D10',
            subtle: '#8A6210',
            DEFAULT: '#FFB224',
            emphasis: '#FFC95C',
            inverted: '#0B0D10',
          },
          background: {
            muted: '#0B0D10',
            subtle: '#1E252D',
            DEFAULT: '#11151A',
            emphasis: '#C9D4DE',
          },
          border: { DEFAULT: '#232B33' },
          ring: { DEFAULT: '#232B33' },
          content: {
            subtle: '#5C6975',
            DEFAULT: '#9AA7B4',
            emphasis: '#C9D4DE',
            strong: '#E8EDF2',
            inverted: '#0B0D10',
          },
        },
      },
      boxShadow: {
        'tremor-input': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
        'tremor-card': '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
        'tremor-dropdown': '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
        'dark-tremor-input': '0 1px 2px 0 rgb(0 0 0 / 0.4)',
        'dark-tremor-card': '0 1px 2px 0 rgb(0 0 0 / 0.45)',
        'dark-tremor-dropdown': '0 10px 24px -6px rgb(0 0 0 / 0.65)',
        glow: '0 0 24px -6px rgb(255 178 36 / 0.35)',
      },
      borderRadius: {
        'tremor-small': '0.25rem',
        'tremor-default': '0.375rem',
        'tremor-full': '9999px',
      },
      fontSize: {
        'tremor-label': ['0.75rem', { lineHeight: '1rem' }],
        'tremor-default': ['0.875rem', { lineHeight: '1.25rem' }],
        'tremor-title': ['1.125rem', { lineHeight: '1.75rem' }],
        'tremor-metric': ['1.875rem', { lineHeight: '2.25rem' }],
      },
    },
  },
  safelist: [
    {
      pattern:
        /^(bg-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ['hover', 'ui-selected'],
    },
    {
      pattern:
        /^(text-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ['hover', 'ui-selected'],
    },
    {
      pattern:
        /^(border-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
      variants: ['hover', 'ui-selected'],
    },
    {
      pattern:
        /^(ring-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(stroke-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
    {
      pattern:
        /^(fill-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950))$/,
    },
  ],
  plugins: [],
};

export default config;
