import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type { StudioMessage, StudioMessageMode } from '../../api/types';
import { Send, Loader, Paperclip, X, FileIcon, ImageIcon, ChevronDown, Upload } from 'lucide-react';
import ChatPromptDock from './ChatPromptDock';
import { useStudioPromptDock } from './useStudioPromptDock';
import { useStudioAttachments } from './useStudioAttachments';

interface TimelineEntry {
  id: string;
  stage: string;
  message: string;
  ts: string;
  tone?: 'info' | 'success' | 'error';
}

interface Props {
  messages: StudioMessage[];
  projectId: string;
  projectName: string;
  sending: boolean;
  echoThinking: boolean;
  progressText?: string | null;
  streamingText?: string | null;
  lastError?: string | null;
  timeline?: TimelineEntry[];
  viewportWidth?: number;
  railWidth?: number;
  onSend: (content: string, mode: StudioMessageMode, attachmentRefs?: string[]) => void;
  onStopRun?: () => void;
  canStopRun?: boolean;
  stopPending?: boolean;
  disabled: boolean;
}

function renderInlineMarkdown(text: string, keyPrefix: string) {
  const parts = String(text).split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/g);
  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (!part) return null;
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key} style={{ padding: '1px 5px', borderRadius: 6, background: 'rgba(255,255,255,0.07)', color: '#e8efe6', fontSize: '0.92em', fontFamily: "'SF Mono', monospace" }}>{part.slice(1, -1)}</code>;
    }
    if ((part.startsWith('**') && part.endsWith('**')) || (part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_'))) {
      const trimmed = part.replace(/^(\*\*|\*|_)/, '').replace(/(\*\*|\*|_)$/, '');
      const isBold = part.startsWith('**');
      return <strong key={key} style={{ fontWeight: isBold ? 650 : 560, fontStyle: isBold ? 'normal' : 'italic' }}>{trimmed}</strong>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

function renderMarkdownish(content: string, role: 'assistant' | 'user' = 'assistant') {
  const normalized = String(content || '').replace(/\r\n/g, '\n').trimEnd();
  if (!normalized) return null;

  const chunks = normalized.split(/(```[\s\S]*?```)/g).filter(Boolean);
  return chunks.map((chunk, chunkIndex) => {
    const fencedMatch = chunk.match(/^```([^\n`]*)\n?([\s\S]*?)```$/);
    if (fencedMatch) {
      const language = (fencedMatch[1] || '').trim();
      const code = (fencedMatch[2] || '').replace(/\n$/, '');
      return (
        <div
          key={`code-${chunkIndex}`}
          style={{
            margin: chunkIndex === 0 ? 0 : '10px 0 0',
            borderRadius: 12,
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(7,10,14,0.92)',
          }}
        >
          {language ? (
            <div style={{ padding: '8px 12px', fontSize: 11, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#9fb0a5', background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {language}
            </div>
          ) : null}
          <pre style={{ margin: 0, padding: '12px 14px', overflowX: 'auto', fontSize: 12.5, lineHeight: 1.55, color: '#ecf4ea', fontFamily: "'SF Mono', 'Cascadia Code', monospace", whiteSpace: 'pre-wrap' }}>
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    const blocks = chunk.split(/\n{2,}/);
    return blocks.map((block, blockIndex) => {
      const key = `chunk-${chunkIndex}-block-${blockIndex}`;
      const lines = block.split('\n');
      const bulletLines = lines.filter((line) => /^\s*[-*]\s+/.test(line));
      const numberedLines = lines.filter((line) => /^\s*\d+[.)]\s+/.test(line));
      if (bulletLines.length === lines.length) {
        return (
          <ul key={`ul-${key}`} style={{ margin: chunkIndex === 0 && blockIndex === 0 ? 0 : '10px 0 0', paddingLeft: 18 }}>
            {lines.map((line, lineIndex) => (
              <li key={`li-${key}-${lineIndex}`} style={{ margin: lineIndex === 0 ? 0 : '4px 0 0' }}>
                {renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, ''), `li-${key}-${lineIndex}`)}
              </li>
            ))}
          </ul>
        );
      }
      if (numberedLines.length === lines.length) {
        return (
          <ol key={`ol-${key}`} style={{ margin: chunkIndex === 0 && blockIndex === 0 ? 0 : '10px 0 0', paddingLeft: 18 }}>
            {lines.map((line, lineIndex) => (
              <li key={`li-${key}-${lineIndex}`} style={{ margin: lineIndex === 0 ? 0 : '4px 0 0' }}>
                {renderInlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ''), `li-${key}-${lineIndex}`)}
              </li>
            ))}
          </ol>
        );
      }
      if (/^#{1,3}\s+/.test(block)) {
        const level = Math.min(3, (block.match(/^#+/)?.[0].length || 1));
        const text = block.replace(/^#{1,3}\s+/, '');
        const Tag = level === 1 ? 'h3' : level === 2 ? 'h4' : 'h5';
        return <Tag key={`h-${key}`} style={{ margin: chunkIndex === 0 && blockIndex === 0 ? 0 : '12px 0 0', fontSize: level === 1 ? 15 : 14, lineHeight: 1.35, color: role === 'assistant' ? '#eef6ec' : '#f0f0f0' }}>{renderInlineMarkdown(text, `h-${key}`)}</Tag>;
      }
      return (
        <p key={`p-${key}`} style={{ margin: chunkIndex === 0 && blockIndex === 0 ? 0 : '10px 0 0', lineHeight: 1.6 }}>
          {lines.map((line, lineIndex) => (
            <React.Fragment key={`line-${key}-${lineIndex}`}>
              {lineIndex > 0 && <br />}
              {renderInlineMarkdown(line, `line-${key}-${lineIndex}`)}
            </React.Fragment>
          ))}
        </p>
      );
    });
  });
}

const ATTACHMENT_LINE_RE = /^\[attachment:\s*(.+?)\]\((.+?)\)$/i;

function splitMessageBodyAndAttachments(content: string) {
  const normalized = String(content || '').replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const markerIndex = lines.findIndex((line) => line.trim() === 'Attached files:');
  if (markerIndex === -1) {
    return { body: normalized.trim(), attachments: [] as Array<{ name: string; target: string }> };
  }

  const attachmentLines = lines.slice(markerIndex + 1).map((line) => line.trim()).filter(Boolean);
  const attachments = attachmentLines
    .map((line) => {
      const match = line.match(ATTACHMENT_LINE_RE);
      return match ? { name: match[1], target: match[2] } : null;
    })
    .filter((value): value is { name: string; target: string } => Boolean(value));

  if (attachments.length !== attachmentLines.length) {
    return { body: normalized.trim(), attachments: [] as Array<{ name: string; target: string }> };
  }

  return {
    body: lines.slice(0, markerIndex).join('\n').trim(),
    attachments,
  };
}

const ChatRail: React.FC<Props> = ({
  messages,
  projectId,
  projectName,
  sending,
  echoThinking,
  progressText = null,
  streamingText = null,
  lastError = null,
  timeline = [],
  viewportWidth = 1440,
  railWidth = 430,
  onSend,
  onStopRun,
  canStopRun = false,
  stopPending = false,
  disabled,
}) => {
  const [input, setInput] = useState('');
  const [composeMode, setComposeMode] = useState<StudioMessageMode>('chat');
  const scrollViewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [runStateOpen, setRunStateOpen] = useState(false);
  const [pendingStatusBubbleVisible, setPendingStatusBubbleVisible] = useState(false);

  const {
    promptOpen,
    setPromptOpen,
    promptFiles,
    promptSelectedFile,
    promptContent,
    promptDirty,
    promptSaving,
    promptLoading,
    promptLoadError,
    promptSaveNotice,
    fileMenuOpen,
    setFileMenuOpen,
    hoveredPromptFile,
    setHoveredPromptFile,
    selectedPromptFileLabel,
    savePromptFile,
    onSelectFile,
    onPromptContentChange,
    onPromptKeyDown,
  } = useStudioPromptDock();

  const {
    pendingFiles,
    uploading,
    uploadError,
    dragActive,
    inputHint,
    uploadFiles,
    removePendingFile,
    clearPendingFiles,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    setUploadError,
  } = useStudioAttachments(projectId);

  const promptDockWidth = 30;
  const promptTabWidth = 30;
  const promptTabHeight = 104;
  const promptTabTop = 100;
  const promptPanelWidth = Math.max(320, Math.min(590, viewportWidth - railWidth - 96));

  const latestTimelineMessage = timeline.length > 0 ? timeline[timeline.length - 1]?.message || null : null;
  const latestBackendSummary = latestTimelineMessage && latestTimelineMessage !== 'Run started.'
    ? latestTimelineMessage
    : null;
  const backendPendingSummary = (progressText && progressText !== 'Echo is typing' && progressText !== 'Echo is thinking')
    || latestBackendSummary
    || null;
  const chatStatusSummary = streamingText
    ? 'Echo is typing'
    : (backendPendingSummary || 'Echo is thinking');
  const activeRunLockCopy = 'A run is already in progress. Wait for Echo to finish or stop it.';
  const activeRunPlaceholderCopy = 'A run is already in progress...';
  const showRunStatePanel = echoThinking || Boolean(progressText) || timeline.length > 0 || Boolean(lastError) || canStopRun;
  const runStateSummary = lastError
    || (echoThinking
      ? (backendPendingSummary || 'Run active. Expand for live backend details.')
      : (latestBackendSummary || 'Recent activity available'));
  const shouldDelayPendingStatusBubble = echoThinking && !streamingText && !lastError;
  const showPendingStatusBubble = shouldDelayPendingStatusBubble && pendingStatusBubbleVisible;
  const composerLocked = disabled || echoThinking;
  const canSend = !composerLocked && !sending && !uploading && (Boolean(input.trim()) || pendingFiles.length > 0);

  const lastMessage = messages[messages.length - 1];

  const isNearBottomRef = useRef(true);

  useEffect(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return undefined;
    const onScroll = () => {
      const threshold = 120;
      isNearBottomRef.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < threshold;
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport.removeEventListener('scroll', onScroll);
  }, []);

  useLayoutEffect(() => {
    const viewport = scrollViewportRef.current;
    const bottom = bottomRef.current;
    if (!viewport || !bottom) return;

    // Always scroll on new user messages or pending files; otherwise respect scroll position.
    const forceScroll = pendingFiles.length > 0;
    if (!forceScroll && !isNearBottomRef.current) return;

    const behavior: ScrollBehavior = streamingText || echoThinking ? 'auto' : 'smooth';
    const scrollToBottom = () => {
      try {
        bottom.scrollIntoView({ block: 'end', behavior });
      } catch {}
      viewport.scrollTop = viewport.scrollHeight;
    };

    let frame2 = 0;
    const frame1 = window.requestAnimationFrame(() => {
      scrollToBottom();
      frame2 = window.requestAnimationFrame(scrollToBottom);
    });
    const timer = window.setTimeout(scrollToBottom, 60);

    return () => {
      window.cancelAnimationFrame(frame1);
      if (frame2) window.cancelAnimationFrame(frame2);
      window.clearTimeout(timer);
    };
  }, [
    messages.length,
    lastMessage?.id,
    lastMessage?.content,
    echoThinking,
    streamingText,
    timeline.length,
    runStateOpen,
    showPendingStatusBubble,
    pendingFiles.length,
  ]);

  useEffect(() => {
    if (!shouldDelayPendingStatusBubble) {
      setPendingStatusBubbleVisible(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setPendingStatusBubbleVisible(true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [shouldDelayPendingStatusBubble]);

  const handleSubmit = () => {
    const text = input.trim();
    if ((!text && pendingFiles.length === 0) || disabled || sending || uploading) return;
    const refs = pendingFiles.map((a) => `[attachment: ${a.originalName}](${a.workspacePath || a.path})`);
    const body = refs.length > 0
      ? [text, '', 'Attached files:', ...refs].filter((line, i) => i > 0 || line).join('\n')
      : text;
    onSend(body, composeMode, refs.length > 0 ? refs : undefined);
    setInput('');
    clearPendingFiles();
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(textareaRef.current.scrollHeight, 60)}px`;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    e.target.value = '';
    uploadFiles(Array.from(files));
  };


  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'visible', position: 'relative' }}>
      <ChatPromptDock
        promptOpen={promptOpen}
        promptPanelWidth={promptPanelWidth}
        promptTabWidth={promptTabWidth}
        promptTabHeight={promptTabHeight}
        promptTabTop={promptTabTop}
        promptDockWidth={promptDockWidth}
        promptDirty={promptDirty}
        promptSaving={promptSaving}
        fileMenuOpen={fileMenuOpen}
        promptFiles={promptFiles}
        promptSelectedFile={promptSelectedFile}
        hoveredPromptFile={hoveredPromptFile}
        selectedPromptFileLabel={selectedPromptFileLabel}
        promptLoadError={promptLoadError}
        promptSaveNotice={promptSaveNotice}
        promptContent={promptContent}
        promptLoading={promptLoading}
        onClose={() => setPromptOpen(false)}
        onOpen={() => setPromptOpen(true)}
        onSave={savePromptFile}
        onToggleFileMenu={() => setFileMenuOpen((v) => !v)}
        onSelectFile={onSelectFile}
        onHoverFile={setHoveredPromptFile}
        onPromptContentChange={onPromptContentChange}
        onPromptKeyDown={onPromptKeyDown}
      />

      {/* Main chat column */}
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', position: 'relative', zIndex: 3, background: '#0c0c0c' }}>
      {/* Header */}
      <div
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px 0 16px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            fontSize: 10,
            letterSpacing: '0.14em',
            color: '#888',
            textTransform: 'uppercase',
          }}
        >
          Chat - {projectName}
        </span>
        <span style={{ fontSize: 10, color: '#5f5f5f', fontFamily: "'SF Mono', monospace", letterSpacing: '0.08em' }}>
          Echo Studio
        </span>
      </div>

      {/* Messages */}
      <div
        ref={scrollViewportRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          background: '#0c0c0c',
        }}
      >
        {showRunStatePanel && (
          <div
            style={{
              borderRadius: 12,
              border: `1px solid ${lastError ? 'rgba(180,90,90,0.35)' : 'rgba(255,255,255,0.08)'}`,
              background: lastError ? 'rgba(120,40,40,0.16)' : 'rgba(255,255,255,0.03)',
              overflow: 'hidden',
            }}
          >
            <button
              type="button"
              onClick={() => setRunStateOpen((v) => !v)}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                cursor: 'pointer',
                color: 'inherit',
              }}
              title={runStateOpen ? 'Collapse run state' : 'Expand run state'}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start', minWidth: 0 }}>
                <span style={{ fontSize: 10, color: lastError ? '#d9a3a3' : '#888', fontFamily: "'SF Mono', monospace", letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  Run state
                </span>
                <span style={{ color: lastError ? '#f1c0c0' : echoThinking ? '#a8d19d' : '#a7a7a7', fontSize: 12, lineHeight: 1.4, textAlign: 'left' }}>
                  {runStateSummary}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {echoThinking && <span style={{ color: '#8bb583', fontSize: 11, fontFamily: "'SF Mono', monospace" }}>Active</span>}
                {canStopRun && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStopRun?.();
                    }}
                    disabled={stopPending}
                    style={{
                      height: 24,
                      padding: '0 10px',
                      borderRadius: 999,
                      border: '1px solid rgba(214,106,106,0.32)',
                      background: stopPending ? 'rgba(214,106,106,0.08)' : 'rgba(214,106,106,0.12)',
                      color: stopPending ? '#c99595' : '#efb1b1',
                      cursor: stopPending ? 'default' : 'pointer',
                      fontSize: 10,
                      fontFamily: "'SF Mono', monospace",
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                    title={stopPending ? 'Stopping this run...' : 'Stop this run'}
                  >
                    {stopPending ? 'Stopping...' : 'Stop run'}
                  </button>
                )}
                <ChevronDown size={14} style={{ color: '#6e6e6e', transform: runStateOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 180ms ease' }} />
              </div>
            </button>
            {runStateOpen && (
              <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {lastError && (
                  <div style={{ color: '#f1c0c0', fontSize: 12, lineHeight: 1.5 }}>
                    {lastError}
                  </div>
                )}
                {!lastError && echoThinking && timeline.length === 0 && (
                  <div style={{ color: '#9a9a9a', fontSize: 12, lineHeight: 1.5 }}>
                    Waiting for the first backend event...
                  </div>
                )}
                {timeline.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {timeline.map((entry) => (
                      <div key={entry.id} style={{ display: 'grid', gridTemplateColumns: '64px 1fr', gap: 10, alignItems: 'start' }}>
                        <span style={{ color: '#666', fontSize: 10, fontFamily: "'SF Mono', monospace" }}>
                          {new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                        </span>
                        <div>
                          <div style={{ color: entry.tone === 'error' ? '#f1c0c0' : entry.tone === 'success' ? '#b8d9b2' : '#cfcfcf', fontSize: 12, lineHeight: 1.45 }}>
                            {entry.message}
                          </div>
                          <div style={{ color: '#555', fontSize: 10, fontFamily: "'SF Mono', monospace", marginTop: 2, textTransform: 'uppercase' }}>
                            {entry.stage}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {messages.length === 0 && !echoThinking && (
          <div
            style={{
              display: 'grid',
              placeItems: 'center',
              flex: 1,
            }}
          >
            <span style={{ color: '#333', fontSize: 12, fontFamily: "'SF Mono', monospace", letterSpacing: '0.04em' }}>
              Tell Echo what to build
            </span>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                borderRadius: msg.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background:
                  msg.role === 'user'
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(74,124,68,0.12)',
                border: `1px solid ${
                  msg.role === 'user'
                    ? 'rgba(255,255,255,0.08)'
                    : 'rgba(74,124,68,0.18)'
                }`,
                color: msg.role === 'user' ? '#e0e0e0' : '#c8dcc5',
                fontSize: 13,
                lineHeight: 1.55,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              {msg.role === 'user' && msg.mode && (
                <div style={{ marginBottom: 6 }}>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    height: 18,
                    padding: '0 6px',
                    borderRadius: 999,
                    background: msg.mode === 'instruction' ? 'rgba(139,181,131,0.16)' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${msg.mode === 'instruction' ? 'rgba(139,181,131,0.24)' : 'rgba(255,255,255,0.10)'}`,
                    color: msg.mode === 'instruction' ? '#b7d7ae' : '#b8b8b8',
                    fontSize: 9,
                    fontFamily: "'SF Mono', monospace",
                    letterSpacing: '0.08em',
                  }}>
                    {msg.mode === 'instruction' ? 'CHANGE' : 'ASK'}
                  </span>
                </div>
              )}
              {msg.role === 'assistant'
                ? renderMarkdownish(msg.content, 'assistant')
                : (() => {
                    const { body, attachments } = splitMessageBodyAndAttachments(msg.content);
                    return (
                      <>
                        {body}
                        {attachments.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                            {attachments.map((att, i) => (
                              <span key={i} style={{
                                display: 'inline-flex', alignItems: 'center', gap: 4,
                                padding: '2px 7px', borderRadius: 6,
                                background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                                fontSize: 10, color: '#aaa',
                              }}>
                                {/\.(png|jpe?g|gif|webp|svg)$/i.test(att.name) ? <ImageIcon size={10} /> : <FileIcon size={10} />}
                                {att.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()
              }
            </div>
            <div
              style={{
                fontSize: 9,
                color: '#6f6f6f',
                marginTop: 3,
                textAlign: msg.role === 'user' ? 'right' : 'left',
                fontFamily: "'SF Mono', monospace",
              }}
            >
              {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        ))}

        {showPendingStatusBubble && (
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '85%',
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '14px 14px 14px 4px',
                background: 'rgba(255,255,255,0.035)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#d4d4d4',
                fontSize: 12,
                lineHeight: 1.5,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>{chatStatusSummary}</div>
              <span style={{ display: 'inline-flex', gap: 3, opacity: 0.9, flexShrink: 0 }}>
                <span style={{ ...dotStyle, animationDelay: '0ms' }} />
                <span style={{ ...dotStyle, animationDelay: '200ms' }} />
                <span style={{ ...dotStyle, animationDelay: '400ms' }} />
              </span>
            </div>
          </div>
        )}

        {streamingText && (
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '85%',
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '14px 14px 14px 4px',
                background: 'rgba(74,124,68,0.12)',
                border: '1px solid rgba(74,124,68,0.18)',
                color: '#c8dcc5',
                fontSize: 13,
                lineHeight: 1.6,
                wordBreak: 'break-word',
                overflowWrap: 'anywhere',
              }}
            >
              {renderMarkdownish(streamingText, 'assistant')}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
                <span style={{ display: 'inline-flex', gap: 3, opacity: 0.9 }}>
                  <span style={{ ...dotStyle, animationDelay: '0ms' }} />
                  <span style={{ ...dotStyle, animationDelay: '200ms' }} />
                  <span style={{ ...dotStyle, animationDelay: '400ms' }} />
                </span>
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Upload error */}
      {uploadError && (
        <div style={{
          padding: '6px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          borderTop: '1px solid rgba(180,90,90,0.25)',
          flexShrink: 0,
          background: 'rgba(120,40,40,0.12)',
        }}>
          <span style={{ fontSize: 11, color: '#e8a0a0' }}>{uploadError}</span>
          <button
            onClick={() => setUploadError(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 0, display: 'flex', flexShrink: 0 }}
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Pending attachments */}
      {pendingFiles.length > 0 && (
        <div
          style={{
            padding: '6px 12px 0',
            display: 'flex',
            gap: 6,
            flexWrap: 'wrap',
            borderTop: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        >
          {pendingFiles.map((att) => (
            <div
              key={att.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 8px',
                borderRadius: 6,
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontSize: 11,
                color: '#bbb',
                maxWidth: 180,
              }}
            >
              {att.mimeType.startsWith('image/') ? <ImageIcon size={12} /> : <FileIcon size={12} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {att.originalName}
              </span>
              <button
                onClick={() => removePendingFile(att.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#666',
                  padding: 0,
                  display: 'flex',
                  flexShrink: 0,
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input (Fix 2: proper alignment) */}
      <div
        style={{
          borderTop: pendingFiles.length > 0 ? 'none' : '1px solid rgba(255,255,255,0.06)',
          padding: '10px 12px',
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          style={{
            display: 'flex',
            alignItems: 'stretch',
            gap: 8,
            background: dragActive ? 'rgba(139,181,131,0.10)' : 'rgba(255,255,255,0.04)',
            border: dragActive ? '1px solid rgba(139,181,131,0.42)' : '1px solid rgba(255,255,255,0.08)',
            borderRadius: 16,
            padding: '8px',
            transition: 'border-color 150ms, background 150ms ease, box-shadow 150ms ease',
            boxShadow: dragActive ? '0 0 0 1px rgba(139,181,131,0.18)' : 'none',
            minHeight: 0,
            minWidth: 0,
            overflow: 'hidden',
          }}
        >
          <button
            onClick={handleFileSelect}
            disabled={composerLocked || uploading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 34,
              height: 34,
              borderRadius: 8,
              background: 'transparent',
              border: 'none',
              cursor: composerLocked || uploading ? 'default' : 'pointer',
              color: dragActive || uploading ? '#8bb583' : composerLocked ? '#333' : '#555',
              transition: 'color 100ms',
              flexShrink: 0,
            }}
            title={dragActive ? 'Drop files to attach' : uploading ? 'Uploading...' : echoThinking ? 'Wait for the active run to finish or stop it first' : 'Attach files'}
          >
            {uploading ? <Loader size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> : dragActive ? <Upload size={16} /> : <Paperclip size={16} />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={handleFileChange}
            style={{ display: 'none' }}
            accept="image/*,.pdf,.txt,.html,.css,.js,.json,.md,.svg"
          />

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, alignSelf: 'stretch' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '2px 4px 0 4px', flexWrap: 'wrap', minWidth: 0 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: 3, borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => setComposeMode('chat')}
                  disabled={composerLocked}
                  style={{
                    height: 26,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: composeMode === 'chat' ? 'rgba(255,255,255,0.12)' : 'transparent',
                    color: composeMode === 'chat' ? '#f0f0f0' : '#8c8c8c',
                    cursor: composerLocked ? 'default' : 'pointer',
                    fontSize: 10,
                    fontFamily: "'SF Mono', monospace",
                    letterSpacing: '0.08em',
                    opacity: composerLocked ? 0.6 : 1,
                  }}
                  title={echoThinking ? activeRunLockCopy : 'Ask mode keeps Echo in explanation mode unless you clearly request a change.'}
                >
                  ASK
                </button>
                <button
                  type="button"
                  onClick={() => setComposeMode('instruction')}
                  disabled={composerLocked}
                  style={{
                    height: 26,
                    padding: '0 10px',
                    borderRadius: 6,
                    border: 'none',
                    background: composeMode === 'instruction' ? 'rgba(139,181,131,0.18)' : 'transparent',
                    color: composeMode === 'instruction' ? '#b7d7ae' : '#8c8c8c',
                    cursor: composerLocked ? 'default' : 'pointer',
                    fontSize: 10,
                    fontFamily: "'SF Mono', monospace",
                    letterSpacing: '0.08em',
                    opacity: composerLocked ? 0.6 : 1,
                  }}
                  title={echoThinking ? activeRunLockCopy : 'Change mode tells Echo to edit the project or preview.'}
                >
                  CHANGE
                </button>
              </div>
              <div style={{ fontSize: 11, color: dragActive ? '#b7d7ae' : '#7f7f7f', whiteSpace: 'normal', flex: '1 1 180px', minWidth: 0, overflowWrap: 'anywhere', transition: 'color 150ms ease' }}>
                {echoThinking
                  ? activeRunLockCopy
                  : inputHint || (composeMode === 'chat' ? 'Chat does not change the preview.' : 'Change mode may update the preview.')}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                const ta = e.target;
                ta.style.height = 'auto';
                ta.style.height = `${Math.min(Math.max(ta.scrollHeight, 60), 220)}px`;
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={disabled ? 'Select a project first...' : echoThinking ? activeRunPlaceholderCopy : composeMode === 'chat' ? 'Ask Echo a question about this project...' : 'Describe the change you want Echo to make...'}
              disabled={composerLocked}
              rows={2}
              style={{
                flex: 'none',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e0e0e0',
                fontSize: 13,
                lineHeight: '20px',
                resize: 'none',
                minHeight: 60,
                maxHeight: 220,
                padding: '6px 10px',
                display: 'block',
                fontFamily: 'Inter, system-ui, sans-serif',
                overflowY: 'auto',
                alignSelf: 'stretch',
              }}
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={!canSend}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'flex-end',
              width: 38,
              height: 38,
              marginBottom: 6,
              marginRight: 2,
              borderRadius: 10,
              background: canSend ? 'rgba(255,255,255,0.1)' : 'transparent',
              border: 'none',
              cursor: canSend ? 'pointer' : 'default',
              color: canSend ? '#e0e0e0' : '#444',
              transition: 'all 100ms',
              flexShrink: 0,
            }}
          >
            {sending ? <Loader size={16} style={{ animation: 'spin 0.8s linear infinite' }} /> : <Send size={16} />}
          </button>
        </div>
      </div>

      </div>{/* end main chat column */}

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
};

const dotStyle: React.CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: '#8bb583',
  animation: 'bounce 1.4s ease-in-out infinite',
};

export default ChatRail;

