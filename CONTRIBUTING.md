# Contributing

- Branch from `main`, one change per branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
- Commit subjects follow Conventional Commits: `type(scope): lowercase subject`.
- Run `./dev lint && ./dev test && ./dev scan` before opening a pull request; CI runs the same scripts.
- `./dev scan` runs gitleaks over the tree and the history, foxguard (a reviewed false positive gets `foxguard: ignore[rule-id]` on the line above it and the reason in a comment above that; fix real ones), and `scripts/privacy-check.sh`: no real email addresses (use `example.com`), no phone numbers outside 555, no Firebase identifiers, no coordinates, no image metadata. CI runs the same check on every commit and file version in a pull request.
- `main` accepts changes through pull requests only, with green checks.
- Never commit `google-services.json`, keystores, `.env` files or service-account keys. CI receives them from repository secrets.
- Images added to the repository must be your own and carry no EXIF or location metadata.
