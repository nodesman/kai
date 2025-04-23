// src/lib/analysis/types.ts
export interface AnalysisCacheEntry {
    filePath: string; // Relative path from project root
    type: 'binary' | 'text_large' | 'text_analyze'; // File classification
    size: number; // File size in bytes
    loc: number | null; // Lines of Code (null for binary/large)
    summary: string | null; // AI-generated summary (null for non-analyzed)
    lastAnalyzed: string; // ISO timestamp of when this entry was created/updated
}

// --- UPDATED: Top-level Cache Structure for Milestone 2 ---
export interface ProjectAnalysisCache {
    overallSummary: string | null; // Placeholder for M2, goal for later milestones
    entries: AnalysisCacheEntry[]; // Array of individual file entries
}