# Issue tracker & PR workflow: GitHub

Issues, specs, and pull requests for this repo live on GitHub. Use the `gh` CLI for all operations.

## Branch & Pull Request Workflow (Single Source of Truth)

`.githooks/pre-commit` rejects direct commits to `main` and `.githooks/pre-push` rejects direct pushes to `main`. Every change follows this sequence:

1. **Branch**: Create a feature branch from `main` (`git switch -c feat/<issue>-<slug>` or `chore/<slug>`).
2. **Review**: Run two-axis `/code-review` against `main...HEAD` (**Standards** via `CODING_STANDARDS.md` + **Spec** via the GitHub issue and `ROADMAP.md`) and resolve all findings.
3. **Open PR (`/pr`)**: Push the branch (`git push -u origin HEAD`) and create a Pull Request using the `/pr` template (`## Summary`, `## Evidence`, `## Merge Danger`):
   ```bash
   gh pr create --base main --title "feat(core): ... (closes #<number>)" --body "..."
   ```
4. **Completion criterion**: `gh pr create` outputs the Pull Request URL, and you present that URL to the user so the repository owner can review and merge it into `main`.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue or PR (always pass `--json` + `--jq` to avoid deprecated classic Projects GraphQL errors and single-line JSON truncation)**:
  - Issue: `gh issue view <number> --json number,title,state,labels,body --jq '"#\(.number): \(.title) [\(.state)]\n\n\(.body)"'`
  - PR: `gh pr view <number> --json number,title,state,body,labels,comments,files` and `gh pr diff <number>`
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`
- **Find unblocked frontier**:
  ```bash
  gh api --paginate 'repos/samasastudio/gridlock/issues?state=open&labels=ready-for-agent' \
    --jq '.[] | select(.issue_dependencies_summary.blocked_by == 0) | "#\(.number): \(.title) (\(.html_url))"'
  ```
- **Make an issue a sub-issue of a parent**: `gh api --method POST repos/samasastudio/gridlock/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`
- **Blocking edges**: `gh api --method POST repos/samasastudio/gridlock/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` (where `<blocker-db-id>` is `gh api repos/samasastudio/gridlock/issues/<n> --jq .id`).
- **Comment / label / close**: `gh issue comment <number> --body "..."`, `gh issue edit <number> --add-label "..."`, `gh issue close <number> --comment "..."`.

## Pull requests as a triage surface

**PRs as a request surface: no.**
