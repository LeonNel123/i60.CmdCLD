# BackupHero — Goal

## Goal

Ship BackupHero, a focused web app that delivers automated, encrypted, verified database backups with one-click restore for small SaaS teams.

## Non-goals

- Not an enterprise compliance platform
- Not a generic file/object backup tool — databases only

## Acceptance criteria

- shell: npm test
- judge: WHEN a user clicks "Sign in with Google", THE SYSTEM SHALL authenticate via Better Auth

## Constraints

- max_iterations: 40
- max_api_cost_usd: 1.0
- max_doer_output_per_reset: 60000
