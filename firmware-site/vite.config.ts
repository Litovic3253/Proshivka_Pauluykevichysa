/// <reference types="vitest/config" />
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  // 127.0.0.1, а не localhost: Node может слушать только IPv6 [::1], и браузер не достучится
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // esptool-js — ESM без "type": "module"; пусть Vite преобразует его для Node
    server: { deps: { inline: ['esptool-js'] } },
  },
})
