import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 後端 API 埠——server/index.ts 也讀同一個環境變數，預設 8788（比便利貼版 +1，
// 兩個 app 可以同時開）。
const API_PORT = Number(process.env.API_PORT ?? 8788)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5274,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
})
