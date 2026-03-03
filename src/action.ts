import * as core from '@actions/core';
import * as github from '@actions/github';

/** Marker embedded in every comment this action creates. */
export const COMMENT_MARKER = '<!-- ready-for-review-action -->';

/** Regex to extract the ISO date from the hidden date comment. */
const DATE_PATTERN = /<!-- date: (\d{4}-\d{2}-\d{2}) -->/;

/**
 * Returns today's date as an ISO-8601 date string (YYYY-MM-DD) in UTC.
 * Exported so tests can verify date formatting.
 */
export function getTodayString(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Parses a comma-separated string of URLs and returns the valid ones.
 *
 * @param rawUrls - Raw input value from the `buddy-webhook-base-urls` input.
 * @returns Array of trimmed, valid URL strings.
 */
export function parseUrls(rawUrls: string): string[] {
  return rawUrls
    .split(',')
    .map(u => u.trim())
    .filter(u => u.length > 0 && isValidUrl(u));
}

/**
 * Returns true if the given string is a parseable, absolute URL.
 */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Derives a human-readable label from a URL.
 * Uses the last non-empty path segment, falling back to the hostname.
 */
export function getLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(s => s.length > 0);
    return segments[segments.length - 1] ?? parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Builds the PR comment body containing shield.io badge buttons for each URL.
 *
 * An HTML comment with today's date is embedded so future runs can detect
 * that a comment was already posted today and skip posting another one.
 *
 * @param urls   - Validated Buddy webhook base URLs.
 * @param today  - ISO date string (YYYY-MM-DD), defaults to today.
 */
export function buildComment(urls: string[], today = getTodayString()): string {
  const buttons = urls
    .map(url => {
      const label = getLabelFromUrl(url);
      const badgeLabel = encodeURIComponent(label.replace(/-/g, '--').replace(/ /g, '_'));
      return `[![${label}](https://img.shields.io/badge/Run-${badgeLabel}-blue?style=for-the-badge)](${url})`;
    })
    .join('\n');

  return [
    COMMENT_MARKER,
    `<!-- date: ${today} -->`,
    '## 🚀 Buddy Pipelines',
    '',
    buttons,
  ].join('\n');
}

/**
 * Returns true if the given comment body was posted by this action today.
 *
 * @param body  - Comment body to inspect.
 * @param today - ISO date string to match against.
 */
export function isActionCommentForToday(body: string, today: string): boolean {
  if (!body.includes(COMMENT_MARKER)) return false;
  const match = DATE_PATTERN.exec(body);
  return match !== null && match[1] === today;
}

/**
 * Main entry-point for the action.
 */
export async function run(): Promise<void> {
  try {
    const rawUrls = core.getInput('buddy-webhook-base-urls');
    const token = core.getInput('github-token', { required: true });

    if (!rawUrls) {
      core.info('buddy-webhook-base-urls input is empty – skipping');
      return;
    }

    const urls = parseUrls(rawUrls);
    if (urls.length === 0) {
      core.warning(
        'No valid URLs were found in buddy-webhook-base-urls. ' +
          'Ensure the BUDDY_WEBHOOK_BASE_URLS secret contains at least one ' +
          'comma-separated http(s) URL.'
      );
      return;
    }

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pullNumber = github.context.payload.pull_request?.number;

    if (!pullNumber) {
      core.info('Not running in a pull_request event context – skipping.');
      return;
    }

    const today = getTodayString();

    // Substitute ${PR} placeholder in each URL with the actual PR number.
    const resolvedUrls = urls.map(url => url.replace(/\$\{PR\}/g, String(pullNumber)));

    // Paginate through all comments to find a same-day comment from this action.
    let alreadyPostedToday = false;
    for await (const response of octokit.paginate.iterator(
      octokit.rest.issues.listComments,
      { owner, repo, issue_number: pullNumber, per_page: 100 }
    )) {
      for (const comment of response.data) {
        if (comment.body && isActionCommentForToday(comment.body, today)) {
          alreadyPostedToday = true;
          break;
        }
      }
      if (alreadyPostedToday) break;
    }

    if (alreadyPostedToday) {
      core.info('Buddy pipeline comment already posted today – skipping.');
      return;
    }

    const body = buildComment(resolvedUrls, today);
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber,
      body,
    });

    core.info(`✅ Posted Buddy pipeline buttons on PR #${pullNumber}.`);
  } catch (error) {
    core.setFailed(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
