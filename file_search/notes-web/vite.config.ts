import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 後端 API 埠——server/index.ts 也讀同一個環境變數，預設 8787。
const API_PORT = Number(process.env.API_PORT ?? 8787)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5273,
    // 開發時前端打 /api/... 由 Vite 轉發到 Fastify，省掉 CORS 設定。
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
})
