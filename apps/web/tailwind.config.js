/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#050B14',
        panel: '#0B1524',
        raised: '#101D2F',
        line: '#1E2A3B',
        fog: '#94A3B8',
        accent: '#4F46E5',
        mint: '#34D399',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 20px 60px -24px rgba(0, 0, 0, 0.7)',
      },
    },
  },
  plugins: [],
};
