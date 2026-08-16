# Harmony API requirements

WebUI Studio is a Harmony extension. It imports no Harmony source files and
communicates with Harmony through the `harmony` Cordis service exposed by the
public `dsh-harmony` package.

The Studio production path requires Harmony to provide:

- extension discovery for profile dependencies declaring
  `dsh.harmony.extension`;
- `HarmonyService.binEntry` and `HarmonyService.profileDir`;
- `HarmonyService.inspect()` and `inspectDependencies()`;
- `HarmonyService.prepareDraft()` with staged, active, preview-pending, and
  closed Draft transitions;
- source Patch declaration metadata and optional render trace metadata used by
  Preview inspection.

These APIs exist in the captured local Harmony public entry, but they are not
part of the currently published `dsh-harmony@0.1.2` artifact. The package can be
installed, typechecked, tested, and built against the registry release, but its
Host integration requires a Harmony release containing those public APIs.

`dsh-harmony-react@0.1.0` exposes the generic `./studio` React element and
variable registration API used by the browser and Preview bridge. That package
is not currently available from the npm registry, so this repository pins and
bundles the exact public package artifact captured from the source worktree.
The application still resolves it exclusively through the
`dsh-harmony-react/studio` package export.
