import React, { useState } from 'react';
import type { StudioProject } from '../../api/types';
import {
  Plus,
  ChevronLeft,
  LogOut,
  Home,
  Pencil,
  Check,
  X,
  Layers,
  Copy,
  Trash2,
  AlertTriangle,
} from 'lucide-react';

interface Props {
  projects: StudioProject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  actionPending?: string | null;
  width?: number;
  onClose: () => void;
  onNavigateHome: () => void;
  onLogout: () => void;
}

const ProjectDrawer: React.FC<Props> = ({
  projects,
  selectedId,
  onSelect,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  actionPending = null,
  width = 272,
  onClose,
  onNavigateHome,
  onLogout,
}) => {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setCreating(false);
  };

  const handleRename = (id: string) => {
    const name = editName.trim();
    if (!name) return;
    onRename(id, name);
    setEditingId(null);
    setEditName('');
  };

  const startEdit = (project: StudioProject) => {
    setEditingId(project.id);
    setEditName(project.name);
  };

  const actionsLocked = Boolean(actionPending);
  const isPending = (value: string) => actionPending === value;

  return (
    <div
      style={{
        position: 'relative',
        width,
        flexShrink: 0,
        borderRight: '1px solid rgba(255,255,255,0.06)',
        background: '#0c0c0c',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Layers size={14} style={{ color: '#888' }} />
          <span
            style={{
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              fontSize: 10,
              letterSpacing: '0.16em',
              color: '#888',
              textTransform: 'uppercase',
            }}
          >
            Projects
          </span>
        </div>
        <button onClick={onClose} style={iconBtnStyle} title="Collapse drawer">
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* Project List */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {projects.map((project) => {
          const isSelected = project.id === selectedId;
          const isEditing = editingId === project.id;
          const showHoverActions = !isSelected && hoveredId === project.id;

          return (
            <div
              key={project.id}
              style={{
                display: 'flex',
                alignItems: isSelected && !isEditing ? 'stretch' : 'center',
                gap: 6,
                padding: isSelected && !isEditing ? '8px 8px' : '0 8px',
                minHeight: isSelected && !isEditing ? 62 : 38,
                cursor: 'pointer',
                background: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderLeft: isSelected
                  ? '2px solid rgba(255,255,255,0.3)'
                  : '2px solid transparent',
                transition: 'all 80ms',
                position: 'relative',
              }}
              onClick={() => !isEditing && onSelect(project.id)}
              onMouseEnter={() => setHoveredId(project.id)}
              onMouseLeave={() => setHoveredId((prev) => (prev === project.id ? null : prev))}
            >
              {isEditing ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
                  <input
                    autoFocus
                    disabled={actionsLocked}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(project.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 4,
                      padding: '3px 6px',
                      color: '#e0e0e0',
                      fontSize: 12,
                      fontFamily: 'Inter, system-ui, sans-serif',
                      outline: 'none',
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); handleRename(project.id); }}
                    disabled={actionsLocked}
                    style={{ ...iconBtnSmall, color: '#6b9e64', opacity: actionsLocked ? 0.45 : 1, cursor: actionsLocked ? 'default' : 'pointer' }}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingId(null); }}
                    style={{ ...iconBtnSmall, color: '#888' }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ) : isSelected ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0, justifyContent: 'center' }}>
                  <div
                    style={{
                      minWidth: 0,
                      fontSize: 12,
                      color: '#e0e0e0',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {project.name}
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); onDuplicate(project.id); }}
                      style={projectActionBtnStyle}
                      title="Duplicate project"
                    >
                      <Copy size={11} />
                      Duplicate
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); startEdit(project); }}
                      style={projectActionBtnStyle}
                      title="Rename project"
                    >
                      <Pencil size={11} />
                      Rename
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(project.id); }}
                      style={{ ...projectActionBtnStyle, color: '#d3a0a0', border: '1px solid rgba(153,63,63,0.2)', background: 'rgba(153,63,63,0.08)' }}
                      title="Delete project"
                    >
                      <Trash2 size={11} />
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      color: '#999',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      paddingRight: showHoverActions ? 98 : 0,
                    }}
                  >
                    {project.name}
                  </div>
                  {showHoverActions && (
                    <div
                      style={{
                        position: 'absolute',
                        right: 8,
                        top: '50%',
                        transform: 'translateY(-50%)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        flexShrink: 0,
                        background: 'rgba(12,12,12,0.98)',
                        borderRadius: 6,
                        padding: '2px 4px',
                        border: '1px solid rgba(255,255,255,0.08)',
                        zIndex: 2,
                      }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onDuplicate(project.id); }}
                        disabled={actionsLocked}
                        style={{ ...iconBtnSmall, opacity: actionsLocked ? 0.45 : 1, cursor: actionsLocked ? 'default' : 'pointer' }}
                        title={isPending(`duplicate:${project.id}`) ? 'Duplicating project…' : 'Duplicate project'}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); startEdit(project); }}
                        disabled={actionsLocked}
                        style={{ ...iconBtnSmall, opacity: actionsLocked ? 0.45 : 1, cursor: actionsLocked ? 'default' : 'pointer' }}
                        title={isPending(`rename:${project.id}`) ? 'Renaming project…' : 'Rename'}
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(project.id); }}
                        disabled={actionsLocked}
                        style={{ ...iconBtnSmall, color: '#c07070', opacity: actionsLocked ? 0.45 : 1, cursor: actionsLocked ? 'default' : 'pointer' }}
                        title={isPending(`delete:${project.id}`) ? 'Deleting project…' : 'Delete project'}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* Create new */}
        {creating ? (
          <div style={{ padding: '6px 8px' }}>
            <input
              autoFocus
              disabled={actionsLocked}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') { setCreating(false); setNewName(''); }
              }}
              placeholder="Project name..."
              style={{
                width: '100%',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 4,
                padding: '6px 8px',
                color: '#e0e0e0',
                fontSize: 12,
                fontFamily: 'Inter, system-ui, sans-serif',
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <button
                onClick={handleCreate}
                disabled={actionsLocked}
                style={{ ...smallBtnStyle, opacity: actionsLocked ? 0.45 : 1, cursor: actionsLocked ? 'default' : 'pointer' }}
              >
                {isPending('create') ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setCreating(false); setNewName(''); }}
                style={{ ...smallBtnStyle, color: '#666', background: 'transparent' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            disabled={actionsLocked}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: '8px 12px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: '#666',
              fontSize: 12,
              fontFamily: 'Inter, system-ui, sans-serif',
              transition: 'color 100ms',
            }}
          >
            <Plus size={14} />
            New project
          </button>
        )}
      </div>

      {confirmDeleteId && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(5,5,5,0.82)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 14,
            zIndex: 20,
          }}
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            style={{
              width: '100%',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.08)',
              background: '#0e0e0e',
              boxShadow: '0 16px 48px rgba(0,0,0,0.45)',
              padding: 14,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <AlertTriangle size={14} style={{ color: '#d6a35f' }} />
              <span style={{ fontFamily: "'SF Mono', monospace", fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#c8c8c8' }}>
                Delete project?
              </span>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: '#8a8a8a', marginBottom: 14 }}>
              This permanently removes the project, chat history, checkpoints, attachments, and current render files.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setConfirmDeleteId(null)}
                style={{ ...smallBtnStyle, background: 'transparent', color: '#777' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onDelete(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                disabled={actionsLocked}
                style={{
                  ...smallBtnStyle,
                  background: 'rgba(153,63,63,0.16)',
                  border: '1px solid rgba(153,63,63,0.28)',
                  color: '#d8a0a0',
                }}
              >
                I'm sure
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Footer */}
      <div
        style={{
          borderTop: '1px solid rgba(255,255,255,0.06)',
          padding: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <button onClick={onNavigateHome} style={iconBtnStyle} title="Dashboard">
          <Home size={14} />
        </button>
        <button onClick={onLogout} style={iconBtnStyle} title="Logout">
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
};

const iconBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  color: '#666',
  cursor: 'pointer',
};

const iconBtnSmall: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 24,
  height: 24,
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  color: '#999',
  cursor: 'pointer',
  flexShrink: 0,
};

const smallBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 4,
  color: '#ccc',
  fontSize: 11,
  fontFamily: "'SF Mono', monospace",
  cursor: 'pointer',
};

const projectActionBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  height: 24,
  padding: '0 8px',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 999,
  color: '#b8b8b8',
  fontSize: 10,
  fontFamily: "'SF Mono', monospace",
  letterSpacing: '0.03em',
  cursor: 'pointer',
};

export default ProjectDrawer;
