# RFC 0000: RFC Process

**Status:** Implemented
**Author:** Charlie Cheever / Claude
**Date:** 2026-03-22
**Revised:** 2026-03-22

## Summary

Establish a numbered RFC process for mdview. RFCs are the primary mechanism for proposing and documenting significant changes — architecture decisions, new subsystems, API designs, and cross-cutting concerns. This document defines the numbering scheme, lifecycle, authoring workflow, and review requirements.

## Numbering

- RFCs are numbered with **4-digit zero-padded integers**: `0001`, `0002`, ..., `9999`.
- To create a new RFC, pick the next available number by scanning filenames in `rfcs/`. A number is permanently assigned once used, even if the RFC is later withdrawn or superseded.
- **Collisions are not catastrophic.** The number is a prefix used in filenames and references, not a primary key in a database. If two people (or agents) pick the same number concurrently on parallel branches, one of them can be renumbered in a follow-up commit. This is expected to be rare — just renumber and move on.
- We use 4 digits because AI-assisted development generates RFCs at a much higher rate than a traditional process. We will exceed 1000 if the project continues.
- Filename format: `NNNN-slug.md` (e.g., `0000-rfc-process.md`, `0042-sidebar-redesign.md`).

### Pre-existing RFCs

RFCs created before this process was adopted do not have numbers. They can be retroactively numbered if they are actively updated, but this is not required. Unnumbered filenames (e.g., `image-component.md`) are valid and unambiguous.

## Lifecycle

Every RFC has a **status** field in its header. Valid statuses:

| Status | Meaning |
|---|---|
| `Draft` | Under active discussion. May change substantially. |
| `Review` | Draft is complete and undergoing multi-model review. |
| `Accepted` | Approved for implementation. Design is stable. |
| `Implemented` | Fully implemented in the codebase. |
| `Superseded` | Replaced by a specific newer RFC. Link to the replacement. |
| `Shelved` | Not now, maybe later. The idea has merit but isn't a priority. |
| `Withdrawn` | Abandoned without a replacement. Not going to be implemented. |

Typical progression: `Draft` -> `Review` -> `Accepted` -> `Implemented`. Not every RFC reaches `Accepted` — some are `Shelved` when priorities shift, and some are `Withdrawn` when the idea itself is rejected. Both are fine.

**Distinguishing the terminal statuses:**
- `Superseded` — another RFC explicitly replaces this one. Always link to the replacement.
- `Shelved` — the idea is sound but the timing is wrong (e.g., TUI/SSH target — cool idea, not a priority before launch). Can be reopened by moving back to `Draft`.
- `Withdrawn` — the idea was tried and rejected, or is no longer relevant. No replacement RFC exists.

Rules:
- New RFCs start as `Draft`.
- A draft moves to `Review` when it's ready for multi-model review. This is optional — small RFCs can go directly from `Draft` to `Accepted`.
- A draft or review becomes `Accepted` once the review loop (see below) is complete and the author is satisfied.
- An accepted RFC becomes `Implemented` when the work is done and merged.
- If a later RFC replaces this one, set status to `Superseded` and add a line: `**Superseded by:** RFC NNNN`.
- If an RFC is deprioritized, set status to `Shelved`. Briefly note why.
- If an RFC is abandoned, set status to `Withdrawn`. Briefly note why.
- Once accepted, an RFC should not have its design section materially changed. If the design evolves during implementation, write a new RFC or add an addendum — don't silently rewrite history. Addendums are appended as dated sections at the end of the RFC (e.g., `## Addendum (2026-04-15): ...`).
- Update the `**Revised:**` date in the frontmatter when making substantive changes to a draft.

### Compatibility with existing statuses

Some pre-existing RFCs use statuses like `Draft v2`, `Draft v5`, or `Shelved`. These map naturally: `Draft vN` is just `Draft` (the version is implicit in git history), and `Shelved` remains `Shelved`. No migration is required — update the status when an RFC is next touched.

### Frontmatter

New RFCs should include at minimum. Pre-existing RFCs can be normalized to this format when they are next touched, but this is not required retroactively:

```markdown
# RFC NNNN: Title

**Status:** Draft | Review | Accepted | Implemented | Superseded | Shelved | Withdrawn
**Author:** Name / AI model (if co-authored)
**Date:** YYYY-MM-DD
**Revised:** YYYY-MM-DD (if updated after initial draft)
```

## Authoring Workflow

RFCs are written collaboratively with AI. The typical flow:

1. **Discuss** the idea interactively with Claude. Hash out the motivation, constraints, trade-offs, and rough design.
2. **Draft** — Claude writes the RFC based on the discussion. The author reviews and edits.
3. **Review** — The draft must be reviewed by at least two AI models in addition to the author:
   - **(a) The author** (you). Read it critically. Does it make sense? Are there gaps?
   - **(b) GPT 5.4** (or whatever the current SOTA model from OpenAI is). Paste the RFC and ask for a critical review. Look for blind spots, unstated assumptions, and alternative approaches the draft doesn't consider.
   - **(c) A Claude model** (a fresh session, not the one that wrote the draft). Same goals — different context, different blind spots.

   The principle is: get critical review from both Claude and GPT. If another model family (Gemini, etc.) reaches the same level, we'll revisit.

   **Standard review prompt.** When requesting a model review, ask these questions:

   > What do you think of this proposal? Is it a good idea? Do we have a good plan here? How would you change it to make it better? What would you add or take away or change? Is anything definitely or possibly wrongheaded here? Do you have any novel ideas that you think might make this way better even if they are a bit non-standard? What are the key open questions we need to answer to refine this?
4. **Iterate** — Address feedback from all reviewers. The author decides which feedback to incorporate and when the RFC is good enough. Model reviewers are required *inputs*, not *approvers* — the author is the final decision-maker.
5. **Accept** — The author updates the status to `Accepted`. Right now, Charlie is the sole maintainer and accepts all RFCs. As the team grows, acceptance authority may be delegated, but that's a future problem.

### Why multi-model review?

Each model has different strengths and blind spots. GPT may catch practical concerns Claude misses; Claude may catch architectural issues GPT glosses over. The author catches things neither model knows about (business context, user needs, taste). The combination produces significantly better designs than any single reviewer.

### Review artifacts

Model review responses can be saved as `NNNN-slug.gpt54.md`, `NNNN-slug.opus46.md`, etc. These can be kept alongside the RFC in `rfcs/` or archived separately.

## Implementation

Once an RFC is accepted:

- **Codex** handles implementation in most cases — it's well-suited for executing against a clear spec.
- **Claude** handles implementation when the work requires more interactive iteration, architectural judgment, or when the scope is small enough that a conversation is more efficient than a batch task.
- The implementer (human or AI) should reference the RFC number in commit messages and PR descriptions (e.g., "Implements RFC 0042").

## Where RFCs Live

| Status | Location |
|---|---|
| `Draft`, `Review` | `rfcs/` |
| `Accepted` | `rfcs/` |
| `Implemented` | `rfcs/` |
| `Superseded` | `rfcs/`. Add a `**Superseded by:**` line; don't delete. |
| `Shelved`, `Withdrawn` | `rfcs/` |

- **Review artifacts:** alongside the RFC in `rfcs/`, or a subdirectory if preferred

## RFC Structure Guide

An RFC doesn't need to follow a rigid template, but most good RFCs cover:

1. **Summary** — One paragraph. What is this RFC proposing?
2. **Motivation** — Why is this needed? What problem does it solve?
3. **Design** — The proposed solution. Be specific enough that someone (or an AI agent) could implement it.
4. **Alternatives considered** — What else was considered and why was it rejected?
5. **Implementation plan** — Phases, ordering, dependencies. Who/what implements each part?
6. **Open questions** — Unresolved issues that need answers before or during implementation.

Not every section is required for every RFC. A small, focused RFC might just have Summary, Motivation, and Design. Use judgment.

## This RFC

This document is RFC 0000. It is self-referential: it follows the process it defines, except that the process didn't exist yet when it was written. Future RFCs should follow the workflow described above.
