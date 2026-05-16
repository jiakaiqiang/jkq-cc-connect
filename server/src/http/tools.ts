import { Router } from 'express'
import { authMiddleware } from './middleware.js'
import { getVibeTools } from '../tools/vibe.js'

const router = Router()

router.get('/api/vibe-tools', authMiddleware, (_req, res) => {
  try {
    res.json({ success: true, data: getVibeTools() })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to inspect vibe tools' })
  }
})

export default router
