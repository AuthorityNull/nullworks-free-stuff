import React from 'react';
import { ChevronDown, ChevronRight, Loader, Save } from 'lucide-react';

interface PromptSaveNotice {
  tone: 'success' | 'error';
  text: string;
}

interface PromptFile {
  path: string;
  label?: string;
  relativePath?: string;
  name?: string;
}

interface Props {
  promptOpen: boolean;
  promptPanelWidth: number;
  promptTabWidth: number;
  promptTabHeight: number;
  promptTabTop: number;
  promptDockWidth: number;
  promptDirty: boolean;
  promptSaving: boolean;
  fileMenuOpen: boolean;
  promptFiles: PromptFile[];
  promptSelectedFile: string;
  hoveredPromptFile: string | null;
  selectedPromptFileLabel: string;
  promptLoadError: string | null;
  promptSaveNotice: PromptSaveNotice | null;
  promptContent: string;
  promptLoading: boolean;
  onClose: () => void;
  onOpen: () => void;
  onSave: () => void;
  onToggleFileMenu: () => void;
  onSelectFile: (filePath: string) => void;
  onHoverFile: (filePath: string | null) => void;
  onPromptContentChange: (value: string) => void;
  onPromptKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

const ChatPromptDock: React.FC<Props> = ({
  promptOpen,
  promptPanelWidth,
  promptTabWidth,
  promptTabHeight,
  promptTabTop,
  promptDockWidth,
  promptDirty,
  promptSaving,
  fileMenuOpen,
  promptFiles,
  promptSelectedFile,
  hoveredPromptFile,
  selectedPromptFileLabel,
  promptLoadError,
  promptSaveNotice,
  promptContent,
  promptLoading,
  onClose,
  onOpen,
  onSave,
  onToggleFileMenu,
  onSelectFile,
  onHoverFile,
  onPromptContentChange,
  onPromptKeyDown,
}) => {
  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: 82,
          bottom: 14,
          right: '100%',
          width: promptPanelWidth + promptTabWidth,
          transform: promptOpen ? 'translateX(0)' : `translateX(${promptPanelWidth}px)`,
          transition: 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
          zIndex: 1,
          pointerEvents: 'none',
          overflow: 'visible',
        }}
      >
        {promptOpen && (
          <button
            onClick={onClose}
            title="Collapse system prompt editor"
            style={{
              position: 'absolute',
              top: promptTabTop - 82,
              left: 0,
              width: promptTabWidth,
              height: promptTabHeight,
              borderRadius: '0 10px 10px 0',
              border: '1px solid rgba(255,255,255,0.10)',
              borderLeft: 'none',
              background: 'rgba(34,34,34,0.98)',
              color: '#ededed',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              letterSpacing: '0.14em',
              fontSize: 9,
              fontFamily: "'SF Mono', monospace",
              writingMode: 'vertical-rl',
              textOrientation: 'mixed',
              transform: 'rotate(180deg)',
              cursor: 'pointer',
              pointerEvents: 'auto',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 0 0 1px rgba(255,255,255,0.02)',
              transition: 'background 180ms ease, color 180ms ease, box-shadow 180ms ease',
              zIndex: 1,
              padding: '10px 0',
            }}
          >
            PROMPT
          </button>
        )}

        <div
          style={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            right: 0,
            width: promptPanelWidth,
            background: 'rgba(11,11,11,0.985)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRight: 'none',
            borderRadius: '16px 0 0 16px',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: 'none',
            overflow: 'hidden',
            backdropFilter: 'blur(10px)',
            pointerEvents: promptOpen ? 'auto' : 'none',
            zIndex: 0,
          }}
        >
          <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px 0 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: '#9a9a9a', letterSpacing: '0.14em', textTransform: 'uppercase' }}>System prompt</span>
              <span style={{ fontSize: 12, color: '#6f6f6f' }}>Live Echo profile files</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {promptDirty && (
                <button
                  onClick={onSave}
                  disabled={promptSaving}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    height: 30, padding: '0 10px',
                    background: 'rgba(74,124,68,0.18)', border: '1px solid rgba(74,124,68,0.34)',
                    borderRadius: 8, color: '#a8d19d', cursor: 'pointer',
                    fontSize: 11, fontFamily: "'SF Mono', monospace",
                  }}
                >
                  <Save size={12} />
                  {promptSaving ? 'Saving prompt...' : 'Save prompt'}
                </button>
              )}
              <button
                onClick={onClose}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 30, height: 30, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', color: '#7a7a7a', cursor: 'pointer', borderRadius: 8 }}
                title="Collapse prompt editor"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8, padding: '12px 14px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0, overflow: 'visible' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, position: 'relative' }}>
              <span style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: '#777', letterSpacing: '0.10em', textTransform: 'uppercase' }}>File</span>
              <button
                type="button"
                onClick={onToggleFileMenu}
                style={{
                  height: 36,
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.10)',
                  background: '#151515',
                  color: '#d6d6d6',
                  fontSize: 12,
                  padding: '0 12px',
                  fontFamily: "'SF Mono', monospace",
                  outline: 'none',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{selectedPromptFileLabel}</span>
                <ChevronDown size={14} style={{ color: '#8a8a8a', flexShrink: 0, transform: fileMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 160ms ease' }} />
              </button>
              {fileMenuOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: 0,
                    right: 0,
                    maxHeight: 260,
                    overflowY: 'auto',
                    background: '#111111',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 12,
                    boxShadow: '0 18px 48px rgba(0,0,0,0.48)',
                    zIndex: 80,
                  }}
                >
                  {promptFiles.length === 0 ? (
                    <div style={{ padding: '12px 14px', fontSize: 12, color: '#757575', fontFamily: "'SF Mono', monospace" }}>No files found</div>
                  ) : promptFiles.map((f) => {
                    const active = f.path === promptSelectedFile;
                    const hovered = hoveredPromptFile === f.path;
                    return (
                      <button
                        key={f.path}
                        type="button"
                        onClick={() => onSelectFile(f.path)}
                        onMouseEnter={() => onHoverFile(f.path)}
                        onMouseLeave={() => onHoverFile(null)}
                        style={{
                          width: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 10,
                          padding: '10px 12px',
                          border: 'none',
                          borderBottom: '1px solid rgba(255,255,255,0.04)',
                          background: active ? 'rgba(255,255,255,0.08)' : hovered ? 'rgba(255,255,255,0.045)' : 'transparent',
                          color: active ? '#f0f0f0' : hovered ? '#e1e1e1' : '#c8c8c8',
                          fontSize: 12,
                          fontFamily: "'SF Mono', monospace",
                          textAlign: 'left',
                          cursor: 'pointer',
                          transition: 'background 120ms ease, color 120ms ease',
                        }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.label || f.relativePath || f.name}</span>
                        {active && <span style={{ color: '#7fa66f', fontSize: 10, letterSpacing: '0.10em' }}>OPEN</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div style={{ flex: 1, overflow: 'hidden', background: 'rgba(0,0,0,0.12)', padding: '12px 12px 14px', cursor: 'default' }}>
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, background: 'rgba(255,255,255,0.03)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)', cursor: 'default' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                <span style={{ fontSize: 11, color: '#979797', fontFamily: "'SF Mono', monospace", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedPromptFileLabel}</span>
                <span style={{ fontSize: 10, color: '#6f6f6f', fontFamily: "'SF Mono', monospace", flexShrink: 0 }}>editable</span>
              </div>
              {promptLoadError && (
                <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: '#d08a8a', fontSize: 11, fontFamily: "'SF Mono', monospace", background: 'rgba(127,32,32,0.12)' }}>
                  {promptLoadError}
                </div>
              )}
              {promptSaveNotice && (
                <div
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    color: promptSaveNotice.tone === 'error' ? '#e7b0b0' : '#a8d19d',
                    fontSize: 11,
                    fontFamily: "'SF Mono', monospace",
                    background: promptSaveNotice.tone === 'error' ? 'rgba(127,32,32,0.12)' : 'rgba(42,79,38,0.16)',
                  }}
                >
                  {promptSaveNotice.text}
                </div>
              )}
              <div style={{ flex: 1, padding: '14px 16px 18px', cursor: 'default', position: 'relative' }}>
                <textarea
                  value={promptContent}
                  onChange={(e) => onPromptContentChange(e.target.value)}
                  onKeyDown={onPromptKeyDown}
                  spellCheck={false}
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: '#d0d0d0',
                    fontSize: 12,
                    lineHeight: 1.7,
                    fontFamily: "'SF Mono', 'Fira Code', monospace",
                    padding: 0,
                    resize: 'none',
                    tabSize: 2,
                    overflowY: 'auto',
                    cursor: 'text',
                    opacity: promptLoading ? 0.62 : 1,
                    transition: 'opacity 120ms ease',
                  }}
                />
                {promptLoading && (
                  <div style={{ position: 'absolute', top: 10, right: 12, display: 'inline-flex', alignItems: 'center', gap: 6, color: '#666', fontSize: 10, fontFamily: "'SF Mono', monospace" }}>
                    <Loader size={12} style={{ animation: 'spin 0.8s linear infinite' }} />
                    Loading
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          width: promptDockWidth,
          flexShrink: 0,
          position: 'relative',
          background: 'linear-gradient(180deg, rgba(18,18,18,0.98), rgba(12,12,12,0.98))',
          borderRight: '1px solid rgba(255,255,255,0.05)',
          boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.02)',
          zIndex: 4,
        }}
      >
        <button
          onClick={onOpen}
          title="Open system prompt editor"
          style={{
            position: 'absolute',
            top: promptTabTop,
            left: 0,
            width: promptTabWidth,
            height: promptTabHeight,
            borderRadius: '0 10px 10px 0',
            border: '1px solid rgba(255,255,255,0.10)',
            borderLeft: 'none',
            background: 'rgba(20,20,20,0.94)',
            color: '#9f9f9f',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            letterSpacing: '0.14em',
            fontSize: 9,
            fontFamily: "'SF Mono', monospace",
            writingMode: 'vertical-rl',
            textOrientation: 'mixed',
            transform: 'rotate(180deg)',
            cursor: promptOpen ? 'default' : 'pointer',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03)',
            transition: 'opacity 120ms ease, background 180ms ease, color 180ms ease, box-shadow 180ms ease',
            opacity: promptOpen ? 0 : 1,
            pointerEvents: promptOpen ? 'none' : 'auto',
            padding: '10px 0',
            zIndex: 1,
          }}
        >
          PROMPT
        </button>
      </div>
    </>
  );
};

export default ChatPromptDock;
