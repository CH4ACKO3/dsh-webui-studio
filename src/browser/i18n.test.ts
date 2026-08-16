import { describe, expect, it } from 'vitest'
import { readStudioLocale, STUDIO_LANGUAGES, STUDIO_LOCALE_STORAGE_KEY, translate } from './i18n'

function storage(value: string | null): Pick<Storage, 'getItem'> {
  return { getItem: key => key === STUDIO_LOCALE_STORAGE_KEY ? value : null }
}

describe('Studio locale', () => {
  it('uses a persisted locale before the browser language', () => {
    expect(readStudioLocale(storage('en'), 'zh-CN')).toBe('en')
    expect(readStudioLocale(storage('zh-CN'), 'en-US')).toBe('zh-CN')
  })

  it('derives the initial locale when storage is missing or invalid', () => {
    expect(readStudioLocale(storage(null), 'zh-Hans-CN')).toBe('zh-CN')
    expect(readStudioLocale(storage('unknown'), 'fr-FR')).toBe('en')
  })

  it('publishes stable language autonyms for the settings selector', () => {
    expect(STUDIO_LANGUAGES).toEqual([
      { locale: 'en', nativeName: 'English' },
      { locale: 'zh-CN', nativeName: '简体中文' },
    ])
  })

  it('translates both locales and interpolates values', () => {
    expect(translate('en', 'draftClose', { name: 'Demo' })).toBe('Close draft Demo')
    expect(translate('zh-CN', 'draftClose', { name: 'Demo' })).toBe('关闭草稿 Demo')
  })
})
