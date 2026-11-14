# Contributing

- Branch from `main`, one change per branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`).
- Commit subjects follow Conventional Commits: `type(scope): lowercase subject`.
- Run `./dev lint && ./dev test` before opening a pull request; CI runs the same scripts.
- `main` accepts changes through pull requests only, with green checks.
- Never commit `google-services.json`, keystores, `.env` files or service-account keys. CI receives them from repository secrets.
- Images added to the repository must be your own and carry no EXIF or location metadata.
