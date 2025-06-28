# Lean, Multi-Phase Test Plan for Branch Coverage

This plan outlines a phased approach to increase test coverage, focusing on critical modules first. Each phase identifies specific modules and testing priorities. You don't need to tackle everything at once; complete Phase 1, then move on to subsequent phases.

-----

## 📊 Phase 1 — Foundation & I/O Primitives

**Why first?** All higher-level logic depends on config loading, user I/O, filesystem, and Git abstractions. Shaky foundations here will lead to brittle or duplicate tests elsewhere.

| Module(s) | What to test |
|---|---|
| **Config.ts** | Valid vs. missing keys, default fallback, parse errors |
| **FileSystem.ts** | File-exists / read/write success & failure paths |
| **GitService.ts** | "Clean" vs. "dirty" repo, commit-hash lookup, error cases |
| **UserInterface.ts** | Prompts answered → paths taken; aborted / invalid input |
| **CommandService.ts** | Each CLI command entry-point, flags on/off, error exit |

> **Mocks**: Stub out real `fs` and `git` so your tests drive both success and simulated I/O errors.
> **Goal**: $\\ge$ 90% branch coverage on these files before moving on.

-----

## 🚀 Phase 2 — Core CLI Orchestration

**Why next?** This wiring layer stitches together the foundation into actual "kai" commands. Fully testing your orchestration will catch mis-wiring as soon as you refactor sub-systems.

| Module(s) | What to test |
|---|---|
| **kai.js** (the bin entry point) | Flag parsing → delegates to `CommandService` |
| **ConversationManager.ts** | Branching around new vs. resume vs. rollback flows |
| **ProjectContextBuilder.ts** | Success vs. missing project files / context errors |
| **ProjectScaffolder.ts** | Scaffold path exists, conflicts, dry-run vs. apply |

> **Focus** on each `if`/`else` in your command-dispatch (e.g., "if no project, scaffold; else analyse").
> **Mocks**: Inject fake `FileSystem`, `GitService`, `Config` so you can force both happy and unhappy paths.

-----

## 🧠 Phase 3 — AI-Integration Core

**Why now?** Once your I/O and CLI layers are solid, turn to the guts that actually call LLMs. Testing these early prevents flaky tests later when you get into analysis/consolidation loops.

| Module(s) | What to test |
|---|---|
| **AIClient.ts** | Success vs. API-error (network failure, bad credentials) |
| **CodeProcessor.ts** | Fallback when LLM output is invalid JSON / schema mismatch |
| **CommandService.test.ts** (add AI branches) | Branching on LLM-driven subcommands (analysis vs. generation) |

> **Mocks**: `jest.mock('@google/generative-ai')` or your adapter, and force both resolved payloads and rejects.
> **Goal**: Hit every `try/catch` around the LLM calls.

-----

## 🔍 Phase 4 — Analysis & Consolidation Engines

**Why here?** These services contain the real business logic (branchy heuristics, multi-step merges, feedback loops). They're high-value but also the most complex.

| Module(s) | What to test |
|---|---|
| **analysis/ProjectAnalyzerService.ts** | Each analysis-path: single-file vs. multi-file vs. no files found |
| **consolidation/ConsolidationService.ts** | "No edits needed" vs. "edits applied" vs. "conflicts / reviewer abort" |
| **consolidation/\*.ts** (Analyzer, Applier, Generator, Reviewer) | Every `switch`/`case`, every early-exit, both happy & sad paths |

> **Strategy**:
>
> 1.  Write one "golden" happy-path test that exercises the full pipeline.
> 2.  Then write small focused tests to force each error or edge-branch.

-----

## 🛠 Phase 5 — Code-Gen & Interactive Loops

**Why next?** Code-gen modules and interactive-feedback loops are peripheral today but will grow as you flesh out features. You'll want tests in place before they become a maintenance headache.

| Module(s) | What to test |
|---|---|
| **code-gen/ApplicationStartup.js** | All template branches, missing template keys, prompt errors |
| **consolidation/feedback/FeedbackLoop.js** | Loop terminates on accept, on reject, on max-iterations |
| **typescript/services/test-runner/TestRunnerService.js** | Success vs. test-fail vs. timeout vs. malformed jest output |

> **Mocks**: Simulate user input, fake test-run results, drive both loop-continue and loop-break conditions.

-----

## 📡 Phase 6 — WebService, Sample-Project, Remaining Stubs

**Why last?** These bits are either wrappers around already tested code (so have very little branching) or sample/demo code that doesn’t affect core logic.

| Module(s) | What to test |
|---|---|
| **WebService.js** | Routes up/down, JSON vs. text responses, error handling |
| **sample-project/\*.js** | Ensure the demo flows as advertised (smoke-tests) |
| Leftover stubs | Minimal "exists" tests to lock in future behavior |

> **Optional**: You can keep these as very thin smoke-tests (just ensure no throw) and consider them "low priority."

-----

## 📈 Maintaining & Measuring Progress

1.  **Run coverage after each phase**:
    ```bash
    npm test -- --coverage --coverageReporters=text
    ```
2.  **Track coverage numbers** for `% Branch` in each file. Phase 1 $\\to$ 2 should boost global branch coverage well into the 60–70% range, and Phases 3–4 into 80–90%.
3.  **Celebrate quick wins**: Finishing Phase 1 already gives you major confidence for every subsequent test you write.

-----

## 🏁 TL;DR

| Phase | Rough Module Count | Reason |
|---|---|---|
| 1 | 5 files | Core I/O & config (largest ripple effect) |
| 2 | 5–6 files | CLI orchestration (wiring together foundation) |
| 3 | 2–3 files | AI integration (most external-dependency risk) |
| 4 | \~10 files | Analysis & consolidation (core business logic, branchy) |
| 5 | \~8 files | Code-gen & feedback loops (growing feature set) |
| 6 | \~5 files + stubs | Web service, sample/demo & low-risk wrappers |

Start with **Phase 1** today. Once those tests are in place, every subsequent module becomes far easier to exercise and refactor.

Which slice would you like to tackle first, and how can I help you get started with the test skeletons?