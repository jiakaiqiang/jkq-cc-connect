import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getConfig } from '../config.js'

export interface AuthRequest extends Request {
  authToken?: string
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Missing token' })
    return
  }
  try {
    const token = header.slice(7)
    jwt.verify(token, getConfig().jwtSecret)
    req.authToken = token
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}
