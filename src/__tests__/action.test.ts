import * as core from '@actions/core';
import * as github from '@actions/github';

import {
  COMMENT_MARKER,
  buildComment,
  getLabelFromUrl,
  isActionCommentForToday,
  parseUrls,
  run,
} from '../action';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
// jest.mock() auto-mocks the CJS files wired via moduleNameMapper –
// this avoids loading the ESM-only @actions packages directly.
jest.mock('@actions/core');
jest.mock('@actions/github');

// Typed references to the mocked modules.
const mockCore = jest.mocked(core);
const mockGithub = jest.mocked(github);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOctokit(comments: { body: string }[] = []) {
  const createComment = jest.fn().mockResolvedValue({});

  const paginateIterator = jest.fn().mockImplementation(() => {
    return (async function* () {
      yield { data: comments };
    })();
  });

  return {
    rest: {
      issues: {
        listComments: jest.fn(),
        createComment,
      },
    },
    paginate: {
      iterator: paginateIterator,
    },
  };
}

// ---------------------------------------------------------------------------
// parseUrls
// ---------------------------------------------------------------------------

describe('parseUrls', () => {
  it('returns a single valid URL', () => {
    expect(parseUrls('https://buddy.works/api/webhooks/abc123')).toEqual([
      'https://buddy.works/api/webhooks/abc123',
    ]);
  });

  it('splits comma-separated URLs', () => {
    const result = parseUrls(
      'https://buddy.works/webhook/1, https://buddy.works/webhook/2'
    );
    expect(result).toEqual([
      'https://buddy.works/webhook/1',
      'https://buddy.works/webhook/2',
    ]);
  });

  it('trims whitespace around each URL', () => {
    const result = parseUrls('  https://example.com/a  ,  https://example.com/b  ');
    expect(result).toEqual(['https://example.com/a', 'https://example.com/b']);
  });

  it('filters out empty segments from trailing commas', () => {
    const result = parseUrls('https://example.com/a,,');
    expect(result).toEqual(['https://example.com/a']);
  });

  it('filters out non-http(s) URLs', () => {
    const result = parseUrls('ftp://example.com/a, https://example.com/b');
    expect(result).toEqual(['https://example.com/b']);
  });

  it('filters out invalid strings', () => {
    const result = parseUrls('not-a-url, https://example.com/b');
    expect(result).toEqual(['https://example.com/b']);
  });

  it('returns empty array for blank input', () => {
    expect(parseUrls('')).toEqual([]);
    expect(parseUrls('   ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getLabelFromUrl
// ---------------------------------------------------------------------------

describe('getLabelFromUrl', () => {
  it('returns the last non-empty path segment', () => {
    expect(getLabelFromUrl('https://buddy.works/api/webhooks/abc123')).toBe('abc123');
  });

  it('falls back to hostname when path is empty', () => {
    expect(getLabelFromUrl('https://buddy.works')).toBe('buddy.works');
  });

  it('handles trailing slashes gracefully', () => {
    expect(getLabelFromUrl('https://buddy.works/pipeline/')).toBe('pipeline');
  });

  it('returns the raw input for an unparseable value', () => {
    expect(getLabelFromUrl('not-a-url')).toBe('not-a-url');
  });
});

// ---------------------------------------------------------------------------
// buildComment
// ---------------------------------------------------------------------------

describe('buildComment', () => {
  const FIXED_TODAY = '2026-03-03';

  it('includes the action marker', () => {
    const body = buildComment(['https://buddy.works/webhook/1'], FIXED_TODAY);
    expect(body).toContain(COMMENT_MARKER);
  });

  it('embeds the supplied date', () => {
    const body = buildComment(['https://buddy.works/webhook/1'], FIXED_TODAY);
    expect(body).toContain(`<!-- date: ${FIXED_TODAY} -->`);
  });

  it('contains a badge link for each URL', () => {
    const body = buildComment(
      ['https://buddy.works/webhook/1', 'https://buddy.works/webhook/2'],
      FIXED_TODAY
    );
    expect(body).toContain('https://buddy.works/webhook/1');
    expect(body).toContain('https://buddy.works/webhook/2');
    // Both links wrapped in badge markdown
    expect((body.match(/img\.shields\.io/g) ?? []).length).toBe(2);
  });

  it('encodes hyphens in badge labels using double-hyphen', () => {
    const body = buildComment(
      ['https://buddy.works/webhook/my-pipeline'],
      FIXED_TODAY
    );
    // Hyphens in Shields.io labels must be escaped as --
    expect(body).toContain('my--pipeline');
  });
});

// ---------------------------------------------------------------------------
// isActionCommentForToday
// ---------------------------------------------------------------------------

describe('isActionCommentForToday', () => {
  const today = '2026-03-03';

  it('returns true for a comment created by this action today', () => {
    const body = buildComment(['https://example.com/hook'], today);
    expect(isActionCommentForToday(body, today)).toBe(true);
  });

  it('returns false when the marker is absent', () => {
    expect(isActionCommentForToday('Some random comment', today)).toBe(false);
  });

  it('returns false when the date does not match today', () => {
    const body = buildComment(['https://example.com/hook'], '2026-03-02');
    expect(isActionCommentForToday(body, today)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// run() – integration-style tests with mocked inputs and Octokit
// ---------------------------------------------------------------------------

describe('run', () => {
  const PR_NUMBER = 42;
  const TODAY = '2026-03-03';

  beforeEach(() => {
    jest.clearAllMocks();

    // Default context – mutate the object in-place (context is a getter on the module)
    Object.assign(mockGithub.context, {
      repo: { owner: 'org', repo: 'my-repo' },
      payload: { pull_request: { number: PR_NUMBER } },
    });

    // Default inputs
    mockCore.getInput.mockImplementation((name: string) => {
      if (name === 'buddy-webhook-base-urls')
        return 'https://buddy.works/webhook/1, https://buddy.works/webhook/2';
      if (name === 'github-token') return 'gh-token';
      return '';
    });

    // Mock today's date so tests are deterministic
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue(`${TODAY}T12:00:00.000Z`);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('posts a comment when no same-day comment exists', async () => {
    const octokit = makeOctokit([]);
    mockGithub.getOctokit.mockReturnValue(octokit as never);

    await run();

    expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1);
    const callArg = (octokit.rest.issues.createComment as jest.Mock).mock.calls[0][0];
    expect(callArg.issue_number).toBe(PR_NUMBER);
    expect(callArg.body).toContain(COMMENT_MARKER);
    expect(callArg.body).toContain(`<!-- date: ${TODAY} -->`);
    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining(`PR #${PR_NUMBER}`)
    );
  });

  it('skips posting when a same-day comment already exists', async () => {
    const existingBody = buildComment(['https://buddy.works/webhook/1'], TODAY);
    const octokit = makeOctokit([{ body: existingBody }]);
    mockGithub.getOctokit.mockReturnValue(octokit as never);

    await run();

    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('already posted today')
    );
  });

  it('skips (with info) when buddy-webhook-base-urls input is empty', async () => {
    mockCore.getInput.mockImplementation((name: string) => {
      if (name === 'buddy-webhook-base-urls') return '';
      if (name === 'github-token') return 'gh-token';
      return '';
    });
    const octokit = makeOctokit([]);
    mockGithub.getOctokit.mockReturnValue(octokit as never);

    await run();

    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(mockCore.info).toHaveBeenCalledWith(
      expect.stringContaining('empty')
    );
  });

  it('warns when all provided URLs are invalid', async () => {
    mockCore.getInput.mockImplementation((name: string) => {
      if (name === 'buddy-webhook-base-urls') return 'not-a-url, ftp://bad';
      if (name === 'github-token') return 'gh-token';
      return '';
    });
    const octokit = makeOctokit([]);
    mockGithub.getOctokit.mockReturnValue(octokit as never);

    await run();

    expect(octokit.rest.issues.createComment).not.toHaveBeenCalled();
    expect(mockCore.warning).toHaveBeenCalled();
  });

  it('calls setFailed when not in a pull_request context', async () => {
    Object.assign(mockGithub.context, {
      repo: { owner: 'org', repo: 'my-repo' },
      payload: {},
    });
    const octokit = makeOctokit([]);
    mockGithub.getOctokit.mockReturnValue(octokit as never);

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('pull_request event context')
    );
  });

  it('calls setFailed when the API throws', async () => {
    const octokit = makeOctokit([]);
    (octokit.paginate.iterator as jest.Mock).mockImplementation(() => {
      return (async function* () {
        throw new Error('API error');
      })();
    });
    mockGithub.getOctokit.mockReturnValue(octokit as never);

    await run();

    expect(mockCore.setFailed).toHaveBeenCalledWith(
      expect.stringContaining('API error')
    );
  });
});
