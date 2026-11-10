import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/german-quiz/',
  publicDir: false,
  build: { sourcemap: false, emptyOutDir: true },
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**',
      '**/reports/**', '**/source-pdfs/**', '**/*personal-vocabulary*.json'] },
  },
  plugins: [react()],
})
