import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
const CACHE_TTL_MS = 30_000;
const MAX_BUFFER = 4 * 1024 * 1024;
let cache = null;
function runCommand(command, args = []) {
    try {
        return execSync([command, ...args].join(' '), {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 4_000,
            maxBuffer: MAX_BUFFER,
            shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
        }).trim();
    }
    catch {
        return null;
    }
}
function getVersion(command) {
    return runCommand(command, ['--version']) || null;
}
function readJsonFile(filePath) {
    try {
        return JSON.parse(readFileSync(filePath, 'utf8'));
    }
    catch {
        return null;
    }
}
function sanitizeWhitespace(text) {
    return (text || '').replace(/\s+/g, ' ').trim();
}
function extractFrontmatter(markdown) {
    const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match)
        return {};
    const data = {};
    for (const line of match[1].split(/\r?\n/)) {
        const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!pair)
            continue;
        data[pair[1]] = pair[2].trim().replace(/^['"]|['"]$/g, '');
    }
    return data;
}
function extractMarkdownHeadings(markdown) {
    return markdown
        .split(/\r?\n/)
        .map(line => line.match(/^##+\s+(.*)$/)?.[1]?.trim() || '')
        .filter(Boolean);
}
function extractMarkdownBullets(markdown) {
    const body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
    return body
        .split(/\r?\n/)
        .map((line) => {
        const bullet = line.match(/^\s*[-*+]\s+(.*)$/)?.[1]
            || line.match(/^\s*\d+\.\s+(.*)$/)?.[1];
        return sanitizeWhitespace(bullet);
    })
        .filter(Boolean);
}
function extractFirstParagraph(markdown) {
    const body = markdown
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        .replace(/```[\s\S]*?```/g, ' ');
    for (const block of body.split(/\r?\n\r?\n/)) {
        const paragraph = sanitizeWhitespace(block
            .split(/\r?\n/)
            .filter(line => !/^\s*#/.test(line))
            .filter(line => !/^\s*[-*+]\s+/.test(line))
            .filter(line => !/^\s*\d+\.\s+/.test(line))
            .join(' '));
        if (paragraph)
            return paragraph;
    }
    return '';
}
function parseInlineList(value) {
    if (!value)
        return [];
    return value
        .replace(/^\[|\]$/g, '')
        .split(/[,\uFF0C|/]/)
        .map(item => sanitizeWhitespace(item))
        .filter(Boolean);
}
function unique(items, limit = 8) {
    const result = [];
    const seen = new Set();
    for (const item of items) {
        const value = sanitizeWhitespace(item);
        if (!value || seen.has(value))
            continue;
        seen.add(value);
        result.push(value);
        if (result.length >= limit)
            break;
    }
    return result;
}
function inferAgentCapabilities(name, description) {
    const haystack = `${name} ${description}`.toLowerCase();
    const capabilities = [];
    if (/(review|audit|lint|qa|test|spec|审查|评审|测试|验证)/.test(haystack)) {
        capabilities.push('代码审查与风险识别', '测试策略与回归验证');
    }
    if (/(frontend|ui|ux|vue|react|web|页面|前端|界面|交互)/.test(haystack)) {
        capabilities.push('前端界面实现与交互优化', '组件结构与样式细化');
    }
    if (/(backend|api|server|service|database|后端|接口|数据)/.test(haystack)) {
        capabilities.push('服务端接口与数据流实现', '后端问题排查与接口联调');
    }
    if (/(debug|bug|fix|repair|triage|故障|排查|修复|调试)/.test(haystack)) {
        capabilities.push('问题定位与根因分析', '缺陷修复与验证闭环');
    }
    if (/(doc|readme|guide|explain|summary|总结|文档|说明)/.test(haystack)) {
        capabilities.push('文档整理与说明撰写', '复杂实现的结构化解释');
    }
    if (/(design|plan|architecture|refactor|重构|架构|规划|设计)/.test(haystack)) {
        capabilities.push('方案设计与任务拆解', '重构策略与边界梳理');
    }
    return unique(capabilities, 6);
}
function formatToolCapability(toolName) {
    const normalized = toolName.toLowerCase();
    if (normalized === 'read')
        return '可读取文件与代码上下文';
    if (normalized === 'write')
        return '可写入或创建工作区文件';
    if (normalized === 'edit')
        return '可直接编辑现有文件';
    if (normalized === 'bash' || normalized === 'shell')
        return '可执行终端命令';
    if (normalized === 'grep' || normalized === 'glob' || normalized === 'search')
        return '可检索代码与文件';
    if (normalized === 'web')
        return '可访问网页与在线资料';
    if (normalized === 'mcp')
        return '可调用 MCP 服务';
    return `可调用 ${toolName} 工具`;
}
function formatOpenCodePermission(permission) {
    const normalized = permission.toLowerCase();
    if (normalized === '*')
        return '通用工具执行';
    if (normalized === 'read')
        return '读取工作区与本地文件';
    if (normalized === 'write')
        return '修改工作区文件';
    if (normalized === 'bash' || normalized === 'shell')
        return '执行终端命令';
    if (normalized === 'external_directory')
        return '访问外部目录';
    if (normalized === 'web')
        return '访问网络资源';
    if (normalized === 'mcp')
        return '调用 MCP 服务';
    return permission;
}
function extractOpenCodePermissionRules(body) {
    const allow = new Set();
    const ask = new Set();
    for (const match of body.matchAll(/"permission":\s*"([^"]+)"[\s\S]{0,160}?"action":\s*"([^"]+)"/g)) {
        const permission = sanitizeWhitespace(match[1]);
        const action = sanitizeWhitespace(match[2]).toLowerCase();
        if (!permission)
            continue;
        if (action === 'allow')
            allow.add(permission);
        if (action === 'ask')
            ask.add(permission);
    }
    return { allow: [...allow], ask: [...ask] };
}
function buildMarkdownDocument(title, description, capabilities, extraSections = []) {
    const sections = [
        `# ${title}`,
        '',
        description,
        '',
        '## 能力',
        ...capabilities.map(item => `- ${item}`),
    ];
    for (const section of extraSections) {
        const items = unique(section.items);
        if (!items.length)
            continue;
        sections.push('', `## ${section.title}`, ...items.map(item => `- ${item}`));
    }
    return sections.join('\n');
}
function buildAgent(id, name, state, statusText, description, capabilities, markdownTitle, markdownPath, markdownContent) {
    return {
        id,
        name,
        state,
        statusText,
        description,
        capabilities,
        markdownTitle,
        markdownPath,
        markdownContent,
    };
}
function buildClaudeAgents(installed) {
    const defaultCapabilities = [
        '多轮对话与上下文理解',
        '代码实现与补丁修改',
        '终端命令协作与调试推进',
        '结果总结与交付说明',
    ];
    const agents = [
        buildAgent('claude:default', 'default', installed ? 'ready' : 'missing', installed ? '默认' : '缺失', installed
            ? 'Claude 默认 Agent，可直接处理当前会话中的开发任务。'
            : '当前环境中未检测到 Claude CLI。', defaultCapabilities, 'Claude Default Agent', undefined, buildMarkdownDocument('Claude Default Agent', installed
            ? 'Claude 默认 Agent，用于处理通用编程、调试、说明和交付类任务。'
            : '当前环境中未检测到 Claude CLI，因此该 Agent 暂不可用。', defaultCapabilities, [
            { title: '状态', items: [installed ? '当前状态：可用' : '当前状态：缺失'] },
        ])),
    ];
    const agentsDir = join(homedir(), '.claude', 'agents');
    if (!existsSync(agentsDir))
        return agents;
    for (const fileName of readdirSync(agentsDir)) {
        if (!fileName.endsWith('.md'))
            continue;
        try {
            const filePath = join(agentsDir, fileName);
            const markdown = readFileSync(filePath, 'utf8');
            const frontmatter = extractFrontmatter(markdown);
            const name = sanitizeWhitespace(frontmatter.name) || basename(fileName, '.md');
            const description = sanitizeWhitespace(frontmatter.description) || extractFirstParagraph(markdown) || 'Claude 自定义 Agent。';
            const headings = extractMarkdownHeadings(markdown);
            const bullets = extractMarkdownBullets(markdown);
            const declaredTools = parseInlineList(frontmatter.tools).map(formatToolCapability);
            const declaredCapabilities = parseInlineList(frontmatter.capabilities);
            const inferred = inferAgentCapabilities(name, `${description} ${bullets.join(' ')}`);
            const capabilities = unique([
                ...declaredCapabilities,
                ...declaredTools,
                ...bullets,
                ...headings.map(item => `擅长：${item}`),
                ...(frontmatter.model ? [`默认模型：${frontmatter.model}`] : []),
                ...inferred,
                '按自定义提示词处理专项任务',
            ], 8);
            agents.push(buildAgent(`claude:${name}`, name, installed ? 'ready' : 'missing', installed ? '可用' : '缺失', description, capabilities.length ? capabilities : ['按自定义提示词处理专项任务'], `${name}.md`, filePath, markdown));
        }
        catch {
            // Ignore malformed local agent files.
        }
    }
    return agents;
}
function buildCodexAgents(installed, authenticated) {
    const capabilities = unique([
        '多文件代码修改与补丁输出',
        '代码审查与回归风险识别',
        '终端命令、构建与测试执行',
        authenticated ? '可按需调用 MCP、浏览器与插件能力' : '登录后可调用 MCP、浏览器与插件能力',
        authenticated ? '适合拆解并推进复杂开发任务' : undefined,
    ], 6);
    const state = !installed ? 'missing' : authenticated ? 'ready' : 'limited';
    const statusText = !installed ? '缺失' : authenticated ? '默认' : '需登录';
    const description = installed
        ? 'Codex CLI 当前未暴露独立 Agent 列表，这里展示的是默认 Agent。'
        : '当前环境中未检测到 Codex CLI。';
    return [
        buildAgent('codex:default', 'default', state, statusText, description, capabilities, 'Codex Default Agent', undefined, buildMarkdownDocument('Codex Default Agent', description, capabilities, [
            { title: '状态', items: [installed ? (authenticated ? '当前状态：已登录可执行' : '当前状态：已安装但需登录') : '当前状态：缺失'] },
            { title: '说明', items: ['Codex CLI 本地未提供可枚举的独立 Agent 名单，因此这里展示默认 Agent 能力概览。'] },
        ])),
    ];
}
function parseOpenCodeAgentSections(output) {
    const lines = output.split(/\r?\n/);
    const sections = [];
    let current = null;
    for (const line of lines) {
        const header = line.match(/^([^\s][^(]+?)\s+\(([^)]+)\)\s*$/);
        if (header) {
            if (current)
                sections.push(current);
            current = { name: sanitizeWhitespace(header[1]), rawStatus: sanitizeWhitespace(header[2]), body: '' };
            continue;
        }
        if (current)
            current.body += `${line}\n`;
    }
    if (current)
        sections.push(current);
    return sections;
}
function mapOpenCodeStatus(rawStatus) {
    const normalized = rawStatus.toLowerCase();
    if (normalized.includes('primary'))
        return { state: 'ready', statusText: '主 Agent' };
    if (normalized.includes('subagent'))
        return { state: 'ready', statusText: '子 Agent' };
    if (normalized.includes('active') || normalized.includes('running'))
        return { state: 'ready', statusText: '运行中' };
    if (normalized.includes('default'))
        return { state: 'ready', statusText: '默认' };
    return { state: 'limited', statusText: rawStatus || '已检测' };
}
function summarizeOpenCodeCapabilities(body) {
    const { allow, ask } = extractOpenCodePermissionRules(body);
    const directPermissions = allow.filter(permission => permission !== '*').map(formatOpenCodePermission);
    const confirmPermissions = ask.map(formatOpenCodePermission);
    return unique([
        allow.includes('*') ? '具备通用工具执行权限' : null,
        directPermissions.length ? `直接可用：${directPermissions.join('、')}` : null,
        confirmPermissions.length ? `需确认后可用：${confirmPermissions.join('、')}` : null,
        /"permission":\s*"read"/.test(body) ? '可读取工作区与本地文件' : null,
        /"permission":\s*"external_directory"/.test(body) ? '可访问外部目录' : null,
    ], 6);
}
function buildOpenCodeAgentMarkdown(name, statusText, description, capabilities, body) {
    const { allow, ask } = extractOpenCodePermissionRules(body);
    return buildMarkdownDocument(`OpenCode Agent: ${name}`, description, capabilities, [
        { title: '状态', items: [`当前状态：${statusText}`] },
        { title: '已开放权限', items: allow.map(formatOpenCodePermission) },
        { title: '需确认权限', items: ask.map(formatOpenCodePermission) },
    ]);
}
function buildOpenCodeAgents(installed, configured) {
    if (!installed) {
        return [
            buildAgent('opencode:default', 'default', 'missing', '缺失', '当前环境中未检测到 OpenCode CLI。', ['等待安装 OpenCode CLI'], 'OpenCode Default Agent', undefined, buildMarkdownDocument('OpenCode Default Agent', '当前环境中未检测到 OpenCode CLI。', ['等待安装 OpenCode CLI'])),
        ];
    }
    const output = runCommand('opencode', ['agent', 'list']);
    if (!output) {
        const description = configured
            ? 'OpenCode 已安装，但暂未读取到 agent 列表。'
            : 'OpenCode 已安装，但当前 provider 配置不可用。';
        const capabilities = configured
            ? ['命令执行', '模型调用', '等待读取 agent 列表']
            : ['命令执行', '模型调用', '等待补全 provider 配置'];
        return [
            buildAgent('opencode:default', 'default', configured ? 'ready' : 'error', configured ? '可用' : '需配置', description, capabilities, 'OpenCode Default Agent', undefined, buildMarkdownDocument('OpenCode Default Agent', description, capabilities)),
        ];
    }
    const sections = parseOpenCodeAgentSections(output);
    if (!sections.length) {
        return [
            buildAgent('opencode:default', 'default', configured ? 'ready' : 'error', configured ? '可用' : '需配置', 'OpenCode 已安装，但未解析到结构化 Agent 信息。', ['命令执行', '模型调用'], 'OpenCode Default Agent', undefined, buildMarkdownDocument('OpenCode Default Agent', 'OpenCode 已安装，但未解析到结构化 Agent 信息。', ['命令执行', '模型调用'])),
        ];
    }
    return sections.map((section) => {
        const mappedStatus = mapOpenCodeStatus(section.rawStatus);
        const capabilities = summarizeOpenCodeCapabilities(section.body);
        const description = 'OpenCode Agent，可按其权限规则执行文件与命令相关任务。';
        const finalStatus = configured ? mappedStatus.statusText : '需配置';
        const finalState = configured ? mappedStatus.state : 'error';
        return buildAgent(`opencode:${section.name}`, section.name, finalState, finalStatus, description, capabilities.length ? capabilities : ['命令执行', '文件读写'], `${section.name}.md`, undefined, buildOpenCodeAgentMarkdown(section.name, finalStatus, description, capabilities.length ? capabilities : ['命令执行', '文件读写'], section.body));
    });
}
function detectClaude() {
    const version = getVersion('claude');
    const installed = !!version;
    const agents = buildClaudeAgents(installed);
    return {
        id: 'claude',
        label: 'Claude',
        command: 'claude',
        version,
        installed,
        configured: installed,
        authenticated: installed,
        state: installed ? 'ready' : 'missing',
        statusText: installed ? '可用' : '缺失',
        detail: installed
            ? '当前聊天主引擎可直接执行请求。'
            : '当前环境中未检测到 Claude CLI。',
        supportsExecution: installed,
        supportsParallel: false,
        agentCount: agents.length,
        agents,
    };
}
function detectCodex() {
    const version = getVersion('codex');
    const installed = !!version;
    const authPath = join(homedir(), '.codex', 'auth.json');
    const authenticated = installed && existsSync(authPath);
    const agents = buildCodexAgents(installed, authenticated);
    return {
        id: 'codex',
        label: 'Codex',
        command: 'codex',
        version,
        installed,
        configured: authenticated,
        authenticated,
        state: !installed ? 'missing' : authenticated ? 'ready' : 'limited',
        statusText: !installed ? '缺失' : authenticated ? '已登录' : '需登录',
        detail: !installed
            ? '当前环境中未检测到 Codex CLI。'
            : authenticated
                ? 'Codex 已安装并已登录，可以直接处理当前请求。'
                : 'Codex CLI 已安装，但未检测到本地登录凭证。',
        supportsExecution: authenticated,
        supportsParallel: false,
        agentCount: agents.length,
        agents,
    };
}
function detectOpenCode() {
    const version = getVersion('opencode');
    const installed = !!version;
    const configPath = join(homedir(), '.config', 'opencode', 'opencode.json');
    const config = installed && existsSync(configPath) ? readJsonFile(configPath) : null;
    const apiKey = config?.provider?.openai?.options?.apiKey;
    const configured = installed && !!apiKey;
    const agents = buildOpenCodeAgents(installed, configured);
    return {
        id: 'opencode',
        label: 'OpenCode',
        command: 'opencode',
        version,
        installed,
        configured,
        authenticated: configured,
        state: !installed ? 'missing' : configured ? 'ready' : 'error',
        statusText: !installed ? '缺失' : configured ? '可用' : '需配置',
        detail: !installed
            ? '当前环境中未检测到 OpenCode CLI。'
            : configured
                ? 'CLI 配置已检测到，可以直接处理当前请求。'
                : 'OpenCode 已安装，但未检测到可用的 provider 配置。',
        supportsExecution: configured,
        supportsParallel: false,
        agentCount: agents.length,
        agents,
    };
}
export function getVibeTools(force = false) {
    if (!force && cache && cache.expiresAt > Date.now()) {
        return cache.tools;
    }
    const tools = [detectClaude(), detectCodex(), detectOpenCode()];
    cache = { tools, expiresAt: Date.now() + CACHE_TTL_MS };
    return tools;
}
function findTool(tools, id) {
    return tools.find(tool => tool.id === id);
}
function scorePromptForTool(text, toolId) {
    const input = text.toLowerCase();
    let score = 0;
    if (toolId === 'claude') {
        score += 40;
        if (/(fix|implement|modify|build|debug|refactor|repair|feature|修复|实现|修改|构建|调试|重构)/.test(input))
            score += 40;
        if (/(summary|summarize|wrap up|finalize|conclude|总结|收尾)/.test(input))
            score += 15;
    }
    if (toolId === 'codex') {
        if (/(review|audit|lint|test|coverage|verify|检查|审查|测试|验证)/.test(input))
            score += 45;
        if (/(diff|patch|repo|repository|regression|补丁|仓库|回归)/.test(input))
            score += 20;
    }
    if (toolId === 'opencode') {
        if (/(brainstorm|explore|variant|creative|prototype|concept|头脑风暴|探索|创意|原型)/.test(input))
            score += 40;
        if (/(ux|ui|copy|content|design|设计|文案)/.test(input))
            score += 20;
    }
    return score;
}
const TOOL_TIE_BREAKER = {
    claude: 0,
    codex: 1,
    opencode: 2,
};
export function getFallbackTools(text, failedTool, tools = getVibeTools()) {
    return tools
        .filter((tool) => tool.id !== failedTool && tool.supportsExecution)
        .map((tool) => ({ tool, score: scorePromptForTool(text, tool.id) }))
        .sort((left, right) => {
        if (right.score !== left.score)
            return right.score - left.score;
        return TOOL_TIE_BREAKER[left.tool.id] - TOOL_TIE_BREAKER[right.tool.id];
    })
        .map(({ tool }) => tool.id);
}
export function planToolRoute(text, mode, tools = getVibeTools(), context) {
    const requestedMode = mode || 'auto';
    const claude = findTool(tools, 'claude');
    if (requestedMode === 'parallel') {
        const readyTools = tools.filter(tool => tool.supportsExecution).map(tool => tool.id);
        if (readyTools.length < 2) {
            return {
                mode: requestedMode,
                selectedTools: claude?.supportsExecution ? ['claude'] : [],
                summary: '当前没有足够的可并行工具，请先使用单工具模式。',
                blockedReason: claude?.supportsExecution ? undefined : '当前环境中 Claude 不可用。',
            };
        }
        return {
            mode: requestedMode,
            selectedTools: readyTools,
            summary: `已检测到可用工具：${readyTools.join('、')}。`,
            blockedReason: '当前版本还没有接入并行执行器。',
        };
    }
    if (requestedMode !== 'auto') {
        const requestedTool = findTool(tools, requestedMode);
        if (!requestedTool?.supportsExecution) {
            return {
                mode: requestedMode,
                selectedTools: [],
                summary: `${requestedTool?.label || requestedMode} 当前还不能直接执行。`,
                blockedReason: requestedTool?.detail || '所选工具当前不可用。',
            };
        }
        return {
            mode: requestedMode,
            selectedTools: [requestedMode],
            summary: `这次请求将由 ${requestedTool.label} 处理。`,
        };
    }
    const executableTools = tools.filter(tool => tool.supportsExecution);
    if (executableTools.length === 0) {
        return {
            mode: requestedMode,
            selectedTools: [],
            summary: '没有检测到可直接执行的工具。',
            blockedReason: '请先安装或重新配置至少一个 CLI 工具。',
        };
    }
    const stickyTool = context?.lastSuccessfulTool
        ? executableTools.find(tool => tool.id === context.lastSuccessfulTool)
        : undefined;
    const sessionToolSet = new Set(context?.availableSessionTools || []);
    const ranked = executableTools
        .map((tool) => {
        let score = scorePromptForTool(text, tool.id);
        if (sessionToolSet.has(tool.id))
            score += 20;
        if (stickyTool?.id === tool.id) {
            score += sessionToolSet.has(tool.id) ? 120 : 80;
        }
        return { tool, score };
    })
        .sort((left, right) => {
        if (right.score !== left.score)
            return right.score - left.score;
        return TOOL_TIE_BREAKER[left.tool.id] - TOOL_TIE_BREAKER[right.tool.id];
    });
    const winner = ranked[0]?.tool || executableTools[0];
    const onlyClaudeReady = executableTools.length === 1 && winner.id === 'claude';
    return {
        mode: requestedMode,
        selectedTools: [winner.id],
        summary: onlyClaudeReady
            ? '当前只有 Claude 可直接执行，所以自动模式会使用 Claude。'
            : `自动模式已将这次请求匹配给 ${winner.label}。`,
    };
}
//# sourceMappingURL=vibe.js.map