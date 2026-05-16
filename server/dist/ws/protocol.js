export function parseClientMessage(data) {
    try {
        const msg = JSON.parse(data);
        if (!msg.type)
            return null;
        return msg;
    }
    catch {
        return null;
    }
}
export function serializeServerMsg(msg) {
    return JSON.stringify(msg);
}
//# sourceMappingURL=protocol.js.map