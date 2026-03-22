import React, { useEffect, useRef, useCallback } from 'react';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view';
import { Compartment, EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { bracketMatching, indentOnInput, foldGutter, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  disabled?: boolean;
}

const studioTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    fontFamily: "'SF Mono', 'Fira Code', 'JetBrains Mono', monospace",
  },
  '.cm-content': {
    padding: '14px 0',
    caretColor: '#a8d19d',
  },
  '.cm-gutters': {
    background: 'transparent',
    border: 'none',
    color: '#3a3a3a',
    minWidth: '36px',
  },
  '.cm-activeLineGutter': {
    background: 'transparent',
    color: '#666',
  },
  '.cm-activeLine': {
    background: 'rgba(255,255,255,0.03)',
  },
  '.cm-cursor': {
    borderLeftColor: '#a8d19d',
    borderLeftWidth: '2px',
  },
  '.cm-selectionBackground': {
    background: 'rgba(122,162,255,0.18) !important',
  },
  '&.cm-focused .cm-selectionBackground': {
    background: 'rgba(122,162,255,0.24) !important',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
  '.cm-foldGutter .cm-gutterElement': {
    color: '#3a3a3a',
  },
  '.cm-panels': {
    background: '#101010',
    color: '#d4d4d4',
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  '.cm-panels-bottom': {
    padding: '14px 16px 16px',
  },
  '.cm-search': {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    width: '100%',
  },
  '.cm-search label': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    color: '#a1a1a1',
    whiteSpace: 'nowrap',
  },
  '.cm-search input[type="text"]': {
    minHeight: '36px',
    width: '100%',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.04)',
    color: '#f1f1f1',
    padding: '0 12px',
    outline: 'none',
    fontSize: '13px',
  },
  '.cm-search input[type="text"]:focus': {
    borderColor: 'rgba(168,209,157,0.45)',
    boxShadow: '0 0 0 1px rgba(168,209,157,0.18)',
  },
  '.cm-search button': {
    minHeight: '36px',
    padding: '0 14px',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.10)',
    background: 'rgba(255,255,255,0.06)',
    backgroundImage: 'none',
    color: '#d8d8d8',
    cursor: 'pointer',
    fontSize: '12px',
  },
  '.cm-search button:hover': {
    background: 'rgba(255,255,255,0.10)',
  },
  '.cm-search button:disabled': {
    opacity: 0.45,
    cursor: 'default',
  },
  '.cm-search input[type="checkbox"]': {
    minHeight: 'auto',
    width: '16px',
    height: '16px',
    padding: 0,
    accentColor: '#a8d19d',
  },
  '.cm-search br': {
    display: 'none',
  },
  '.cm-button': {
    backgroundImage: 'none !important',
  },
}, { dark: true });

const readOnlyCompartment = new Compartment();
const editableCompartment = new Compartment();

const CodeEditor: React.FC<CodeEditorProps> = ({ value, onChange, onSave, disabled = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);

  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const createState = useCallback((doc: string) => {
    return EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        foldGutter(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        highlightSelectionMatches(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        javascript({ jsx: true }),
        EditorView.lineWrapping,
        oneDark,
        studioTheme,
        keymap.of([
          ...defaultKeymap,
          ...closeBracketsKeymap,
          ...searchKeymap,
          indentWithTab,
          {
            key: 'Mod-s',
            run: () => {
              onSaveRef.current();
              return true;
            },
          },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        readOnlyCompartment.of(EditorState.readOnly.of(disabled)),
        editableCompartment.of(EditorView.editable.of(!disabled)),
      ],
    });
  }, [disabled]);

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return;

    const view = new EditorView({
      state: createState(value),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []); // Mount once

  // Sync value from outside (e.g., server response after save)
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  // Reconfigure editability without destroying undo history, selection, or scroll state.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        readOnlyCompartment.reconfigure(EditorState.readOnly.of(disabled)),
        editableCompartment.reconfigure(EditorView.editable.of(!disabled)),
      ],
    });
  }, [disabled]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
      }}
    />
  );
};

export default CodeEditor;
