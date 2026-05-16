const PREFIX = '[cc-connect]';
export const logger = {
    info(msg, ...args) {
        console.log(`${PREFIX} ${msg}`, ...args);
    },
    warn(msg, ...args) {
        console.warn(`${PREFIX} WARN ${msg}`, ...args);
    },
    error(msg, ...args) {
        console.error(`${PREFIX} ERROR ${msg}`, ...args);
    },
};
//# sourceMappingURL=logger.js.map