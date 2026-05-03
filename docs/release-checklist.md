# Release Checklist

Use this checklist for installer releases so the generated installer version is not left behind.

1. Run `npm run release:win` for a bumped Windows installer release.
2. Confirm `package.json`, `package-lock.json`, and `dist/latest.yml` all show the same version.
3. Run `npm test`.
4. Commit the version bump and release helper changes.
5. Push the release branch and tag when a tagged release is needed.

For non-release packaging smoke tests, use `npm run package:win`.
