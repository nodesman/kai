// File: src/lib/Config.ts
import fs from 'fs'; // Use synchronous fs for config loading
import path from 'path';
import yaml from 'js-yaml';
import chalk from 'chalk';

// --- Interfaces ---
interface GeminiRateLimitConfig {
    requests_per_minute?: number;
}

// *** ADDED subsequent_chat_model_name AND RETRY SETTINGS ***
interface GeminiConfig {
    api_key: string; // Loaded from ENV
    model_name?: string; // Primary model (e.g., Pro)
    subsequent_chat_model_name?: string; // Secondary model (e.g., Flash)
    max_output_tokens?: number; // Max tokens for model response
    max_prompt_tokens?: number; // Max tokens for input (used for context building limit)
    rate_limit?: GeminiRateLimitConfig;
    max_retries?: number; // General retries (might deprecate if specific ones are better)
    retry_delay?: number; // General retry delay (might deprecate)
    generation_max_retries?: number; // Max retries specifically for the generation step (Step B) <-- ADDED
    generation_retry_base_delay_ms?: number; // Base delay for generation step retries (ms) <-- ADDED
    // Add safetySettings if needed:
    // safetySettings?: SafetySetting[];
}
// *** END ADDITION ***

interface ProjectConfig {
    root_dir?: string;
    prompts_dir?: string;
    prompt_template?: string;
    chats_dir?: string; // Directory for conversation logs
}

// Main Config structure used internally (interfaces, not class for simpler structure)
interface IConfig { // Renamed to IConfig to avoid conflict with Config class name
    gemini: GeminiConfig;
    project: Required<ProjectConfig>; // Make project settings required internally after defaults
    chatsDir: string; // Absolute path to chats directory
}

// Type for the raw data loaded from YAML (all fields optional)
type YamlConfigData = {
    gemini?: Partial<GeminiConfig>;
    project?: Partial<ProjectConfig>;
};

// --- Config Class ---
// Renamed class to avoid conflict with IConfig interface
class ConfigLoader implements IConfig {
    gemini: GeminiConfig;
    project: Required<ProjectConfig>; // Use Required utility type
    chatsDir: string; // Absolute path

    constructor() {
        const loadedConfig = this.loadConfig();
        this.gemini = loadedConfig.gemini;
        this.project = loadedConfig.project;
        this.chatsDir = loadedConfig.chatsDir; // Use pre-calculated absolute path
    }

    private loadConfig(): IConfig {
        const configPath = path.resolve(process.cwd(), 'config.yaml');
        let yamlConfig: YamlConfigData = {};

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
            console.warn(chalk.yellow('Continuing with default configurations...'));
        }

        // 3. Construct the final Config object with defaults
        // Default subsequent model to Flash if not specified
        const defaultSubsequentModel = "gemini-2.0-flash";
        const defaultGenerationMaxRetries = 3;
        const defaultGenerationRetryBaseDelayMs = 2000; // 2 seconds base

        const finalGeminiConfig: GeminiConfig = {
            api_key: apiKey, // Mandatory, loaded from env
            model_name: yamlConfig.gemini?.model_name || "gemini-2.5-pro-preview-03-25", // Default initial model
            subsequent_chat_model_name: yamlConfig.gemini?.subsequent_chat_model_name || defaultSubsequentModel, // Default subsequent
            max_output_tokens: yamlConfig.gemini?.max_output_tokens || 8192,
            max_prompt_tokens: yamlConfig.gemini?.max_prompt_tokens || 32000, // Default context limit for context building
            rate_limit: {
                requests_per_minute: yamlConfig.gemini?.rate_limit?.requests_per_minute || 60
            },
            // Keep general retry settings for now, but prioritize specific ones
            max_retries: yamlConfig.gemini?.max_retries || 3,
            retry_delay: yamlConfig.gemini?.retry_delay || 60000,
            // *** USE new generation retry settings ***
            generation_max_retries: yamlConfig.gemini?.generation_max_retries ?? defaultGenerationMaxRetries,
            generation_retry_base_delay_ms: yamlConfig.gemini?.generation_retry_base_delay_ms ?? defaultGenerationRetryBaseDelayMs,
        };

        const finalProjectConfig: Required<ProjectConfig> = {
            root_dir: yamlConfig.project?.root_dir || "generated_project",
            prompts_dir: yamlConfig.project?.prompts_dir || "prompts",
            prompt_template: yamlConfig.project?.prompt_template || "prompt_template.yaml",
            chats_dir: yamlConfig.project?.chats_dir || ".kaichats",
        };

        // Calculate absolute chats directory path
        const absoluteChatsDir = path.resolve(process.cwd(), finalProjectConfig.chats_dir);

        // Ensure chats directory exists immediately
        try {
            if (!fs.existsSync(absoluteChatsDir)) {
                fs.mkdirSync(absoluteChatsDir, { recursive: true });
                console.log(chalk.blue(`Created chats directory: ${absoluteChatsDir}`));
            }
        } catch (dirError) {
            console.error(chalk.red(`Fatal: Could not create chats directory at ${absoluteChatsDir}:`), dirError);
            process.exit(1);
        }

        return {
            gemini: finalGeminiConfig,
            project: finalProjectConfig,
            chatsDir: absoluteChatsDir
        };
    }
}

// Export the class implementation as 'Config'
export { ConfigLoader as Config };
// Export the interface type separately if needed for type hinting elsewhere
export type { IConfig, GeminiConfig, ProjectConfig };