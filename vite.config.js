
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// GitHub Pages configuration
export default defineConfig({
  plugins: [react()],
  base: '/mumbai-urban-heat/',
})
