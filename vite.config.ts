import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  // 相对基址：GitHub Pages 无论挂在用户名根域（user.github.io）还是项目子路径（user.github.io/repo）
  // 都能正确加载资源，避免默认 '/' 在子路径下 404。
  base: './',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
  server: {
    // 固定地址：URL 永远是 http://127.0.0.1:5173/（可安全加书签）
    //  - host 显式写 127.0.0.1：避免只绑 IPv6 [::1] 导致 127.0.0.1 打不开
    //  - strictPort：端口被占用时**直接报错**，而不是静默换到 5174（否则书签失效、易误开旧服务）
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  preview: {
    // 冻结快照（dist/）的固定地址：http://127.0.0.1:4173/
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
});
