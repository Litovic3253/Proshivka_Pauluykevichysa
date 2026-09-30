/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // esptool-js — ESM без "type": "module"; пусть Vite преобразует его для Node
    server: { deps: { inline: ['esptool-js'] } },
  },
})
