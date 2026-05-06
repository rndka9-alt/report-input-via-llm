# Project Agent Guide

## Goal

- Keep this project easy to grow from an empty starting point.
- Prefer simple structure until real ownership boundaries appear.
- Make public APIs intentional when modules become large enough to need them.
- Avoid importing domain assumptions from other projects.

## General Rules

1. Start with the smallest structure that clearly supports the current code.
2. Add folders only when they clarify ownership, responsibility, or reuse.
3. Keep related types, constants, and small helpers near the code that owns them until reuse is real.
4. Avoid vague names such as `common`, `misc`, or `helper`.
5. Prefer responsibility-oriented names over technical buckets when a clear domain exists.
6. Keep dependencies directional. Avoid circular imports between modules.
7. Do not add abstractions for symmetry alone.
8. Preserve existing project patterns once they exist.

## Module Boundaries

- A single file is fine while the implementation is small.
- Promote a file into a directory when it gains meaningful internal structure.
- If a directory becomes a module, expose its public API through an entry file such as `index.ts` or `index.tsx`.
- Entry files should only re-export intentional public symbols.
- Do not use `export *` in module entry files.
- Code outside a module should not import that module's private implementation files.
- Sibling modules should import each other through public entry points.

## Promotion Rules

Promote a folder into its own module when several of these are true:

- It has a clear responsibility that can be named.
- It is growing beyond a few files.
- Other code relies on it through an obvious API.
- Its internal imports are denser than its connection to surrounding code.
- It needs its own types, model, hooks, components, or internal helpers.

## Type Safety

- Do not use type assertions such as `as`, non-null assertions such as `!`, or double assertions just to silence compile errors.
- Prefer type guards, null checks, discriminated unions, and control-flow narrowing.
- Validate values at runtime boundaries instead of asserting deeper in the code path.

## Comments

- Explain why code exists when the reason is not obvious.
- Do not write comments that merely repeat what the code does.

```ts
// Good: iOS Safari includes the address bar in 100vh, so dvh avoids cropped layouts.
const height = '100dvh'

// Bad: Set the height to 100dvh.
const height = '100dvh'
```

## Testing And Verification

- Prefer tests that assert behavior through public APIs.
- Internal tests are acceptable for complex pure logic, branch-heavy transforms, or regression-prone behavior.
- Do not couple tests to file layout unless there is a strong reason.
- After code changes, run the project's test command when one exists.
- If no test command exists, report that verification was limited by the current project setup.
- Do not overwrite, revert, or clean up unrelated worktree changes.

## Refactoring Standard

- Refactor only when it improves clarity, ownership, or future change safety.
- Keep edits scoped to the requested work.
- Avoid adding folder depth just for symmetry.
- Optimize for clear imports, clear ownership, and low-friction future changes.
