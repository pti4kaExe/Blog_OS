import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/* base по умолчанию — корень: так ждут Vercel и локальный dev-сервер.
   GitHub Pages отдаёт проектный сайт из подпути /<репозиторий>/, поэтому
   workflow деплоя передаёт VITE_BASE='/Blog_OS/' только для той сборки —
   остальные сборки этот путь не видят и не меняются. */
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
  server: { port: 5173 },
})
