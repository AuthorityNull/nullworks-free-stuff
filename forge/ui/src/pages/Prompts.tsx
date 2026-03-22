import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Save, Play, ChevronDown, ChevronRight, FileText, AlertTriangle } from 'lucide-react';
import apiClient from '../api/client';
import type { FileTreeNode, PromptFileEntry, PromptTreeAgent } from '../api/types';
import { useToast } from '../components/Toast';

interface SelectedFile {
  agentLabel: string;
  file: PromptFileEntry;
}

interface PromptTreeSection {
  id: string;
  label: string;
  files: PromptFileEntry[];
}

function flattenFiles(nodes: FileTreeNode[]): PromptFileEntry[] {
  return nodes.flatMap((node) => {
    if (node.type === 'file') {
      return [{ name: node.name, path: node.path, size: node.size, modifiedAt: node.modifiedAt }];
    }
    return flattenFiles(node.children || []);
  });
}

function normalizePromptSections(tree: unknown): PromptTreeSection[] {
  if (!Array.isArray(tree)) return [];

  return tree.map((entry) => {
    const item = entry as PromptTreeAgent & FileTreeNode;
    if (Array.isArray(item.files)) {
      return {
        id: item.agent,
        label: item.label,
        files: item.files,
      };
    }

    return {
      id: item.path || item.name,
      label: item.label || item.name,
      files: flattenFiles(item.children || []),
    };
  }).filter((section) => section.files.length > 0);
}

const Prompts: React.FC = () => {
  const { addToast } = useToast();
  const [tree, setTree] = useState<PromptTreeSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [content, setContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [fileLoading, setFileLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [applying, setApplying] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Load file tree
  useEffect(() => {
    apiClient.getPromptTree()
      .then((resp) => {
        const agents = normalizePromptSections(resp.tree);
        setTree(agents);
        setExpandedAgents(new Set(agents.map((a) => a.id)));
        if (agents.length > 0 && agents[0].files.length > 0) {
          setSelected({ agentLabel: agents[0].label, file: agents[0].files[0] });
        }
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to load file tree';
        if (msg.includes('404')) {
          setTreeError('Prompt tree endpoint not available (404). Backend needs /api/v1/prompts/tree.');
        } else {
          setTreeError(msg);
        }
      })
      .finally(() => setLoading(false));
  }, []);

  // Load file content
  const loadFile = useCallback(async (file: PromptFileEntry) => {
    setFileLoading(true);
    try {
      const resp = await apiClient.getPromptFile(file.path);
      setContent(resp.content || '');
      setOriginalContent(resp.content || '');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load file';
      if (msg.includes('404')) {
        setContent('');
        setOriginalContent('');
        addToast('File endpoint not available (404)', 'warning');
      } else {
        addToast(msg, 'error');
        setContent('');
        setOriginalContent('');
      }
    } finally {
      setFileLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    if (selected) loadFile(selected.file);
  }, [selected, loadFile]);

  const isModified = content !== originalContent;

  const handleSave = useCallback(async () => {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await apiClient.updatePromptFile(selected.file.path, content);
      setOriginalContent(content);
      addToast('File saved', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      if (msg.includes('404')) {
        addToast('Save endpoint unavailable', 'warning');
      } else {
        addToast(msg, 'error');
      }
    } finally {
      setSaving(false);
    }
  }, [selected, content, saving, addToast]);

  // Keyboard shortcut: Cmd/Ctrl+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const handleApply = async () => {
    const currentSelection = selected;
    if (isModified && currentSelection) {
      setSaving(true);
      try {
        await apiClient.updatePromptFile(currentSelection.file.path, content);
        setOriginalContent(content);
      } catch {
        addToast('Save before apply failed', 'error');
        setSaving(false);
        return;
      }
      setSaving(false);
    }

    if (!currentSelection) {
      addToast('Select a prompt file first', 'warning');
      return;
    }

    const path = currentSelection.file.path;
    const parts = path.split('/');
    const agentId = parts.length >= 2 ? parts[1] : '';
    const fileName = parts[parts.length - 1] || '';
    const modelId = fileName.replace(/\.(md|txt)$/i, '');

    if (!agentId || !modelId) {
      addToast('Could not derive exact prompt target from file path', 'error');
      return;
    }

    setApplying(true);
    try {
      const run = await apiClient.runPipeline({
        agentId,
        modelId,
        promptPath: path,
      });
      await apiClient.applyPrompts({
        runId: run.runId,
        agentId,
        modelId,
        promptPath: path,
        apply: content,
      });
      addToast('Prompt applied to exact file target', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Apply failed';
      addToast(msg, 'error');
    } finally {
      setApplying(false);
    }
  };

  const toggleAgent = (agentId: string) => {
    setExpandedAgents(prev => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  };

  const selectFile = (agent: PromptTreeSection, file: PromptFileEntry) => {
    setSelected({ agentLabel: agent.label, file });
  };

  const formatSize = (bytes?: number): string => {
    if (bytes === undefined) return '';
    if (bytes < 1024) return `${bytes}B`;
    return `${(bytes / 1024).toFixed(1)}K`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <span className="loading-cursor" />
      </div>
    );
  }

  const lines = content.split('\n');

  return (
    <div className="flex h-full" style={{ minHeight: 0 }}>
      {/* Left panel - file tree */}
      <div
        className="flex flex-col flex-shrink-0 overflow-auto"
        style={{
          width: 280,
          borderRight: '1px solid var(--color-border)',
          backgroundColor: 'var(--color-sidebar)',
        }}
      >
        <div
          className="px-4 flex items-center"
          style={{
            height: 'var(--header-height)',
            minHeight: 'var(--header-height)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <h1
            className="font-ui font-semibold uppercase"
            style={{ fontSize: 'var(--text-sm)', letterSpacing: '0.15em', color: 'var(--color-text-primary)' }}
          >
            System Prompts
          </h1>
        </div>

        <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
          <p className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
            Real prompt files live here. Select a file from the tree, edit it, save it, then apply to trigger the real backend prompt workflow.
          </p>
        </div>
        <div className="flex-1 py-2 overflow-auto">
          {treeError ? (
            <div className="px-4 py-6">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle size={14} style={{ color: 'var(--color-warning)' }} />
                <span className="font-mono uppercase" style={{ fontSize: '10px', letterSpacing: '0.15em', color: 'var(--color-warning)' }}>
                  Unavailable
                </span>
              </div>
              <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: '1.5' }}>
                {treeError}
              </span>
            </div>
          ) : tree.length === 0 ? (
            <div className="px-4 py-6">
              <span className="font-mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                No prompt files found
              </span>
            </div>
          ) : (
            tree.map((agent) => {
              const isExpanded = expandedAgents.has(agent.id);
              return (
                <div key={agent.id}>
                  <button
                    onClick={() => toggleAgent(agent.id)}
                    className="flex items-center gap-2 w-full px-4 py-2 text-left"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      transition: 'background var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                      : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                    }
                    <span
                      className="font-mono font-medium"
                      style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}
                    >
                      {agent.label}
                    </span>
                    <span
                      className="font-mono"
                      style={{ fontSize: '10px', color: 'var(--color-text-disabled)', marginLeft: 'auto' }}
                    >
                      {agent.files.length}
                    </span>
                  </button>

                  {isExpanded && agent.files.map((file) => {
                    const isActive = selected?.file.path === file.path;
                    return (
                      <button
                        key={file.path}
                        onClick={() => selectFile(agent, file)}
                        className="flex items-center gap-2 w-full pl-9 pr-4 py-1.5 text-left"
                        style={{
                          background: isActive ? 'var(--color-surface-elevated)' : 'transparent',
                          border: 'none',
                          borderLeftStyle: 'solid',
                          borderLeftWidth: 2,
                          borderLeftColor: isActive ? 'var(--color-accent)' : 'transparent',
                          cursor: 'pointer',
                          transition: 'background var(--transition-fast)',
                        }}
                        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-surface-hover)'; }}
                        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <FileText
                          size={11}
                          style={{
                            color: isActive ? 'var(--color-accent)' : 'var(--color-text-disabled)',
                            flexShrink: 0,
                          }}
                        />
                        <span
                          className="font-mono truncate"
                          style={{
                            fontSize: '11px',
                            color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                          }}
                        >
                          {file.name}
                        </span>
                        <span
                          className="font-mono ml-auto"
                          style={{ fontSize: '9px', color: 'var(--color-text-disabled)', flexShrink: 0 }}
                        >
                          {formatSize(file.size)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right panel - editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div
          className="flex items-center justify-between px-4"
          style={{
            height: 'var(--header-height)',
            minHeight: 'var(--header-height)',
            borderBottom: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <div className="flex items-center gap-3">
            {selected && (
              <>
                <span className="font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                  {selected.file.name}
                </span>
                <span className="font-mono" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                  {selected.agentLabel}
                </span>
              </>
            )}
            {isModified && (
              <span
                className="font-mono uppercase"
                style={{
                  fontSize: '10px',
                  color: 'var(--color-warning)',
                  letterSpacing: '0.15em',
                }}
              >
                MODIFIED
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              className="btn btn--primary btn--compact"
              onClick={handleSave}
              disabled={saving || !isModified}
            >
              <Save size={12} /> Save
            </button>
            <button
              className="btn btn--secondary btn--compact"
              onClick={handleApply}
              disabled={applying}
            >
              <Play size={12} /> Apply
            </button>
          </div>
        </div>

        {/* Editor area */}
        <div className="flex-1 overflow-auto" style={{ backgroundColor: 'var(--color-bg)' }}>
          {fileLoading ? (
            <div className="flex items-center justify-center h-full">
              <span className="loading-cursor" />
            </div>
          ) : selected ? (
            <div className="flex h-full">
              {/* Line numbers */}
              <div
                className="flex-shrink-0 py-3 px-3 text-right select-none"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '11px',
                  color: 'var(--color-text-disabled)',
                  lineHeight: '1.6',
                  minWidth: 44,
                  borderRight: '1px solid var(--color-border-subtle)',
                  backgroundColor: 'var(--color-surface)',
                }}
              >
                {lines.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="flex-1 p-3 resize-none"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  color: 'var(--color-text-primary)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  outline: 'none',
                  lineHeight: '1.6',
                  minHeight: '100%',
                }}
                spellCheck={false}
              />
            </div>
          ) : (
            <div className="empty-state">
              <FileText size={32} style={{ color: 'var(--color-text-disabled)', marginBottom: 12 }} />
              <span className="font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
                Select a prompt file to edit
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Prompts;
