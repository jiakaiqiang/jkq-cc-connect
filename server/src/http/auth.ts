import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { getDb } from '../store/database.js'
import { getConfig, updateConfig } from '../config.js'
import { authMiddleware, type AuthRequest } from './middleware.js'
import { randomBytes } from 'node:crypto'
import { logger } from '../utils/logger.js'

const router = Router()

export function ensurePassword(): string | null {
  const config = getConfig()
  if (config.passwordHash) return null

  // Generate random password on first run
  const password = randomBytes(8).toString('hex')
  const hash = bcrypt.hashSync(password, 10)
  updateConfig({ passwordHash: hash })
  logger.info(`Initial password generated: ${password}`)
  return password
}

router.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      serverTime: new Date().toISOString(),
    },
  })
})

// POST /api/auth - Login
router.post('/api/auth', (req, res) => {
  try {
    const { password } = req.body
    if (!password) {
      res.status(400).json({ success: false, error: 'Password required' })
      return
    }

    const config = getConfig()
    if (!config.passwordHash) {
      res.status(500).json({ success: false, error: 'Server not initialized' })
      return
    }

    if (!bcrypt.compareSync(password, config.passwordHash)) {
      res.status(401).json({ success: false, error: 'Invalid password' })
      return
    }

    const token = jwt.sign({}, config.jwtSecret, { expiresIn: '7d' })
    res.json({ success: true, data: { token } })
  } catch (err) {
    logger.error('Auth error:', err)
    res.status(500).json({ success: false, error: 'Internal error' })
  }
})

router.get('/api/settings', authMiddleware, (_req, res) => {
  const config = getConfig()
  res.json({ success: true, data: { allowedRoots: config.allowedRoots } })
})

router.put('/api/settings', authMiddleware, (req: AuthRequest, res) => {
  try {
    const { allowedRoots } = req.body as { allowedRoots?: string[] }
    if (!Array.isArray(allowedRoots) || allowedRoots.length === 0) {
      res.status(400).json({ success: false, error: 'allowedRoots required' })
      return
    }
    const normalized = allowedRoots
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean)
    if (normalized.length === 0) {
      res.status(400).json({ success: false, error: 'allowedRoots required' })
      return
    }
    updateConfig({ allowedRoots: normalized })
    res.json({ success: true, data: { allowedRoots: normalized } })
  } catch (err) {
    logger.error('Settings update error:', err)
    res.status(500).json({ success: false, error: 'Internal error' })
  }
})

// PUT /api/auth/password - Change password
router.put('/api/auth/password', authMiddleware, (req: AuthRequest, res) => {
  try {
    const { newPassword } = req.body
    if (!newPassword || newPassword.length < 4) {
      res.status(400).json({ success: false, error: 'Password too short (min 4 chars)' })
      return
    }
    const hash = bcrypt.hashSync(newPassword, 10)
    updateConfig({ passwordHash: hash })
    logger.info('Password changed')
    res.json({ success: true })
  } catch (err) {
    logger.error('Password change error:', err)
    res.status(500).json({ success: false, error: 'Internal error' })
  }
})

export default router
