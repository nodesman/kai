// lib/Config.ts
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import chalk from 'chalk';

// --- Interfaces (Ideally in a separate types.ts file) ---
interface GeminiConfig {
    api_key: string;
    model_name?: string;
    rate_limit?: {
        requests_per_minute?: number;
    };
    max_retries?: number;
    retry_delay?: number;
}

interface ProjectConfig {
    root_dir?: string;
    prompts_dir?: string;
    conversation_file?: string;
    prompt_history_file?: string;
    prompt_template?: string;
}

interface Config {
    gemini: GeminiConfig;
    project?: ProjectConfig;
}

// --- Config Class ---

class ConfigClass implements Config {
    gemini: GeminiConfig;   // Property declaration
    project?: ProjectConfig; // Property declaration

    constructor() {
        // Initialize gemini directly in the constructor
        this.gemini = this.loadConfig().gemini;
        this.project = this.loadConfig().project;
    }

    private loadConfig(): Config { // Return the full Config object
        let config: Partial<Config> = {};
        const configPath = path.join(__dirname, '../../config/config.yaml');

        try {
            const configFile = fs.readFileSync(configPath, 'utf8');
            config = yaml.load(configFile) as Partial<Config>;
        } catch (e) {
            console.warn(chalk.yellow("config.yaml not found or invalid.  Using default values and environment variables."));
            config = { gemini: { api_key: '' } }; // Still provide a default, but with api_key
        }

        if (!process.env.GEMINI_API_KEY) {
            console.error(chalk.red('Gemini API key required'));
            process.exit(1);
        }

        // Construct the final Config object
        const loadedConfig: Config = { // Create a full Config object
            gemini: {
                api_key: process.env.GEMINI_API_KEY!, // Use the non-null assertion (!)
                model_name: config.gemini?.model_name || "gemini-1.5-pro-002",
                rate_limit: {
                    requests_per_minute: config.gemini?.rate_limit?.requests_per_minute || 60
                },
                max_retries: config.gemini?.max_retries || 3,
                retry_delay: config.gemini?.retry_delay || 60000,
            },
            project: {
                root_dir: config.project?.root_dir || "generated_project",
                prompts_dir: config.project?.prompts_dir || "prompts",
                conversation_file: config.project?.conversation_file || "conversation.jsonl",
                prompt_history_file: config.project?.prompt_history_file || "prompt_history.jsonl",
                prompt_template: config.project?.prompt_template || "prompt_template.yaml",
            }
        };


        return loadedConfig; // Return the complete Config object
    }
}

export { ConfigClass as Config };