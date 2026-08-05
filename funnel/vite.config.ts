import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// DEMO=1：数据层换成浏览器 localStorage 实现，并打成单文件 HTML（体验/分发用）
const demo = process.env.DEMO === '1';

export default defineConfig({
  base: './',
  define: {
    'import.meta.env.VITE_DEMO': JSON.stringify(demo),
  },
  plugins: [react(), tailwindcss(), ...(demo ? [viteSingleFile()] : [])],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
});
