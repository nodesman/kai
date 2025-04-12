// src/lib/consolidation/types.ts

// Defines the structure for the final desired state of files after generation
export interface FinalFileStates {
    [filePath: string]: string | 'DELETE_CONFIRMED'; // Key is relative path, value is content or deletion marker
}

// Defines the structure of the output from the ConsolidationAnalyzer
export interface ConsolidationAnalysis {
    operations: Array<{
        filePath: string;                  // Relative path of the file
        action: 'CREATE' | 'MODIFY' | 'DELETE'; // Action to take
    }>;
    groups?: string[][]; // Optional grouping information if analysis provides it
}