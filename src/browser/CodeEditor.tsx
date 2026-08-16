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
  const editor = useRef<EditorView>()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
            if (update.docChanged) onChangeRef.current(update.state.doc.toString())
          }),
          EditorView.theme({
            '&': { height: '100%', backgroundColor: 'transparent' },
            '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
            '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--border)' },
          }),
        ],
      }),
    })
    editor.current = view
    return () => {
      if (editor.current === view) editor.current = undefined
      view.destroy()
    }
  }, [path])

  useEffect(() => {
    const view = editor.current
    if (view === undefined || view.state.doc.toString() === value) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } })
  }, [value])

  return <div className="code-editor" ref={parent} />
}
