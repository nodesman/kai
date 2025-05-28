# How to Run the Agentic TDD System Locally

This document provides instructions on how to set up your environment and run the `system2-test-rig.ts` script to see the Agentic TDD system in action.

## 1. Setup Your Environment

Before you can run the script, you need to ensure your local environment is correctly set up.

*   **Clone the Repository:**
    If you haven't already, clone the repository to your local machine. Make sure you have the latest version of the code.
    ```bash
    # git clone <repository_url>
    # cd <repository_directory>
    ```

*   **Install Node.js and Yarn:**
    The project uses Node.js and Yarn for package management. If you don't have them installed, please download and install them from their official websites:
    *   Node.js: [https://nodejs.org/](https://nodejs.org/)
    *   Yarn: [https://yarnpkg.com/](https://yarnpkg.com/)

*   **Install Dependencies:**
    Once Node.js and Yarn are installed, open your terminal, navigate to the root directory of the cloned repository, and run the following command to install the project's dependencies:
    ```bash
    yarn install
    ```

## 2. Run the Test Rig (`system2-test-rig.ts`)

The `system2-test-rig.ts` script is the entry point for testing the Agentic TDD service (`AgenticTddService`). You can run it with different configurations:

*   **A. Run with the Default Calculator Scenario:**
    This is the simplest test case. It demonstrates the TDD flow for adding a `subtract` method to a sample `Calculator` class.
    ```bash
    npx ts-node src/lib/system2-test-rig.ts
    ```

*   **B. Run with a Specific Comprehensive Specification:**
    These commands use one of the detailed JSON specification files. This will show the system orchestrating a more complex (though still simulated by the scripted AI) task.
    *   **Electron Notepad App:**
        ```bash
        npx ts-node src/lib/system2-test-rig.ts --spec docs/sample-specifications/electron-notepad-spec.json
        ```
    *   **Electron Scientific Calculator App:**
        ```bash
        npx ts-node src/lib/system2-test-rig.ts --spec docs/sample-specifications/electron-scientific-calculator-spec.json
        ```
    *   **Personal Finance App:**
        ```bash
        npx ts-node src/lib/system2-test-rig.ts --spec docs/sample-specifications/personal-finance-app-spec.json
        ```

## 3. What to Expect in the Console Output

When you run the script, you will see extensive console output. This output details the steps the `AgenticTddService` is taking during its TDD process:

*   **Specification Loading:** Indication of which specification is being used (default or from a file).
*   **Test Generation:** Attempts to generate test code for each scenario (Note: the AI is currently scripted, so the generated test code will be basic and may not be fully functional for complex scenarios).
*   **Test Execution:** Running the generated tests. These will likely fail initially.
*   **Code Fix Generation:** Attempts to generate code fixes based on test failures (Note: AI is scripted).
*   **Applying Fixes:** Simulating the application of these fixes.
*   **Re-running Tests:** Running tests again to see if the fixes worked.
*   **Holistic Remediation:** If multiple tests fail (or if initial fixes lead to regressions within the same specification), you'll see logs indicating the "holistic remediation" logic is being invoked. This involves gathering all current failures and asking the AI for a comprehensive fix.
*   **File Operations:** Messages about creating temporary test files, and attempts to read/write application files as specified in the `Specification`.

## 4. Important Considerations & Expected "Errors"

*   **Scripted AI (`SimpleAiModelService`):**
    The "AI" used in this test rig is **scripted**. It returns predefined, placeholder responses and does **not** actually understand the code or generate real, functional application logic for complex features. The primary purpose of running this rig is to observe the **orchestration logic** of the `AgenticTddService` – how it manages the TDD workflow.

*   **File System Operations & `ENOENT` Errors (for Comprehensive Specs):**
    *   For the **default calculator scenario**, the rig is set up to modify (and then restore) the actual `src/lib/sample-project/calculator.ts` file.
    *   For the **comprehensive specifications** (notepad, scientific calculator, finance app), the application files specified in the JSON (e.g., `src/finance-app/services/transaction-service.ts`) do **not** actually exist in the project. The scripted AI also does not create these files in their correct, specified paths.
    *   **Therefore, you should expect to see `ENOENT: no such file or directory` errors** when the `TestRunnerService` tries to copy these non-existent files for testing, or when `AgenticTddService` attempts to read their content for the AI prompt. This is normal and expected with the current scripted setup. The key thing to observe is that the `AgenticTddService` itself handles these situations (e.g., by logging the error and continuing its process or failing a specific scenario) rather than crashing.

*   **Holistic Fix Parsing Error (`SyntaxError`):**
    When the holistic remediation logic is triggered for complex specs, the scripted AI currently provides a placeholder comment string (e.g., `/* SimpleAiModelService: Generic placeholder response. */`) as a "holistic fix." The `AgenticTddService` expects a JSON response here.
    *   **Therefore, you should expect to see a `SyntaxError: Unexpected token / in JSON at position 0` (or similar)** when the system tries to parse this non-JSON response. This is also an expected outcome with the current scripted AI and highlights an area for integration with a real AI model.

Running these commands will give you a good feel for the control flow within `AgenticTddService` and how it attempts to manage an automated TDD process. If you have further questions, please refer back to the main project documentation or ask for clarification.
