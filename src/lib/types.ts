//File: src/lib/types.ts
// Add to src/lib/types.ts
export interface DiffFile {
    path: string;
    content: string; // This is now the *diff content*, not the entire file content
}
