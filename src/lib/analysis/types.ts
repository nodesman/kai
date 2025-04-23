// src/lib/analysis/types.ts
export interface AnalysisCacheEntry {
    filePath: string; // Relative path from project root
    loc: number;      // Lines of Code
    summary: string | null;  // AI-generated summary (null if error/skipped)
    lastAnalyzed: string; // ISO timestamp of when this entry was created/updated
}

// For Milestone 1, the cache is just an array of entries.
export type ProjectAnalysisCache = AnalysisCacheEntry[];