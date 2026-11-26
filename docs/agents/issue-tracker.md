# Issue tracker & PR workflow: GitHub (`samasastudio/gridlock`)

Issues, specs, and pull requests for `samasastudio/gridlock` live on GitHub.

## Branch, Stacked PR & Review Workflow

1. **Chunk Issues Upfront Before Branching**: Scope each ticket (via `/to-tickets` or sub-issues under `#1`) so one ticket maps to one vertical PR slice cleanly under `800` changed lines (`<= 650-700` initial target to leave review headroom). Keep wide mechanical refactors (like codebase-wide renames) in a single GitHub issue executed via stacked expand/migrate/contract PRs rather than creating one issue per migration batch. When design, architecture, or library choices remain open, align with the human before writing production code.
2. **Branch per Ticket**: Switch to a dedicated branch (`git switch -c feat/<issue>-<slug>`, `fix/<issue>-<slug>`, or `chore/<slug>`). `.githooks/pre-commit` enforces numeric GitHub issue IDs on `feat/` and `fix/` branches, blocks direct commits to `main`, and runs `npm run lint` (`tsc -b` + architecture/type-hygiene checks).
3. **Stay Within `<= 800` Lines & Check Working Tree Early**: Run `PR_BASE_REF=<base> npm run check:pr-size -- --working-tree` at the end of each implementation phase (after `git add -N` on new files) and `PR_BASE_REF=<base> npm run check:pr-size` before opening or updating a PR. Never line-golf code or tests to squeeze an oversized change under `800`; if an issue still needs multiple slices, stack vertical PRs (`#N part 1/k..k/k`) upfront:
   - Branch slice `k` from slice `k - 1` and pass `--base <slice-(k-1)-branch>` to `gh pr create` so each PR stays `<= 800` lines, compiles cleanly (`tsc -b`, `noUnusedLocals`, `evaluateUnusedModuleExports`, zero `any` leaks), and passes `npm run verify` on its own.
   - Use `Part of #<issue>` on slices `1/k..(k-1)/k` and reserve `Closes #<issue>` (plus `ROADMAP.md` completion checkboxes) strictly for the final tip slice `k/k` so merging earlier slices does not prematurely close the issue.
   - When amending an earlier slice, transplant downstream slices via `git rebase --onto <new-parent-sha> <old-parent-sha> <slice-branch>` so pre-amend parent commits are not replayed.
   - `delete_branch_on_merge` is enabled on `samasastudio/gridlock`: when slice `1/k` merges into `main`, GitHub deletes the merged head branch and auto-retargets slice `2/k` onto `main` server-side (omit `-d` / `--delete-branch` when merging via CLI so client-side branch deletion does not race auto-retargeting). When merging an approved stack bottom-up:
     ```bash
     for pr in <pr1> <pr2> ...; do
       for _ in $(seq 1 15); do
         [ "$(gh pr view "$pr" --json baseRefName --jq .baseRefName)" = "main" ] && break
         sleep 2
       done
       gh pr merge "$pr" --merge
     done
     git fetch origin --prune && git switch main && git pull --ff-only origin main
     ```
4. **Verify & Editor Review Gate**: Run `npm run verify` and a two-axis pre-PR review across **Acceptance Criteria / Spec** (the GitHub Issue and [`ROADMAP.md`](../../ROADMAP.md)) and **Standards** ([`CODING_STANDARDS.md`](../../CODING_STANDARDS.md), `GLOSSARY.md`, `docs/adr/`), reviewing each slice's own diff (`<base_k>...<slice_k>`) when stacking PRs. For single-PR tickets, leave changes uncommitted in the working tree and stop for human review in the code editor. When executing an approved multi-slice stack, commit each verified slice locally on its branch so the next slice can branch cleanly, pausing before pushing or opening PRs unless instructed.
5. **Commit, Push, Open PR & Merge Rules**:
   - Only when explicitly instructed by the user, stage owned slice files (never unrelated untracked workspace files), commit on the feature branch, push (`git push -u origin HEAD`), verify symbol names, `@samasastudio/*` package names, and `ADR-0001`–`ADR-0004` references in the PR body against `git diff <base>...HEAD`, and open the PR via `gh pr create` (`## Summary`, `## Evidence`, `## Merge Danger`).
   - Only run `gh pr merge` when the user explicitly instructs you to merge; otherwise stop and share the PR URL.
   - Post inline GitHub PR review threads (`gh api repos/samasastudio/gridlock/pulls/<pr-number>/reviews -X POST --input ...` with `event: "COMMENT"`, summary `body`, and inline diff `comments` on `Files changed`, not `gh pr comment`) **only when the user explicitly asks to post review comments to GitHub**; otherwise keep pre-PR audits in `06-review.md` so PRs do not accumulate unresolved self-review threads.
   - When wrapping up a multi-slice ticket mid-flight across sessions, update `ROADMAP.md` slice progress and post a pickup checkpoint comment on the originating issue (`gh issue comment <issue>`).

## `gh` CLI Conventions

- **Read an issue or PR (always pass `--json` to bypass sunset Classic Projects GraphQL errors)**:
  - Issue: `gh issue view <number> --json number,title,state,body,labels,comments`
  - PR metadata & diff: `gh pr view <number> --json number,title,state,baseRefName,headRefName,body,labels,comments,files` and `gh pr diff <number>`
  - **Avoid GraphQL 500k-node blowups on `gh pr list`**: omit `commits` from `--json` and keep `--limit <= 50` whenever requesting nested fields (`comments`, `reviews`).
- **Fetch PR reviews (one-shot GraphQL for latest review summary + unresolved inline threads)**:
  ```bash
  gh api graphql -F number=<number> -f query='
    query($number: Int!) {
      repository(owner: "samasastudio", name: "gridlock") {
        pullRequest(number: $number) {
          reviews(last: 3) { nodes { state submittedAt body } }
          reviewThreads(first: 50) {
            nodes {
              isResolved isOutdated path line
              comments(first: 5) { nodes { author { login } body } }
            }
          }
        }
      }
    }' --jq '{reviews: .data.repository.pullRequest.reviews.nodes, unresolved: [.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved == false)]}'
  ```
- **Edit issue or PR title/body (use REST `PATCH`; `gh issue edit` / `gh pr edit` hit Classic Projects GraphQL errors)**:
  ```bash
  gh api repos/samasastudio/gridlock/issues/<number> -X PATCH -F body=@/tmp/body.md
  gh api repos/samasastudio/gridlock/pulls/<number> -X PATCH -f title="..." -F body=@/tmp/body.md
  ```
- **Create / comment / close**: `gh issue create --title "..." --body "..."`, `gh issue comment <number> --body "..."`, `gh issue close <number> --comment "..."`.
- **List open issues**: `gh issue list --state open --json number,title,body,labels,comments`
- **Find unblocked frontier**:
  ```bash
  gh api --paginate 'repos/samasastudio/gridlock/issues?state=open' \
    --jq '.[] | select(.pull_request == null and .issue_dependencies_summary.blocked_by == 0) | "#\(.number): \(.title) (\(.html_url))"'
  ```
- **Sub-issues & blocking edges**:
  - Sub-issue: `gh api --method POST repos/samasastudio/gridlock/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`
  - Add blocker (`<db-id>` via `gh api repos/samasastudio/gridlock/issues/<n> --jq .id`): `gh api --method POST repos/samasastudio/gridlock/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`
  - Remove stale blocker (keep synced whenever `ROADMAP.md` wave dependencies change so `blocked_by == 0` stays accurate): `gh api --method DELETE repos/samasastudio/gridlock/issues/<child>/dependencies/blocked_by/<blocker-db-id>`
- **Apply / remove labels (use REST; `gh issue edit` hits Classic Projects GraphQL errors on `gh` 2.46)**:
  - Add: `gh api repos/samasastudio/gridlock/issues/<number>/labels -X POST -f 'labels[]=<label>'`
  - Remove: `gh api repos/samasastudio/gridlock/issues/<number>/labels/<label> -X DELETE`
- **Target repo guard**: File issues only into `samasastudio/gridlock` (never into `mattpocock/skills`). Before the first `gh issue create` of a session, confirm with `gh repo view --json nameWithOwner`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, external PRs run through the same labels and states as issues (`gh pr view <number> --json ...`, `gh pr diff <number>`, `gh pr comment <number> --body "..."`, `gh pr close <number>`, and the `/issues/<number>/labels` REST endpoint above since GitHub shares issue and PR label endpoints).

## When a skill says "publish to the issue tracker"

Create a GitHub issue in `samasastudio/gridlock`.

## When a skill says "fetch the relevant ticket"

Read it with `gh issue view <number> --json number,title,state,body,labels,comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body (`gh issue create --label wayfinder:map ...`).
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api --method POST repos/samasastudio/gridlock/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`). Labels: `wayfinder:<type>` (`research` / `prototype` / `grilling` / `task`).
- **Blocking**: use native GitHub issue dependencies (`dependencies/blocked_by` above) and count open blockers via `gh api repos/samasastudio/gridlock/issues/<n> --jq .issue_dependencies_summary.blocked_by` (`0` means startable).
- **Frontier query**: list the map's open children, drop any with `issue_dependencies_summary.blocked_by > 0` or an existing assignee; first in map order wins.
- **Claim**: `gh api repos/samasastudio/gridlock/issues/<n>/assignees -X POST -f "assignees[]=$(gh api user --jq .login)"`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far via REST `PATCH`.
