# Contributing to Strong Notes

Thanks for your interest in improving Strong Notes! This guide covers how to get set
up and what we expect from contributions.

## Ground rules

- Be respectful — this project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- By contributing, you agree that your contributions are licensed under the
  [Apache License 2.0](LICENSE).
- Keep changes focused. One logical change per pull request makes review easier.

## Getting set up

The repo is a monorepo with two apps. Follow the setup in each README section:

- **Backend** (`backend/`) — Go 1.25, PostgreSQL. See the
  [Backend](README.md#backend-backend) section of the README.
- **Mobile** (`mobile/`) — Expo / React Native. See the
  [Mobile](README.md#mobile-mobile) section of the README.

## Making changes

1. Fork the repo and create a branch off `main`
   (`git checkout -b my-feature`).
2. Make your change, following the conventions already present in the code you touch
   (formatting, naming, structure).
3. Add or update tests for any behavior you change.
4. Run the checks for the area you touched (see below).
5. Open a pull request against `main` with a clear description of *what* and *why*.

## Checks before you push

**Backend:**

```bash
cd backend
make generate   # if you changed SQL — sqlc codegen must be committed
make lint
make test
```

**Mobile:**

```bash
cd mobile
npm test
npm run i18n:check   # if you added or changed user-facing strings
```

## Commit messages

Commits use [Conventional Commits](https://www.conventionalcommits.org/) prefixes
scoped by app, matching the existing history — e.g.
`feat(mobile): ...`, `fix(backend): ...`, `docs: ...`, `test(mobile): ...`.

## Reporting bugs and requesting features

Open a GitHub issue. For bugs, include steps to reproduce, what you expected, and what
actually happened. For the parser specifically, include the exact note text you typed
and how it was (mis)parsed.

## Security

Please do **not** open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report them privately.
