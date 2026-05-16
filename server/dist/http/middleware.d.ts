import type { Request, Response, NextFunction } from 'express';
export interface AuthRequest extends Request {
    authToken?: string;
}
export declare function authMiddleware(req: AuthRequest, res: Response, next: NextFunction): void;
