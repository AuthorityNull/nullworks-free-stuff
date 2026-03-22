import React, { createContext, useContext, useState, useCallback } from 'react';

export type PanelType =
  | 'model'
  | 'research'
  | 'prompt'
  | 'mapping'
  | 'approval'
  | 'run'
  | 'phase'
  | '';

export type RightPanelTab = 'overview' | 'run' | 'model' | 'phase';

interface RightPanelContextValue {
  panelOpen: boolean;
  panelType: PanelType;
  panelItem: unknown;
  activeTab: RightPanelTab;
  openPanel: (type: PanelType, item: unknown, preferredTab?: RightPanelTab) => void;
  setActiveTab: (tab: RightPanelTab) => void;
  closePanel: () => void;
}

const RightPanelContext = createContext<RightPanelContextValue | null>(null);

export const RightPanelProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelType, setPanelType] = useState<PanelType>('');
  const [panelItem, setPanelItem] = useState<unknown>(null);
  const [activeTab, setActiveTab] = useState<RightPanelTab>('overview');

  const openPanel = useCallback((type: PanelType, item: unknown, preferredTab?: RightPanelTab) => {
    setPanelType(type);
    setPanelItem(item);
    setPanelOpen(true);
    setActiveTab(preferredTab || (type === 'run' || type === 'approval' ? 'run' : type === 'model' ? 'model' : type === 'phase' ? 'phase' : 'overview'));
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setTimeout(() => {
      setPanelType('');
      setPanelItem(null);
    }, 150);
  }, []);

  return (
    <RightPanelContext.Provider
      value={{ panelOpen, panelType, panelItem, activeTab, openPanel, setActiveTab, closePanel }}
    >
      {children}
    </RightPanelContext.Provider>
  );
};

export const useRightPanel = (): RightPanelContextValue => {
  const ctx = useContext(RightPanelContext);
  if (!ctx) throw new Error('useRightPanel must be used inside RightPanelProvider');
  return ctx;
};
