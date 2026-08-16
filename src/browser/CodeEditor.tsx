import { useEffect, useRef } from 'react'
import { javascript } from '@codemirror/lang-javascript'
import { basicSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

interface CodeEditorProps {
  path: string
  value: string
  onChange(value: string): void
}

export function CodeEditor({ path, value, onChange }: CodeEditorProps): JSX.Element {
  const parent = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (parent.current === null) return
    const code = /\.[cm]?[jt]sx?$/.test(path)
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          ...(code ? [javascript({ jsx: /x$/.test(path), typescript: /tsx?$/.test(path) })] : []),
          EditorView.lineWrapping,
          EditorView.updateListener.of(update => {
            if (update.docChanged) onChange(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'transparent' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--border)' },
          }),
        ],
      }),
    })
    return () => view.destroy()
  }, [path])

  return <div className="code-editor" ref={parent} />
}
