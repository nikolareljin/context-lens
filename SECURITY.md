# Security policy

## Reporting

Report vulnerabilities privately through GitHub's "Report a vulnerability" (Security tab). Please do not open a public issue.

## Scope

- The Android app, the Firebase configuration templates and the release/deploy workflows in this repository.
- Secrets are never stored in the repository. Firebase configuration, signing keys and deploy credentials reach CI through repository secrets; deploy authentication uses short-lived credentials where the platform allows it.
- App Check protects the Firebase AI Logic endpoints from unattested clients.
