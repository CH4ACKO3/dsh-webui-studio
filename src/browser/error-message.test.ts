import { describe, expect, it } from 'vitest'
import { studioErrorCodeMessage, studioErrorMessage } from './error-message'
import { translate } from './i18n'
import { StudioRpcError } from './rpc'

describe('Studio error localization', () => {
  it('localizes RPC codes while retaining raw diagnostics', () => {
    const error = new StudioRpcError('studio-build-failed', 'command exited with status 1')
    expect(studioErrorMessage(error, (key, values) => translate('zh-CN', key, values)))
      .toBe('Draft 构建失败。 诊断信息：command exited with status 1')
  })

  it('localizes browser transport failures', () => {
    expect(studioErrorMessage(new TypeError('Failed to fetch'), (key, values) => translate('zh-CN', key, values)))
      .toBe('无法连接到 Studio。 诊断信息：Failed to fetch')
  })

  it('localizes Preview bridge codes', () => {
    expect(studioErrorCodeMessage('preview-variable', 'invalid value', (key, values) => translate('zh-CN', key, values)))
      .toBe('无法更新 Preview 变量。 诊断信息：invalid value')
  })
})
