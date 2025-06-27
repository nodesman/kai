# Kai - AI Coding Assistant

[![NPM Version](https://img.shields.io/npm/v/kai?style=flat-square)](https://www.npmjs.com/package/kai)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
<!-- Add build status badge if you set up CI -->
<!-- [![Build Status](https://img.shields.io/github/actions/workflow/status/nodesman/kai/YOUR_CI_WORKFLOW.yml?branch=main&style=flat-square)](https://github.com/nodesman/kai/actions) -->

Kai is a context-aware, AI-powered coding assistant designed to run locally and interact directly with your project's filesystem. It helps streamline development workflows through conversation-driven code generation, modification, and task execution.

## Key Features

*   **Conversation Mode:** Engage in an interactive chat session with an AI (powered by Google Gemini by default). Kai automatically builds context from your project files to inform the AI's responses.
*   **Consolidation Mode:** After a conversation, Kai can analyze the discussion and the current codebase to propose and apply consolidated code changes directly to your files, attempting to bring the project state in line with the conversation outcome.
*   **Context-Awareness:**
    *   Reads your project files (respecting `.gitignore` and `.kaiignore`) to provide relevant context to the AI.
    *   Supports multiple context modes:
        *   **`full`**: Includes all non-ignored text files (suitable for smaller projects).
        *   **`analysis_cache`**: Uses a pre-generated summary of the project structure and file purposes (faster for large projects, requires initial analysis).
        *   **`dynamic`**: Uses the analysis cache and the current query/history to let the AI select the most relevant files to load fully (balances context relevance and token limits).
    *   Automatically determines the best mode on the first run or allows manual selection.
*   **Project Analysis:** Can analyze your project to generate a cache (`.kai/project_analysis.json`) containing file summaries, types, and sizes, enabling efficient context handling for large repositories.
*   **Direct Filesystem Interaction:** Can create, modify, and delete files based on conversation analysis (Consolidation Mode) or direct instructions (future agentic modes).
*   **Iterative Compilation:** After applying changes Kai can run `tsc --noEmit` and feed errors back to the AI for another pass.
*   **Configurable:** Uses a local `.kai/config.yaml` for settings like AI models, token limits, and directories.
*   **Editor Integration:** Opens conversations in your default command-line editor (tested with Sublime Text's `subl --wait`, basic support for JetBrains IDEs like WebStorm, CLion, IntelliJ IDEA via their command-line launchers).

## How it Works

1.  **Initialization:** On first run in a project, Kai checks for a Git repository. If none exists (and the directory is safe or user confirms), it initializes Git and creates a `.kai` directory for logs and configuration.
2.  **Context Mode:** Determines the context mode (`full`, `analysis_cache`, `dynamic`) based on project size (token estimation) or existing configuration. If `analysis_cache` or `dynamic` is selected and the cache doesn't exist, it runs the project analysis first.
3.  **Main Menu:** Presents options to:
    *   **Start/Continue Conversation:** Loads existing history or starts a new conversation log (`.kai/logs/*.jsonl`). Opens your configured editor with the history, ready for your prompt. Context (based on the selected mode) is automatically prepended to your prompt before sending it to the AI.
    *   **Consolidate Changes:** Select a conversation. Kai analyzes the history since the last successful consolidation, compares it with the current code, generates proposed file changes (creations, modifications, deletions), and applies them *directly* to your filesystem. **It's crucial to review these changes using Git tools (`git status`, `git diff`) before committing.**
    *   **Re-run Project Analysis:** Manually triggers the analysis process to update the `.kai/project_analysis.json` cache. Useful if you've made significant changes outside of Kai.
    *   **Change Context Mode:** Allows you to manually switch between `full`, `analysis_cache`, and `dynamic` modes and saves the setting to `.kai/config.yaml`.
    *   **Delete Conversation:** Lets you select and remove conversation log files.

## Installation

### Prerequisites

*   **Node.js:** (Version specified in `package.json` or higher)
*   **npm:** (Comes with Node.js)
*   **Git:** Required for context building (.gitignore handling) and change tracking.
*   **Command-Line Editor:**
    *   **Sublime Text (Recommended Default):** Requires the `subl` command-line tool installed and in your system's PATH (usually configured during Sublime Text installation). Use the `--wait` flag.
    *   **JetBrains IDEs (Experimental):** Requires the command-line launcher to be created (e.g., via `Tools -> Create Command-line Launcher...` in the IDE) and the launcher's directory added to your system's PATH. Kai attempts to detect `webstorm`, `clion`, `idea`, etc., on macOS.
    *   Other editors might work if they have a CLI command that waits for the file to be closed.
*   **Google Gemini API Key:** Required for the AI interactions.

### Steps

1.  **Install Globally (Recommended for Users):**
    ```bash
    npm install -g kai
    ```

2.  **Set Gemini API Key:**
    Kai reads the API key from the `GEMINI_API_KEY` environment variable.
    ```bash
    # On Linux/macOS (add to ~/.bashrc, ~/.zshrc, etc. for persistence)
    export GEMINI_API_KEY='YOUR_API_KEY_HERE'

    # On Windows (Command Prompt - for current session only)
    set GEMINI_API_KEY=YOUR_API_KEY_HERE

    # On Windows (PowerShell - for current session only)
    $env:GEMINI_API_KEY = 'YOUR_API_KEY_HERE'
    ```
    *Tip: Use tools like `dotenv` or your shell's profile configuration for managing environment variables easily.*

### Development Setup (From Source)

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/nodesman/kai.git
    cd kai
    ```
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Compile TypeScript:** (Outputs to `bin/`)
    ```bash
    npm run build
    ```
4.  **Set API Key:** (See Step 2 above)
5.  **Run:**
    ```bash
    node bin/kai.js
    ```
    *(Optionally, use `npm link` to make the `kai` command available globally from your source directory)*

## Usage

1.  Navigate to your project's root directory in your terminal.
2.  Run the `kai` command:
    ```bash
    kai
    ```
    *(If running from source without `npm link`, use `node bin/kai.js`)*
3.  Follow the interactive prompts to select a mode (Start/Continue Conversation, Consolidate Changes, etc.).

**Important Notes:**

*   **Consolidation is direct:** Changes made during Consolidation Mode are applied directly to your files. Always review changes with `git status`, `git diff`, or a Git GUI before committing.
*   **Context Limits:** Be mindful of your AI model's token limits. For large projects, use the `analysis_cache` or `dynamic` context modes. Re-run analysis if needed.
*   **Editor Behavior:** Kai relies on the editor's command-line tool supporting a "wait" flag (like `subl -w`) to pause execution until you close the file. If your editor doesn't wait, the conversation loop might proceed prematurely.

## Configuration

Kai uses a configuration file located at `.kai/config.yaml` within your project directory. If it doesn't exist on the first run, a default one will be created.

Key settings include:

*   `project.chats_dir`: Location for conversation logs (default: `.kai/logs`).
*   `analysis.cache_file_path`: Location for the analysis cache (default: `.kai/project_analysis.json`).
*   `context.mode`: (`full`, `analysis_cache`, `dynamic`) - Often set automatically, but can be overridden.
*   `gemini.model_name`: Primary Gemini model to use.
*   `gemini.subsequent_chat_model_name`: Faster/cheaper Gemini model for subsequent turns (if configured).
*   `gemini.max_output_tokens`: Max tokens for the AI's response.
*   `gemini.max_prompt_tokens`: Max tokens for the input prompt (context limit).
*   `gemini.generation_max_retries`: Retries for the file generation step in consolidation.
*   `gemini.generation_retry_base_delay_ms`: Base delay for generation retries.
*   `gemini.interactive_prompt_review`: Set to `true` to review/edit prompts in Sublime Text before sending to Gemini Pro models during chat.
*   `project.typescript_autofix`: If `true`, run `tsc --noEmit` after each consolidation pass.
*   `project.autofix_iterations`: How many times Kai will attempt to re-run generation after compilation errors (default 3).

*(Refer to the `src/lib/config_defaults.ts` file for default values).*

### Iterative TypeScript Compilation

When the TypeScript feedback loop is enabled, Kai runs `npx tsc --noEmit` after applying generated changes. Any compiler errors are appended to the conversation and the generation step is retried. The process repeats up to `project.autofix_iterations` times.

## Development

*   **Build:** `npm run build` (Compiles TypeScript from `src/` to `bin/`)
*   **Test:** `npm test` (Runs Jest tests)
*   **Run Locally:** `npm start` or `node bin/kai.js`

### Versioning

This project uses `npm version` for semantic versioning. The `preversion` script runs tests and checks for a clean Git status, and `postversion` pushes the commit and tag to the remote.

*   Patch: `npm version patch -m "Upgrade to %s for [reason]"`
*   Minor: `npm version minor -m "Upgrade to %s for [feature]"`
*   Major: `npm version major -m "Upgrade to %s for [breaking change]"`

## Contributing

Contributions are welcome! Please feel free to open an issue or submit a pull request. (Add more detailed guidelines if needed, e.g., link to CONTRIBUTING.md).

## License

This project is licensed under the [MIT License](LICENSE).