# Agent Mention Orchestration Design

Date: 2026-05-16
Project: `jkq-cc-connect`
Status: Draft approved for planning

## Summary

This design finishes the current `@agent` feature line by moving mention orchestration out of the WebSocket gateway, standardizing message metadata for agent-to-agent visibility, and updating the client to render structured sender/target relationships.

The goal is not to add a new multi-agent platform. The goal is to make the existing public mention conversation flow maintainable, testable, and aligned with the current product behavior:

1. User mentions a lead agent and optionally one or two collaborator agents.
2. The lead agent can publicly ask a collaborator.
3. The collaborator publicly replies.
4. The lead agent summarizes back to the user.

## Goals

- Extract mention orchestration from `server/src/ws/gateway.ts` into a dedicated module.
- Preserve the current single-session, single-active-execution model.
- Standardize sender/target orchestration metadata in both persisted messages and live WebSocket events.
- Keep existing non-mention chat behavior unchanged.
- Keep the UI simple by reusing the current message components and improving message headers only.
- Add server and client tests for the orchestration flow and metadata rendering.

## Non-Goals

- Recursive or open-ended multi-agent conversation trees.
- Cross-CLI mention conversations.
- Parallel mention execution.
- A new message card system for orchestrated conversations.
- Replacing the current `source` and `sourceLabel` fields in one step.

## Current Problems

- `server/src/ws/gateway.ts` currently owns both transport behavior and mention orchestration behavior.
- Mention messages rely too heavily on formatted labels instead of structured routing metadata.
- The client can show source labels, but it does not have a stable structured model for `agent -> agent` and `agent -> user` flows.
- The current mention behavior is implemented, but not shaped as an isolated unit with dedicated tests.

## Proposed Architecture

### Server Structure

Add a dedicated mention orchestrator module at:

- `server/src/agents/orchestrator.ts`

The orchestrator owns:

- mention validation
- lead/collaborator resolution
- public orchestration message creation
- `CCManager` invocation for each single-agent execution step
- collaborator failure handling
- final lead summary generation

`WSGateway` remains responsible for:

- parsing client messages
- session and manager lookup
- normal non-mention routing
- delegating mention requests to the orchestrator
- broadcasting events returned by the orchestrator

`CCManager` remains a single-agent executor. It does not manage multi-agent policy.

### Orchestration Scope

This version supports one bounded flow only:

1. `user -> lead`
2. `lead -> collaborator`
3. `collaborator -> lead`
4. `lead -> user`

If only one agent is mentioned, the flow is reduced to `user -> lead -> user`.

Collaborators do not recursively trigger deeper mention chains in this version.

## Protocol and Metadata Design

### Client Input

The existing `mentions` array stays in the input payload:

```ts
{
  type: 'input'
  text: string
  sessionId: string
  mode?: ToolExecutionMode
  mentions?: AgentMention[]
}
```

No behavioral change is required in the input shape beyond continuing to send parsed mentions.

### Outgoing Message Metadata

Standardize the following metadata for persisted messages and server-to-client events:

```ts
type OrchestrationStep =
  | 'user_request'
  | 'agent_to_agent'
  | 'agent_reply'
  | 'agent_to_user'

interface OrchestrationMetadata {
  senderType: 'user' | 'agent' | 'system'
  senderAgentId?: string
  senderAgentName?: string
  targetAgentId?: string
  targetAgentName?: string
  orchestrationStep?: OrchestrationStep
}
```

Compatibility rules:

- Keep `source`, `sourceLabel`, `sourceAgent`, and `sourceAgentLabel`.
- Populate both the old compatibility fields and the new structured fields during the transition.
- The client should prefer structured metadata when present and fall back to compatibility fields when absent.

## Validation Rules

The orchestrator must reject the request when:

- more than 3 agents are mentioned
- mentioned agents belong to different CLI tools
- the lead agent cannot be resolved
- any collaborator cannot be resolved
- the target tool does not support execution

The first mention is always the lead agent.

## Failure Handling

### Collaborator Failure

If a collaborator execution fails or returns no usable assistant text:

- insert a visible message describing the collaborator failure
- tag it with structured metadata
- continue the orchestration using the successful collaborator replies already collected

The lead agent still produces a final user-facing summary unless the lead execution itself fails.

### Depth and Timeout

This version does not expose configurable orchestration depth.

Instead:

- orchestration is bounded to the fixed lead/collaborator flow
- timeout and depth guard constants live inside the orchestrator implementation
- future work may promote those constants into configuration after behavior stabilizes

## Client Rendering Design

### Store

The chat store should preserve the new structured metadata on incoming messages.

This metadata should be stored directly on message objects so rendering logic can stay declarative and avoid reparsing message text.

### Presentation

Reuse the current text bubble and header rendering with better source labeling:

- user message: `用户`
- normal agent message: `Claude / agent1`
- agent-to-agent message: `Claude / agent1 -> agent2`
- final lead summary: `Claude / agent1`

The client may use `orchestrationStep` for small visual distinctions, but it should not introduce a new card type in this iteration.

The display logic must be driven by metadata, not by parsing `@agent` mentions back out of the message body.

## Testing Strategy

### Server Tests

Add tests for:

- mention validation failures
- single-agent mention execution
- multi-agent orchestration flow
- collaborator failure fallback
- structured metadata for each public message type

These tests should exercise the orchestrator in isolation where possible.

### Client Tests

Add tests for:

- chat store preservation of structured orchestration metadata
- message header rendering for:
  - normal agent responses
  - `agent -> agent`
  - `agent -> user`

### Regression Coverage

Existing non-mention tests must remain green.

Build and test verification must include:

- `npm.cmd test -w server`
- `npm.cmd test -w client`
- `npm run build -w server`
- `npm run build -w client`

## Implementation Order

1. Add failing server tests for orchestrator validation and metadata.
2. Extract mention orchestration into `server/src/agents/orchestrator.ts`.
3. Extend server message metadata types and persistence shape.
4. Update `WSGateway` to delegate mention flows to the orchestrator.
5. Add failing client tests for metadata-driven rendering.
6. Update client store and message presentation to use structured metadata.
7. Re-run server and client tests and production builds.

## Acceptance Criteria

This work is complete when all of the following are true:

- mention orchestration logic is no longer embedded directly in `WSGateway`
- user-visible mention conversations still work for one lead agent and up to two collaborators
- public messages carry structured sender/target orchestration metadata
- the client renders agent-to-agent relationships from metadata rather than text parsing
- invalid mention requests fail deterministically with visible feedback
- server tests, client tests, and both builds pass

## Risks

- Compatibility drift between old source fields and new structured metadata if both are not populated consistently.
- Testability friction if the orchestrator depends too directly on `WSGateway` internals.
- UI regressions if older persisted messages without structured metadata are not handled by the compatibility fallback.

## Recommendation

Implement this as a bounded refactor around the existing mention behavior, not as a broader conversation system redesign. That keeps the scope aligned with the current product state and creates a stable base for later improvements such as configurable depth, richer orchestration UI, or cross-tool policies.
