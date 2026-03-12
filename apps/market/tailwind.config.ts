import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      maxWidth: {
        content: '1200px',
        reading: '800px',
      },
      colors: {
        surface: {
          DEFAULT: 'var(--surface)',
          elevated: 'var(--surface-elevated)',
        },
      },
    },
  },
};

export default config;
