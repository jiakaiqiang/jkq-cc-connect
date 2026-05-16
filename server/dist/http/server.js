import express from 'express';
import cors from 'cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import authRoutes from './auth.js';
import sessionsRoutes from './sessions.js';
import filesRoutes from './files.js';
import toolsRoutes from './tools.js';
const __dirname = dirname(fileURLToPath(import.meta.url));
// Express 在这里同时承担两件事：
// 1. 提供给 PWA / APK 调用的 REST API。
// 2. 当 client/dist 存在时，顺手把前端静态资源一起托管出来，形成单进程部署。
export function createApp() {
    const app = express();
    app.use(cors());
    app.use(express.json());
    // API 路由全部在这里挂载，方便快速看清后端暴露的入口。
    app.use(authRoutes);
    app.use(sessionsRoutes);
    app.use(filesRoutes);
    app.use(toolsRoutes);
    // 当项目已经构建过前端时，服务器会直接托管 dist 目录。
    // 这样浏览器访问 3000 端口就能同时拿到页面与 API，不需要额外的静态资源服务器。
    const clientDist = join(__dirname, '..', '..', '..', 'client', 'dist');
    if (existsSync(clientDist)) {
        app.use(express.static(clientDist));
        // Vue Router 使用前端路由，所以未知路径也要回落到 index.html，
        // 交给前端自己判断当前应该展示哪个页面。
        app.get('*', (_req, res) => {
            res.sendFile(join(clientDist, 'index.html'));
        });
    }
    return app;
}
//# sourceMappingURL=server.js.map