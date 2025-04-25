# Documentation: System 1 Analysis and Existing Code Context

**Question:** Will System 1's analysis process consider the existing code when generating requirements/specifications, especially for modifications?

**Date:** 2024-09-07

## 1. Direct Answer

**Yes, absolutely.** For System 1 (Requirements Clarification & Specification Generation) to function effectively, especially when handling requests to **modify existing code**, it is fundamental that its analysis process considers the relevant existing code context. It is not limited to scaffolding new code based solely on user input.

## 2. How System 1 Uses Existing Code Context

The integration of existing code into System 1's analysis is a crucial part of the workflow:

1.  **User Request:** The process starts with a user request that implies interaction with existing code.
    *   *Example:* "I need to add VAT calculation to the `calculateTotal` function in `src/lib/billing.ts`."

2.  **Context Building (`ProjectContextBuilder`):** Before the AI in System 1 begins its core reasoning, the `ProjectContextBuilder` service is invoked. Its role is to prepare the necessary context for the AI.
    *   Based on the user request and the current context mode (`analysis_cache`, `dynamic`, or even `full` for small projects), the builder identifies relevant files.
    *   For a modification request like the example, it will prioritize identifying and loading the *current content* of `src/lib/billing.ts`.
    *   In `dynamic` mode, it might also use the request keywords ("calculateTotal", "billing.ts", "VAT") along with the analysis cache summary (`.kai/project_analysis.json`) to determine if other related files (e.g., type definitions, constants files) should also be included in the context provided to the AI.
    *   *Example:* The `ProjectContextBuilder` fetches the content of `src/lib/billing.ts` and potentially `src/types/cart.ts` if `calculateTotal` uses types defined there.

3.  **System 1 AI Analysis Input:** The AI model performing the analysis within System 1 receives a combined input package:
    *   The user's request.
    *   The **text content** of the relevant existing code files identified by the `ProjectContextBuilder`.
    *   Potentially, a summary of the overall project structure (from the analysis cache if using `analysis_cache` or `dynamic` mode).

4.  **Cognitive Analysis by AI:** The AI then performs its analysis *using* this combined input:
    *   **Understanding the Target:** It reads the existing code (e.g., the current `calculateTotal` function signature, its logic, its return type) to understand the starting point for the modification.
    *   **Interpreting the Request:** It interprets the user's request ("add VAT calculation") *in relation to* the existing code.
    *   **Identifying Ambiguities:** Based on the code, it can identify potential ambiguities or necessary clarifications.
        *   *Example Questions:* "Okay, I see `calculateTotal` currently returns a `number`. Will adding VAT change this? What is the VAT rate? Should it be a fixed value, or should it come from configuration? Does the VAT apply before or after discounts (if any exist in the current function)?"
    *   **Formulating a Plan:** It begins to formulate a plan for the change, considering how the new logic fits into the existing structure.

5.  **Generating the `Specification`:** Based on the user's clarifications and its analysis of the existing code context, System 1 generates the `Specification` object. This specification will detail:
    *   The precise changes required for the *existing* function (`calculateTotal`).
    *   Any necessary related changes (e.g., adding a new constant, modifying related types).
    *   Crucially, **test scenarios** that verify the modification *relative to the original functionality* and the new requirements.
        *   *Example Test Scenario:* "Given a cart total of 100 and a VAT rate of 20%, `calculateTotal` should now return 120."

## 3. Contrast with Pure Scaffolding

For pure scaffolding requests (e.g., "Create a new Express route for `/users`"), the existing code context might be less critical for the *specific file content* but still important for understanding project structure, naming conventions, existing utility functions, or common patterns used in the project, which System 1 can leverage from the context provided.

## 4. Scope of "Knowledge" (v1.0)

It's important to note that for Kai v1.0, System 1's "knowledge" of the existing code comes primarily from the **text content** provided by the `ProjectContextBuilder`. It reasons based on the source code it sees in its context window.

It does **not** (in v1.0) perform deep semantic analysis like building a full Abstract Syntax Tree (AST), tracking detailed call graphs across the entire project, or complex type flow analysis. Such capabilities fall under the "Enhanced Code Analysis" (E6) research area, which is a much lower priority for the initial versions.

## 5. Conclusion

System 1's ability to handle code modification requests effectively hinges on its analysis incorporating the **current state of the relevant code**. The `ProjectContextBuilder` provides this necessary code context, allowing the AI within System 1 to understand the starting point, ask pertinent clarifying questions, and ultimately generate a `Specification` that accurately describes the required changes to the existing codebase for System 2 to implement via TDD. Without this analysis of existing code, System 1 could not reliably handle modification tasks.