# Meta‑TDD Harness: LLM‑to‑LLM Review Tests

This document demonstrates how to build a **meta‑TDD harness** for the autonomous coding loop by using one LLM stub to generate code patches and another to review them. By writing tests against these mocks, we get a deterministic, test‑first safety net for the agentic workflow.

## 1. Example Test (Vitest)

```ts
// tests/agentic-loop.test.ts
import { describe, it, expect, vi } from 'vitest'
import { agenticGenerateAndReview } from '../src/agentic-loop'

// 1. Stub out the patch generator
const mockGeneratePatch = vi.fn<[], Promise<string>>()
mockGeneratePatch.mockResolvedValueOnce(
  `@@ -1 +1
-foo
+bar
`
)

// 2. Stub out the patch reviewer
const mockReviewPatch = vi.fn<[string], Promise<{ approved: boolean; feedback: string }>>()
mockReviewPatch.mockResolvedValueOnce({ approved: true, feedback: 'OK' })

describe('agenticGenerateAndReview', () => {
  it('passes the patch through when approved', async () => {
    const patch = await agenticGenerateAndReview(mockGeneratePatch, mockReviewPatch)
    expect(mockGeneratePatch).toHaveBeenCalledOnce()
    expect(mockReviewPatch).toHaveBeenCalledWith(patch)
    expect(patch).toContain('bar')
  })
})
```

## 2. Failing‑review Scenario

```ts
mockReviewPatch.mockResolvedValueOnce({ approved: false, feedback: 'Missing semicolon' })
await expect(
  agenticGenerateAndReview(mockGeneratePatch, mockReviewPatch)
).rejects.toThrow(/Missing semicolon/)
```

## 3. Next Steps for Experimentation

1. **Queue multiple rounds**: Extend mocks to simulate multi‑round review cycles (re‑generation upon rejection).
2. **Golden‑file integration**: Capture real GPT‑4/Gemini responses in fixtures and replay them instead of stubs.
3. **CI gating**: Use a `META_TDD=true` env var to include meta‑TDD tests only when explicitly enabled in CI.
4. **Expand scenarios**: Add tests for edge cases: timeout, LLM errors, partial patches, file creation/deletion.
5. **Automation**: Hook into the `codex auto` command to optionally run the meta‑TDD harness as part of the spike branch validation.

---
_This harness bridges conventional TDD with agentic workflows, making AI‑driven loops verifiable and repeatable._
