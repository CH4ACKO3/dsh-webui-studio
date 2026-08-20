import type { StudioMessageKey, StudioTranslate } from './i18n'
import { StudioRpcError } from './rpc'

const ERROR_MESSAGES: Readonly<Record<string, StudioMessageKey>> = {
  transport: 'errorTransport',
  'studio-method-forbidden': 'errorServiceUnavailable',
  'studio-build-busy': 'errorBuildBusy',
  'studio-build-config': 'errorBuildConfig',
  'studio-build-failed': 'errorBuildFailed',
  'studio-build-timeout': 'errorBuildTimeout',
  'studio-build-canceled': 'errorBuildCanceled',
  cancelled: 'errorRequestCanceled',
  'bad-request': 'errorRequestInvalid',
  'arguments-invalid': 'errorRequestInvalid',
  'input-invalid': 'errorRequestInvalid',
  'result-invalid': 'errorRequestInvalid',
  'definition-unavailable': 'errorServiceUnavailable',
  'invocation-unavailable': 'errorServiceUnavailable',
  'method-unavailable': 'errorServiceUnavailable',
  'service-unavailable': 'errorServiceUnavailable',
  'preview-registry': 'errorPreviewRegistry',
  'preview-selection': 'errorPreviewSelection',
  'preview-variable': 'errorPreviewVariable',
  'preview-style': 'errorPreviewStyle',
}

function withDiagnostic(summary: string, details: string, t: StudioTranslate): string {
  const diagnostic = details.trim()
  return diagnostic === '' || diagnostic === summary ? summary : t('errorDiagnostic', { summary, details: diagnostic })
}

export function studioErrorCodeMessage(
  code: string,
  details: string,
  t: StudioTranslate,
): string {
  const summary = t(ERROR_MESSAGES[code] ?? 'errorUnexpected')
  return withDiagnostic(summary, details, t)
}

export function studioErrorMessage(cause: unknown, t: StudioTranslate): string {
  if (cause instanceof StudioRpcError) return studioErrorCodeMessage(cause.code, cause.message, t)
  if (cause instanceof DOMException && cause.name === 'AbortError') return t('errorRequestCanceled')
  const details = cause instanceof Error ? cause.message : String(cause)
  if (details === 'Failed to fetch') return studioErrorCodeMessage('transport', details, t)
  return studioErrorCodeMessage('internal', details, t)
}
