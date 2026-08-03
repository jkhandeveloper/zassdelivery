/**
 * Conventional Commits, enforced by the `commit-msg` hook.
 *
 * A predictable subject line is what makes automated changelogs and semantic
 * version bumps possible later without rewriting history.
 *
 * Example: `feat(auth): add phone OTP verification`
 */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // a new capability
        'fix', // a bug fix
        'docs', // documentation only
        'style', // formatting; no behaviour change
        'refactor', // restructuring; no behaviour change
        'perf', // performance improvement
        'test', // adding or correcting tests
        'build', // build system or dependencies
        'ci', // CI configuration
        'chore', // housekeeping
        'revert', // reverts a previous commit
      ],
    ],
    // Scope is optional, but must be lower-case when present, e.g. `feat(orders):`.
    'scope-case': [2, 'always', 'lower-case'],
    'subject-case': [2, 'never', ['upper-case', 'pascal-case', 'start-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [2, 'always', 200],
  },
};
