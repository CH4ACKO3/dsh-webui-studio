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

These APIs are public in `dsh-harmony@0.1.3`, which is the minimum compatible
registry release for Studio Host integration.

`dsh-harmony-react@0.1.0` exposes the generic `./studio` React element and
variable registration API used by the browser and Preview bridge. That package
is not currently available from the npm registry, so this repository pins and
bundles the exact public package artifact captured from the source worktree.
The application still resolves it exclusively through the
`dsh-harmony-react/studio` package export.
