// lib/Config.ts
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import chalk from 'chalk';

// --- Interfaces (Ideally in a separate types.ts file) ---
interface GeminiConfig {
    max_prompt_tokens?: number;
    api_key: string;
    model_name?: string;
    rate_limit?: {
        requests_per_minute?: number;
    };
    max_retries?: number;
    retry_delay?: number;
}

interface OpenAIConfig {
    api_key: string;
    model_name?: string; // Added model_name for OpenAI
    api_base?: string;  // Added api_base for custom endpoints
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
    openai: OpenAIConfig;
}

// --- Config Class ---

class ConfigClass implements Config {
    gemini: GeminiConfig;
    project?: ProjectConfig;
    openai: OpenAIConfig;

    constructor() {
        const loadedConfig = this.loadConfig(); // Load once
        this.gemini = loadedConfig.gemini;
        this.openai = loadedConfig.openai;
        this.project = loadedConfig.project;
    }

    private loadConfig(): Config {
        let config: Partial<Config> = {};
        const configPath = path.join(__dirname, '../../config/config.yaml');

        try {
            const configFile = fs.readFileSync(configPath, 'utf8');
            config = yaml.load(configFile) as Partial<Config>;
        } catch (e) {
            console.warn(chalk.yellow("config.yaml not found or invalid.  Using default values and environment variables."));
            // Provide defaults for BOTH Gemini and OpenAI if config.yaml is missing.
            config = {
                gemini: { api_key: '' },
                openai: { api_key: '' },  // Initialize openai here
            };
        }

        // --- Environment Variable Checks and Error Handling ---
        if (!process.env.GEMINI_API_KEY) {
            console.error(chalk.red('Gemini API key (GEMINI_API_KEY) required as an environment variable.'));
            process.exit(1);
        }

        // Check for OpenAI API key *if* it's provided in the config file.
        // This allows users to *either* use the config file *or* the environment variable.
        if (config.openai && !config.openai.api_key && !process.env.OPENAI_API_KEY) {
            console.error(chalk.red('OpenAI API key (OPENAI_API_KEY) required.  Set either in config.yaml or as an environment variable.'));
            process.exit(1);
        }



        // --- Construct the final Config object with defaults ---

        const loadedConfig: Config = {
            gemini: {
                api_key: process.env.GEMINI_API_KEY!, // Use environment variable (checked above)
                model_name: config.gemini?.model_name || "gemini-2.0-flash",
                rate_limit: {
                    requests_per_minute: config.gemini?.rate_limit?.requests_per_minute || 60
                },
                max_retries: config.gemini?.max_retries || 3,
                retry_delay: config.gemini?.retry_delay || 1000, // Reduced to 1 second (more reasonable default)
            },
            project: {
                root_dir: config.project?.root_dir || "generated_project",
                prompts_dir: config.project?.prompts_dir || "prompts",
                conversation_file: config.project?.conversation_file || "conversation.jsonl",
                prompt_history_file: config.project?.prompt_history_file || "prompt_history.jsonl",
                prompt_template: config.project?.prompt_template || "prompt_template.yaml",
            },
            openai: {
                api_key: config.openai?.api_key || process.env.OPENAI_API_KEY || "", // Prioritize config, then env, then empty string
                model_name: config.openai?.model_name || "gpt-4o", // Sensible default
                api_base: config.openai?.api_base || "https://api.openai.com/v1",  // Default OpenAI endpoint

            }
        };

        return loadedConfig;
    }
}

export { ConfigClass as Config };