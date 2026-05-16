import { readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, basename, extname, join, relative } from 'node:path';
import { getConfig } from '../config.js';
function getRoots() {
    return getConfig().allowedRoots.map((rootPath, index) => {
        const resolvedPath = resolve(rootPath);
        const parts = resolvedPath.split(/[\\/]/).filter(Boolean);
        return {
            id: String(index),
            name: parts[parts.length - 1] || resolvedPath,
            path: resolvedPath,
        };
    });
}
function getRootById(rootId) {
    const root = getRoots().find(item => item.id === rootId);
    if (!root)
        throw new Error('Invalid root');
    return root;
}
function isWithinRoot(rootPath, targetPath) {
    const rel = relative(rootPath, targetPath);
    return rel === '' || (!rel.startsWith('..') && !rel.includes(':'));
}
function safePath(rootId, requestedPath = '.') {
    const root = getRootById(rootId);
    const resolved = resolve(root.path, requestedPath);
    if (!isWithinRoot(root.path, resolved)) {
        throw new Error('Path outside root directory');
    }
    return resolved;
}
const LANGUAGE_MAP = {
    '.ts': 'typescript', '.tsx': 'tsx', '.js': 'javascript', '.jsx': 'jsx',
    '.vue': 'vue', '.json': 'json', '.md': 'markdown', '.html': 'html',
    '.css': 'css', '.scss': 'scss', '.less': 'less',
    '.py': 'python', '.rs': 'rust', '.go': 'go', '.java': 'java',
    '.sql': 'sql', '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml',
    '.sh': 'bash', '.bash': 'bash', '.toml': 'toml', '.txt': 'text',
    '.gitignore': 'gitignore', '.env': 'text',
};
const SENSITIVE_FILES = new Set(['.env', '.env.local', '.env.production', 'credentials.json', 'secrets.json']);
function detectLanguage(filename) {
    const ext = extname(filename).toLowerCase();
    if (LANGUAGE_MAP[ext])
        return LANGUAGE_MAP[ext];
    if (LANGUAGE_MAP[filename.toLowerCase()])
        return LANGUAGE_MAP[filename.toLowerCase()];
    return 'text';
}
export function listRoots() {
    return getRoots();
}
export function isAllowedProjectDir(projectDir) {
    const resolved = resolve(projectDir);
    return getRoots().some(root => isWithinRoot(root.path, resolved));
}
export function listDirectory(rootId, dirPath = '.') {
    const fullPath = safePath(rootId, dirPath);
    const entries = readdirSync(fullPath, { withFileTypes: true });
    return entries
        .filter(entry => !entry.name.startsWith('.') || entry.name === '.gitignore')
        .filter(entry => !SENSITIVE_FILES.has(entry.name))
        .map(entry => {
        const stat = statSync(join(fullPath, entry.name));
        const nextPath = dirPath === '.' ? entry.name : `${dirPath}/${entry.name}`;
        return {
            name: entry.name,
            path: nextPath,
            type: (entry.isDirectory() ? 'directory' : 'file'),
            size: entry.isFile() ? stat.size : undefined,
            modifiedAt: stat.mtime.toISOString(),
            selectable: entry.isDirectory(),
        };
    })
        .sort((a, b) => {
        if (a.type !== b.type)
            return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}
export function readFile(rootId, filePath) {
    const fullPath = safePath(rootId, filePath);
    const stat = statSync(fullPath);
    if (stat.size > 1024 * 1024) {
        throw new Error('File too large (>1MB)');
    }
    const content = readFileSync(fullPath, 'utf-8');
    return {
        path: filePath,
        content,
        language: detectLanguage(basename(filePath)),
        size: stat.size,
    };
}
//# sourceMappingURL=browser.js.map