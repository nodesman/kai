# Kai Project Documentation Index

Welcome to the documentation for the Kai AI Coding Assistant project. This index serves as a central guide to understanding the project's purpose, architecture, design decisions, and core concepts.

For the primary project overview, installation instructions, and basic usage, please see the main [**README.md**](../README.md).

*(Note: This documentation reflects the strategic decisions made following detailed discussions, prioritizing Path 1: Personal Leverage for v1.0).*

## Goals & Strategy (v1.0)

These documents outline the primary objectives and strategic direction for Kai v1.0:

*   **[Kai v1.0 Goal: Maximum Personal Leverage via Reliable Implementation](goals/primary_objective_v1.md):** Defines the core focus on amplifying the primary developer's capabilities.
*   **[Path Selection Rationale: Prioritizing Personal Leverage (Path 1)](strategy/path_selection_rationale.md):** Explains the decision to focus on personal advantage over broader sharing/impact in v1.0.
*   **[Analysis of Cultural Motivation & Its Deferred Implementation](strategy/cultural_motivation_analysis.md):** Discusses the secondary motivation for cultural representation and why its active pursuit via Kai is deferred.

## Architecture & Vision

This section details the technical design and intended workflow of Kai:

*   **[The S1/S2 TDD Architectural Vision for Reliable Implementation](architecture/s1_s2_tdd_vision.md):** Outlines the core System 1 (Specification) -> System 2 (TDD Execution) loop designed for reliable code generation.

### Agentic System Details (Explanations)

These older documents provide background and detailed comparisons related to the agentic systems:

*   **[System 1+2 vs Consolidation for Modifications?](explanations/s1s2-vs-consolidation-modifications.md):** Why the S1/S2 TDD approach is preferred over the existing Consolidation Mode for modifications.
*   **[Does System 1 Analyze Existing Code?](explanations/s1-analysis-existing-code.md):** How System 1 incorporates existing code context.
*   **[Is System 2 Only a Scaffolder? Analysis Roles?](explanations/s2-scaffolding-vs-modification-analysis.md):** Clarifies System 2's role in modification and distinguishes analysis types.
*   **[Responsibility Distribution (System 1 vs System 2)?](explanations/s1-s2-responsibility-distribution.md):** Defines the distinct roles of System 1 (WHAT) and System 2 (HOW).

## Development Focus (v1.0)

*   **[Development Focus (v1.0): Core Engine & Personal Optimization](development/focus_and_priorities_v1.md):** Translates the strategic goals into concrete development priorities, emphasizing S1/S2 implementation and personal workflow optimization.

## Core Concepts & Analysis

These documents cover underlying philosophies, analysis techniques, and competitive positioning:

*   **[Role of Analysis (Context vs. Agentic)](concepts/role_of_analysis_revisited.md):** Clarifies the distinction between descriptive context analysis (`ProjectAnalyzerService`) and cognitive agentic analysis (S1/S2).
*   **[Analysis Philosophy](concepts/analysis_philosophy.md):** Original document explaining the context-driven nature of the current analysis cache.
*   **[Competitive Landscape Assessment & Kai's Differentiators](concepts/competitive_landscape_assessment.md):** Assesses competitors (Cursor, Replit) and highlights Kai's intended unique value proposition based on the S1/S2 architecture.
*   **[Analysis of Kai's Long-Term Personal Advantage](concepts/personal_advantage_analysis.md):** Analyzes the nature and potential durability of the personal competitive edge offered by a private Kai S1/S2 system.
*   **[Deferred Strategic Analysis (v2.0)](concepts/strategic_analysis_v2.md):** Discusses the deferred capability for handling high-level business strategy.
*   **[Enhanced Code Analysis (Deferred)](concepts/enhanced_code_analysis.md):** Outlines deferred plans for deeper code understanding beyond context analysis.

## Future Considerations

*   **[Future Considerations (Post-v1.0 Leverage)](future/post_v1_options.md):** Explores potential paths for Kai *after* the primary v1.0 goal is achieved.

## Architectural Decision Records (ADRs)

Key architectural decisions are documented in the `docs/decisions/` directory:

*   **[ADR 001: Defer Electron GUI Transition](decisions/ADR_001_Electron_Transition.md)**
*   **[ADR 002: Prefer Web Technologies for GUI](decisions/ADR_002_Prefer_WebTech_for_GUI.md)**
*   **[ADR 003: Defer Interactive Kanban GUI](decisions/ADR_003_Defer_Interactive_Kanban_GUI.md)**

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