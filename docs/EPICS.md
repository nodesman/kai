# Epic Roadmap & Discovery

This document captures the **discovery**, **analysis**, and **rationale** behind our high-level Epics and Task breakdown for evolving Kai’s diff-applier, hybrid model integration, and autonomous coding workflow.

## 1. Discovery & Analysis (Epic 0)
- **Note:** The above **codex-rs** and **codex-cli** code is a separate OpenAI‑maintained codebase (OpenAI Codex). We are **analyzing** it purely for design inspiration. Our work in this repo (the `/src` folder in the project root) remains completely distinct. Please do not conflate the two codebases.
  - Reviewed TypeScript preview parser to understand initial diff parsing logic: `codex/codex-cli/src/parse-apply-patch.ts`【F:codex/codex-cli/src/parse-apply-patch.ts†L1-L90】
  - Inspected Rust orchestrator and entrypoint to see how hunks are applied: `codex/codex-rs/apply-patch/src/lib.rs`【F:codex/codex-rs/apply-patch/src/lib.rs†L261-L330】
  - Dug into the patch parser rules in `parser.rs` and smart locator `seek_sequence.rs` for potential extension points【F:codex/codex-rs/apply-patch/src/parser.rs†L1-L80】【F:codex/codex-rs/apply-patch/src/seek_sequence.rs†L1-L20】
  - Surveyed existing CLI UI code for user approval and command execution patterns: `cli.tsx`, `app.tsx`, and command formatting hooks【F:codex/codex-cli/src/cli.tsx†L1-L20】【F:codex/codex-cli/src/app.tsx†L1-L20】【F:codex/codex-cli/src/format-command.ts†L1-L20】

## 2. Epics & Tasks Overview
Refer to the repository’s **Kanban.md** for the living board of Epics (E1–E9) and detailed task checklists. Below is a high-level summary of all Epics:

| Epic | Title                                                                      |
|:----:|:---------------------------------------------------------------------------|
| E1   | Core Infrastructure & Shared Services                                      |
| E2   | System 1 – Agentic Requirements Clarification & Specification Generation   |
| E3   | System 2 – Agentic Test-Driven Development/Implementation                  |
| E4   | Consolidation Service – Maintenance & Integration                          |
| E5   | Evaluation & Testing – Testing the Kai system itself                       |
| E6   | Future Exploration – Lower priority research                                |
| E7   | Plugin System – Extend Kai with new functionalities                        |
| E8   | Hybrid Model & Fuzzy Diff‑Applier Enhancements                             |
| E9   | Autonomous Coding Application (`codex auto`)                                |

Detailed task checklists under each Epic in **Kanban.md** ensure that both the “why” (analysis) and the “how” (code changes) are persisted.

## 3. Maintaining Context
To avoid losing this reasoning and discovery:

- **Do not delete** this file (`docs/EPICS.md`). It preserves the initial analysis steps.
- Link to this file from `docs/index.md` under Development & Task Tracking.
- Update it if new major discovery or architectural decisions arise.

---
## E8: Hybrid Model & Fuzzy Diff‑Applier Enhancements

**Scope & Goals:**
Integrate multiple LLM providers (e.g. OpenAI GPT‑4 and Gemini) for diff generation, implement best‑of and fallback logic, and harden the offline diff‑applier with fuzzy matching and robust failure logging.

**Methodology:**
- Abstract a pluggable model‐provider layer in Rust (and TS) to route between GPT‑4, Gemini, or hybrid strategies.
- Extend prompt templates for Gemini compatibility and enable multi‑pass “best‑of” diff proposals.
- Enhance `seek_sequence.rs` to widen fuzzy search radius and add configuration tunables.
- Improve failure telemetry: capture context snippets on patch failures and emit structured JSON logs.
- Cover new logic with unit/regression tests and integration tests to measure reduction in patch‑failure rate.
- Expose CLI flags (`--model-provider`, `--log-level`) and update documentation in `apply_patch_tool_instructions.md`.

Refer to **Kanban.md** (Epic E8) for the detailed task checklist.

## E9: Autonomous Coding Application (`codex auto`)

**Scope & Goals:**
Build a minimal autonomous coding loop in the CLI that can fetch tasks, propose and execute shell commands, apply AI‑generated patches, run tests, and iterate—with human approval only on conflicts or failures.

**Methodology:**
- Study existing codex‑cli command execution, history, and approval flows to surface extension points.
- Implement a TaskPlanner module in TypeScript to orchestrate the fetch/generate/exec/report cycle.
- Add hooks in `format-command.ts` and `use-confirmation.ts` to format suggested commands and capture approvals/overrides.
- Integrate the Rust diff‑applier endpoints for automatic patch application without manual copy‑paste.
- Auto‑run test suites after each patch, parse results, and feed back into the loop.
- Provide end‑to‑end example scripts and expand `examples/prompting_guide.md`.

Refer to **Kanban.md** (Epic E9) for the detailed task checklist.
**Definition of Done:**

**Definition of Done (Proof‑of‑Concept via external codex CLI):**

> _This Definition of Done describes a mock‑driven proof‑of‑concept using the external `codex` CLI codebase, with no live LLM integrations and no direct changes to our own CLI implementation. It documents the expected user‑visible flow when all mocks and hooks are wired up._

– A user can run `codex auto --dry-run "<problem description>"` against a sample repo and see a sequence of:
  1. Task fetched: a JSON object defining the work (mocked input).
  2. Suggested command printed (e.g. "git branch feature/x && git checkout feature/x").
  3. Execution results shown (mocked stdout/stderr feedback) and fed back to the agent loop.
  4. AI-generated patch applied via Rust diff-applier (`apply-patch`), with summary output.
  5. Tests auto-run (`pnpm test`), their pass/fail status captured and displayed.
 6. Loop repeats until all mock tests pass, then outputs final success message.

### Definition of Done (Kai CLI Autonomous Experience)
> _This Definition of Done outlines the mocked autonomous programming experience via our own `kai auto` command, providing a similar dry-run demo before LLM wiring._

* A user invokes our native `kai auto --dry-run` (or simply `kai auto`) and then freely enters a detailed, multi-line problem statement. They then experience a multi-step plan:
  ```text
  kai> Received problem: "Add a --verbose flag to enable debug logging"

  kai> Analyzing requirements and planning implementation...
  kai> Plan:
    1. Create new branch feature/verbose-flag
    2. Update src/cli.ts to read --verbose flag
    3. Update src/logger.ts to conditionally log extra output
    4. Add unit tests for verbose flag

  user> Approve plan

  kai> Executing command: git checkout -b feature/verbose-flag
  [stdout] Switched to new branch 'feature/verbose-flag'

  kai> Generating patch for src/cli.ts...
  kai> Applying patch via apply-patch
  [summary] Updated src/cli.ts (4 lines changed)

  kai> Running tests: npm test -- --grep "verbose"
  [stdout] 3 tests passed, 0 failed

  kai> 🎉 All tests passed. Task complete!
  ```

Refer to **Kanban.md** for tasks under Epic E9 to wire up analysis, planning, execution, and iteration.

Refer to **Kanban.md** for the tasks to wire up this flow incrementally under Epic E9.

**Current Focus:** Designing the multi-line problem-statement input modality (editor spawn vs. EOF sentinel vs. inline TUI). See Kanban E9 In Progress for details.

**Initial Steps & Branch Strategy:**
- Create a dedicated spike branch (e.g. `feature/autonomous-coding-poc`) to avoid a big‑bang merge.
- Implement a minimal TaskPlanner stub that accepts a fixed task, formats a suggested command, and logs it to stdout.
- Hook into `format-command.ts` to prove out the suggested‑command pipeline in codex‑cli.
- Add a smoke e2e test (`examples/auto-smoke-test.ts`) driving `codex auto --dry-run` to verify the basic loop.
- Commit each of these steps incrementally to the spike branch, review, then merge back to `main` when stable.

## E9.1: Meta‑TDD Harness (LLM‑to‑LLM Review)

**Scope & Goals:**
Define a test harness that uses one LLM stub to generate patches and another to review them, enabling test-first validation of the autonomous loop.

**Methodology:**
- Mock `generatePatch()` and `reviewPatch()` function‑calls in Vitest/Jest.
- Write a simple test (`agentic-loop.test.ts`) that asserts the correct sequencing and error handling when review rejects the patch.
- Expand to multi‑round generate→review cycles by queueing multiple mock responses.
- Integrate real LLM playbacks via golden‑file fixtures once the harness is stable.
- Gate these tests behind a `metaTdd` flag to avoid long CI runs by default.

Refer to **docs/AGENT_TDD.md** for the detailed example and test patterns.

---
_Last updated: $(date +%Y-%m-%d)_
