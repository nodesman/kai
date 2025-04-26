# Development Focus (v1.0): Core Engine & Personal Optimization

## 1. Guiding Principle

All development efforts for Kai version 1.0 are guided by the primary objective defined in `docs/goals/primary_objective_v1.md`: **Maximize the primary developer's (Raj's) personal leverage by creating a reliable AI-driven implementation engine.** Any task or feature not directly contributing to this core goal is considered out of scope for v1.0.

## 2. Top Priority: The S1/S2 TDD Engine

The absolute, non-negotiable highest priority for v1.0 is the **successful implementation and refinement of the core agentic workflow**:

*   **System 1:** Requirements Clarification & Formal `Specification` Generation.
*   **System 2:** Test-Driven Development (TDD) Execution based on the `Specification`.

This S1/S2 TDD engine, as detailed in `docs/architecture/s1_s2_tdd_vision.md` and represented by **Epics E2 and E3** in `Kanban.md`, is the central technical bet and the primary mechanism for achieving the project's core goal. All other development must support or enable the creation and effective operation of this engine.

## 3. Optimization Target: The Primary Developer

Consistent with the primary objective and the strategy outlined in `docs/strategy/path_selection_rationale.md`, all optimization efforts – including prompt engineering, CLI interactions, workflow design, and feedback loops – are targeted **exclusively at enhancing the efficiency, speed, and cognitive alignment for the primary developer (Raj).**

Making the tool intuitive, user-friendly, or easily adaptable for *other* hypothetical users is explicitly **not** a goal for v1.0. Optimization serves the "personal exosuit" model.

## 4. Scope Boundaries (What NOT to Build in v1.0)

To maintain laser focus on the S1/S2 engine and the primary goal, the following areas are explicitly **out of scope** for v1.0 development:

*   **Graphical User Interfaces (GUI):**
    *   No Electron-based GUI (as per ADR 001).
    *   No interactive web-based Kanban GUI (as per ADR 003).
    *   Minimal improvements to the existing CLI/TUI are permissible *only if* they are deemed essential bottlenecks for the primary developer's personal use of the S1/S2 workflow. The static Kanban web viewer is the only planned UI enhancement.
*   **General Usability Features:**
    *   No features aimed solely at making Kai easier for others to learn or use (e.g., wizards, graphical configuration tools, extensive help commands beyond basic usage).
*   **External-Facing Documentation:**
    *   Documentation efforts are limited to internal architecture, design decisions (like this document), and essential notes required for the primary developer's understanding and future maintenance.
    *   No user guides, tutorials, or public documentation intended for external users will be created in v1.0.
*   **Advanced Analysis Capabilities:**
    *   Strategic Business-to-Software Analysis ("Analysis v2.0") is deferred (see `docs/concepts/strategic_analysis_v2.md`).
    *   Enhanced Code Analysis (beyond what's needed for basic context building via `ProjectAnalyzerService`) is deferred (see `docs/concepts/enhanced_code_analysis.md`).
*   **Cultural Integration Features:**
    *   Beyond the tool's name ("Kai"), the integration of Tamil phrases or other cultural markers into messages is deferred (as per `docs/strategy/cultural_motivation_analysis.md`).
*   **Sharing & Collaboration:**
    *   No features supporting multi-user access, project sharing, collaborative sessions, or easy distribution/packaging for others will be implemented.

## 5. Kanban Alignment

Development work tracked on the `Kanban.md` board must reflect these priorities. The primary focus should be on tasks within:

*   **E2: System 1 - Agentic Requirements Clarification & Specification Generation**
*   **E3: System 2 - Agentic Test-Driven Development/Implementation**
*   **E1: Core Infrastructure & Shared Services** (Only tasks directly supporting or required by E2/E3).

Tasks within other Epics (E4: Consolidation Service Maintenance, E5: Evaluation, E6: Future Exploration) should be strictly de-prioritized or only undertaken if they represent critical fixes or are unavoidable dependencies for the core S1/S2 work.