import { useCallback, useEffect, useMemo, useState } from 'react';
import apiClient from '../../api/client';

interface PromptTreeNode {
  name: string;
  label?: string;
  type?: string;
  path?: string;
  children?: PromptTreeNode[];
}

interface PromptFile {
  path: string;
  label: string;
  relativePath: string;
  name: string;
}

interface PromptSaveNotice {
  tone: 'success' | 'error';
  text: string;
}

const PROMPT_FILE_ORDER = [
  'AGENTS.md',
  'BOOTSTRAP.md',
  'HEARTBEAT.md',
  'IDENTITY.md',
  'MEMORY.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
];
const PROMPT_FILE_ALLOWLIST = new Set(PROMPT_FILE_ORDER);
const DEFAULT_AGENT = 'echo-live-prompt';

function flattenPromptFiles(nodes: PromptTreeNode[], prefix = ''): PromptFile[] {
  const result: PromptFile[] = [];
  for (const node of nodes) {
    if (node.type === 'file' && node.path) {
      const relativePath = prefix ? `${prefix}/${node.name}` : node.name;
      if (!prefix && PROMPT_FILE_ALLOWLIST.has(node.name)) {
        result.push({
          name: node.name,
          path: node.path,
          relativePath,
          label: relativePath,
        });
      }
    } else if (node.type === 'dir' && Array.isArray(node.children)) {
      const nextPrefix = prefix ? `${prefix}/${node.name}` : node.name;
      result.push(...flattenPromptFiles(node.children, nextPrefix));
    }
  }
  return result.sort((a, b) => {
    const aBase = a.relativePath.split('/').pop() || a.relativePath;
    const bBase = b.relativePath.split('/').pop() || b.relativePath;
    const aIdx = PROMPT_FILE_ORDER.indexOf(aBase);
    const bIdx = PROMPT_FILE_ORDER.indexOf(bBase);
    if (aIdx !== -1 || bIdx !== -1) {
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      if (aIdx !== bIdx) return aIdx - bIdx;
    }
    return a.relativePath.localeCompare(b.relativePath);
  });
}

export function useStudioPromptDock() {
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptTree, setPromptTree] = useState<PromptTreeNode[]>([]);
  const [promptAgent, setPromptAgent] = useState(DEFAULT_AGENT);
  const [promptFiles, setPromptFiles] = useState<PromptFile[]>([]);
  const [promptSelectedFile, setPromptSelectedFile] = useState('');
  const [promptContent, setPromptContent] = useState('');
  const [promptDirty, setPromptDirty] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptLoadError, setPromptLoadError] = useState<string | null>(null);
  const [promptSaveNotice, setPromptSaveNotice] = useState<PromptSaveNotice | null>(null);
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [hoveredPromptFile, setHoveredPromptFile] = useState<string | null>(null);

  useEffect(() => {
    if (!promptSaveNotice) return undefined;
    const timer = window.setTimeout(() => setPromptSaveNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [promptSaveNotice]);

  const resetPromptFiles = useCallback(() => {
    setPromptFiles([]);
    setPromptSelectedFile('');
    setPromptContent('');
    setPromptDirty(false);
    setPromptLoadError('No live Echo prompt files are available to load.');
  }, []);

  const loadPromptFile = useCallback(async (filePath: string) => {
    setPromptLoading(true);
    setPromptSelectedFile(filePath);
    setPromptDirty(false);
    setPromptLoadError(null);
    setPromptSaveNotice(null);
    try {
      const res = await apiClient.getPromptFile(filePath);
      if (res.ok) {
        setPromptContent(res.content ?? '');
      } else {
        setPromptLoadError('Failed to load the selected prompt file.');
      }
    } catch (err: any) {
      setPromptLoadError(err?.message || 'Failed to load the selected prompt file.');
    } finally {
      setPromptLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!promptOpen) return;

    const applyFiles = (files: PromptFile[], agentName = DEFAULT_AGENT) => {
      setPromptAgent(agentName);
      setPromptFiles(files);
      setPromptLoadError(null);
      const preferred = files.find((file) => file.path === promptSelectedFile) || files[0];
      if (preferred) {
        void loadPromptFile(preferred.path);
        return;
      }
      resetPromptFiles();
    };

    void apiClient.getPromptTree()
      .then((res: any) => {
        if (res.ok && Array.isArray(res.tree)) {
          setPromptTree(res.tree);
          const agent = res.tree.find((entry: PromptTreeNode) => entry.name === DEFAULT_AGENT)
            || res.tree.find((entry: PromptTreeNode) => entry.name === promptAgent)
            || res.tree[0];
          if (agent) {
            applyFiles(flattenPromptFiles(agent.children || []), agent.name);
            return;
          }
        }
        setPromptTree([]);
        applyFiles([]);
      })
      .catch(() => {
        setPromptTree([]);
        applyFiles([]);
      });
  }, [loadPromptFile, promptAgent, promptOpen, promptSelectedFile, resetPromptFiles]);

  useEffect(() => {
    const agent = promptTree.find((entry) => entry.name === promptAgent);
    if (!agent) return;
    const files = flattenPromptFiles(agent.children || []);
    setPromptFiles(files);
    if (files.length === 0) {
      resetPromptFiles();
      return;
    }
    const preferred = files.find((file) => file.path === promptSelectedFile) || files[0];
    if (preferred && preferred.path !== promptSelectedFile) {
      void loadPromptFile(preferred.path);
    }
  }, [loadPromptFile, promptAgent, promptSelectedFile, promptTree, resetPromptFiles]);

  const savePromptFile = useCallback(async () => {
    if (!promptSelectedFile || promptSaving) return;
    setPromptSaving(true);
    setPromptSaveNotice(null);
    try {
      await apiClient.updatePromptFile(promptSelectedFile, promptContent);
      setPromptDirty(false);
      setPromptSaveNotice({ tone: 'success', text: 'Prompt saved.' });
    } catch (err: any) {
      setPromptSaveNotice({ tone: 'error', text: err?.message || 'Failed to save prompt.' });
    } finally {
      setPromptSaving(false);
    }
  }, [promptContent, promptSaving, promptSelectedFile]);

  const onPromptContentChange = useCallback((value: string) => {
    setPromptContent(value);
    setPromptDirty(true);
  }, []);

  const onPromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 's') {
      event.preventDefault();
      void savePromptFile();
    }
  }, [savePromptFile]);

  const onSelectFile = useCallback((filePath: string) => {
    setFileMenuOpen(false);
    void loadPromptFile(filePath);
  }, [loadPromptFile]);

  const selectedPromptFileLabel = useMemo(
    () => promptFiles.find((file) => file.path === promptSelectedFile)?.label || promptSelectedFile || 'No file selected',
    [promptFiles, promptSelectedFile],
  );

  return {
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
  };
}
