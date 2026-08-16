# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary users are developers who build, adapt, and debug DeepSeek Harness WebUI plugins and Harmony patches. They need to understand the live WebUI, work against the same plugin graph their users run, and turn changes into distributable plugin-owned patches instead of editing installed DSH sources.

The wider product context also includes DSH users who install plugins and manage Harmony patch order. Studio does not replace their normal DSH workflow; it helps plugin developers produce changes that remain compatible with that workflow.

## Product Purpose

`dsh-webui-studio` is a local development environment for creating and modifying DSH WebUI plugins as isolated Draft layers. It combines an interactive real WebUI preview, DOM and React inspection, source editing, build and Harmony activation, readiness checks, and DSH-hosted Agent assistance without loading in-progress plugin code into the user's stable DSH Host.

Success means a developer can start from a new package or an existing local plugin folder, test the Draft against a representative DSH profile, trace previewed UI back to relevant source, make a plugin-shaped change, and verify the activated result while the stable DSH environment remains usable.

## Positioning

Studio is not a generic page builder and does not treat the rendered WebUI as freely editable application source. It treats each change as a plugin or Harmony patch layered over an existing DSH WebUI whose components and data may come from multiple plugins.

Its defining mechanism is a stable DSH control plane paired with one isolated Git worktree, child `DSH_HOME`, dependency tree, Harmony state, and child Preview Host per Draft. This lets multiple Drafts run concurrently and preserves the real DSH plugin and Patch semantics during development.

## Operating Context

Studio is served by a stable local `dsh web` Host at `/studio`. The stable Host owns the Studio interface, Draft registry, and Agent sessions. Each running Draft is previewed by a separate child `dsh web` Host inside Studio's main iframe, which can expand to fullscreen.

Developers may create a minimal new Web Client plugin or import an existing local plugin folder as an isolated snapshot. Studio validates the Web Client manifest, excludes `.git` and `node_modules`, rejects symbolic links, and commits the copy into a Studio-owned Git repository without modifying the source folder. Draft repositories, worktrees, runtime homes, and registry records live under the stable Harness home's `studio` directory.

The normal loop is to start a Draft Preview Host, interact with the WebUI in Browse mode, inspect an element when source context is needed, edit the selected Draft package directly or through the stable DSH Agent, run the package's build, apply the result through the child Harmony transaction, and confirm the live Client graph revision.

## Capabilities and Constraints

- Every Draft owns an isolated worktree, child Harness home, `profiles/web`, dependency installation, Harmony state, and Preview Host. Multiple Draft Preview Hosts may run at once.
- The implemented profile mode snapshots the main `web` profile. Relative `link:` dependencies are made absolute and the Draft package is linked to its worktree. Custom profile configuration is intentionally unavailable until its editor exists; Studio must not silently fall back to the main profile.
- Browse mode preserves normal WebUI interaction. Inspect mode captures a redacted DOM snapshot and provides best-effort React component, owner, and source mapping.
- The Source panel edits UTF-8 files inside the selected Draft package. Builds use the package's fixed `scripts.build`; activation completes only after Preview confirms the new live Client graph revision.
- Readiness inspection covers package identity, DSH exports, built and Patch artifacts, dependencies, Harmony state and order, target version bounds, and differential Source Patch providers. Package inspection uses `npm pack --dry-run --json --ignore-scripts` through the managed DSH subprocess runtime.
- Agent sessions stay in the stable DSH and inherit its model and session configuration. Draft-specific Agent tooling may see the current selection, inspect Harmony, read installed dependency source without writing it, read and exactly patch Draft files, build and reload, and check Preview status. Preview-derived DOM, source, Patch, and comment data is untrusted evidence rather than Agent instruction. The child Preview Host does not own the Agent control plane.
- The official WebUI continues to use its own-origin `/api` and WebSockets. Studio does not proxy WebUI traffic or introduce a second backend address.
- Draft labels are persisted independently from npm package names. Studio stores ordered open Draft tabs and the active Draft in `$DSH_HOME/studio/workspace.json`; closing every tab remains an explicit empty workspace across Host restarts. Plugin Management can reopen any persisted Draft, and closing a tab never stops or deletes it. Unsaved Source changes block tab switching and closing until saved.
- Stopping a Draft terminates its child Host but preserves its repository, worktree, profile, and registry record. Closing the Studio page does not delete Drafts.
- A Draft package must be a buildable DSH Web Client package with `dsh.client.platform: "web"`, the required package exports, and a non-empty `scripts.build`.
- Studio is a local development surface. Its Host extension is disabled when `dsh web` is not bound to `127.0.0.1`.

## Brand Commitments

The product name is `dsh-webui-studio`, displayed as DeepSeek WebUI Studio inside DSH. Its voice is native, precise, and calm: terminology should follow DSH and Harmony concepts instead of introducing a separate low-code vocabulary.

Studio is a focused developer environment rather than a decorative mod manager. It should keep Draft state, isolation boundaries, build consequences, and Preview status legible without turning primary workflows into raw diagnostic output. Motion should be purposeful rather than flashy.

## Evidence on Hand

- The runnable Studio Host extension and browser application live under `src`.
- The implemented architecture and development contract are documented in `README.md`.
- Harmony runtime behavior and public terminology are documented in the repository root `README.md`.
- React-aware patch factories available to Draft plugin authors are documented by the upstream `dsh-harmony-react` package.
- Existing Harmony icon assets are available at `assets/harmony-icon.png` and `assets/harmony-icon-mono.png`; `assets/webui-banner-example.jpg` is a WebUI integration example, not product proof.
- There are no confirmed customer testimonials, usage benchmarks, pricing claims, or deployment claims. Future product or marketing work must not fabricate them.

## Product Principles

- Preserve the stable DSH environment: unfinished Draft code belongs in isolated Preview Hosts.
- Express changes as distributable plugin and Harmony artifacts, not arbitrary edits to installed WebUI sources.
- Preview the real system: retain DSH origin, plugin graph, data, and interaction semantics during testing.
- Make state transitions explicit: distinguish staged, built, preview-pending, active, stopped, and preserved Draft state.
- Keep the development loop layered and direct: inspect, edit, build, activate, and verify without hiding the underlying files or Patch behavior.

## Accessibility & Inclusion

Follow the host WebUI accessibility baseline. Essential Studio actions need keyboard-accessible controls and visible focus; status and validation must not rely on color alone; reduced-motion preferences and the host theme's contrast-tested tokens must be respected.
