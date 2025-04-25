# Documentation: System 2 Capabilities (Modification vs. Scaffolding) and Analysis Roles

**Question:** Is System 2 primarily a scaffolder, or can it reliably modify existing code? How does the 'analysis' it performs relate to the context analysis (`ProjectAnalyzerService`) and the idea of an advanced Consolidation Mode?

**Date:** 2024-09-07

## 1. Modification is a Core Capability of System 2

System 2 (Agentic TDD/Implementation) is **explicitly designed for both scaffolding new code AND reliably modifying existing code.** It is *not* merely a scaffolder. Its core Test-Driven Development (TDD) methodology is particularly well-suited for making precise and verified changes to established codebases.

### How Modification Works in System 2:

The process relies heavily on the `Specification` provided by System 1 and the iterative TDD loop:

1.  **Input `Specification`:** System 2 receives a detailed `Specification` from System 1. For a modification task, this spec will detail:
    *   The specific function/class/module to be modified (e.g., `calculateTotal` in `src/lib/billing.ts`).
    *   The precise nature of the change required (e.g., "add VAT calculation at X%").
    *   Crucially, **new or modified test scenarios** designed to verify the change (e.g., "Given cart items A, `calculateTotal` should return B including VAT").

2.  **TDD Loop Initiation:** System 2 starts its loop based on the test scenarios in the `Specification`.

3.  **Test Generation/Selection:** It generates or selects the code for the first test case relevant to the modification.
    *   *Example:* Writes a new test in `src/lib/billing.test.ts` asserting that `calculateTotal` returns the correct value including VAT for a specific input.

4.  **Test Execution (Expect Failure):** It runs the *new* test against the *existing, unmodified* code using a `TestRunnerService` (e.g., based on Task in `Kanban.md.bak`). The expectation is that this test will **fail**.

5.  **Failure Analysis (System 2's "Agentic Analysis"):** This is a critical step. The AI within System 2 analyzes:
    *   The **specific test failure output** (parsed error messages, stack trace pointing to `src/lib/billing.ts`).
    *   The relevant part of the **`Specification`** (the requirement to add VAT).
    *   The **current code context** of the file(s) involved (e.g., the content of `src/lib/billing.ts`, potentially loaded using `ProjectContextBuilder` in a focused mode - Task in `Kanban.md.bak`).
    *   **Goal:** Diagnose *why* the test failed (e.g., "Test failed because `calculateTotal` lacks VAT logic as required by the spec").

6.  **Code Fix Generation (Diff):** Based on the diagnosis, the AI generates a **targeted code change**, ideally as a **diff patch**, specifically intended to make the *failing test pass*.
    *   *Example:* Generates a diff for `src/lib/billing.ts` that adds the VAT calculation logic inside the `calculateTotal` function.

7.  **Apply Patch:** The generated diff is applied to the target file (`src/lib/billing.ts`) using the `FileSystem.applyDiffToFile` method (Task in `Kanban.md.bak`).

8.  **Re-run Test (Expect Success):** The *same* test is executed again. If the generated fix was correct, the test should now **pass**.

9.  **Iteration:** System 2 proceeds to the next test scenario in the `Specification`, repeating steps 3-8 until all tests related to the specified change pass.

This loop ensures that modifications are directly driven by testable requirements and verified at each step.

## 2. Understanding "Analysis" in Kai

The term "analysis" appears in different contexts within Kai. It's crucial to distinguish them:

*   **A. Context-Building Analysis (`ProjectAnalyzerService`):**
    *   **Purpose:** To understand the **structure and content** of the project primarily for **managing context** provided to the LLMs, respecting token limits.
    *   **Process:** Inventories files, classifies them (binary, text, large text), calculates size/LOC, and optionally generates *brief textual summaries* using an LLM (as defined in `src/lib/analysis/ProjectAnalyzerService.ts` and `docs/concepts/analysis_philosophy.md`).
    *   **Output:** A descriptive cache (`.kai/project_analysis.json` containing `ProjectAnalysisCache` structure with an `overallSummary` and an `entries` array - see `src/lib/analysis/types.ts`).
    *   **Role:** Provides the necessary *input data* (summaries or file lists for dynamic selection) to components like `ProjectContextBuilder` so they can feed relevant code snippets or summaries to System 1 or System 2. It describes *what's there*.

*   **B. Agentic Cognitive Analysis (System 1 & System 2):**
    *   **Purpose:** The **reasoning and problem-solving** performed *by the AI agents* within the systems.
    *   **System 1:** Analyzes the user's request against the provided code context to clarify requirements, identify ambiguities, and generate the `Specification`.
    *   **System 2:** Analyzes *test failures* against the `Specification` and code context to diagnose problems and generate targeted code fixes (diffs).
    *   **Role:** This is the "thinking" part of the agents, using the context provided (via mechanism A) to achieve their goals (requirement specification or test passing).

System 2's ability to modify code relies on **both** types of analysis: it needs the relevant **code context** (provided via A) to perform its **cognitive analysis** (B) of test failures and generate the correct diff.

## 3. System 2 vs. Advanced Consolidation Mode

System 1+2 is structurally and methodologically distinct from the `ConsolidationService`, even an advanced version:

*   **Consolidation:** Analyzes *conversation history* and *code state* to generate a proposed *final state* for files. It makes a holistic guess based on dialogue. Verification is manual, post-application.
*   **System 2 (TDD):**
    *   Operates on a formal **`Specification`**, not raw history.
    *   Follows a **strict, iterative TDD cycle**.
    *   Focuses on generating **incremental diffs**, not necessarily entire files for modifications.
    *   Includes **built-in, automated verification** (test execution) at each step.

While both aim to modify code based on user intent, System 2 does so through a more controlled, precise, and verifiable process designed for higher reliability, especially with existing code. It's not just "Consolidation++"; it's a different paradigm centered around test-driven execution of a formal specification.

## 4. Conclusion

System 2 is fundamentally designed to handle **code modification** as a primary use case, leveraging its TDD loop for precision and reliability. The "analysis" it performs is cognitive work focused on diagnosing test failures and generating fixes, which relies on the separate context-building analysis (`ProjectAnalyzerService`) to provide the necessary code visibility. This structured, test-verified approach makes it distinct from and aims to be more robust than the Consolidation Mode for evolving existing code.