# Issue tracker & PR workflow: GitHub (`samasastudio/gridlock`)

Issues, specs, and pull requests for `samasastudio/gridlock` live on GitHub.

## Branch, Stacked PR & Review Workflow

1. **Branch**: Switch to a dedicated branch (`git switch -c feat/<issue>-<slug>`, `fix/<issue>-<slug>`, or `chore/<slug>`). `.githooks/pre-commit` blocks direct commits to `main` and runs `npm run verify`.
2. **Slice Within `<= 700` Lines**: Run `PR_BASE_REF=<base> npm run check:pr-size` before opening or updating a PR. When a ticket exceeds `700` changed lines (`insertions + deletions`), slice it into stacked vertical PRs (`#N part 1/k..k/k`):
   - Branch slice `k` from slice `k - 1` and pass `--base <slice-(k-1)-branch>` to `gh pr create` so each PR's diff stays `<= 700` lines and compiles/tests cleanly on its own.
   - `delete_branch_on_merge` is enabled on `samasastudio/gridlock`: when the human merges slice `1/k` into `main`, GitHub deletes the merged head branch and auto-retargets slice `2/k` onto `main`. Rebase or merge the updated base cleanly if conflicts arise.
3. **Verify & Two-Axis Review**: Run `npm run verify` (typecheck + build + lint + tests) and two-axis `/code-review` against `<base>...HEAD` (**Standards** via [`CODING_STANDARDS.md`](../../CODING_STANDARDS.md) + **Spec** via the GitHub Issue and [`ROADMAP.md`](../../ROADMAP.md)).
4. **Open PR (`/pr`) & Stop for Human Merge**: Push (`git push -u origin HEAD`), verify all symbol names, `@samasastudio/*` package names, and `ADR-0001`–`ADR-0004` references in the `/pr` body against `git diff <base>...HEAD`, create the PR via `gh pr create`, and **stop and share the PR URL** (`gh pr merge` is human-only).

## `gh` CLI Conventions

- **Read an issue or PR (always pass `--json` to bypass sunset Classic Projects GraphQL errors)**:
  - Issue: `gh issue view <number> --json number,title,state,body,labels,comments`
  - PR metadata & diff: `gh pr view <number> --json number,title,state,baseRefName,headRefName,body,labels,comments,files` and `gh pr diff <number>`
- **Fetch PR reviews (both top-level review summaries and inline code comments)**:
  ```bash
  gh api repos/samasastudio/gridlock/pulls/<number>/reviews --jq '.[] | {id, state, submitted_at, body}'
  gh api repos/samasastudio/gridlock/pulls/<number>/comments --jq '.[] | {id, path, line: (.line // .original_line), body}'
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
  gh api --paginate 'repos/samasastudio/gridlock/issues?state=open&labels=ready-for-agent' \
    --jq '.[] | select(.issue_dependencies_summary.blocked_by == 0) | "#\(.number): \(.title) (\(.html_url))"'
  ```
- **Sub-issues & blocking edges**:
  - Sub-issue: `gh api --method POST repos/samasastudio/gridlock/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`
  - Blocker (`<db-id>` via `gh api repos/samasastudio/gridlock/issues/<n> --jq .id`): `gh api --method POST repos/samasastudio/gridlock/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`

## Pull requests as a triage surface

**PRs as a request surface: no.**
