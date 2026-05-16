import { getRecentMessagesWindow } from './messages.js';
import { getConversationState, upsertConversationState } from './sessions.js';
function compactText(text, maxLength = 160) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized)
        return '';
    if (normalized.length <= maxLength)
        return normalized;
    return `${normalized.slice(0, maxLength).trimEnd()}...`;
}
function uniqueStrings(items, limit = 8) {
    const seen = new Set();
    const result = [];
    for (const item of items) {
        const value = compactText(item || '', 140);
        if (!value || seen.has(value))
            continue;
        seen.add(value);
        result.push(value);
        if (result.length >= limit)
            break;
    }
    return result;
}
function toolLabel(tool) {
    switch (tool) {
        case 'claude':
            return 'Claude';
        case 'codex':
            return 'Codex';
        case 'opencode':
            return 'OpenCode';
        default:
            return '';
    }
}
function collectStrings(value, bucket) {
    if (!value)
        return;
    if (typeof value === 'string') {
        bucket.push(value);
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value)
            collectStrings(item, bucket);
        return;
    }
    if (typeof value === 'object') {
        for (const nested of Object.values(value)) {
            collectStrings(nested, bucket);
        }
    }
}
function extractFileCandidatesFromText(text) {
    const matches = text.match(/(?:[A-Za-z]:[\\/]|\.{0,2}[\\/])?[\w.-]+(?:[\\/][\w.-]+)+\.[A-Za-z0-9]+/g) || [];
    return matches
        .map(item => item.replace(/^[ab]\//, '').replace(/\\/g, '/'))
        .filter(item => item.length <= 160);
}
function extractTouchedFiles(messages, state) {
    const candidates = [...state.touchedFiles];
    for (const message of messages) {
        candidates.push(...extractFileCandidatesFromText(message.content));
        if (message.type === 'tool_use') {
            collectStrings(message.metadata.toolInput, candidates);
        }
    }
    return uniqueStrings(candidates, 8);
}
function extractOpenQuestions(messages, state) {
    const candidates = [...state.openQuestions];
    for (const message of messages) {
        if (message.type !== 'user')
            continue;
        const trimmed = compactText(message.content, 140);
        if (!trimmed)
            continue;
        if (/[?？]$/.test(trimmed) || /(待确认|待处理|todo|下一步|如何|怎么)/i.test(trimmed)) {
            candidates.push(trimmed);
        }
    }
    return uniqueStrings(candidates, 6);
}
function extractRecentDecisions(messages, state) {
    const candidates = [...state.recentDecisions];
    for (const message of messages) {
        if (message.type !== 'text' && message.type !== 'code' && message.type !== 'diff' && message.type !== 'tool_result') {
            continue;
        }
        const trimmed = compactText(message.content, 140);
        if (!trimmed)
            continue;
        if (/(已|已经|改了|修改了|刚刚改了|改成|完成|采用|切换到|新增|修复|处理了|落地)/.test(trimmed)) {
            candidates.push(trimmed);
        }
    }
    return uniqueStrings(candidates, 6);
}
function buildWorkingMemory(state, touchedFiles, openQuestions, recentDecisions) {
    const parts = [];
    if (state.currentGoal) {
        parts.push(`当前任务：${compactText(state.currentGoal, 120)}`);
    }
    if (recentDecisions.length) {
        parts.push(`近期决策：${recentDecisions.slice(0, 3).join('；')}`);
    }
    if (touchedFiles.length) {
        parts.push(`当前涉及文件：${touchedFiles.slice(0, 5).join('、')}`);
    }
    if (openQuestions.length) {
        parts.push(`待处理问题：${openQuestions.slice(0, 3).join('；')}`);
    }
    if (!parts.length)
        return state.workingMemory;
    return parts.join('；');
}
function buildCanonicalSummary(messages, state, touchedFiles) {
    const latestUser = [...messages].reverse().find(message => message.type === 'user');
    const latestAssistant = [...messages].reverse().find(message => (message.type === 'text'
        || message.type === 'code'
        || message.type === 'diff'
        || message.type === 'tool_result'));
    const parts = [];
    if (state.currentGoal) {
        parts.push(`当前目标：${compactText(state.currentGoal, 120)}`);
    }
    if (state.lastSuccessfulTool) {
        parts.push(`最近成功工具：${toolLabel(state.lastSuccessfulTool)}`);
    }
    if (touchedFiles.length) {
        parts.push(`已改文件：${touchedFiles.slice(0, 4).join('、')}`);
    }
    if (latestUser) {
        parts.push(`最近用户请求：${compactText(latestUser.content, 120)}`);
    }
    if (latestAssistant) {
        parts.push(`最近进展：${compactText(latestAssistant.content, 160)}`);
    }
    if (!parts.length)
        return state.canonicalSummary;
    return parts.join('；');
}
export function summarizeConversationState(messages, state) {
    const touchedFiles = extractTouchedFiles(messages, state);
    const openQuestions = extractOpenQuestions(messages, state);
    const recentDecisions = extractRecentDecisions(messages, state);
    const workingMemory = buildWorkingMemory(state, touchedFiles, openQuestions, recentDecisions);
    const canonicalSummary = buildCanonicalSummary(messages, state, touchedFiles);
    const lastSummarizedSeq = messages[messages.length - 1]?.seq ?? state.lastSummarizedSeq;
    return {
        canonicalSummary,
        workingMemory,
        touchedFiles,
        openQuestions,
        recentDecisions,
        lastSummarizedSeq,
    };
}
export function refreshConversationStateFromRecentHistory(sessionId, database) {
    const currentState = getConversationState(sessionId, database);
    const page = getRecentMessagesWindow(sessionId, 24, database);
    const patch = summarizeConversationState(page.messages, currentState);
    return upsertConversationState(sessionId, patch, database);
}
//# sourceMappingURL=conversation.js.map