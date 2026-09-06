import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

export default defineConfig({
  plugins: [{name:'local-preview-boundary',configureServer(server) {
    server.middlewares.use((request,response,next) => {
      if (request.url?.startsWith('/__open-in-editor')) { response.statusCode=403; response.end(); return; }
      next();
    });
  }}, uni()],
  server: { host:'127.0.0.1', cors:false, fs:{strict:true} },
});
