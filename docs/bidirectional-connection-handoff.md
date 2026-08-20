# Bidirectional Connection / Typert Gateway implementation handoff

Status: proposed
Date: 2026-08-20
Implementation home: a new independent DSH plugin
First consumer: `dsh-webui-studio`

## 1. Objective

Build one Harmony-enabled plugin that makes the existing DSH Connection and
Typert Gateway bidirectional, then migrate WebUI Studio onto that path.

The completed topology is:

```text
Studio browser
  <=> stable Host Connection + Typert
        <=> Preview Host Connection + Typert

Parent Studio page
  <=> Preview iframe MessageChannel (UI data plane only)
```

For every pair of Cordis environments there is one canonical Connection. The
plugin must not open an additional WebSocket, HTTP server, port, MessagePort,
or peer transport for service RPC.

Completion means:

- Client can call Host Cordis Services through the existing Typert projection.
- Host can call a specifically addressed Client Cordis Service.
- A Host can connect to another Host as a Node client and use the same RPC
  contract.
- Studio browser calls use Connection/Typert instead of `/studio/api`.
- Stable Host calls to a Preview Host use Connection/Typert instead of
  `/dsh-harmony/studio-preview/api`.
- Replaced Studio routes and envelopes are deleted. There is no runtime
  fallback to the old paths.

## 2. Non-goals

- Do not replace Cordis service discovery or lifecycle.
- Do not introduce a general service mesh, broker, registry server, or relay
  daemon.
- Do not route Preview DOM inspection, pointer pan/zoom, element highlighting,
  or live style editing through Host RPC. The existing iframe `MessageChannel`
  remains the direct UI data plane.
- Do not claim that `trustedHosts` authenticates a remote peer. It is a browser
  trust fence, not peer authentication.
- Do not support arbitrary remote-network Host-to-Host connections until an
  authentication policy exists. The first release may be loopback-only.

## 3. Version baseline

Harmony source patches target compiled package structure and therefore must be
version exact.

At handoff time the Studio manifest declares DSH `0.1.0-rc.7`, while the local
`node_modules` inspected for this design contains these packages at
`0.1.0-rc.6`:

- `@deepseek-ai/dsh-api-gateway`
- `@deepseek-ai/dsh-client-connection`
- `@deepseek-ai/dsh-host-apiproxy`
- `@deepseek-ai/dsh-client-runtime`
- `@deepseek-ai/dsh-api-remotes`

The implementation plugin must select one installed DSH release, lock it, and
develop every Patch and test against that single release. Do not publish a
semver range that has not been inspected. Every Harmony Patch must declare an
exact target version and an exact `expect` count so an upstream layout change
fails during Harmony preflight rather than partially applying.

## 4. Current facts

### 4.1 Connection

The current browser Connection has asymmetric public roles:

- Client `ctx.connection.rpc.call()` sends unary HTTP RPC to Host.
- Host `ctx.connection.rpc.handle()` / `intercept()` receives RPC.
- `/api/events.mux` and `/api/events.host` are downlink-only WebSockets.
- Client responses to Host-originated API requests already use HTTP
  `/api/respond` and the `ClientResponse` envelope.
- One consumer owns the Client connection stream loop. A second call to
  `connection.start()` fails.

The wire already has the four envelope shapes needed for bidirectional RPC:

```text
ClientRequest  -> ServerResponse
ServerRequest  -> ClientResponse
```

What is missing is a generic Host-to-Client request registry, explicit peer
identity, Client-side handlers, and pending-call lifecycle.

### 4.2 API Gateway

The current Gateway is role-asymmetric:

- Host installs `ctx.typertGateway` and intercepts claimed `/api` endpoints.
- Client installs generated `ctx.remote.<namespace>` projections.
- Client Remote always calls Host through `ctx.connection.rpc.call()`.

The Typert descriptor, argument codec, lookup resolution, result codec, and
error translation are already carrier-independent concepts. They should be
shared by both local Gateway roles rather than reimplemented for reverse RPC.

### 4.3 Studio

Studio currently has two custom control paths in addition to the iframe UI
bridge:

1. Standalone Studio browser -> stable Host:
   `/studio/api/<method>`, implemented by `src/browser/rpc.ts`,
   `src/host/routes.ts`, and `StudioBackend.call()`.
2. Stable Host -> Preview Host:
   `/dsh-harmony/studio-preview/api/<method>`, implemented by
   `StudioPreviewSupervisor.worker()` and `applyPreviewWorker()`.

The standalone Studio browser also opens `/api/events.mux` and
`/api/events.host` directly through `src/browser/events.ts`; the migrated
Connection client must become the sole owner of these streams.

The parent page and Preview iframe communicate through a capability-bound
`MessageChannel`. That channel is not a competing Cordis control plane and
must remain.

## 5. Architectural decisions

### 5.1 Reuse the existing carrier

Reverse RPC uses:

```text
Host -> Client request     existing /api/events.host WebSocket
Client -> Host response    existing HTTP /api/respond
Host -> Client cancel      existing /api/events.host WebSocket
```

Do not add a third WebSocket. Do not create a new top-level HTTP prefix. A
small Connection-owned handshake endpoint under `/api` is part of the same
carrier, not a parallel API.

### 5.2 Address a peer explicitly

A Host may have multiple browser tabs, a Node client, or more than one Preview
consumer. Host-to-Client calls must never mean “broadcast and accept the first
response”.

Every reverse call targets a live `PeerHandle` issued by Connection. A
generation loss invalidates that handle and rejects its pending calls. Callers
must reacquire a new handle from Connection; Connection must not silently
retry a business invocation on a new generation.

Recommended public shape:

```ts
interface ConnectionPeer {
  readonly id: string
  readonly kind: 'browser' | 'node'
  call(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>>
}

interface HostConnectionPeers {
  get(id: string): ConnectionPeer | undefined
  list(): readonly ConnectionPeer[]
  subscribe(listener: (change: PeerChange) => void): () => void
}
```

The exact names may follow the target package conventions, but the semantics
are required: explicit peer, generation-scoped validity, no implicit current
browser.

### 5.3 Keep request dispatch inside Connection

Reverse protocol frames must be recognized by Client Connection before the
ordinary `HostFrame` schema is applied. This avoids changing
`@deepseek-ai/dsh-client-runtime` and prevents its one stream consumer from
becoming an extension point.

Client Connection adds an inbound registry alongside its existing outbound
caller. The API Gateway registers its Client local dispatcher with this
registry.

Conceptual shape:

```ts
interface ClientConnectionRpc {
  call(channel: string, endpoint: string, payload: unknown, signal?: AbortSignal): Promise<RpcResult<unknown>>
  intercept(
    channel: string,
    matches: (endpoint: string) => boolean,
    handler: ConnectionRpcHandler,
  ): () => void
}
```

Inbound registrations must be Cordis effect-scoped and withdrawn when their
owning fiber is disposed.

### 5.4 Make Gateway roles symmetric

Both sides install a local dispatcher and a remote projection:

```text
Host local Gateway    <-> Client Remote
Host Remote(peer)     <-> Client local Gateway
```

The Host Remote must require a `ConnectionPeer`:

```ts
const client = ctx.remote.for(peer)
await client.studioPreview.someMethod()
```

Do not create a JavaScript dynamic Proxy for method discovery. Preserve the
current generated Typert contribution model. A descriptor is installed as
local on the side owning the Service and as remote on the opposite side.

The local invocation engine must remain one implementation shared by Host and
Client. It continues to own:

- exact endpoint claim checks;
- exact named-argument validation;
- Typert codecs;
- direct and Context-scoped receiver resolution;
- lookup providers;
- AbortSignal injection;
- result validation;
- stable `RpcResult` error translation.

## 6. Wire contract

### 6.1 Peer establishment

Connection owns a trusted `/api/connection.open` operation. It returns an
opaque peer id and an unguessable, memory-only peer capability. The capability
is bound to the connection generation.

The browser presents the capability on both existing WebSocket upgrades using
`Sec-WebSocket-Protocol`, not a URL query parameter. HTTP reverse responses
present it in a Connection-owned request header. The Host publishes a
`PeerHandle` only after the required downlinks for that generation are ready.

Requirements:

- Generate capabilities with at least 256 bits of cryptographic randomness.
- Never put a capability in a URL, log, Cordis event, Typert payload, or error
  message.
- Reject duplicate or mismatched socket attachment.
- Bind a response to both `rpcId` and the authenticated peer generation.
- Close either socket and reject every pending reverse call when the
  generation fails, matching current Connection reconnect semantics.

For the loopback Studio Preview, the existing Preview control token is the
bootstrap credential for `connection.open`. The new connection capability
replaces it only after successful establishment. Do not remove the existing
security boundary without an equivalent check.

### 6.2 Reverse request

Use the existing `ServerRequest` full envelope:

```ts
{
  type: 'server-request',
  rpcId,
  method: 'connection.rpc',
  payload: {
    channel: '/api',
    endpoint: 'namespace/method',
    payload: unknown,
  },
}
```

The Host writes ordinary Host event frames and Connection control frames
through one serialized outbound queue for the peer's existing host downlink.

### 6.3 Reverse response

Client executes the matching Connection handler and submits the existing
`ClientResponse` envelope to `/api/respond`:

```ts
{
  type: 'client-response',
  rpcId,
  result: { ok: true, value } | { ok: false, error },
}
```

Connection owns pending reverse ids. `/api/respond` first checks the
Connection pending table for the authenticated generation. If no Connection
request owns the id, the request continues to the existing API Proxy response
handler for approvals and user questions. This is deterministic ownership of
one endpoint, not a fallback transport.

### 6.4 Cancellation

When the Host caller aborts, send a `ServerRequest` with the same `rpcId` and
`method: 'connection.cancel'`. Client aborts the invocation signal. A response
arriving after Host cancellation is rejected as not pending.

When Client handler disposal or generation loss aborts an invocation, return a
cancelled `RpcResult` when the response carrier is still available. Otherwise
the Host learns the same failure from generation teardown.

Do not automatically retry cancelled, disconnected, or timed-out business
calls.

## 7. Independent plugin layout

Suggested package layout:

```text
dsh-bidirectional-gateway/
├── package.json
├── harmony.patch.yml
├── index.ts
├── client.ts
├── src/
│   ├── connection-host.ts
│   ├── connection-client.ts
│   ├── gateway-core.ts
│   ├── gateway-host.ts
│   ├── gateway-client.ts
│   └── node-peer-client.ts
├── patches/
│   ├── connection-host.patch.cjs
│   ├── connection-client.patch.cjs
│   ├── gateway-host.patch.cjs
│   └── gateway-client.patch.cjs
└── test/
```

The plugin owns protocol and Gateway core logic. Harmony patches should insert
the smallest hooks needed for native Connection/Gateway code to delegate to
that logic. Do not paste the complete implementation independently into four
compiled bundles.

The plugin's browser module must be present in the DSH Client module graph and
load after Client Connection and the Typert registry. Patched API Gateway
client code may require the plugin-owned browser core by module id. Host code
imports the same package-owned core normally.

Declare Cordis type augmentation in the independent plugin. Do not Patch
upstream `.d.ts` files at runtime.

## 8. Harmony Patch inventory

### 8.1 `@deepseek-ai/dsh-client-connection/lib/index.js`

Add only the Host integration points:

- peer registry owned by `HostConnectionService`;
- Connection-owned `/api/connection.open` and reverse-response interception;
- peer authentication on both existing WebSocket upgrades;
- a serialized reverse-request writer on the existing host downlink;
- pending-call cancellation and teardown;
- public Host peer access through `ctx.connection`.

Do not modify API Proxy business handlers.

### 8.2 `@deepseek-ai/dsh-client-connection/lib/client.js`

Add only the Client integration points:

- establish and retain the generation capability;
- attach both existing sockets to the peer generation;
- identify `connection.rpc` / `connection.cancel` before `HostFrame` parsing;
- Client inbound handler registry;
- send `ClientResponse` through the existing respond leg;
- expose the registry on `ctx.connection.rpc`;
- Node-independent shared protocol code where possible.

Ordinary Host and Mux frames must continue to reach the current sinks
unchanged. Do not call `connection.start()` a second time.

### 8.3 `@deepseek-ai/dsh-api-gateway/lib/index.js`

Add the Host outbound projection:

- retain the existing Host local `TypertGatewayService` behavior;
- install a generated Remote projection bound explicitly to a
  `ConnectionPeer`;
- delegate descriptor encoding and result decoding to the shared Gateway core.

### 8.4 `@deepseek-ai/dsh-api-gateway/lib/client.js`

Add the Client local Gateway:

- retain the existing Client Remote projection unchanged;
- install the local invocation dispatcher;
- register that dispatcher through Client Connection's inbound registry;
- use the same Gateway core and error contract as Host.

### 8.5 Packages intentionally not patched

The design should not require Harmony patches to:

- `@deepseek-ai/dsh-client-runtime`;
- `@deepseek-ai/dsh-host-apiproxy`;
- `@deepseek-ai/dsh-api-remotes`.

If implementation evidence shows one is unavoidable, update this handoff with
the missing ownership boundary before adding the Patch. Do not piggyback on
`host/remote-event`; it has event broadcast semantics and cannot safely model
targeted request/response.

## 9. Node peer client

Studio's stable Host needs to connect to each Preview Host without pretending
to be a browser tab. The independent plugin must export a Node peer client
using the same protocol:

```ts
interface NodePeerClient {
  readonly remote: TypertRemote
  connect(signal?: AbortSignal): Promise<void>
  close(): Promise<void>
}
```

It uses the Preview Host's existing HTTP port, the same `/api` endpoints, and
the same two downlinks. It must not start another server or tunnel. It owns one
Connection generation at a time and exposes connection loss directly to its
caller.

Node 22 supplies `fetch`; use the project's existing `ws` dependency for the
WebSocket carrier unless the selected DSH baseline already exports a suitable
Node carrier.

## 10. Studio migration

Migration happens only after Connection and Gateway integration tests pass.
Each cutover deletes the path it replaces in the same change.

### 10.1 Preview Host service

Replace the Preview worker control route with one strict Typert Service owned
by the Preview Host. Suggested namespace: `studioPreviewWorker`.

Required methods:

```text
health
state
activate
applyBuild
inspect
profile
updateProfile
resolveSource
readSource
readPatchTarget
```

The Service delegates to the existing `StudioPreviewDraft`, Harmony service,
and `StudioSourceResolver`. Preserve the current readiness state and input
validation, but express failures through the Gateway error contract rather
than HTTP status branching.

`applyPreviewWorker()` is then reduced to Preview composition and iframe
assets:

- construct/dispose `StudioPreviewDraft`;
- provide the Typert Service;
- serve `/studio/bridge.js`;
- inject the Preview bridge configuration into the Preview HTML.

Delete:

- `STUDIO_PREVIEW_API_PATH`;
- the Preview worker `WebRoute`;
- its manual JSON reader/writer;
- `StudioWorkerResponseError`;
- `StudioPreviewSupervisor.worker()` and its custom envelopes.

### 10.2 Stable Host to Preview Host

`StudioPreviewSupervisor` still owns child process startup, the isolated
`DSH_HOME`, Preview port allocation, logs, and termination. After the child
publishes its URL it creates a Node peer client with the existing Preview
control token as the bootstrap credential.

Replace calls as follows:

```text
worker('health')             -> remote.studioPreviewWorker.health()
worker('state')              -> remote.studioPreviewWorker.state()
worker('activate')           -> remote.studioPreviewWorker.activate()
worker('apply-build')        -> remote.studioPreviewWorker.applyBuild()
worker('inspect')            -> remote.studioPreviewWorker.inspect()
worker('profile')            -> remote.studioPreviewWorker.profile()
worker('update-profile')     -> remote.studioPreviewWorker.updateProfile()
worker('resolve-source')     -> remote.studioPreviewWorker.resolveSource()
worker('read-source')        -> remote.studioPreviewWorker.readSource()
worker('read-patch-target')  -> remote.studioPreviewWorker.readPatchTarget()
```

Stopping the Preview first closes the peer client, then terminates the child.
Child exit invalidates the peer and rejects in-flight calls. Do not retry an
operation on a restarted child.

### 10.3 Studio browser to stable Host

Expose `StudioBackend` through one strict Typert Service. Suggested namespace:
`studio`. Keep the implementation modular internally, but do not create one
Cordis Service per current dotted HTTP name merely to preserve the old path.

Suggested method names:

```text
draftsList                 draftsCreate
draftsRename               draftsExport
draftsStart                draftsStop
workspaceGet               workspaceUpdate
harmonyProfile             harmonyInspect
harmonyUpdateProfile
projectState               projectActivate
projectFiles               projectReadFile
projectWriteFile           projectBuild
projectCancelBuild
elementsStyles             elementsSaveSource
patchesAnalyzeAutomatic    patchesCreateAutomatic
readinessInspect           readinessPack
previewStatus              previewUpdate
previewResolveSource
agentCreate                agentAttach
agentLeave
```

The standalone Studio bundle is not currently running inside the ordinary DSH
WebUI Cordis Client graph. It therefore consumes a browser client exported by
the independent plugin, which establishes the same Connection and mounts the
generated Studio Remote contribution. `callStudio()` may remain temporarily as
an internal TypeScript helper name, but its implementation must call the
generated Remote; it must not fetch `/studio/api`.

The capability currently embedded in the Studio HTML remains the bootstrap
credential for peer establishment. Once the cutover works, delete:

- `STUDIO_API_PATH`;
- the API route in `createStudioRoutes()`;
- `StudioClientRequest` / `StudioServerResponse` custom envelopes;
- manual RPC ids and fetch code in `src/browser/rpc.ts`;
- the method-string dispatcher in `StudioBackend.call()`.

Keep `/studio` and `/studio/assets/*` because they serve the standalone page
and static assets.

The migrated browser Connection becomes the sole owner of mux/host streams.
Remove direct socket ownership from `src/browser/events.ts` and feed the
existing Studio event consumers from Connection sinks or an exported event
source.

### 10.4 Preview iframe bridge

Keep the current `MessageChannel` and its capability/nonce checks. It directly
connects two browser windows for:

- Preview readiness and graph revision;
- DOM selection and React trace metadata;
- registry snapshots;
- pointer pan/zoom;
- element styles and live variables.

Routing these through Client -> Host -> Host -> Client would add two network
hops, require extra peer selection, and provide no Cordis lifecycle benefit.

## 11. Delivery sequence

### Phase 0: lock baseline

- Select one DSH release.
- Install a clean dependency tree.
- Record exact target package versions.
- Add Harmony inspect/preflight to CI.

Exit gate: all four Patch targets bind with exact match counts.

### Phase 1: bidirectional Connection

- Implement peer establishment and authentication.
- Implement targeted Host call, Client dispatch, response, cancellation, and
  teardown.
- Preserve existing Client-to-Host RPC and ordinary event streams.

Exit gate: Connection integration tests pass without API Gateway.

### Phase 2: symmetric Typert Gateway

- Run the local dispatcher on Client.
- Add Host Remote bound to a peer.
- Mount strict generated descriptors on the correct side.

Exit gate: the same test Service can be invoked in both directions with strict
arguments, result validation, cancellation, and structured failure.

### Phase 3: Node peer client

- Implement the Node carrier over the same Preview Host port.
- Verify connect, reverse request, reconnect failure, and close.

Exit gate: one Host process invokes a Service in another Host process without
an additional transport.

### Phase 4: migrate Studio Preview control

- Add `studioPreviewWorker` Service.
- Replace Supervisor worker fetches.
- Delete the custom Preview API route and envelopes.

Exit gate: Studio Preview lifecycle and Harmony operations pass; requests to
the removed Preview API return 404.

### Phase 5: migrate Studio browser control

- Add the strict `studio` Service and generated contribution.
- Replace `callStudio()` transport.
- Transfer event stream ownership to Connection.
- Delete `/studio/api` and the method-string dispatcher.

Exit gate: the complete Studio integration suite passes; requests to the
removed Studio API return 404; the iframe bridge still works.

## 12. Required tests

### Connection

- Client -> Host existing unary RPC remains unchanged.
- Host -> one selected Client succeeds.
- Two Clients with the same endpoint receive only their targeted calls.
- Concurrent reverse calls correlate by `rpcId` without cross-settlement.
- Client business failure returns a structured `RpcResult` failure.
- Host cancellation aborts the Client handler.
- Client disposal aborts its active handlers.
- Generation loss rejects all pending Host calls exactly once.
- A late response is rejected as not pending.
- Wrong or missing peer capability cannot open a socket or settle a response.
- Ordinary Mux/Host frames still reach their original sinks in order.

### Gateway

- Direct Service invocation works in both directions.
- Context-scoped invocation resolves the receiver on the serving side.
- Lookup parameters resolve on the serving side.
- Missing, extra, and invalid arguments fail identically in both directions.
- Result codecs run before returning to the caller.
- A withdrawn strict definition does not fall back to SRC dispatch.
- Disposing a contribution removes both its Remote projection and local claim.

### Studio

- Start and stop one Preview Draft.
- Start two Drafts and prove their peer calls do not cross.
- Activate, apply build, inspect Harmony, update profile, resolve source, and
  read dependency source through Typert.
- Preview child exit rejects the in-flight operation and updates runtime state.
- Studio browser can execute every method previously exposed by
  `StudioBackend.call()`.
- Main Studio capability and Preview control capability are both enforced.
- `/studio/api/*` returns 404 after migration.
- `/dsh-harmony/studio-preview/api/*` returns 404 after migration.
- `/studio`, assets, Preview iframe loading, selection, variables, and element
  style editing continue to work.

## 13. Patch maintenance policy

- Pin each Patch to one exact upstream version.
- Prefer TSQuery selectors over raw text offsets or broad regular expressions.
- Set `expect` for every selector.
- Keep protocol/business code in the independent plugin; keep source Patches
  limited to native hook insertion.
- Run `dsh harmony inspect` for every target file in CI.
- Run the Connection/Gateway contract suite before accepting a new upstream
  DSH version.
- Treat a failed match as an upgrade task. Do not loosen the selector or add a
  second compatibility Patch without reviewing the new upstream behavior.
- Remove the previous version's Patch when advancing the supported baseline.

## 14. Definition of done

- [ ] One Connection carrier per environment pair; no added socket or port.
- [ ] Explicit generation-scoped peer addressing.
- [ ] Peer capability enforced on socket attachment and reverse response.
- [ ] Client local handler registry is Cordis effect-scoped.
- [ ] Host reverse pending calls support result, failure, cancellation, and
      disconnect teardown.
- [ ] Host and Client use one Typert invocation engine.
- [ ] Host Remote requires an explicit peer.
- [ ] Node peer client uses the same protocol.
- [ ] Studio Preview worker custom API is deleted.
- [ ] Studio main custom API is deleted.
- [ ] Studio direct event sockets no longer compete with Connection ownership.
- [ ] Preview iframe MessageChannel remains functional.
- [ ] Removed routes are asserted as 404 in integration tests.
- [ ] Harmony Patch targets and match counts are exact.
- [ ] No compatibility fallback or dual routing remains.

## 15. First source locations to inspect

Independent plugin implementation should begin from these installed files for
the selected DSH baseline:

```text
node_modules/@deepseek-ai/dsh-client-connection/lib/index.js
node_modules/@deepseek-ai/dsh-client-connection/lib/client.js
node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js
node_modules/@deepseek-ai/dsh-api-gateway/lib/client.js
```

Studio migration starts from:

```text
src/host/preview.ts
src/host/preview-worker.ts
src/host/backend.ts
src/host/routes.ts
src/browser/rpc.ts
src/browser/events.ts
src/bridge/main.ts
src/contracts.ts
```
