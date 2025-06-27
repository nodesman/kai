export interface FeedbackLoop {
    run(projectRoot: string): Promise<{ success: boolean; log: string }>;
}
