# ADR 002: Prefer Electron/Web Technologies for GUI Development (Avoid Java/C++)

**Date:** 2024-09-04

**Status:** Accepted

## Context

Following discussions about potential future user interface enhancements beyond the current CLI and planned TUI (Terminal User Interface), a need arose to establish a clear direction for UI technology selection. The core Kai system is built on Node.js/TypeScript. Initial explorations considered native desktop frameworks like Java Swing/FX or C++/Qt, primarily driven by familiarity or perceived capabilities. However, concerns were raised about the complexity, development effort, and potential impedance mismatch with the core Node.js application.

ADR 001 established the decision to *defer* any immediate transition to a GUI (specifically Electron) to prioritize core agentic workflow development (Systems 1 & 2). This ADR addresses a related but distinct question: *If* a GUI is built *in the future*, what technology stack should be used?

The user/developer explicitly requested a guiding principle to steer away from introducing Java or C++ dependencies for the UI and instead leverage web technologies, potentially packaged with Electron. This principle was added to the `Kanban.md`. This ADR formalizes the reasoning behind that principle.

**Alternatives Considered:**

1.  **Java (Swing/FX):** Mature, established GUI toolkits. Requires JVM installation for users. Introduces cross-language communication complexity (e.g., Node.js <-> Java IPC via WebSockets, REST, etc.).
2.  **C++ (Qt, etc.):** High-performance native UI capabilities. Requires C++ toolchain for development and potentially complex cross-platform builds/dependencies for users. Significant development overhead and language context switching. User specifically wants to avoid repeating past time-consuming C++ explorations.
3.  **Web Technologies (HTML/CSS/JS/TS) served by Node.js:** UI built with web tech, served directly from the core Kai Node.js application. Requires a browser but keeps the stack unified.
4.  **Web Technologies packaged with Electron:** UI built with web tech, packaged into a standalone desktop application using Electron. Bundles Chromium and Node.js, providing a native-like experience without external browser dependency.

## Decision

Kai will **exclusively use Web Technologies (HTML, CSS, JavaScript/TypeScript)** for any future GUI development beyond the current CLI/TUI.

If a standalone desktop application is desired, **Electron** will be the preferred packaging framework. Alternatively, the web UI may be served directly by the core Kai Node.js application.

**Java (Swing, JavaFX, etc.) and C++ (Qt, etc.) are explicitly excluded** as choices for UI development in this project.

## Rationale

This decision standardizes the technology stack, leverages existing skills, simplifies the development and deployment process, and aligns with the user's explicit preference.

1.  **Technology Stack Consistency:**
    *   The core of Kai is Node.js/TypeScript. Building the UI with the same or closely related technologies (web stack) minimizes the number of languages, runtimes, and build systems involved in the project.
    *   Reduces cognitive overhead for developers switching between backend and frontend tasks.

2.  **Leverages Existing Ecosystem & Skills:**
    *   Utilizes the vast ecosystem of web development tools, libraries, and frameworks (e.g., React, Vue, Svelte for UI structure, CSS frameworks for styling, numerous JS/TS libraries).
    *   Assumes developers working on the Node.js core possess or can more easily acquire web development skills compared to specialized native GUI toolkits like JavaFX or Qt.

3.  **Reduced Installation Burden for End-Users:**
    *   Avoids requiring users to install and manage a Java Virtual Machine (JVM) or specific C++ runtime libraries, which can be complex and platform-dependent.
    *   Node.js is already a prerequisite for Kai. Electron bundles its required Node.js and Chromium versions, creating a more self-contained package.

4.  **Simplified Cross-Platform Development & Deployment:**
    *   Web technologies are inherently cross-platform.
    *   Electron provides a well-established framework for packaging web applications into installable desktop apps for Windows, macOS, and Linux from a single codebase, often simpler than managing native builds for Java or C++.

5.  **Development Velocity and Iteration Speed:**
    *   The modern web development workflow (including hot-reloading, extensive component libraries, mature debugging tools) often allows for faster UI iteration compared to traditional compile/run cycles of native toolkits.

6.  **Integration with Node.js Core:**
    *   Communication between an Electron frontend (Renderer Process) and the Node.js backend (Main Process or a separate Kai service) can leverage Node.js IPC mechanisms or standard web protocols (like WebSockets served by the core Kai process), facilitating tighter integration than bridging Node.js to Java/C++.

7.  **Alignment with User Directive:**
    *   Directly implements the user's explicit request to avoid Java/C++ UI complexity and favor Electron/web technologies.

8.  **Modern UI/UX Potential:**
    *   Web technologies offer immense flexibility in creating modern, visually appealing, and highly customizable user interfaces.

## Consequences

*   **Positive:**
    *   Unified technology stack reduces complexity and potential points of failure.
    *   Easier developer onboarding and contribution.
    *   Faster UI prototyping and development cycles (potentially).
    *   Simpler dependency management for end-users (no JVM/C++ runtimes).
    *   Consistent cross-platform UI experience.
*   **Negative:**
    *   **Electron Resource Usage:** Electron applications are known to consume more RAM and disk space compared to highly optimized native applications due to bundling Chromium and Node.js. This is deemed an acceptable trade-off for Kai's expected use case.
    *   **Performance:** While modern web tech is fast, computationally intensive UI rendering might perform slightly worse than a meticulously optimized C++ native UI (though unlikely to be a bottleneck for Kai).
    *   **Native Platform Integration:** Deep integration with platform-specific features (beyond what Electron provides) might be more complex than with native toolkits.
    *   **Excludes Mature Native Toolkits:** Foregoes the potential benefits of specific features or stability characteristics of long-standing native frameworks like Java Swing/FX or Qt, although these benefits are not seen as critical for Kai's UI needs compared to the costs.