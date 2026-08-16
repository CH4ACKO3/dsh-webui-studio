import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button, FormField, Input, Tabs } from './primitives'

describe('Studio UI primitives', () => {
  it('renders tabs with a roving tab stop and linked panels', () => {
    const html = renderToStaticMarkup(<Tabs id="studio" label="Studio tools" value="source"
      onChange={() => undefined} options={[
        { value: 'elements', label: 'Elements' },
        { value: 'source', label: 'Source' },
      ]} />)

    expect(html).toContain('role="tablist"')
    expect(html).toContain('id="studio-tab-source"')
    expect(html).toContain('aria-controls="studio-panel-source"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('tabindex="0"')
  })

  it('connects field help and errors to its control', () => {
    const html = renderToStaticMarkup(<FormField id="package-name" label="Package" description="npm package name"
      error="Already exists" required><Input /></FormField>)

    expect(html).toContain('for="package-name"')
    expect(html).toContain('id="package-name"')
    expect(html).toContain('required=""')
    expect(html).toContain('aria-describedby="package-name-description package-name-error"')
    expect(html).toContain('aria-invalid="true"')
  })

  it('keeps a loading action named and unavailable', () => {
    const html = renderToStaticMarkup(<Button loading loadingLabel="Saving">Save</Button>)
    expect(html).toContain('disabled=""')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Saving')
  })
})
