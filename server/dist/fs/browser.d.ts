import type { FileEntry, FileRoot } from '../types/index.js';
export declare function listRoots(): FileRoot[];
export declare function isAllowedProjectDir(projectDir: string): boolean;
export declare function listDirectory(rootId: string, dirPath?: string): FileEntry[];
export declare function readFile(rootId: string, filePath: string): {
    path: string;
    content: string;
    language: string;
    size: number;
};
