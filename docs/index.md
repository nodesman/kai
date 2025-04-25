# Kai Project Documentation Index

Welcome to the documentation for the Kai AI Coding Assistant project. This index serves as a central guide to understanding the project's purpose, architecture, design decisions, and core concepts.

For the primary project overview, installation instructions, and basic usage, please see the main [**README.md**](../README.md).

## Core Concepts

These documents explain the underlying philosophy and key ideas behind Kai's features:

*   **[Analysis Philosophy](concepts/analysis_philosophy.md):** Explains the distinction between foundational descriptive analysis (used for context building, e.g., `project_analysis.json`) and deeper cognitive analysis (performed by agentic systems). Clarifies that current analysis focuses on enabling context management due to software realism (LLM limits).
*   **[Deferred Strategic Analysis (v2.0)](concepts/strategic_analysis_v2.md):** Discusses the reasoning for *deferring* the capability for Kai to handle high-level business strategy and ambiguous goals in v1.0, focusing instead on well-defined coding tasks.
*   **[Enhanced Code Analysis (Deferred)](concepts/enhanced_code_analysis.md):** Outlines the scope for future (v1.0+) investigation into deeper code understanding beyond simple summarization, such as dependency analysis or complexity metrics.

## Architecture & Design

### Agentic Systems Explained

Recent discussions clarified the design and intent behind the planned agentic workflows (System 1: Requirements, System 2: TDD). These files capture those clarifications:

*   **[System 1+2 vs Consolidation for Modifications?](explanations/s1s2-vs-consolidation-modifications.md):** Details why the structured S1+S2 approach (with TDD) is preferred over the existing Consolidation Mode for modifying code, focusing on reliability, precision, and verifiability.
*   **[Does System 1 Analyze Existing Code?](explanations/s1-analysis-existing-code.md):** Confirms that System 1's analysis *must* consider existing code context (provided via `ProjectContextBuilder`) when handling modification requests to generate accurate specifications.
*   **[Is System 2 Only a Scaffolder? Analysis Roles?](explanations/s2-scaffolding-vs-modification-analysis.md):** Clarifies that System 2 is designed for both scaffolding *and* modification, explains how its TDD loop handles changes, and distinguishes its cognitive analysis from the context-building analysis (`ProjectAnalyzerService`).
*   **[Responsibility Distribution (System 1 vs System 2)?](explanations/s1-s2-responsibility-distribution.md):** Outlines the distinct roles: System 1 defines **WHAT** (the `Specification`, including test scenarios), while System 2 handles **HOW** (the TDD implementation loop, generating code/diffs step-by-step).

### Architectural Decision Records (ADRs)

Key architectural decisions are documented in the `docs/decisions/` directory:

*   **[ADR 001: Defer Electron GUI Transition](decisions/ADR_001_Electron_Transition.md):** Documents the decision to postpone migrating from the CLI to a dedicated Electron GUI to prioritize core agentic workflow development (Systems 1 & 2).
*   **[ADR 002: Prefer Web Technologies for GUI](decisions/ADR_002_Prefer_WebTech_for_GUI.md):** Establishes the guideline that *if* a GUI is developed in the future, it should utilize Web Technologies (HTML/CSS/JS/TS), potentially packaged with Electron, and explicitly avoid Java or C++ toolkits.
*   **[ADR 003: Defer Interactive Kanban GUI](decisions/ADR_003_Defer_Interactive_Kanban_GUI.md):** Documents the decision to build a static, read-only web viewer for the Kanban board (`kai show kanban`) instead of a fully interactive GUI, again to maintain focus on core agentic features.

## Development & Task Tracking

Project tasks, epics, and progress are tracked using a Kanban system.

*   **Source of Truth:** [**Kanban Board**](../Kanban.md) (Viewable in Markdown or using `kai show kanban`).
*   **Viewing:** Use the `kai show kanban` command to view a rendered HTML version in your browser (served locally).

## Configuration

Project configuration is managed via a YAML file located at `.kai/config.yaml` in the project root.

*   See defaults in `src/lib/config_defaults.ts`.
*   Refer to the [Configuration Section in the README](../README.md#configuration) for key settings.

## Contributing

(Placeholder: Link to CONTRIBUTING.md when created)

## License

This project is licensed under the MIT License. See [LICENSE](../LICENSE) for details.