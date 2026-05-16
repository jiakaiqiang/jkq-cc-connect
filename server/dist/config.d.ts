interface ConfigData {
    port: number;
    projectDir: string;
    allowedRoots: string[];
    passwordHash: string | null;
    jwtSecret: string;
}
export declare function getConfig(): Readonly<ConfigData>;
export declare function updateConfig(partial: Partial<ConfigData>): void;
export declare function getDbPath(): string;
export {};
