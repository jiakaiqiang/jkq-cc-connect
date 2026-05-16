import { Router } from 'express'
import { authMiddleware } from './middleware.js'
import { listDirectory, listRoots, readFile } from '../fs/browser.js'
import { logger } from '../utils/logger.js'

const router = Router()

router.get('/api/file-roots', authMiddleware, (_req, res) => {
  try {
    res.json({ success: true, data: listRoots() })
  } catch (err) {
    logger.error('File roots error:', err)
    res.status(500).json({ success: false, error: 'Failed to list roots' })
  }
})

router.get('/api/files', authMiddleware, (req, res) => {
  try {
    const rootId = req.query.rootId as string
    const dirPath = (req.query.path as string) || '.'
    if (!rootId) {
      res.status(400).json({ success: false, error: 'rootId required' })
      return
    }
    const entries = listDirectory(rootId, dirPath)
    res.json({ success: true, data: entries })
  } catch (err: any) {
    if (err.message?.includes('outside root') || err.message?.includes('Invalid root')) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }
    logger.error('File list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list directory' })
  }
})

router.get('/api/files/content', authMiddleware, (req, res) => {
  try {
    const rootId = req.query.rootId as string
    const filePath = req.query.path as string
    if (!rootId) {
      res.status(400).json({ success: false, error: 'rootId required' })
      return
    }
    if (!filePath) {
      res.status(400).json({ success: false, error: 'Path required' })
      return
    }
    const result = readFile(rootId, filePath)
    res.json({ success: true, data: result })
  } catch (err: any) {
    if (err.message?.includes('outside root') || err.message?.includes('Invalid root')) {
      res.status(403).json({ success: false, error: 'Access denied' })
      return
    }
    if (err.code === 'ENOENT') {
      res.status(404).json({ success: false, error: 'File not found' })
      return
    }
    if (err.message?.includes('too large')) {
      res.status(400).json({ success: false, error: err.message })
      return
    }
    logger.error('File read error:', err)
    res.status(500).json({ success: false, error: 'Failed to read file' })
  }
})

export default router
