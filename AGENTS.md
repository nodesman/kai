# Kai Development Guidelines

This document summarizes the ongoing effort to refine Kai's **hardening workflow** and the **offline diff applier**. It serves as a reference for contributors and automated agents working on this repository.

## Overview

Kai includes a command called **Harden** that raises Jest test coverage for existing files. Earlier versions attempted to generate an entire test file in one AI request. Large files frequently exceeded LLM context limits, resulting in truncated or invalid output. To solve this, we are transitioning to a **progressive, diff-based approach**.

## Goals of the New Hardening Process

1. **Iterative Test Generation**
   - Identify the file with the lowest coverage using `TestCoverageRaiser`.
   - Create a stub test file if none exists: `describe('<Class>', () => {});`.
   - In subsequent passes, request **unified diffs** from the LLM that append new tests to this file.
   - Apply each diff with `FileSystem.applyDiffToFile`, re-running coverage after each successful patch until the target file reaches 100% line coverage or the configured iteration limit.

2. **Robust Diff Application**
   - `FileSystem.applyDiffToFile` now handles diff content wrapped in Markdown fences and logs failures when a patch cannot be applied.
   - A planned fuzzy fallback searches nearby lines for context when the diff does not apply cleanly (`"Removed line count did not match"` errors). This minimizes failure rates from slightly mismatched hunks without touching unrelated code.

3. **Failure Logging**
   - All failed patch applications are recorded to `.kai/logs/diff_failures.jsonl` with the file path, timestamp, and diff snippet.
   - Console output shows a red message pointing to this log so developers can analyze troublesome diffs and refine heuristics.

## Implementation Notes

- The offline diff applier uses the [`diff`](https://www.npmjs.com/package/diff) library. When `applyPatch` fails, we attempt a fuzzy match (±3 lines) before giving up.
- Log helper: `logDiffFailure(fs: FileSystem, filePath: string, diff: string)` ensures the log directory exists and appends a JSON entry.
- Tests for `FileSystem.applyDiffToFile` cover creating, modifying, and deleting files, fenced diffs, and failure logging.
- Hardening tests will mock `AIClient` to provide deterministic diffs and verify that patches apply iteratively.

## Working Guidelines

- Keep new test files minimal on the first pass—just the `describe` block—then grow them through diffs.
- Always inspect `.kai/logs/diff_failures.jsonl` when patches fail. Use these examples to improve prompts or heuristics.
- Do not attempt to generate entire test suites in one request. Iterate until coverage improves.
- When editing this repository, ensure tasks align with the [Kanban board](Kanban.md) and the strategic focus on **personal leverage** outlined in `docs/strategy/path_selection_rationale.md`.

