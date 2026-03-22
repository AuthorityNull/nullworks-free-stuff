import React, { createContext, useContext, useState, useCallback } from 'react';

export type PaneView =
  | 'idle'
  | 'file'
  | 'model'
  | 'mapping'
  | 'run'
  | 'approval'
  | 'research'
  | 'phase'
  | 'pipeline';

export interface FileSelection {
  path: string;
  name: string;
}

interface OutputPaneContextValue {
  view: PaneView;
  item: unknown;
  file: FileSelection | null;
  activeRunId: string | null;
  showPane: (view: PaneView, item?: unknown) => void;
  showFile: (file: FileSelection) => void;
  showPipeline: (runId: string) => void;
  clearPane: () => void;
}

const OutputPaneContext = createContext<OutputPaneContextValue | null>(null);

export const OutputPaneProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [view, setView] = useState<PaneView>('idle');
  const [item, setItem] = useState<unknown>(null);
  const [file, setFile] = useState<FileSelection | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const showPane = useCallback((v: PaneView, i?: unknown) => {
    setView(v);
    setItem(i ?? null);
    setFile(null);
    if (v !== 'pipeline') setActiveRunId(null);
  }, []);

  const showFile = useCallback((f: FileSelection) => {
    setView('file');
    setFile(f);
    setItem(null);
  }, []);

  const showPipeline = useCallback((runId: string) => {
    setView('pipeline');
    setActiveRunId(runId);
    setItem(null);
    setFile(null);
  }, []);

  const clearPane = useCallback(() => {
    setView('idle');
    setItem(null);
    setFile(null);
    setActiveRunId(null);
  }, []);

  return (
    <OutputPaneContext.Provider value={{ view, item, file, activeRunId, showPane, showFile, showPipeline, clearPane }}>
      {children}
    </OutputPaneContext.Provider>
  );
};

export const useOutputPane = (): OutputPaneContextValue => {
  const ctx = useContext(OutputPaneContext);
  if (!ctx) throw new Error('useOutputPane must be used inside OutputPaneProvider');
  return ctx;
};
