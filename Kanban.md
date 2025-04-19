# Kai Agentic Development Kanban Board

**Goal:** Build and refine the Kai agentic systems for requirements clarification (System 1) and test-driven implementation (System 2), alongside maintaining the existing Consolidation Service.

---

## Epics & Features

*   **E1: Core Infrastructure & Shared Services** (Refinements needed for agentic workflows)
*   **E2: System 1 - Agentic Requirements Clarification & Specification Generation**
*   **E3: System 2 - Agentic Test-Driven Development/Implementation**
*   **E4: Consolidation Service** (Maintenance & Integration)
*   **E5: Evaluation & Testing** (Testing the Kai system itself)
*   **E6: Future Exploration** (Lower priority research)

---

## Backlog (To Do)

*(Tasks prioritized roughly)*

### E1: Core Infrastructure & Shared Services

*   **[ ] Task: Automatically Initialize Git Repository**
    *   **Details:** Modify `GitService.checkCleanStatus`. When the "not a git repository" error is detected:
        *   Log a message indicating initialization attempt.
        *   Use `CommandService` to execute `git init` in the `projectRoot`.
        *   Log success message if `git init` completes.
        *   Handle errors during `git init` (e.g., `git` not found, permissions) and throw an informative error.
        *   If `git init` succeeds, `checkCleanStatus` should effectively return as 'clean'.
    *   **Depends on:** `CommandService`
    *   **Priority:** Medium
*   **[ ] Task: Refactor `AIClient`**
    *   **Details:** Clearly separate Pro/Flash model selection logic. Implement robust error handling/retry for `generateContent` (using config). Add support for selecting OpenAI models via `Config` (requires adding OpenAI keys/config). Ensure logging includes model used.
    *   **Depends on:** -
    *   **Priority:** High
*   **[ ] Task:** Enhance `FileSystem`
    *   **Details:** Implement a reliable `applyDiffToFile(filePath, diffContent)` method using the `diff` library (specifically `Diff.applyPatch`). Ensure it handles file creation (`+++`) and deletion (`---` only) markers correctly within the diff content provided by the AI, alongside modifications. Ensure `ensureDirExists` is used appropriately. Add logic to `readGitignore` to create `.gitignore` if missing and append `.kai/logs/` rule if missing from existing file.
    *   **Depends on:** -
    *   **Priority:** High
*   **[ ] Task:** Enhance `CommandService` / Create `TestRunnerService`
    *   **Details:** Design a way to reliably execute *specific* tests for different frameworks. Start with Jest (`jest <filePath> -t "<testName>"`). Abstract the command generation logic so adding support for `pytest -k`, `cargo test <name>`, etc., is easier later. Ensure it captures `stdout`, `stderr`, and `exitCode` clearly.
    *   **Depends on:** -
    *   **Priority:** High (Crucial for System 2)
*   **[ ] Task:** Implement Test Output Parsers
    *   **Details:** Create parsers (initially for Jest's text output) to reliably extract: failed test names, error messages, stack traces (including file paths and line numbers). Plan for parsing structured formats like JUnit XML or JSON reporters, which are more robust long-term. The output should be a structured object usable by System 2's analysis step.
    *   **Depends on:** `CommandService` enhancements
    *   **Priority:** High (Crucial for System 2)
*   **[ ] Task:** Standardize Logging
    *   **Details:** Implement a consistent logging format/library across all services (`CodeProcessor`, `ConsolidationService`, new Agentic services) for easier debugging. Include timestamps, service names, severity levels.
    *   **Depends on:** -
    *   **Priority:** Medium
*   **[ ] Task:** Refine `Config`
    *   **Details:** Change default `chats_dir` to `.kai/logs`. Add configuration sections specifically for System 1 and System 2 (e.g., default prompts, max iterations, analysis model preferences, test framework configurations). Add OpenAI config if implementing that model support. Ensure `.kai/logs` directory is created on startup.
    *   **Depends on:** -
    *   **Priority:** Medium

### E2: System 1 - Agentic Requirements Clarification & Specification Generation

*   **[ ] Task:** Design `Specification` Data Structure
    *   **Details:** Define the precise output format of System 1. What fields are needed to unambiguously drive System 2? Include: Feature description, User Stories/Use Cases, detailed UI element descriptions (derived from HTML/clarification), Data Models, API contracts (if any), Non-functional requirements, **Test Skeletons/Scenarios** (e.g., array of { description: string, type: 'unit'|'integration', focusArea: string }).
    *   **Depends on:** -
    *   **Priority:** High
*   **[ ] Task:** Implement `RequirementAgentService`
    *   **Details:** The main orchestrator for System 1. Manages the conversation flow, calls AI for analysis/clarification, interacts with the user (via `InteractionManager`), and generates the final `Specification` object.
    *   **Depends on:** `Specification` Design, `InteractionManager`, `AIClient`
    *   **Priority:** High
*   **[ ] Task:** Implement `InteractionManager` (for System 1)
    *   **Details:** Handles the back-and-forth clarification Q&A with the user. Could adapt `UserInterface` or use WebSocket connection. Needs to present AI questions and collect user answers.
    *   **Depends on:** -
    *   **Priority:** High
*   **[ ] Task:** Develop AI Prompts & Function Calls for Requirement Analysis
    *   **Details:** Implement the prompts and corresponding function call definitions (`FunctionDeclaration`) for inferential tasks like:
        *   `analyze_requirement_completeness`: Identifies gaps/ambiguities.
        *   `propose_implementation_plan`: Breaks down features, identifies files.
        *   `generate_test_scenarios`: Suggests unit/integration/edge case tests based on the spec.
    *   **Depends on:** `AIClient` function call support
    *   **Priority:** High
*   **[ ] Task:** Implement "Requirement Linting"
    *   **Details:** Create logic (possibly AI-driven via another prompt/function call) to check the *user's input* and the *intermediate specification* for sufficient detail, consistency, and clarity before finalization. Flags issues back to the user via `InteractionManager`.
    *   **Depends on:** `RequirementAgentService`
    *   **Priority:** Medium
*   **[ ] Task:** Integrate HTML Input Processing (Optional but discussed)
    *   **Details:** If desired, add capability for System 1 to accept HTML mockups, parse them, and incorporate the structure/elements into the clarification process and the final UI description within the `Specification`.
    *   **Depends on:** `RequirementAgentService`
    *   **Priority:** Medium-Low
*   **[ ] Task:** Define System 1 -> System 2 Interface
    *   **Details:** Formalize how the `Specification` object from System 1 is passed to and consumed by System 2. Ensure all necessary information is present.
    *   **Depends on:** `Specification` Design
    *   **Priority:** High

### E3: System 2 - Agentic Test-Driven Development/Implementation

*   **[ ] Task:** Implement `AgenticTddService`
    *   **Details:** The main orchestrator for the TDD loop. Takes the `Specification` from System 1. Manages state (current test, attempts, errors). Calls `TestRunnerService`, parses output, calls `AIClient` for diagnosis/generation, applies patches, and iterates. Handles the overall start/stop/success/failure logic.
    *   **Depends on:** System 1 Interface, `TestRunnerService`, `Test Output Parsers`, `AIClient`, `FileSystem` (`applyDiffToFile`)
    *   **Priority:** High
*   **[ ] Task:** Develop AI Prompts & Function Calls for TDD Loop
    *   **Details:** Implement prompts and `FunctionDeclaration`s for:
        *   `generate_test_code`: Creates test code based on `Specification` skeletons/scenarios.
        *   `diagnose_test_failure`: Analyzes parsed test output + code context to suggest cause/strategy.
        *   `generate_code_fix_or_impl`: Generates code (full file or diff) to pass the current failing test based on diagnosis/spec.
        *   `suggest_next_test_to_implement`: (Optional refinement) Chooses next test based on plan.
    *   **Depends on:** `AIClient`, `Specification` Design, `Test Output Parsers`
    *   **Priority:** High
*   **[ ] Task:** Integrate `ProjectContextBuilder` for Focused Context
    *   **Details:** Modify how context is built for System 2. Instead of sending the whole project, use the `Specification` (files to touch) and test failure info (stack trace file/line) to build a more focused context for the AI prompts, respecting token limits.
    *   **Depends on:** `ProjectContextBuilder`, `Test Output Parsers`
    *   **Priority:** High
*   **[ ] Task:** Implement Human Review/Intervention Point
    *   **Details:** Adapt the `ConsolidationReviewer` TUI (or create a new UI) to display proposed patches *within* the TDD loop. Allow the user to approve/reject/edit the patch or provide guidance if the agent gets stuck after multiple failed attempts. Define triggers for invoking review (e.g., >N failed attempts, complex diff, specific error types).
    *   **Depends on:** `AgenticTddService`, `ConsolidationReviewer` (or replacement)
    *   **Priority:** Medium-High
*   **[ ] Task:** Integrate Coverage Analysis (Optional Enhancement)
    *   **Details:** Add steps to:
        *   Run tests with coverage enabled (`jest --coverage`).
        *   Configure/use coverage reporters (e.g., JSON summary, LCOV).
        *   Implement parsing for the coverage report.
        *   Add logic to `AgenticTddService` to analyze coverage after feature implementation and potentially trigger `generate_test_code` for uncovered areas.
    *   **Depends on:** `AgenticTddService`, `TestRunnerService`
    *   **Priority:** Medium-Low

### E4: Consolidation Service

*   **[ ] Task:** Maintain/Refactor Consolidation Service
    *   **Details:** Ensure the existing service continues to function for its intended use cases (IaC, config files, non-TDD changes). Refactor if necessary to better share components with System 1/2 (like `AIClient`, `FileSystem`). Ensure clear separation of concerns.
    *   **Depends on:** -
    *   **Priority:** Medium

### E5: Evaluation & Testing

*   **[ ] Task:** Define Evaluation Scenarios & Metrics
    *   **Details:** Create specific coding tasks (e.g., "Add a new API endpoint", "Implement a CLI flag", "Fix this specific type error") in test repositories. Define metrics: Success Rate (fully automated?), Number of Iterations, Human Interventions Required, Time Taken, Code Quality (manual assessment), Test Coverage Achieved.
    *   **Depends on:** Systems 1 & 2 being partially functional.
    *   **Priority:** Medium
*   **[ ] Task:** Implement Automated Evaluation Harness (Optional)
    *   **Details:** Script the process of running Kai (Systems 1 & 2) against the evaluation scenarios and collecting metrics automatically.
    *   **Depends on:** Evaluation Scenarios
    *   **Priority:** Low

### E6: Future Exploration

*   **[X] Task:** Evaluate AI Pseudocode Following (Tracked Separately)
    *   **Priority:** Medium -> **Done** (Assumed you've done some initial testing)
*   **[ ] Task:** Investigate C++/Embedded Support (Tracked Separately)
    *   **Priority:** Very Low

---

## In Progress

*(Move tasks here from Backlog when started)*

*   *(Example)* **[ ] Task:** Enhance `FileSystem`

---

## Done

*(Move tasks here when completed)*

*   **[X] Task:** Add Automatic Git Tagging (SemVer Patch Increment)
    *   **Details:** Implemented `GitService.getLatestSemverTag` and `GitService.createAnnotatedTag`. Modified `ConsolidationService._runTaggingStep` to fetch the latest tag with prefix `kai_consolidate_v`, parse the SemVer, increment the patch version (starting from `v0.1.0` if no tag exists), and create a new annotated tag (e.g., `kai_consolidate_v0.1.1`) after successful, user-approved consolidation.
    *   **Depends on:** `CommandService`, `ConsolidationService` structure
    *   **Priority:** Medium -> **Done**