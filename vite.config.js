import {defineConfig} from 'vite'
import {svelte} from '@sveltejs/vite-plugin-svelte'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [svelte()],
  base: '/ordinal/',
  build: {
    outDir: '../src/rhode/ordinal-static',
    emptyOutDir: true,
  },
})
