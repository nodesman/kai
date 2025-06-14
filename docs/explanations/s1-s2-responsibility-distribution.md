# Documentation: Responsibility Distribution between System 1 and System 2

**Question:** What is the distribution of responsibility between System 1 and System 2? Specifically, what information/output does System 1 provide, and is the implementation code already generated before System 2 starts its TDD loop?

**Date:** 2024-09-07

## 1. Overview

The agentic workflow in Kai is divided into two distinct systems, each with a clear responsibility, ensuring a structured and verifiable process from user request to implemented code.

*   **System 1 (Requirements):** Focuses on understanding **WHAT** needs to be built or changed. Its responsibility is clarification, requirement gathering, and detailed planning.
*   **System 2 (TDD Implementation):** Focuses on **HOW** to implement the plan defined by System 1. Its responsibility is the methodical, test-driven generation and verification of code changes.

This separation ensures that implementation (System 2) proceeds based on a clear, unambiguous, and validated plan (the output of System 1), rather than attempting to interpret raw user requests directly.

## 2. System 1: Requirements Clarification & Specification Generation

*   **Primary Responsibility:** To transform a user's request (which might be somewhat ambiguous or incomplete) into a formal, detailed, and testable specification.
*   **Input:**
    *   User's initial request (e.g., "Add a feature X", "Modify function Y").
    *   Relevant existing code context (provided by `ProjectContextBuilder`).
*   **Process:**
    *   **Clarification:** Engages in a potential back-and-forth Q&A with the user (via `InteractionManager`) to resolve ambiguities, define scope, and gather necessary details. (See `RequirementAgentService`, `InteractionManager` tasks in `Kanban.md.bak`).
    *   **Analysis:** Analyzes the request against the provided code context (as discussed in the answer to Question 2). Uses AI (potentially with function calls like `analyze_requirement_completeness`) to identify gaps or inconsistencies.
    *   **Planning:** Breaks down the requirement into smaller, manageable parts. Identifies necessary code changes, new components, data models, etc.
    *   **Test Definition:** Crucially, defines **test scenarios** (unit, integration, edge cases) that will be used to verify the implementation. (See `generate_test_scenarios` AI task).
*   **Output: The `Specification`**
    *   System 1's final output is a structured data object, the **`Specification`**. (See `Design Specification Data Structure` task in `Kanban.md.bak`).
    *   This `Specification` is the formal plan passed to System 2. It contains details like:
        *   Feature description / Goal.
        *   Affected files/modules.
        *   Detailed description of changes (e.g., function signature changes, new logic).
        *   Data models / API contracts (if applicable).
        *   **Test Scenarios / Skeletons:** A list of tests that need to pass for the implementation to be considered complete (e.g., `{ description: "Test VAT calculation", type: 'unit', focusArea: 'billing.calculateTotal' }`).
    *   **Crucially, the `Specification` does NOT contain the final implementation code.** It defines *what* needs to be done and *how to test it*, but not the code itself.

## 3. System 2: Test-Driven Development (TDD) Implementation

*   **Primary Responsibility:** To take the `Specification` from System 1 and implement the required changes using a rigorous Test-Driven Development (TDD) cycle.
*   **Input:**
    *   The **`Specification`** object generated by System 1.
    *   The current state of the codebase.
*   **Process (TDD Loop - See `AgenticTddService` tasks in `Kanban.md.bak`):**
    1.  **Select Test:** Choose a test scenario from the `Specification`.
    2.  **Generate Test Code:** Use AI (`generate_test_code` prompt) to write the actual test code based on the scenario.
    3.  **Run Test (Expect Fail):** Execute the test using `TestRunnerService`. It's expected to fail against the current code.
    4.  **Analyze Failure:** Use AI (`diagnose_test_failure` prompt) to analyze the specific failure output (error, stack trace) in the context of the `Specification` and relevant code snippets (provided via focused `ProjectContextBuilder`).
    5.  **Generate Code/Diff:** Use AI (`generate_code_fix_or_impl` prompt) to generate the **minimal code change (ideally a diff)** required to make *that specific test* pass. **This is where the implementation code is generated, step-by-step.**
    6.  **Apply Change:** Apply the generated diff/code using `FileSystem.applyDiffToFile`.
    7.  **Re-run Test (Expect Pass):** Execute the same test again. If it passes, move to the next test scenario. If it fails, potentially loop back to analysis/generation with more context or trigger human review.
    8.  **Repeat:** Continue until all test scenarios in the `Specification` are implemented and pass.
*   **Output:** Modified codebase where changes have been applied incrementally and verified against the tests defined in the `Specification`.

## 4. Key Distinction: Plan vs. Execution

*   **System 1 produces the PLAN (`Specification`).** It determines *what* code needs to change and *what tests* prove the change is correct. It does **NOT** write the implementation code.
*   **System 2 executes the PLAN using TDD.** It reads the `Specification`, writes a test, *then* writes the **implementation code (often as a diff)** needed to pass that test, verifies it, and repeats.

This clear separation ensures that implementation is directly tied to verifiable requirements (the tests) derived from a clarified understanding (the specification), leading to a more robust and reliable development process compared to attempting to generate code directly from ambiguous initial requests.