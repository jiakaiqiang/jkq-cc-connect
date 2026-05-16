import jwt from 'jsonwebtoken';
import { getConfig } from '../config.js';
export function authMiddleware(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ success: false, error: 'Missing token' });
        return;
    }
    try {
        const token = header.slice(7);
        jwt.verify(token, getConfig().jwtSecret);
        req.authToken = token;
        next();
    }
    catch {
        res.status(401).json({ success: false, error: 'Invalid token' });
    }
}
//# sourceMappingURL=middleware.js.map