# Harmony API requirements

WebUI Studio is a Harmony extension. It imports no Harmony source files and
communicates with Harmony through the `harmony` Cordis service exposed by the
public `dsh-harmony` package.

The Studio production path requires Harmony to provide:

- extension discovery for profile dependencies declaring
  `dsh.harmony.extension`;
- `HarmonyService.binEntry` and `HarmonyService.profileDir`;
- `HarmonyService.profile()` and transactional `updateProfile()` for the stable
  Host's plugin order and provider enablement;
- `HarmonyService.inspect()` and `inspectDependencies()`;
- `HarmonyService.reloadPlugin()` for transactionally reloading a built Draft
  and its Patch declarations; Studio owns the Preview lifecycle transitions;
- source Patch declaration metadata and optional render trace metadata used by
  Preview inspection.

Studio and Harmony releases must keep this service contract aligned.

`dsh-harmony-react@0.1.2` exposes the generic `./studio` React element and
variable registration API used by the browser and Preview bridge. Studio uses
the package published on the npm registry and resolves it exclusively through
the `dsh-harmony-react/studio` package export.
