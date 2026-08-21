# Harmony API requirements

WebUI Studio is an ordinary DSH plugin loaded after Harmony. It imports no
Harmony source files and communicates with Harmony through the public
`dsh-harmony` package.

The Studio production path requires Harmony to provide:

- `HarmonyService.profile()` and transactional `updateProfile()` for the stable
  Host's plugin order and provider enablement;
- `HarmonyService.inspect()` for Patch state, targets, match counts, and errors;
- the public `dsh-harmony/bin` export and `harmony reload` command for
  transactionally reloading a built Draft and its Patch declarations; Studio
  owns the Preview lifecycle transitions;
- source Patch declaration metadata and optional render trace metadata used by
  Preview inspection.

Profile paths come from `HarmonyService.profile().dir`. Studio resolves the CLI
entry through the package export rather than through the Cordis service.
Studio and Harmony releases must keep this public contract aligned.

`dsh-harmony-react@0.3.0` exposes the generic `./studio` React element and
variable registration API used by the browser and Preview bridge. Studio uses
the package published on the npm registry and resolves it exclusively through
the `dsh-harmony-react/studio` package export. Source persistence additionally
requires the `StudioVariableDefinition.defaultSource` anchors introduced by the
corresponding React package release; bindings without those anchors remain
Preview-only.
