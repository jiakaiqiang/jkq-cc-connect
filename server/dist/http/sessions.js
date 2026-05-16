import { Router } from 'express';
import { authMiddleware } from './middleware.js';
import { listSessions, getConversationState, getSession, createSession, archiveSession, deleteSession } from '../store/sessions.js';
import { DEFAULT_MESSAGE_WINDOW, getMessagesBefore, getRecentMessagesWindow } from '../store/messages.js';
import { isAllowedProjectDir } from '../fs/browser.js';
const router = Router();
router.post('/api/sessions', authMiddleware, (req, res) => {
    try {
        const { name, projectDir } = req.body;
        if (!projectDir) {
            res.status(400).json({ success: false, error: 'projectDir required' });
            return;
        }
        if (!isAllowedProjectDir(projectDir)) {
            res.status(403).json({ success: false, error: 'Access denied' });
            return;
        }
        const session = createSession({ name, projectDir });
        res.json({ success: true, data: session });
    }
    catch {
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});
// GET /api/sessions
router.get('/api/sessions', authMiddleware, (_req, res) => {
    try {
        const sessions = listSessions();
        res.json({ success: true, data: sessions });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});
// GET /api/sessions/:id
router.get('/api/sessions/:id', authMiddleware, (req, res) => {
    try {
        const session = getSession(req.params.id);
        if (!session) {
            res.status(404).json({ success: false, error: 'Session not found' });
            return;
        }
        const page = getRecentMessagesWindow(session.id);
        res.json({ success: true, data: { session, ...page } });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});
// GET /api/sessions/:id/messages?beforeSeq=123&limit=40
router.get('/api/sessions/:id/messages', authMiddleware, (req, res) => {
    try {
        const session = getSession(req.params.id);
        if (!session) {
            res.status(404).json({ success: false, error: 'Session not found' });
            return;
        }
        const beforeSeq = Number(req.query.beforeSeq);
        if (!Number.isFinite(beforeSeq)) {
            res.status(400).json({ success: false, error: 'beforeSeq required' });
            return;
        }
        const requestedLimit = Number(req.query.limit);
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(Math.max(requestedLimit, 1), DEFAULT_MESSAGE_WINDOW)
            : 40;
        const page = getMessagesBefore(session.id, beforeSeq, limit);
        res.json({ success: true, data: page });
    }
    catch (err) {
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});
// GET /api/sessions/:id/memory
router.get('/api/sessions/:id/memory', authMiddleware, (req, res) => {
    try {
        const session = getSession(req.params.id);
        if (!session) {
            res.status(404).json({ success: false, error: 'Session not found' });
            return;
        }
        const memory = getConversationState(session.id);
        res.json({ success: true, data: memory });
    }
    catch {
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});
// PATCH /api/sessions/:id/archive
router.patch('/api/sessions/:id/archive', authMiddleware, (req, res) => {
    try {
        const session = getSession(req.params.id);
        if (!session) {
            res.status(404).json({ success: false, error: 'Session not found' });
            return;
        }
        archiveSession(session.id);
        const archived = getSession(session.id);
        res.json({ success: true, data: archived });
    }
    catch {
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});
// DELETE /api/sessions/:id
router.delete('/api/sessions/:id', authMiddleware, (req, res) => {
    try {
        const session = getSession(req.params.id);
        if (!session) {
            res.status(404).json({ success: false, error: 'Session not found' });
            return;
        }
        deleteSession(session.id);
        res.json({ success: true, data: { id: session.id } });
    }
    catch {
        res.status(500).json({ success: false, error: 'Internal error' });
    }
});
export default router;
//# sourceMappingURL=sessions.js.map