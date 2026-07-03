import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// OFFLINE=1 时打成单文件 HTML（JS/CSS 全内联），双击 file:// 直接可演——
// 规格要求「全程可离线（陌拜现场没网也能演）」的交付形态
const offline = process.env.OFFLINE === '1';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), ...(offline ? [viteSingleFile()] : [])],
});
