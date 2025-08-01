// src/lib/config_defaults.ts

/**
 * Default content for config.yaml when scaffolded by Kai.
 */
export const DEFAULT_CONFIG_YAML = `# Kai Configuration File (Located in .kai/config.yaml)
# Generated Default

project:
  # root_dir: "." # Default location for generated project artifacts (if used)
  prompts_dir: "prompts" # Directory for custom prompt templates
  prompt_template: "prompt_template.yaml" # Default prompt template file
  chats_dir: ".kai/logs" # Directory for conversation logs (inside .kai)
  typescript_autofix: false # Run tsc after each consolidation
  autofix_iterations: 3 # Max compile/apply iterations
  coverage_iterations: 3 # Max test coverage improvement iterations

# --- Analysis & Context Caching (Optional) ---
# analysis:
#   cache_file_path: ".kai/project_analysis.json" # Location for the analysis cache
#   # phind_command is no longer configurable; Kai checks for 'phind' then falls back to 'find'.

# --- Context Mode (Determined automatically on first run if not set) ---
# The 'context.mode' setting will be added here automatically after the first run.
# Options: "full", "analysis_cache", "dynamic"

# --- Gemini Configuration ---
gemini:
  # API Key is read from the GEMINI_API_KEY environment variable, not set here.
  model_name: "gemini-2.5-flash" # Default primary model (Flash)
  subsequent_chat_model_name: "gemini-2.5-pro" # Default secondary model
  max_output_tokens: 8192 # Max tokens for model response
  max_prompt_tokens: 32000 # Max tokens for input context (adjust based on model limits)
  rate_limit:
    requests_per_minute: 60
  # Specific retries for the generation step (Consolidation Step B)
  generation_max_retries: 3 # Retries for consolidation generation step
  generation_retry_base_delay_ms: 2000 # Base delay for generation retries (ms)
  # interactive_prompt_review: false # Set to true to manually review/edit Gemini Pro prompts before sending

# --- OpenAI Configuration (optional) ---
openai:
  # API key read from OPENAI_API_KEY environment variable
  max_output_tokens: 8192
  max_prompt_tokens: 128000
`;