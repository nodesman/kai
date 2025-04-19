# Kai - AI Coding Assistant

Kai is an AI-powered coding assistant designed to help with various development tasks, including code generation, conversation-driven development, and code consolidation.

## Features

*   **Conversation Mode:** Engage in a chat-like interface where Kai can generate code, answer questions, and modify files based on your prompts.
*   **Consolidation Mode:** Analyze conversation history and codebase context to propose and apply consolidated changes, bringing the codebase in line with the discussion.
*   **Context-Aware:** Reads your project files (respecting `.gitignore`) to provide relevant context to the AI.
*   **Interactive Review:** (Consolidation) Offers a terminal-based UI to review and approve proposed file changes before they are applied.
*   **(Experimental) Agentic Systems:** Future work includes agentic systems for requirements clarification and test-driven development.

## Getting Started

### Prerequisites

*   Node.js (Version recommended by `package.json` or higher)
*   npm (comes with Node.js)
*   Git
*   Sublime Text (with `subl` command-line tool installed and in your system's PATH) - Required for the interactive conversation editor.
*   A Gemini API Key (set as the `GEMINI_API_KEY` environment variable).

### Installation

1.  Clone the repository:
    ```bash
    git clone <repository-url>
    cd kai
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Compile TypeScript:
    ```bash
    npm run build
    ```
4.  Set the environment variable:
    ```bash
    # On Linux/macOS
    export GEMINI_API_KEY='YOUR_API_KEY_HERE'

    # On Windows (Command Prompt)
    set GEMINI_API_KEY=YOUR_API_KEY_HERE

    # On Windows (PowerShell)
    $env:GEMINI_API_KEY = 'YOUR_API_KEY_HERE'
    ```
    *(Consider using a tool like `dotenv` or adding this to your shell profile for persistence)*

### Running Kai

Execute the main command from the project root:

```bash
node bin/kai.js
```

Or, if you link the package globally (optional):

```bash
npm link
kai
```

Kai will then prompt you to select a mode:

*   **Start/Continue Conversation:** Opens the Sublime Text editor interface for interacting with the AI.
*   **Consolidate Changes...:** Runs the consolidation process for a selected conversation.
*   **Delete Conversation...:** Allows you to select and delete logged conversations.

## Configuration

Kai uses a `config.yaml` file in the project root for settings like AI model names, token limits, and directory paths. See the `config.yaml` file for available options and defaults.

## Manual Version Tagging

To manually create version tags (following SemVer) for stable points in your codebase, use the standard `npm version` command. This is useful for marking releases or known good states.

1.  **Ensure your working directory is clean:** Commit or stash any pending changes (`git status`).
2.  **Run `npm version`:**
    *   **Patch Release (e.g., 0.1.0 -> 0.1.1):** For bug fixes or minor changes.
        ```bash
        npm version patch -m "Upgrade to %s for [brief reason]"
        ```
    *   **Minor Release (e.g., 0.1.1 -> 0.2.0):** For new features that are backward-compatible.
        ```bash
        npm version minor -m "Upgrade to %s for [new feature description]"
        ```
    *   **Major Release (e.g., 0.2.0 -> 1.0.0):** For breaking changes.
        ```bash
        npm version major -m "Upgrade to %s for [description of breaking change]"
        ```
    *   **(Optional) Set a specific version:**
        ```bash
        npm version 1.2.3 -m "Set specific version %s"
        ```
    *(The `%s` in the message will be replaced with the new version number.)*

3.  **Push changes:** After running `npm version`, push the commit and the new tag to your remote repository:
    ```bash
    git push && git push --tags
    ```

*(Note: Kai's consolidation process does **not** automatically tag or commit changes. Use `npm version` as described above for manual, deliberate versioning of the project.)*

## Development

*   **Testing:** Run tests using `npm test`.
*   **Building:** Compile TypeScript using `npm run build`.

## Contributing

*(Add contribution guidelines if applicable)*

## License

*(Specify project license, e.g., MIT)*