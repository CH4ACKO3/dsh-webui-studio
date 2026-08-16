# dsh-webui-studio

`dsh-webui-studio` is a Harmony Host extension served by the stable `dsh web`
process at:

```text
http://127.0.0.1:<dsh-port>/dsh-harmony/studio
```

It is an independent package and repository. Its dependency direction is only
from Studio to the public `dsh-harmony` and `dsh-harmony-react` package exports;
it does not import files from either project's source tree.

The stable Host owns the Studio UI, Draft registry, and DSH Agent sessions. Each
Draft owns a separate Git worktree, `DSH_HOME`, `profiles/web`, dependency tree,
Harmony state, and child `dsh web` Preview Host. Starting or rebuilding a Draft
therefore never loads it into the stable Host's Client graph. Multiple Draft
Preview Hosts can run at the same time.

Studio data lives under the stable Harness home:

```text
$DSH_HOME/studio/
├── drafts/<draft-id>.json
├── repositories/<draft-id>/
├── worktrees/<draft-id>/
└── runtimes/<draft-id>/dsh-home/profiles/web/
```

Creating a new plugin initializes and commits a minimal DSH Web Client package,
then creates a managed worktree. Creating a Draft from an existing local Git
repository or Git URL clones committed source into a managed repository and
creates a Draft branch/worktree at the selected ref. `packagePath` selects a
package inside a monorepo.

The implemented profile mode snapshots the current main `web` profile's
manifest, Cordis patch, and Harmony order into the child home. Relative `link:`
specs are made absolute, the Draft package is linked to its worktree, and an
independent lockfile and `node_modules` are installed. The custom-profile choice
is visible but intentionally returns a not-implemented error until its editor is
built; it never silently falls back to the main profile.

The Preview URL is shown in Studio's primary iframe and can expand into the
browser's fullscreen surface. The official WebUI continues to use its own-origin
`/api` and WebSockets; Studio does not proxy WebUI traffic. The iframe inspection
bridge uses an exact stable-parent origin plus a per-start capability and
`MessageChannel`.

Browse mode preserves normal WebUI interaction. Inspect mode captures a
redacted DOM snapshot and best-effort React component/owner/source mapping. The
Source panel edits UTF-8 files in the selected Draft package with CodeMirror.
Builds run the Draft's fixed `scripts.build`, apply through the child Harmony
transaction, reload Preview, and activate only after the page confirms the live
Client graph revision.

The Elements panel is intentionally narrower than a DOM editor. A Draft registers
plugin-owned subtree boundaries, Draft-relative source locations, and live variable
bindings through `dsh-harmony-react/studio`; Studio then finds the nearest registered
boundary for a Preview selection. Render-path Patch traces are candidate evidence, not
exact node ownership. A selection inside a Draft boundary may still contain changes
from another plugin, and a traced node may not exist literally in the Element source.
Unregistered or raw Source Patches remain available through target-level Harmony
inspection rather than being attributed to an arbitrary DOM node.

Readiness checks package identity, Host/Client/package.json exports, built and
Patch artifacts, Client and Harmony dependencies, current Patch state, target
version bounds, effective `harmony.json` order, and differential Source Patch
providers. Package inspection runs
`npm pack --dry-run --json --ignore-scripts` through DSH's managed subprocess
runtime.

Studio Agents remain in the stable DSH and inherit its model/session settings.
One Agent controller is associated with each running Draft and exposes seven
Studio tools for Selection, Harmony inspection, read-only installed dependency
sources, Draft file reads/exact patches, build/reload, and Preview status. DOM,
React, source, Patch, and comment data returned from Preview is explicitly
treated as untrusted evidence rather than Agent instructions. The child Preview
Host does not load the Agent or full Studio control plane; it loads only the
Preview worker.

Stopping a Draft terminates its child Host but preserves its repository,
worktree, profile, and registry record. Closing the Studio page does not delete
Drafts.

## Development

```sh
npm install
npm run check
dsh plugin --profile web add link:$(pwd)
dsh web
```

`npm run test:integration` exercises the complete Host, Draft worktree, child
Preview Host, build, activation, and shutdown path. It requires a
`dsh-harmony` release that exposes the Studio service APIs listed in
[`docs/harmony-api-requirements.md`](docs/harmony-api-requirements.md). The
currently published `dsh-harmony@0.1.2` predates those APIs.

A Draft package must declare `dsh.client.platform: "web"`, export `.`,
`./client`, and `./package.json`, and define `scripts.build`.
