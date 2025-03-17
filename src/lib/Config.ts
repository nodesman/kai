// lib/Config.js
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Config {
    constructor() {
        this.config = this.loadConfig();
    }

    loadConfig() {
        let config = {};
        const configPath = path.join(__dirname, '../config/config.yaml');

        try {
            // Try to load from YAML file
            const configFile = fs.readFileSync(configPath, 'utf8');
            config = yaml.load(configFile);
        } catch (e) {
            console.warn(chalk.yellow("config.yaml not found or invalid. Using default values and environment variables."));
            // It's OK if the file doesn't exist; we'll use defaults.
            config = { gemini: {} }; // Initialize to prevent errors
        }

        // --- Gemini Configuration ---

        // 1. API Key (REQUIRED - from environment variable)
        if (!process.env.GEMINI_API_KEY) {
            console.error(chalk.red(`ERROR: Gemini API key not found.`)); // Only the "ERROR" is red
            console.error(`
To use this tool, you need a Gemini API key.  Here's how to get one and set it up:

1. ${chalk.bold('Get a Gemini API Key:')}
   - Go to Google AI Studio: ${chalk.blue.underline('https://makersuite.google.com/app/apikey')}
   - Create a new API key.

2. ${chalk.bold('Set the GEMINI_API_KEY Environment Variable (Bash/Zsh - macOS/Linux):')}
   - Open your terminal.
   - Add the following line to your shell's configuration file (usually ~/.bashrc, ~/.zshrc, or ~/.bash_profile):

     ${chalk.cyan('export GEMINI_API_KEY="your-api-key-here"')}  (Replace 'your-api-key-here' with your actual key)

   - Save the file.
   - Source the file to apply the changes (or restart your terminal):

     ${chalk.cyan('source ~/.bashrc')}  (or ~/.zshrc, or ~/.bash_profile)

3. ${chalk.bold('Set the GEMINI_API_KEY Environment Variable (Windows):')}
   - Search for "environment variables" in the Start Menu.
   - Click "Edit the system environment variables."
   - Click the "Environment Variables..." button.
   - Under "System variables," click "New..."
   - Enter "GEMINI_API_KEY" for the "Variable name."
   - Enter your actual API key for the "Variable value."
   - Click "OK" on all open windows.  You might need to restart your terminal.

4. ${chalk.bold('Verify (in a NEW terminal):')}
    - To verify, run ${chalk.cyan('echo $GEMINI_API_KEY')} (macOS/Linux) or ${chalk.cyan('echo %GEMINI_API_KEY%')} (Windows) in a *new* terminal window.
      It should print your API key.

${chalk.bold('After setting the environment variable, re-run this script.')}
`);
            process.exit(1); // Exit with an error code
        }
        config.gemini.api_key = process.env.GEMINI_API_KEY;

        // 2. Model Name (Default: gemini-1.5-pro-002)
        config.gemini.model_name = config.gemini.model_name || "gemini-1.5-pro-002";

        // 3. Rate Limit (Default: 60 requests/minute)
        config.gemini.rate_limit = config.gemini.rate_limit || {};
        config.gemini.rate_limit.requests_per_minute = (config.gemini.rate_limit.requests_per_minute || 60);

        // 4. Max Retries (Default: 3)
        config.gemini.max_retries = config.gemini.max_retries || 3;

        // 5. Retry Delay (Default: 60000 ms = 1 minute)
        config.gemini.retry_delay = config.gemini.retry_delay || 60000;

        // --- Project Configuration (Optional, with defaults) ---

        config.project = config.project || {};
        config.project.root_dir = config.project.root_dir || "generated_project";
        config.project.prompts_dir = config.project.prompts_dir || "prompts";
        config.project.conversation_file = config.project.conversation_file || "conversation.jsonl";
        config.project.prompt_history_file = config.project.prompt_history_file || "prompt_history.jsonl";
        config.project.prompt_template = config.project.prompt_template || "prompt_template.yaml";

        return config;
    }

    get(key) {
        return this.config[key];
    }
}

export { Config };