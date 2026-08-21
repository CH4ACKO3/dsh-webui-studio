import { describe, expect, it } from 'vitest'
import type { StudioServerRequest } from '../contracts'
import {
  agentPlanReview,
  approvalInteractionResponse,
  cancelQuestionInteractionResponse,
  parseRecommendedLabel,
  questionInteractionResponse,
  updateAgentInteractions,
  type AgentPendingInteraction,
} from './agent-interactions'

function envelope(rpcId: string, payload: Record<string, unknown>): StudioServerRequest<Record<string, unknown>> {
  return { type: 'server-request', method: 'events.mux', rpcId, payload }
}

describe('Studio Agent pending interactions', () => {
  it('keeps ordered requests, deduplicates replay, and clears the reconnect baseline', () => {
    const approval = envelope('approval-rpc', {
      type: 'approval/requested', sessionId: 'session-1', approvalId: 'approval-1', toolName: 'studio_build_and_reload',
    })
    const question = envelope('question-rpc', {
      type: 'question/requested', sessionId: 'session-1', questions: [{ id: 'target', question: 'Which target?' }],
    })
    let store = updateAgentInteractions({}, approval)
    store = updateAgentInteractions(store, question)
    store = updateAgentInteractions(store, approval)

    expect(store['session-1']?.map(item => item.rpcId)).toEqual(['approval-rpc', 'question-rpc'])
    expect(updateAgentInteractions(store, envelope('baseline', {
      type: 'session/subscribed', sessionId: 'session-1', lastSeq: 3,
    }))).toEqual({})
  })

  it('resolves only the interaction named by the Host', () => {
    let store = updateAgentInteractions({}, envelope('approval-rpc', {
      type: 'approval/requested', sessionId: 'session-1', approvalId: 'approval-1', toolName: 'exec',
    }))
    store = updateAgentInteractions(store, envelope('question-rpc', {
      type: 'question/requested', sessionId: 'session-1', questions: [{ id: 'q', question: '?' }],
    }))
    store = updateAgentInteractions(store, envelope('resolved-1', {
      type: 'approval/resolved', sessionId: 'session-1', approvalId: 'approval-1', outcome: 'allowed-once',
    }))
    expect(store['session-1']?.map(item => item.rpcId)).toEqual(['question-rpc'])

    store = updateAgentInteractions(store, envelope('resolved-2', {
      type: 'question/resolved', sessionId: 'session-1', questionRpcId: 'question-rpc', outcome: 'answered',
    }))
    expect(store).toEqual({})
  })

  it('encodes approval, question, and cancellation responses with the request rpcId', () => {
    const approval = updateAgentInteractions({}, envelope('approval-rpc', {
      type: 'approval/requested', sessionId: 'session-1', approvalId: 'approval-1', toolName: 'exec',
    }))['session-1']![0]! as Extract<AgentPendingInteraction, { kind: 'approval' }>
    const question = updateAgentInteractions({}, envelope('question-rpc', {
      type: 'question/requested', sessionId: 'session-1', questions: [{ id: 'q', question: '?' }],
    }))['session-1']![0]! as Extract<AgentPendingInteraction, { kind: 'question' }>

    expect(approvalInteractionResponse(approval, 'allowed-once')).toEqual({
      type: 'client-response', rpcId: 'approval-rpc',
      result: { ok: true, value: { sessionId: 'session-1', approvalId: 'approval-1', outcome: 'allowed-once' } },
    })
    expect(questionInteractionResponse(question, { answers: [{ id: 'q', selected: ['A'] }] })).toEqual({
      type: 'client-response', rpcId: 'question-rpc',
      result: { ok: true, value: { sessionId: 'session-1', answer: { answers: [{ id: 'q', selected: ['A'] }] } } },
    })
    expect(cancelQuestionInteractionResponse(question).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('recognizes recommended labels and valid plan reviews without changing answer values', () => {
    expect(parseRecommendedLabel('Use CSS (Recommended)')).toEqual({ label: 'Use CSS', recommended: true })
    const interaction = updateAgentInteractions({}, envelope('plan-rpc', {
      type: 'question/requested', sessionId: 'session-1', questions: [{
        id: 'review', question: 'Proceed?', detail: '# Plan', intent: { kind: 'plan-review', approve: 'Approve' },
        options: [{ label: 'Refuse' }, { label: 'Approve' }],
      }],
    }))['session-1']![0]! as Extract<AgentPendingInteraction, { kind: 'question' }>
    expect(agentPlanReview(interaction)).toMatchObject({ id: 'review', plan: '# Plan', approve: { label: 'Approve' } })
  })
})
