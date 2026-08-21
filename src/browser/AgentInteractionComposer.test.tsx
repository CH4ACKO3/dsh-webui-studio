import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { translate } from './i18n'
import { AgentInteractionComposer } from './AgentInteractionComposer'
import type { AgentPendingInteraction } from './agent-interactions'

const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate('en', key, values)

describe('Studio Agent interaction composer', () => {
  it('renders an actionable approval instead of a handoff notice', () => {
    const interaction = {
      kind: 'approval', rpcId: 'approval-rpc',
      request: {
        type: 'approval/requested', sessionId: 'session-1', approvalId: 'approval-1',
        toolName: 'studio_build_and_reload', reason: 'Apply the new build',
      },
    } as AgentPendingInteraction
    const html = renderToStaticMarkup(<AgentInteractionComposer interaction={interaction} pendingCount={1}
      approvalArguments={'{"draft":"demo"}'}
      t={t} onRespond={async () => undefined} />)

    expect(html).toContain('Approval required')
    expect(html).toContain('studio_build_and_reload')
    expect(html).toContain('Allow once')
    expect(html).toContain('Reject')
    expect(html).toContain('&quot;draft&quot;: &quot;demo&quot;')
  })

  it('renders question choices, recommendation metadata, and a custom answer', () => {
    const interaction = {
      kind: 'question', rpcId: 'question-rpc',
      request: {
        type: 'question/requested', sessionId: 'session-1', questions: [{
          id: 'target', question: 'Which target?', options: [
            { label: 'Current Draft (Recommended)', description: 'Use the open project.' },
            { label: 'Another Draft' },
          ],
        }],
      },
    } as AgentPendingInteraction
    const html = renderToStaticMarkup(<AgentInteractionComposer interaction={interaction} pendingCount={2}
      t={t} onRespond={async () => undefined} />)

    expect(html).toContain('Which target?')
    expect(html).toContain('Current Draft')
    expect(html).toContain('Recommended')
    expect(html).toContain('Custom answer')
    expect(html).toContain('2 pending')
  })

  it('uses the dedicated plan-review decision surface when requested', () => {
    const interaction = {
      kind: 'question', rpcId: 'plan-rpc',
      request: {
        type: 'question/requested', sessionId: 'session-1', questions: [{
          id: 'review', question: 'Proceed?', detail: '# Plan\nChange the client.',
          intent: { kind: 'plan-review', approve: 'Approve' },
          options: [{ label: 'Refuse' }, { label: 'Approve' }],
        }],
      },
    } as AgentPendingInteraction
    const html = renderToStaticMarkup(<AgentInteractionComposer interaction={interaction} pendingCount={1}
      t={t} onRespond={async () => undefined} />)

    expect(html).toContain('Plan review')
    expect(html).toContain('Change the client.')
    expect(html).toContain('Discuss')
    expect(html).toContain('Approve')
  })
})
