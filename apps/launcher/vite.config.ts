import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    port: 4200,
    strictPort: true,
  },
  clearScreen: false,
  // Tauri expects a fixed port; fail if 4200 is taken
  envPrefix: ['VITE_', 'TAURI_'],
});
