// File: src/lib/Config.ts
import fs from 'fs'; // Use synchronous fs for config loading
import path from 'path';
import yaml from 'js-yaml';
import chalk from 'chalk';

// --- Interfaces ---
interface GeminiRateLimitConfig {
    requests_per_minute?: number;
}

interface GeminiConfig {
    api_key: string; // <-- Add this
    model_name?: string;
    max_prompt_tokens?: number;
    rate_limit?: GeminiRateLimitConfig;
    max_retries?: number;
    retry_delay?: number;
}

interface ProjectConfig {
    root_dir?: string;
    prompts_dir?: string;
    prompt_template?: string;
    chats_dir?: string;
}

// Main Config structure used internally
interface Config {
    gemini: GeminiConfig;
    project: ProjectConfig; // Make project non-optional internally
}

// Type for the raw data loaded from YAML (all fields optional)
type YamlConfigData = {
    gemini?: Partial<GeminiConfig>;
    project?: Partial<ProjectConfig>;
};

// --- Config Class ---
class ConfigClass implements Config {
    gemini: GeminiConfig;
    project: ProjectConfig;
    chatsDir: string; // Absolute path

    constructor() {
        const loadedConfig = this.loadConfig();
        this.gemini = loadedConfig.gemini;
        this.project = loadedConfig.project;
        this.chatsDir = path.resolve(process.cwd(), this.project.chats_dir || '.kaichats'); // Use loaded project config
    }

    private loadConfig(): Config {
        const configPath = path.resolve(process.cwd(), 'config.yaml');
        let yamlConfig: YamlConfigData = {}; // Initialize as empty object

        // 1. Load API Key from Environment Variable
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error(chalk.red('Error: GEMINI_API_KEY environment variable is not set.'));
            console.log(chalk.yellow('Please set the GEMINI_API_KEY environment variable with your API key.'));
            process.exit(1); // Exit if API key is missing
        }

        // 2. Load config.yaml
        try {
            if (fs.existsSync(configPath)) {
                const fileContents = fs.readFileSync(configPath, 'utf8');
                const loadedYaml = yaml.load(fileContents);
                if (loadedYaml && typeof loadedYaml === 'object') {
                    yamlConfig = loadedYaml as YamlConfigData;
                } else {
                    console.warn(chalk.yellow(`Warning: config.yaml at ${configPath} is empty or invalid. Using defaults.`));
                }
            } else {
                console.warn(chalk.yellow(`Warning: config.yaml not found at ${configPath}. Using defaults.`));
            }
        } catch (e) {
            console.error(chalk.red(`Error loading or parsing config.yaml at ${configPath}:`), e);
            // Decide if you want to exit or continue with defaults
            console.warn(chalk.yellow('Continuing with default configurations...'));
        }

        // 3. Construct the final Config object with defaults
        const finalConfig: Config = {
            gemini: {
                api_key: apiKey, // Mandatory, loaded from env
                model_name: yamlConfig.gemini?.model_name || "gemini-1.5-pro-latest", // Default model
                max_prompt_tokens: yamlConfig.gemini?.max_prompt_tokens || 8000,
                rate_limit: {
                    requests_per_minute: yamlConfig.gemini?.rate_limit?.requests_per_minute || 60
                },
                max_retries: yamlConfig.gemini?.max_retries || 3,
                retry_delay: yamlConfig.gemini?.retry_delay || 60000,
            },
            project: {
                // Use defaults if values are missing in yamlConfig.project
                root_dir: yamlConfig.project?.root_dir || "generated_project",
                prompts_dir: yamlConfig.project?.prompts_dir || "prompts",
                prompt_template: yamlConfig.project?.prompt_template || "prompt_template.yaml",
                chats_dir: yamlConfig.project?.chats_dir || ".kaichats",
            }
        };

        // Ensure chats directory exists immediately
        try {
            let absoluteChatsDir: string;
            if (finalConfig.project.chats_dir === undefined) {
                throw new Error("Configuration error: 'project.chats_dir' must be defined in your configuration.");
            }
            absoluteChatsDir = path.resolve(process.cwd(), finalConfig.project.chats_dir);
            if (!fs.existsSync(absoluteChatsDir)) {
                fs.mkdirSync(absoluteChatsDir, { recursive: true });
                console.log(`Created chats directory: ${absoluteChatsDir}`);
            }
        } catch (dirError) {
            console.error(chalk.red(`Fatal: Could not create chats directory at ${finalConfig.project.chats_dir}:`), dirError);
            process.exit(1);
        }


        return finalConfig;
    }
}

// Export the class itself, typically used as `new Config()`
export { ConfigClass as Config };
// Also export the interface if needed elsewhere for type hints
export type { Config as IConfig, GeminiConfig, ProjectConfig };