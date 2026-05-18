import { spawn, execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { CCOutputParser } from './parser.js';
import { logger } from '../utils/logger.js';
// Windows 下 Claude/Codex/OpenCode 的入口并不总是可直接执行的 exe，
// 有时只是一个 shim 或 ps1 包装脚本，所以这里会尽量解析出真实入口。
function findClaudeExe() {
    if (process.platform !== 'win32')
        return 'claude';
    try {
        const lines = execSync('where claude', { encoding: 'utf8' }).trim().split('\n');
        for (const loc of lines) {
            const dir = dirname(loc);
            const exe = join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe');
            if (existsSync(exe))
                return exe;
        }
    }
    catch { /* ignore */ }
    return 'claude.exe';
}
const CLAUDE_EXE = findClaudeExe();
function findCodexScript() {
    if (process.platform !== 'win32')
        return 'codex';
    try {
        return execSync('(Get-Command codex).Source', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            shell: 'powershell.exe',
        }).trim() || 'codex';
    }
    catch {
        return 'codex';
    }
}
const CODEX_ENTRY = findCodexScript();
function findOpenCodeScript() {
    if (process.platform !== 'win32')
        return 'opencode';
    try {
        return execSync('(Get-Command opencode).Source', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            shell: 'powershell.exe',
        }).trim() || 'opencode';
    }
    catch {
        return 'opencode';
    }
}
const OPENCODE_ENTRY = findOpenCodeScript();
const TOOL_RESPONSE_TIMEOUT_MS = 20_000;
// 失败分类的目标不是“精确诊断所有错误”，
// 而是给上层路由一个足够可靠的恢复信号：
// 例如 auth/model/network 失败时，可以尝试切换到别的工具继续执行。
function classifyFailure(rawMessage) {
    const message = rawMessage.toLowerCase();
    if (/(401|403|unauthorized|forbidden|invalid api key|authentication|auth failed|login required|not logged in|access token)/.test(message)) {
        return { failureKind: 'auth', recoverable: true };
    }
    if (/(model|provider|not available|unsupported|no such model|does not exist|overloaded|capacity|rate limit|quota)/.test(message)) {
        return { failureKind: 'model', recoverable: true };
    }
    if (/(timeout|timed out|network|fetch failed|econn|enotfound|connection|socket|tls|dns|temporar)/.test(message)) {
        return { failureKind: 'network', recoverable: true };
    }
    if (/(spawn|enoent|not recognized|cannot find|not found|failed to start|exited with code)/.test(message)) {
        return { failureKind: 'unavailable', recoverable: true };
    }
    return { failureKind: 'unknown', recoverable: false };
}
function createSuccessResult(tool, producedOutput = true, assistantText = '') {
    return {
        ok: true,
        tool,
        producedOutput,
        recoverable: false,
        assistantText,
    };
}
function createFailureResult(tool, rawMessage, producedOutput = false, assistantText = '') {
    const message = rawMessage.trim() || `${tool} execution failed`;
    const { failureKind, recoverable } = classifyFailure(message);
    return {
        ok: false,
        tool,
        producedOutput,
        recoverable,
        failureKind,
        errorMessage: message,
        assistantText,
    };
}
export class CCManager {
    // CCManager 是“单个 session 对一个 CLI 进程”的桥接层：
    // - 负责拉起/停止 Claude、Codex、OpenCode
    // - 把 stdout/stderr 解析成统一的 ServerMsg
    // - 维护当前状态、当前工具、以及各工具自己的会话 ID
    proc = null;
    parser = new CCOutputParser();
    broadcast = null;
    status = 'idle';
    activeTool = null;
    activeAgentName = null;
    activeAgentLabel = null;
    claudeSessionId = null;
    codexSessionId = null;
    openCodeSessionId = null;
    pendingBuffer = '';
    pendingResolve = null;
    setBroadcast(fn) {
        this.broadcast = fn;
    }
    getStatus() {
        return this.status;
    }
    getTool() {
        return this.activeTool;
    }
    getSessionId() {
        if (this.activeTool === 'claude')
            return this.claudeSessionId;
        if (this.activeTool === 'codex')
            return this.codexSessionId;
        if (this.activeTool === 'opencode')
            return this.openCodeSessionId;
        return null;
    }
    getAgentName() {
        return this.activeAgentName;
    }
    getAgentLabel() {
        return this.activeAgentLabel;
    }
    hydrateToolSessions(sessionIds) {
        this.claudeSessionId = sessionIds.claude || null;
        this.codexSessionId = sessionIds.codex || null;
        this.openCodeSessionId = sessionIds.opencode || null;
    }
    getToolSessionSnapshot() {
        return {
            claude: this.claudeSessionId,
            codex: this.codexSessionId,
            opencode: this.openCodeSessionId,
        };
    }
    isRunning() {
        return this.proc !== null && !this.proc.killed;
    }
    async start(projectDir, inputText, tool = 'claude', options = {}) {
        if (this.isRunning())
            return createSuccessResult(tool, false);
        this.activeTool = tool;
        this.setDefaultAgent(tool, options.requestedAgentName, options.requestedAgentLabel);
        const preparedInput = this.buildExecutionInput(inputText, options.preamble);
        // 三种工具在启动命令、输出格式、会话恢复方式上差异很大，
        // 所以分成独立 startXxx，保持每条执行链路易于调试。
        if (tool === 'codex') {
            return this.startCodex(projectDir, preparedInput, options);
        }
        if (tool === 'opencode') {
            return this.startOpenCode(projectDir, preparedInput, options);
        }
        return this.startClaude(projectDir, preparedInput, options);
    }
    async startCommand(projectDir, tool, args) {
        if (this.isRunning())
            return true;
        this.activeTool = tool;
        const requestedAgent = this.extractRequestedAgent(tool, args);
        this.setDefaultAgent(tool, requestedAgent);
        const command = this.resolveCommand(tool);
        const spawnArgs = this.resolveSpawnArgs(tool, args);
        try {
            logger.info(`Spawning ${tool} command:`, spawnArgs.join(' '));
            this.proc = spawn(command, spawnArgs, {
                cwd: projectDir,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
            });
            this.pendingBuffer = '';
            this.setStatus('executing');
            return new Promise((resolve) => {
                this.pendingResolve = () => {
                    this.setStatus('idle');
                    resolve(true);
                };
                // 直接命令模式不走结构化 parser，stdout/stderr 就按纯文本原样转发给前端。
                const emitChunk = (chunk, kind) => {
                    if (!chunk.trim())
                        return;
                    if (kind === 'error') {
                        this.broadcast?.({ type: 'error', message: chunk.trim() });
                        return;
                    }
                    this.broadcast?.({
                        type: 'text',
                        content: chunk,
                        messageId: crypto.randomUUID(),
                    });
                };
                this.proc.stdout?.on('data', (data) => {
                    emitChunk(data.toString(), 'text');
                });
                this.proc.stderr?.on('data', (data) => {
                    emitChunk(data.toString(), 'error');
                });
                this.proc.on('exit', (code) => {
                    logger.info(`${tool} command exited (code ${code})`);
                    this.proc = null;
                    this.pendingResolve?.();
                    this.pendingResolve = null;
                });
                this.proc.on('error', (err) => {
                    logger.error(`${tool} command error:`, err.message);
                    this.broadcast?.({ type: 'error', message: `${tool} command error: ${err.message}` });
                    this.proc = null;
                    this.pendingResolve?.();
                    this.pendingResolve = null;
                });
            });
        }
        catch (err) {
            logger.error(`Failed to start ${tool} command:`, err);
            this.proc = null;
            this.setStatus('idle');
            return false;
        }
    }
    async startClaude(projectDir, inputText, options) {
        try {
            const args = [
                '--print',
                '--output-format', 'stream-json',
                '--verbose',
                '--include-partial-messages',
            ];
            if (this.claudeSessionId) {
                args.push('--resume', this.claudeSessionId);
            }
            logger.info('Spawning Claude with args:', args.join(' '));
            this.proc = spawn(CLAUDE_EXE, args, {
                cwd: projectDir,
                env: { ...process.env },
                stdio: ['pipe', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
            });
            this.parser.reset();
            this.pendingBuffer = '';
            this.setStatus('thinking');
            return new Promise((resolve) => {
                let hasAssistantOutput = false;
                let assistantText = '';
                let stderrBuffer = '';
                let settled = false;
                let responseTimeout = null;
                const clearResponseTimeout = () => {
                    if (!responseTimeout)
                        return;
                    clearTimeout(responseTimeout);
                    responseTimeout = null;
                };
                const finalize = (result) => {
                    if (settled)
                        return;
                    settled = true;
                    clearResponseTimeout();
                    this.proc = null;
                    this.setStatus('idle');
                    resolve(result);
                    this.pendingResolve = null;
                };
                const failFast = (message) => {
                    const proc = this.proc;
                    if (proc && !proc.killed)
                        proc.kill();
                    finalize(createFailureResult('claude', message, false, assistantText));
                };
                responseTimeout = setTimeout(() => {
                    if (!hasAssistantOutput) {
                        failFast(`Claude timed out after ${TOOL_RESPONSE_TIMEOUT_MS / 1000}s without a response`);
                    }
                }, TOOL_RESPONSE_TIMEOUT_MS);
                this.pendingResolve = () => {
                    finalize(createSuccessResult('claude', hasAssistantOutput, assistantText));
                };
                this.proc.stdout?.on('data', (data) => {
                    this.pendingBuffer += data.toString();
                    this.tryCaptureClaudeSessionId(this.pendingBuffer);
                    // Claude 使用 stream-json 输出，parser 会把结构化事件还原为前端统一消息。
                    this.parser.feed(data.toString(), (msg) => {
                        if (this.isAssistantLikeMessage(msg)) {
                            hasAssistantOutput = true;
                            clearResponseTimeout();
                        }
                        if (msg.type === 'text' || msg.type === 'code' || msg.type === 'diff') {
                            assistantText += msg.content;
                        }
                        this.broadcastExecutionMessage(msg, options);
                    });
                });
                this.proc.stderr?.on('data', (data) => {
                    const text = data.toString();
                    stderrBuffer += text;
                    const stderrText = stderrBuffer.trim();
                    const classified = stderrText ? classifyFailure(stderrText) : null;
                    if (!hasAssistantOutput && classified?.recoverable) {
                        failFast(stderrText);
                        return;
                    }
                    if (text.trim()) {
                        this.broadcast?.({
                            type: 'text',
                            content: text,
                            messageId: crypto.randomUUID(),
                        });
                    }
                });
                this.proc.on('exit', (code) => {
                    if (settled)
                        return;
                    logger.info(`Claude process exited (code ${code})`);
                    this.parser.feed('\n', () => { });
                    const result = !hasAssistantOutput && ((code ?? 0) !== 0 || stderrBuffer.trim())
                        ? createFailureResult('claude', stderrBuffer || `Claude exited with code ${code}`, false, assistantText)
                        : createSuccessResult('claude', hasAssistantOutput, assistantText);
                    finalize(result);
                });
                this.proc.on('error', (err) => {
                    if (settled)
                        return;
                    logger.error('Claude process error:', err.message);
                    this.broadcast?.({ type: 'error', message: `Claude error: ${err.message}` });
                    finalize(createFailureResult('claude', err.message, hasAssistantOutput, assistantText));
                });
                setTimeout(() => {
                    if (this.proc?.stdin) {
                        this.proc.stdin.write(inputText + '\n');
                        this.proc.stdin.end();
                    }
                }, 200);
            });
        }
        catch (err) {
            logger.error('Failed to start Claude:', err);
            this.proc = null;
            this.setStatus('idle');
            return createFailureResult('claude', err instanceof Error ? err.message : 'Failed to start Claude');
        }
    }
    async startCodex(projectDir, inputText, options) {
        try {
            const args = this.codexSessionId
                ? [
                    'exec',
                    'resume',
                    '--json',
                    '--dangerously-bypass-approvals-and-sandbox',
                    this.codexSessionId,
                    inputText,
                ]
                : [
                    'exec',
                    '--json',
                    '--dangerously-bypass-approvals-and-sandbox',
                    '-C',
                    projectDir,
                    inputText,
                ];
            const command = process.platform === 'win32' ? 'powershell.exe' : CODEX_ENTRY;
            const spawnArgs = process.platform === 'win32'
                ? ['-NoProfile', '-File', CODEX_ENTRY, ...args]
                : args;
            logger.info('Spawning Codex with args:', spawnArgs.join(' '));
            this.proc = spawn(command, spawnArgs, {
                cwd: projectDir,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
            });
            this.pendingBuffer = '';
            this.setStatus('thinking');
            return new Promise((resolve) => {
                let hasAssistantMessage = false;
                let assistantText = '';
                let stderrBuffer = '';
                let eventErrorMessage = null;
                let settled = false;
                let responseTimeout = null;
                const clearResponseTimeout = () => {
                    if (!responseTimeout)
                        return;
                    clearTimeout(responseTimeout);
                    responseTimeout = null;
                };
                const finalize = (result) => {
                    if (settled)
                        return;
                    settled = true;
                    clearResponseTimeout();
                    this.proc = null;
                    this.setStatus('idle');
                    resolve(result);
                    this.pendingResolve = null;
                };
                const failFast = (message) => {
                    const proc = this.proc;
                    if (proc && !proc.killed)
                        proc.kill();
                    finalize(createFailureResult('codex', message, false, assistantText));
                };
                responseTimeout = setTimeout(() => {
                    if (!hasAssistantMessage) {
                        failFast(`Codex timed out after ${TOOL_RESPONSE_TIMEOUT_MS / 1000}s without a response`);
                    }
                }, TOOL_RESPONSE_TIMEOUT_MS);
                this.pendingResolve = () => {
                    finalize(createSuccessResult('codex', hasAssistantMessage, assistantText));
                };
                this.proc.stdout?.on('data', (data) => {
                    this.pendingBuffer += data.toString();
                    // Codex 按行输出 JSON 事件，所以这里按换行切帧解析。
                    let newlineIndex = this.pendingBuffer.indexOf('\n');
                    while (newlineIndex >= 0) {
                        const line = this.pendingBuffer.slice(0, newlineIndex).trim();
                        this.pendingBuffer = this.pendingBuffer.slice(newlineIndex + 1);
                        if (line) {
                            const outcome = this.handleCodexEvent(line, options);
                            hasAssistantMessage = hasAssistantMessage || outcome.producedAssistantOutput;
                            if (outcome.producedAssistantOutput) {
                                clearResponseTimeout();
                            }
                            if (outcome.outputText)
                                assistantText += outcome.outputText;
                            eventErrorMessage ||= outcome.errorMessage || null;
                            const classified = outcome.errorMessage ? classifyFailure(outcome.errorMessage) : null;
                            if (!hasAssistantMessage && classified?.recoverable) {
                                failFast(outcome.errorMessage);
                                return;
                            }
                        }
                        newlineIndex = this.pendingBuffer.indexOf('\n');
                    }
                });
                this.proc.stderr?.on('data', (data) => {
                    stderrBuffer += data.toString();
                });
                this.proc.on('exit', (code) => {
                    if (settled)
                        return;
                    logger.info(`Codex process exited (code ${code})`);
                    const tail = this.pendingBuffer.trim();
                    if (tail) {
                        const outcome = this.handleCodexEvent(tail, options);
                        hasAssistantMessage = hasAssistantMessage || outcome.producedAssistantOutput;
                        if (outcome.outputText)
                            assistantText += outcome.outputText;
                        eventErrorMessage ||= outcome.errorMessage || null;
                    }
                    const stderrText = stderrBuffer.trim();
                    const failureText = stderrText
                        || eventErrorMessage
                        || ((code && code !== 0) ? `Codex exited with code ${code}` : '');
                    const result = !hasAssistantMessage && failureText
                        ? createFailureResult('codex', failureText, false, assistantText)
                        : createSuccessResult('codex', hasAssistantMessage, assistantText);
                    finalize(result);
                });
                this.proc.on('error', (err) => {
                    if (settled)
                        return;
                    logger.error('Codex process error:', err.message);
                    this.broadcast?.({ type: 'error', message: `Codex error: ${err.message}` });
                    finalize(createFailureResult('codex', err.message, hasAssistantMessage, assistantText));
                });
            });
        }
        catch (err) {
            logger.error('Failed to start Codex:', err);
            this.proc = null;
            this.setStatus('idle');
            return createFailureResult('codex', err instanceof Error ? err.message : 'Failed to start Codex');
        }
    }
    async startOpenCode(projectDir, inputText, options) {
        try {
            const args = [
                'run',
                '--format',
                'json',
                '--dir',
                projectDir,
            ];
            if (this.openCodeSessionId) {
                args.push('--session', this.openCodeSessionId);
            }
            args.push(inputText);
            const command = process.platform === 'win32' ? 'powershell.exe' : OPENCODE_ENTRY;
            const spawnArgs = process.platform === 'win32'
                ? ['-NoProfile', '-File', OPENCODE_ENTRY, ...args]
                : args;
            logger.info('Spawning OpenCode with args:', spawnArgs.join(' '));
            this.proc = spawn(command, spawnArgs, {
                cwd: projectDir,
                env: { ...process.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
            });
            this.pendingBuffer = '';
            this.setStatus('thinking');
            return new Promise((resolve) => {
                let hasAssistantMessage = false;
                let assistantText = '';
                let stderrBuffer = '';
                let eventErrorMessage = null;
                let openCodeMessageId = null;
                let settled = false;
                let responseTimeout = null;
                const clearResponseTimeout = () => {
                    if (!responseTimeout)
                        return;
                    clearTimeout(responseTimeout);
                    responseTimeout = null;
                };
                const finalize = (result) => {
                    if (settled)
                        return;
                    settled = true;
                    clearResponseTimeout();
                    this.proc = null;
                    this.setStatus('idle');
                    resolve(result);
                    this.pendingResolve = null;
                };
                const failFast = (message) => {
                    const proc = this.proc;
                    if (proc && !proc.killed)
                        proc.kill();
                    finalize(createFailureResult('opencode', message, false, assistantText));
                };
                responseTimeout = setTimeout(() => {
                    if (!hasAssistantMessage) {
                        failFast(`OpenCode timed out after ${TOOL_RESPONSE_TIMEOUT_MS / 1000}s without a response`);
                    }
                }, TOOL_RESPONSE_TIMEOUT_MS);
                this.pendingResolve = () => {
                    finalize(createSuccessResult('opencode', hasAssistantMessage, assistantText));
                };
                this.proc.stdout?.on('data', (data) => {
                    this.pendingBuffer += data.toString();
                    // OpenCode 同样是逐行 JSON，但文本片段可能分多次出现，
                    // 所以通过闭包里的 openCodeMessageId 把同一轮回答串起来。
                    let newlineIndex = this.pendingBuffer.indexOf('\n');
                    while (newlineIndex >= 0) {
                        const line = this.pendingBuffer.slice(0, newlineIndex).trim();
                        this.pendingBuffer = this.pendingBuffer.slice(newlineIndex + 1);
                        if (line) {
                            const outcome = this.handleOpenCodeEvent(line, options, () => {
                                openCodeMessageId ||= crypto.randomUUID();
                                return openCodeMessageId;
                            });
                            hasAssistantMessage = hasAssistantMessage || outcome.producedAssistantOutput;
                            if (outcome.producedAssistantOutput) {
                                clearResponseTimeout();
                            }
                            if (outcome.outputText)
                                assistantText += outcome.outputText;
                            eventErrorMessage ||= outcome.errorMessage || null;
                            const classified = outcome.errorMessage ? classifyFailure(outcome.errorMessage) : null;
                            if (!hasAssistantMessage && classified?.recoverable) {
                                failFast(outcome.errorMessage);
                                return;
                            }
                        }
                        newlineIndex = this.pendingBuffer.indexOf('\n');
                    }
                });
                this.proc.stderr?.on('data', (data) => {
                    stderrBuffer += data.toString();
                });
                this.proc.on('exit', (code) => {
                    if (settled)
                        return;
                    logger.info(`OpenCode process exited (code ${code})`);
                    const tail = this.pendingBuffer.trim();
                    if (tail) {
                        const outcome = this.handleOpenCodeEvent(tail, options, () => {
                            openCodeMessageId ||= crypto.randomUUID();
                            return openCodeMessageId;
                        });
                        hasAssistantMessage = hasAssistantMessage || outcome.producedAssistantOutput;
                        if (outcome.outputText)
                            assistantText += outcome.outputText;
                        eventErrorMessage ||= outcome.errorMessage || null;
                    }
                    const stderrText = stderrBuffer.trim();
                    const failureText = stderrText
                        || eventErrorMessage
                        || ((code && code !== 0) ? `OpenCode exited with code ${code}` : '');
                    const result = !hasAssistantMessage && failureText
                        ? createFailureResult('opencode', failureText, false, assistantText)
                        : createSuccessResult('opencode', hasAssistantMessage, assistantText);
                    finalize(result);
                });
                this.proc.on('error', (err) => {
                    if (settled)
                        return;
                    logger.error('OpenCode process error:', err.message);
                    this.broadcast?.({ type: 'error', message: `OpenCode error: ${err.message}` });
                    finalize(createFailureResult('opencode', err.message, hasAssistantMessage, assistantText));
                });
            });
        }
        catch (err) {
            logger.error('Failed to start OpenCode:', err);
            this.proc = null;
            this.setStatus('idle');
            return createFailureResult('opencode', err instanceof Error ? err.message : 'Failed to start OpenCode');
        }
    }
    tryCaptureClaudeSessionId(buffer) {
        if (this.claudeSessionId)
            return;
        try {
            for (const line of buffer.split('\n')) {
                if (!line.trim())
                    continue;
                const event = JSON.parse(line);
                if (event.type === 'system' && event.session_id) {
                    this.claudeSessionId = event.session_id;
                    logger.info('Captured Claude session ID:', this.claudeSessionId);
                    return;
                }
            }
        }
        catch { /* ignore */ }
    }
    buildExecutionInput(inputText, preamble) {
        const prefix = preamble?.trim();
        if (!prefix)
            return inputText;
        return `${prefix}\n\n${inputText}`;
    }
    setDefaultAgent(tool, requestedAgent, requestedAgentLabel) {
        const trimmed = requestedAgent?.trim();
        if (trimmed) {
            this.activeAgentName = trimmed;
            this.activeAgentLabel = requestedAgentLabel?.trim() || trimmed;
            return;
        }
        if (tool === 'opencode') {
            this.activeAgentName = 'auto';
            this.activeAgentLabel = '自动 Agent';
            return;
        }
        this.activeAgentName = 'default';
        this.activeAgentLabel = 'default';
    }
    extractRequestedAgent(tool, args) {
        const flag = args.findIndex(arg => arg === '--agent' || arg.startsWith('--agent='));
        if (flag < 0)
            return null;
        const current = args[flag];
        if (current.includes('=')) {
            return current.split('=').slice(1).join('=').trim() || null;
        }
        const next = args[flag + 1];
        if (!next || next.startsWith('-'))
            return null;
        return next.trim();
    }
    resolveCommand(tool) {
        if (process.platform !== 'win32') {
            if (tool === 'claude')
                return CLAUDE_EXE;
            if (tool === 'codex')
                return CODEX_ENTRY;
            return OPENCODE_ENTRY;
        }
        if (tool === 'claude')
            return CLAUDE_EXE;
        return 'powershell.exe';
    }
    resolveSpawnArgs(tool, args) {
        if (process.platform !== 'win32')
            return args;
        if (tool === 'claude')
            return args;
        if (tool === 'codex')
            return ['-NoProfile', '-File', CODEX_ENTRY, ...args];
        return ['-NoProfile', '-File', OPENCODE_ENTRY, ...args];
    }
    isAssistantLikeMessage(msg) {
        switch (msg.type) {
            case 'text':
            case 'thinking':
            case 'thinking_done':
            case 'code':
            case 'diff':
            case 'tool_use':
            case 'tool_result':
                return true;
            default:
                return false;
        }
    }
    broadcastExecutionMessage(msg, options) {
        if (options.suppressAssistantMessageBroadcast && this.isAssistantLikeMessage(msg))
            return;
        this.broadcast?.(msg);
    }
    handleCodexEvent(line, options) {
        try {
            const event = JSON.parse(line);
            if (event.type === 'thread.started' && typeof event.thread_id === 'string') {
                this.codexSessionId = event.thread_id;
                logger.info('Captured Codex session ID:', this.codexSessionId);
                return { producedAssistantOutput: false };
            }
            if (event.type === 'item.completed' && event.item?.type === 'agent_message' && typeof event.item.text === 'string') {
                this.broadcastExecutionMessage({
                    type: 'text',
                    content: event.item.text,
                    messageId: crypto.randomUUID(),
                }, options);
                return { producedAssistantOutput: true, outputText: event.item.text };
            }
            if (event.type === 'error' && typeof event.message === 'string') {
                if (!event.message.startsWith('Reconnecting')) {
                    this.broadcast?.({
                        type: 'error',
                        message: `Codex: ${event.message}`,
                    });
                }
                return {
                    producedAssistantOutput: false,
                    errorMessage: event.message,
                };
            }
            if (event.type === 'turn.failed' && typeof event.error?.message === 'string') {
                this.broadcast?.({
                    type: 'error',
                    message: `Codex: ${event.error.message}`,
                });
                return {
                    producedAssistantOutput: false,
                    errorMessage: event.error.message,
                };
            }
        }
        catch { /* ignore non-JSON noise from the wrapper */ }
        return { producedAssistantOutput: false };
    }
    handleOpenCodeEvent(line, options, getMessageId) {
        try {
            const event = JSON.parse(line);
            if (typeof event.sessionID === 'string') {
                this.openCodeSessionId = event.sessionID;
            }
            if (event.type === 'text' && typeof event.part?.text === 'string') {
                this.broadcastExecutionMessage({
                    type: 'text',
                    content: event.part.text,
                    messageId: getMessageId(),
                }, options);
                return { producedAssistantOutput: true, outputText: event.part.text };
            }
            if (event.type === 'error') {
                const message = typeof event.message === 'string'
                    ? event.message
                    : typeof event.error?.data?.message === 'string'
                        ? event.error.data.message
                        : typeof event.error?.message === 'string'
                            ? event.error.message
                            : typeof event.part?.text === 'string'
                                ? event.part.text
                                : 'OpenCode execution failed';
                this.broadcast?.({ type: 'error', message: `OpenCode: ${message}` });
                return {
                    producedAssistantOutput: false,
                    errorMessage: message,
                };
            }
        }
        catch { /* ignore non-JSON noise from the wrapper */ }
        return { producedAssistantOutput: false };
    }
    async stop() {
        if (!this.proc)
            return;
        this.proc.kill();
        this.proc = null;
        this.activeAgentName = null;
        this.activeAgentLabel = null;
        this.setStatus('idle');
    }
    write(_text) {
        // Non-interactive tool runners start a new process per message.
    }
    sendConfirm(_requestId, _allow) {
        // Non-interactive runners do not currently expose confirm hooks here.
    }
    cancel() {
        if (this.proc) {
            this.proc.kill();
            this.proc = null;
            this.activeAgentName = null;
            this.activeAgentLabel = null;
            this.setStatus('idle');
        }
    }
    setStatus(status) {
        this.status = status;
        this.broadcast?.({ type: 'status', state: status });
    }
}
//# sourceMappingURL=manager.js.map