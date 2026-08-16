import { execFileSync } from 'node:child_process'
import { expect, test } from 'vitest'

test('keeps tracked source code in TypeScript', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  expect(tracked.filter(file => /\.(?:[cm]?js|jsx)$/.test(file))).toEqual([])
})
