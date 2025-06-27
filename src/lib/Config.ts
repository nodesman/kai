// File: src/lib/Config.ts
import * as fsSync from 'fs'; // Use synchronous fs for config loading/saving
import path from 'path';
import yaml from 'js-yaml';
import chalk from 'chalk';

// --- Interfaces ---

interface GeminiRateLimitConfig {
    requests_per_minute?: number;
}

interface GeminiConfig {
    api_key: string; // Loaded from ENV
    model_name: string; // Primary model (e.g., Pro) - Will be required after loading
    subsequent_chat_model_name: string; // Secondary model (e.g., Flash) - Will be required after loading
    max_output_tokens?: number; // Max tokens for model response
    max_prompt_tokens?: number; // Max tokens for input (used for context building limit)
    rate_limit?: GeminiRateLimitConfig;
    max_retries?: number; // General retries (might deprecate if specific ones are better)
    retry_delay?: number; // General retry delay (might deprecate)
    generation_max_retries?: number; // Max retries specifically for the generation step (Step B)
    generation_retry_base_delay_ms?: number; // Base delay for generation step retries (ms)
    interactive_prompt_review?: boolean; // Flag for interactive review/edit
    // Add safetySettings if needed:
    // safetySettings?: SafetySetting[];
}

interface ProjectConfig {
    root_dir?: string;
    prompts_dir?: string;
    prompt_template?: string;
    chats_dir?: string; // Directory for conversation logs
    typescript_autofix?: boolean;
    autofix_iterations?: number;
}

// *** ADDED: Analysis Config Interface ***
interface AnalysisConfig {
    cache_file_path?: string;
    // phind_command?: string; // REMOVED - Determined automatically
}

// *** ADDED: Context Config Interface ***
interface ContextConfig {
    mode?: 'full' | 'analysis_cache' | 'dynamic'; // Added 'dynamic' mode
}

// Main Config structure used internally (interfaces, not class for simpler structure)
interface IConfig { // Renamed to IConfig to avoid conflict with Config class name
    gemini: Required<Omit<GeminiConfig, 'rate_limit'>> & { rate_limit?: GeminiRateLimitConfig }; // Most fields are required, rate_limit is optional object
    project: Required<ProjectConfig>; // Make project settings required internally after defaults
    analysis: Required<AnalysisConfig>; // Add analysis section
    context: ContextConfig; // Add context section (mode is optional until resolved)
    chatsDir: string; // Absolute path to chats directory (CALCULATED, NOT CREATED HERE)
}

// Type for the raw data loaded from YAML (all fields optional)
type YamlConfigData = {
    gemini?: Partial<GeminiConfig>;
    project?: Partial<ProjectConfig>;
    analysis?: Partial<AnalysisConfig>; // phind_command is removed from AnalysisConfig itself
    context?: Partial<ContextConfig>; // Added context
};

// --- Config Class ---
class ConfigLoader /* implements IConfig */ { // Let TS infer implementation details
    gemini: Required<Omit<GeminiConfig, 'rate_limit'>> & { rate_limit?: GeminiRateLimitConfig };
    project: Required<ProjectConfig>; // Use Required utility type
    analysis: Required<AnalysisConfig>; // Add analysis property
    context: ContextConfig; // Add context property (mode is optional until resolved)
    chatsDir: string; // Absolute path
    private configFilePath: string; // Store path for saving

    constructor() {
        // Resolve path relative to project root inside .kai directory
        this.configFilePath = path.resolve(process.cwd(), '.kai', 'config.yaml'); // Store path
        const loadedConfig = this.loadConfig();
        this.gemini = loadedConfig.gemini;
        this.project = loadedConfig.project;
        this.analysis = loadedConfig.analysis; // Assign loaded analysis config
        // 'context' is loaded as potentially undefined here
        this.context = loadedConfig.context;   // Assign loaded context config
        this.chatsDir = loadedConfig.chatsDir; // Use pre-calculated absolute path
    }

    private loadConfig(): IConfig {
        // Load from .kai directory
        const configPath = path.resolve(process.cwd(), '.kai', 'config.yaml');
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
            // Use synchronous existsSync for initial check during config load
            if (fsSync.existsSync(configPath)) {
                const fileContents = fsSync.readFileSync(configPath, 'utf8');
                const loadedYaml = yaml.load(fileContents);
                if (loadedYaml && typeof loadedYaml === 'object') {
                    yamlConfig = loadedYaml as YamlConfigData;
                } else {
                    console.warn(chalk.yellow(`Warning: config.yaml at ${configPath} is empty or invalid. Using defaults.`));
                }
            } else {
                 console.warn(chalk.yellow(`Warning: config.yaml not found at ${configPath}. Using defaults. Will be created if needed.`));
            }
        } catch (e) {
            console.error(chalk.red(`Error loading or parsing config.yaml at ${configPath}:`), e);
            console.warn(chalk.yellow('Continuing with default configurations...'));
        }

        // 3. Construct the final Config object with defaults
        // Define application-level defaults here
        const DEFAULT_PRIMARY_MODEL = "gemini-2.5-flash";
        const DEFAULT_SECONDARY_MODEL = "gemini-2.5-pro";

        const defaultGenerationMaxRetries = 3;
        const defaultGenerationRetryBaseDelayMs = 2000; // 2 seconds base
        const defaultInteractivePromptReview = false;

        const finalGeminiConfig: Required<Omit<GeminiConfig, 'rate_limit'>> & { rate_limit?: GeminiRateLimitConfig } = {
            api_key: apiKey, // Mandatory, loaded from env
            model_name: yamlConfig.gemini?.model_name || DEFAULT_PRIMARY_MODEL,
            subsequent_chat_model_name: yamlConfig.gemini?.subsequent_chat_model_name || DEFAULT_SECONDARY_MODEL,
            max_output_tokens: yamlConfig.gemini?.max_output_tokens || 8192,
            max_prompt_tokens: yamlConfig.gemini?.max_prompt_tokens || 32000, // Default context limit for context building
            rate_limit: {
                requests_per_minute: yamlConfig.gemini?.rate_limit?.requests_per_minute || 60
            },
            max_retries: yamlConfig.gemini?.max_retries || 3,
            retry_delay: yamlConfig.gemini?.retry_delay || 60000,
            generation_max_retries: yamlConfig.gemini?.generation_max_retries ?? defaultGenerationMaxRetries,
            generation_retry_base_delay_ms: yamlConfig.gemini?.generation_retry_base_delay_ms ?? defaultGenerationRetryBaseDelayMs,
            interactive_prompt_review: yamlConfig.gemini?.interactive_prompt_review ?? defaultInteractivePromptReview,
        };

        const finalProjectConfig: Required<ProjectConfig> = {
            root_dir: yamlConfig.project?.root_dir || "generated_project",
            prompts_dir: yamlConfig.project?.prompts_dir || "prompts",
            prompt_template: yamlConfig.project?.prompt_template || "prompt_template.yaml",
            chats_dir: yamlConfig.project?.chats_dir || ".kai/logs", // Using the updated default
            typescript_autofix: yamlConfig.project?.typescript_autofix ?? false,
            autofix_iterations: yamlConfig.project?.autofix_iterations ?? 3,
        };

        // *** ADDED: Default and Loading for Analysis Config ***
        const finalAnalysisConfig: Required<AnalysisConfig> = {
            cache_file_path: yamlConfig.analysis?.cache_file_path || ".kai/project_analysis.json",
            // phind_command removed
        };

        // *** ADDED: Default and Loading for Context Config ***
        const finalContextConfig: ContextConfig = {
            // Default to undefined if not explicitly 'full', 'analysis_cache', or 'dynamic'
            mode: ['full', 'analysis_cache', 'dynamic'].includes(yamlConfig.context?.mode ?? '')
                  ? yamlConfig.context!.mode! as 'full' | 'analysis_cache' | 'dynamic' // Use validated value if present
                  : undefined // Default to undefined signal

        };
        // *** END ADDED ***

        // Calculate absolute chats directory path (DO NOT CREATE IT HERE)
        const absoluteChatsDir = path.resolve(process.cwd(), finalProjectConfig.chats_dir);

        return {
            gemini: finalGeminiConfig,
            project: finalProjectConfig,
            analysis: finalAnalysisConfig, // Return loaded analysis config
            context: finalContextConfig,   // Return loaded context config
            chatsDir: absoluteChatsDir // Return the calculated path
        };
    }

    /**
     * Saves the current configuration state back to config.yaml (in .kai/).
     * Note: This will overwrite the existing file and might lose comments.
     * The context mode will be either 'full', 'analysis_cache', or 'dynamic' after determination/selection.
     */
    async saveConfig(): Promise<void> {
        console.log(chalk.dim(`Attempting to save configuration to ${this.configFilePath}...`));
        // Construct the object to be saved from the current instance state
        // Omit calculated fields like chatsDir and environment variables like api_key
        const configToSave: YamlConfigData = {
            project: {
                root_dir: this.project.root_dir,
                prompts_dir: this.project.prompts_dir,
                prompt_template: this.project.prompt_template,
                chats_dir: this.project.chats_dir, // Save the relative path
                typescript_autofix: this.project.typescript_autofix,
                autofix_iterations: this.project.autofix_iterations,
            },
            analysis: {
                cache_file_path: this.analysis.cache_file_path,
            },
            context: {
                // Save the mode if it's defined (will be 'full', 'analysis_cache', or 'dynamic' after determination/selection)
                mode: this.context.mode,
            },
            gemini: { // Only save non-sensitive, configurable Gemini settings
                model_name: this.gemini.model_name,
                subsequent_chat_model_name: this.gemini.subsequent_chat_model_name,
                max_output_tokens: this.gemini.max_output_tokens,
                max_prompt_tokens: this.gemini.max_prompt_tokens,
                rate_limit: this.gemini.rate_limit,
                generation_max_retries: this.gemini.generation_max_retries,
                generation_retry_base_delay_ms: this.gemini.generation_retry_base_delay_ms,
                interactive_prompt_review: this.gemini.interactive_prompt_review,
            },
        };

        try {
            // Ensure .kai directory exists before writing
            const configDir = path.dirname(this.configFilePath);
            await fsSync.promises.mkdir(configDir, { recursive: true }); // Use async mkdir for safety

            // Convert the object to YAML string
            // Filter out keys with undefined values before dumping
            const filteredConfig = Object.entries(configToSave).reduce((acc, [key, value]) => {
                if (value !== undefined && typeof value === 'object' && value !== null) {
                    const filteredSubObject = Object.entries(value).reduce((subAcc, [subKey, subValue]) => {
                         if (subValue !== undefined) {
                              // @ts-ignore // Allow dynamic assignment
                              subAcc[subKey] = subValue;
                         }
                         return subAcc;
                    }, {} as Record<string, any>);
                    // Only include sub-object if it has keys after filtering
                    if (Object.keys(filteredSubObject).length > 0) {
                         // @ts-ignore // Allow dynamic assignment
                         acc[key] = filteredSubObject;
                    }
                } else if (value !== undefined) {
                    // @ts-ignore // Allow dynamic assignment
                    acc[key] = value;
                }
                return acc;
            }, {} as Record<string, any>);

            const yamlString = yaml.dump(filteredConfig, { indent: 2, skipInvalid: true });
            // Use synchronous write for simplicity during this critical update phase
            fsSync.writeFileSync(this.configFilePath, yamlString, 'utf8');
            console.log(chalk.green(`Configuration successfully saved to ${this.configFilePath}.`));
        } catch (error) {
            console.error(chalk.red(`Error saving configuration to ${this.configFilePath}:`), error);
            // Decide if this should be fatal or just a warning
            throw new Error(`Failed to save updated configuration: ${(error as Error).message}`);
        }
    }

    /**
     * Gets the resolved absolute path to the configuration file.
     */
    public getConfigFilePath(): string {
        return this.configFilePath;
    }
}

// Export the class implementation as 'Config'
export { ConfigLoader as Config };
// Export the interface type separately if needed for type hinting elsewhere
export type { IConfig, GeminiConfig, ProjectConfig, AnalysisConfig, ContextConfig };