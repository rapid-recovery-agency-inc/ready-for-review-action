# ready-for-review-action

A GitHub Action that runs when a pull request transitions from **Draft → Ready for Review** and posts clickable Buddy CI pipeline buttons as a comment on the PR.

The comment is posted **at most once per PR per calendar day (UTC)**, preventing duplicate notifications on repeated transitions.

---

## How it works

1. The workflow is triggered by the `pull_request: ready_for_review` event.
2. The action reads the `BUDDY_WEBHOOK_BASE_URLS` secret (a newline-separated list of `Label,URL` pairs).
3. It checks whether a Buddy pipeline comment has already been posted today.
4. If not, it creates a PR comment containing a clickable badge button for each pipeline entry.

---

## Setup

### 1 – Add the secret to your repository

In your repository → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|------|-------|
| `BUDDY_WEBHOOK_BASE_URLS` | `Deploy to Staging,https://buddy.works/api/webhooks/abc123` |

For multiple pipelines, put each entry on its own line:

```
Deploy to Staging,https://buddy.works/api/webhooks/abc123
Tests,https://buddy.works/api/webhooks/def456
```

### 2 – Add the workflow to your repository

Copy the following file to `.github/workflows/ready-for-review.yml` in your repository:

```yaml
name: Ready for Review – Notify Buddy

on:
  pull_request:
    types: [ready_for_review]

jobs:
  notify-buddy:
    name: Post Buddy pipeline buttons
    runs-on: ubuntu-latest
    if: ${{ !github.event.pull_request.draft }}

    permissions:
      pull-requests: write
      issues: write

    steps:
      - uses: actions/checkout@v4

      - name: Post Buddy webhook buttons
        uses: rapid-recovery-agency-inc/ready-for-review-action@main
        with:
          buddy-webhook-base-urls: ${{ secrets.BUDDY_WEBHOOK_BASE_URLS }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

---

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `buddy-webhook-base-urls` | No | `''` | Newline-separated list of `Label,URL` pairs (one per line). Map to the `BUDDY_WEBHOOK_BASE_URLS` secret. |
| `github-token` | Yes | `${{ github.token }}` | GitHub token used to read and write PR comments. |

---

## Example comment

When the action runs, it creates a comment like:

> ## 🚀 Buddy Pipelines
>
> <a href="https://buddy.works/api/webhooks/abc123" target="_blank" rel="noopener noreferrer"><kbd>Run Deploy to Staging</kbd></a>
>
> <a href="https://buddy.works/api/webhooks/def456" target="_blank" rel="noopener noreferrer"><kbd>Run Tests</kbd></a>

---

## Development

```bash
# Install dependencies
npm install

# Type-check
npm run lint

# Run tests
npm test

# Build the dist bundle (required before committing)
npm run build
```

The `dist/` directory must be committed alongside source changes so GitHub Actions can execute the bundled code without a separate install step.
