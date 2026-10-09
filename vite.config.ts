import { defineConfig } from 'vite';
export default defineConfig({ base: './',build:{rollupOptions:{input:{main:'index.html',speech:'speech.html',score:'score.html'}}} });
