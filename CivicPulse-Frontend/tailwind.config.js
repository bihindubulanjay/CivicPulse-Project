/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glass: '0 8px 32px rgba(15, 23, 42, 0.07), 0 1px 3px rgba(15, 23, 42, 0.05)',
        elevated: '0 20px 50px rgba(15, 23, 42, 0.14), 0 4px 14px rgba(15, 23, 42, 0.06)',
      },
    },
  },
  plugins: [],
};
