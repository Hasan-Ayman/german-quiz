import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/german-quiz/',
  publicDir: false,
  build: { sourcemap: false, emptyOutDir: true },
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/data/**',
      '**/reports/**', '**/source-pdfs/**', '**/private/**', '**/backups/**', '**/tmp/**', '**/*.[pP][dD][fF]',
      '**/*personal-vocabulary*.json', '**/*complete-private*.json', '**/*private-vocabulary*.json',
      '**/*vocabulary-backup*.json', '**/*.backup.json',
      '**/study-private/**', '**/*-private*.json', '**/reviewed-*.json'] },
  },
  plugins: [react()],
})
