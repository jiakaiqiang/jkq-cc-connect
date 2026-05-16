import { stripAnsi } from '../utils/ansi.js';
export class CCOutputParser {
    buffer = '';
    lastStatus = 'idle';
    pendingToolUses = new Map();
    sawStreamedText = false;
    sawStreamedThinking = false;
    reset() {
        this.buffer = '';
        this.lastStatus = 'idle';
        this.pendingToolUses.clear();
        this.sawStreamedText = false;
        this.sawStreamedThinking = false;
    }
    feed(data, emit) {
        this.buffer += data;
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';
        for (const line of lines) {
            if (!line.trim())
                continue;
            this.processLine(line, emit);
        }
    }
    processLine(line, emit) {
        try {
            const event = JSON.parse(line);
            this.handleEvent(event, emit);
        }
        catch {
            const cleaned = stripAnsi(line);
            if (cleaned.trim()) {
                emit({ type: 'text', content: cleaned, messageId: crypto.randomUUID() });
            }
        }
    }
    handleEvent(event, emit) {
        switch (event.type) {
            case 'system':
                this.handleSystemEvent(event, emit);
                break;
            case 'stream_event':
                this.handleStreamEvent(event.event, emit);
                break;
            case 'assistant':
                this.handleAssistantEvent(event, emit);
                break;
            case 'user':
                this.handleUserEvent(event, emit);
                break;
            case 'result':
                this.emitStatus('idle', emit);
                break;
            default:
                break;
        }
    }
    handleSystemEvent(event, emit) {
        if (event.subtype === 'status' && event.status === 'requesting') {
            this.emitStatus('thinking', emit);
        }
    }
    handleStreamEvent(event, emit) {
        if (!event)
            return;
        switch (event.type) {
            case 'content_block_start':
                this.handleContentBlockStart(event, emit);
                break;
            case 'content_block_delta':
                this.handleContentBlockDelta(event, emit);
                break;
            case 'content_block_stop':
                this.handleContentBlockStop(event);
                break;
            case 'message_delta':
                if (event.delta?.type === 'thinking_delta' && event.delta.thinking) {
                    this.emitStatus('thinking', emit);
                    emit({ type: 'thinking', content: event.delta.thinking, messageId: crypto.randomUUID() });
                }
                break;
            default:
                break;
        }
    }
    handleContentBlockStart(event, emit) {
        const block = event.content_block;
        if (!block)
            return;
        switch (block.type) {
            case 'text':
                if (block.text) {
                    this.emitStatus('thinking', emit);
                    emit({ type: 'text', content: block.text, messageId: crypto.randomUUID() });
                }
                break;
            case 'thinking':
                if (block.thinking) {
                    this.emitStatus('thinking', emit);
                    emit({ type: 'thinking', content: block.thinking, messageId: crypto.randomUUID() });
                }
                break;
            case 'tool_use':
                if (typeof event.index === 'number') {
                    this.pendingToolUses.set(event.index, {
                        id: block.id || crypto.randomUUID(),
                        name: block.name || 'unknown',
                        partialInput: '',
                    });
                }
                break;
        }
    }
    handleContentBlockDelta(event, emit) {
        const delta = event.delta;
        if (!delta)
            return;
        if (delta.type === 'text_delta' && delta.text) {
            this.sawStreamedText = true;
            this.emitStatus('thinking', emit);
            emit({ type: 'text', content: delta.text, messageId: crypto.randomUUID() });
            return;
        }
        if (delta.type === 'thinking_delta' && delta.thinking) {
            this.sawStreamedThinking = true;
            this.emitStatus('thinking', emit);
            emit({ type: 'thinking', content: delta.thinking, messageId: crypto.randomUUID() });
            return;
        }
        if (delta.type === 'input_json_delta' && typeof event.index === 'number') {
            const pending = this.pendingToolUses.get(event.index);
            if (pending) {
                pending.partialInput += delta.partial_json || '';
            }
        }
    }
    handleContentBlockStop(event) {
        if (typeof event.index !== 'number')
            return;
        const pending = this.pendingToolUses.get(event.index);
        if (!pending)
            return;
        this.pendingToolUses.delete(event.index);
    }
    handleAssistantEvent(event, emit) {
        const blocks = event.message?.content;
        if (!blocks?.length)
            return;
        for (const block of blocks) {
            switch (block.type) {
                case 'text':
                    if (block.text && !this.sawStreamedText) {
                        this.emitStatus('thinking', emit);
                        emit({ type: 'text', content: block.text, messageId: crypto.randomUUID() });
                    }
                    break;
                case 'thinking':
                    if (block.thinking && !this.sawStreamedThinking) {
                        this.emitStatus('thinking', emit);
                        emit({ type: 'thinking', content: block.thinking, messageId: crypto.randomUUID() });
                        emit({ type: 'thinking_done', messageId: crypto.randomUUID() });
                    }
                    break;
                case 'tool_use':
                    this.emitStatus('executing', emit);
                    emit({
                        type: 'tool_use',
                        toolName: block.name || 'unknown',
                        toolInput: block.input || {},
                        messageId: block.id || crypto.randomUUID(),
                    });
                    break;
            }
        }
    }
    handleUserEvent(event, emit) {
        const blocks = event.message?.content;
        if (!blocks?.length)
            return;
        for (const block of blocks) {
            if (block.type !== 'tool_result')
                continue;
            this.emitStatus('thinking', emit);
            emit({
                type: 'tool_result',
                content: block.content || '',
                messageId: crypto.randomUUID(),
                parentId: block.tool_use_id || '',
            });
        }
    }
    emitStatus(status, emit) {
        if (this.lastStatus === status)
            return;
        this.lastStatus = status;
        emit({ type: 'status', state: status });
    }
}
//# sourceMappingURL=parser.js.map