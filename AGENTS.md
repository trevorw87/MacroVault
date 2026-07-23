# MacroVault repository workflow

## Default publishing workflow

When the user asks to push completed app changes, treat the request as a small Home Assistant add-on release unless they explicitly request a branch or pull request.

1. Synchronize root frontend assets into `macrovault/app` with `npm run sync:addon`.
2. Increment the patch version in `macrovault/config.yaml` unless the user requests a different version.
3. Add concise release notes to `macrovault/CHANGELOG.md`.
4. Run `npm test` and `npm run test:browser`.
5. Commit the app changes, packaged add-on files, version, and changelog together.
6. Push directly to `main` when allowed.

Do not create a branch or pull request for this default release workflow unless the user asks for one or the remote prevents a direct `main` update.

The Home Assistant add-on is packaged from the tracked `macrovault/` directory. The untracked `macrovault-home-assistant.zip` is not part of the default release workflow.
