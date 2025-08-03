# Agent Command Execution & Feedback Loop

This document describes how **codex-cli** executes shell commands in a sandboxed environment and feeds back the stdout/stderr into the LLM conversation, enabling an iterative, self-correcting loop.

## 1. Sandboxed Execution

Depending on the platform, **codex-cli** uses two sandbox helpers:

### 1.1 Linux: Landlock
In `src/utils/agent/sandbox/landlock.ts`:
```ts
export async function execWithLandlock(
  cmd: string[], opts: SpawnOptions,
  userWritable: string[], config: AppConfig,
): Promise<ExecResult> { /* ... */ }
```
【F:codex/codex-cli/src/utils/agent/sandbox/landlock.ts†L1-L38】

### 1.2 macOS: Seatbelt (sandbox-exec)
In `src/utils/agent/sandbox/macos-seatbelt.ts`:
```ts
export const PATH_TO_SEATBELT_EXECUTABLE = "/usr/bin/sandbox-exec";
export function execWithSeatbelt(
  cmd: string[], opts: SpawnOptions,
  writableRoots: string[], config: AppConfig,
): Promise<ExecResult> { /* ... */ }
```
【F:codex/codex-cli/src/utils/agent/sandbox/macos-seatbelt.ts†L1-L16】【F:codex/codex-cli/src/utils/agent/sandbox/macos-seatbelt.ts†L48-L70】

## 2. Central Dispatch & Approval

The core handler `handleExecCommand` applies approval policies, chooses sandboxing, and executes:
```ts
export async function handleExecCommand(
  args: ExecInput, config: AppConfig,
  policy: ApprovalPolicy, writableRoots: string[],
): Promise<HandleExecCommandResult> { /* ... */ }
```
【F:codex/codex-cli/src/utils/agent/handle-exec-command.ts†L214-L267】【F:codex/codex-cli/src/utils/agent/handle-exec-command.ts†L195-L202】

## 3. Output Capture & LLM Feedback

After execution, stdout or stderr is returned to the LLM:
```ts
function convertSummaryToResult(summary: ExecCommandSummary) {
  return { outputText: summary.stdout || summary.stderr, metadata: { exit_code, duration_seconds } };
}
```
【F:codex/codex-cli/src/utils/agent/handle-exec-command.ts†L195-L202】

## 4. Stripping Shell Wrappers

To present clean commands, `bash -lc` wrappers are detected and removed in `deriveCommandKey`:
```ts
if (maybeShell === "bash" && maybeFlag === "-lc") {
  return coreInvocation.split(/\s+/)[0];
}
```
【F:codex/codex-cli/src/utils/agent/handle-exec-command.ts†L29-L46】

---
_This loop of sandboxed exec → capture output → feed back into LLM ensures iterative problem solving without manual intervention._
