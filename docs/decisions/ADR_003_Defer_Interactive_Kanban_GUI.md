# ADR 003: Defer Interactive Kanban Web GUI

**Date:** 2024-09-05

**Status:** Accepted

## Context

The current project status and priorities are tracked using a `Kanban.md` file. While functional, Markdown is not ideal for quickly visualizing the board structure (columns, tasks within columns).

To address this readability issue, a proposal was made to:

1.  Replace `Kanban.md` with a structured data format (e.g., `.kai/kanban.json`).
2.  Build an interactive web-based GUI, served locally by Kai (`kai show kanban`), allowing users to view and manipulate the Kanban board (drag-and-drop tasks, edit, add, delete) directly in their browser. This would leverage Node.js and web technologies, aligning with ADR 002 (Prefer WebTech for GUI Development).

However, this proposal needs to be evaluated against the project's primary goals and existing decisions, particularly ADR 001 (Defer Electron GUI Transition), which emphasized avoiding significant UI development efforts that could distract from core agentic workflow implementation.

## Decision

We will **defer** the development of a fully interactive, JSON-backed Kanban web GUI **at this time**.

The project will continue using `Kanban.md` as the source of truth for task tracking.

To address the Kanban visualization/readability issue, we will proceed with the implementation of a **static, read-only web viewer**. This viewer, triggered by a command like `kai show kanban`, will:

1.  Read the current `Kanban.md`.
2.  Convert the Markdown to HTML.
3.  Serve this HTML via a simple, local Node.js HTTP server.
4.  Open the user's default web browser to display the rendered Kanban board.

## Rationale

This decision aligns with the reasoning established in ADR 001, prioritizing core functionality over significant UI development, even when using preferred web technologies (ADR 002).

1.  **Conflict with Core Priorities (High Risk):** Building a fully interactive GUI (data model design, backend API for CRUD, frontend JS for rendering/drag-drop/editing, persistence logic) is a substantial development effort. It directly competes for resources and focus with the high-priority agentic workflows (Epics E2 & E3), which are the primary objectives of Kai v1.0.
2.  **Violation of ADR 001 Spirit (High Risk):** While not using Electron, the proposed interactive GUI represents a similar level of complexity and potential distraction that ADR 001 aimed to avoid. It's a major UI/application development task tangential to the core agentic goals.
3.  **High Implementation Cost:** The interactive GUI requires significantly more effort than the current Markdown system or the proposed static viewer. It involves frontend state management, API design, data validation, persistence logic, and potentially introducing frontend libraries/frameworks.
4.  **Sufficiency of Alternative:** The combination of `Kanban.md` (editable with standard tools) and the proposed **static web viewer** provides a reasonable, low-cost solution to the immediate visualization problem without the significant overhead and distraction of the interactive GUI. The static viewer leverages web tech (ADR 002) minimally and directly addresses the user's stated pain point regarding Markdown readability.

## Consequences

*   **Positive:**
    *   Development focus remains on core agentic features (E2, E3), maximizing progress on the primary goals.
    *   Avoids significant development overhead and architectural complexity associated with building and maintaining an interactive web application.
    *   The Kanban readability issue is addressed in a low-cost, low-risk manner via the static viewer.
*   **Negative:**
    *   Kanban board interaction remains manual (editing `Kanban.md`).
    *   Potential benefits of an interactive GUI (easier task movement, inline editing) are postponed.
    *   The `Kanban.md` format may still feel slightly cumbersome for complex board states, even with the static viewer.

---

This ADR confirms the decision to prioritize core agentic work and address the immediate Kanban visualization need with the simpler static web viewer solution. The interactive GUI remains a possibility for *future* exploration *after* v1.0 goals are met.