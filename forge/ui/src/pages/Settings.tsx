import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Globe } from 'lucide-react';
import apiClient from '../api/client';
import type { Webhook, HealthResponse } from '../api/types';
import { useToast } from '../components/Toast';

const Settings: React.FC = () => {
  const { addToast } = useToast();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // New webhook form
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');
  const [newEvents, setNewEvents] = useState('prompt.applied, run.completed');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      apiClient.getWebhooks().catch(() => []),
      apiClient.health().catch(() => null),
    ])
      .then(([wh, h]) => {
        setWebhooks(wh);
        setHealth(h);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async () => {
    if (!newUrl.trim()) {
      addToast('Callback URL is required', 'warning');
      return;
    }
    setCreating(true);
    try {
      await apiClient.createWebhook({
        name: newName.trim() || 'Webhook',
        callbackUrl: newUrl.trim(),
        events: newEvents.split(',').map((s) => s.trim()).filter(Boolean),
        active: true,
      });
      const updated = await apiClient.getWebhooks();
      setWebhooks(updated);
      setNewName('');
      setNewUrl('');
      setNewEvents('prompt.applied, run.completed');
      setShowForm(false);
      addToast('Webhook created', 'success');
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Create failed', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiClient.deleteWebhook(id);
      const updated = await apiClient.getWebhooks();
      setWebhooks(updated);
      addToast('Webhook deleted', 'success');
    } catch {
      addToast('Delete failed', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full p-12">
        <span className="loading-cursor" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-full p-6" style={{ width: '100%' }}>
      <div className="w-full max-w-4xl">
        <h1
          className="font-ui font-semibold mb-6"
          style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text-primary)', letterSpacing: '0.05em' }}
        >
          Settings
        </h1>

        {/* Webhooks */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <span className="section-number">01</span>
              <span className="label">WEBHOOKS</span>
            </div>
            <button
              className="btn btn--secondary btn--compact"
              onClick={() => setShowForm(!showForm)}
            >
              <Plus size={12} /> {showForm ? 'Cancel' : 'Add'}
            </button>
          </div>

          <p className="font-mono mb-3" style={{ fontSize: '10px', color: 'var(--color-text-muted)', lineHeight: '1.6' }}>
            Register callback endpoints here. Forge posts JSON to these URLs when selected pipeline events fire.
          </p>

          {showForm && (
            <div
              className="card mb-4 space-y-3 animate-fade-in"
              style={{ backgroundColor: 'transparent', borderColor: 'rgba(172, 170, 158, 0.16)' }}
            >
              <div>
                <span className="label">NAME</span>
                <input
                  className="input mt-1"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Webhook label"
                />
              </div>
              <div>
                <span className="label">CALLBACK URL</span>
                <input
                  className="input mt-1"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://your-app.com/webhook"
                />
              </div>
              <div>
                <span className="label">EVENT FILTER</span>
                <input
                  className="input mt-1"
                  value={newEvents}
                  onChange={(e) => setNewEvents(e.target.value)}
                  placeholder="prompt.applied, run.completed"
                />
                <p className="font-mono mt-1" style={{ fontSize: '9px', color: 'var(--color-text-disabled)' }}>
                  Comma-separated event names.
                </p>
              </div>
              <button
                className="btn btn--primary btn--compact"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? <span className="loading-cursor" style={{ width: 6, height: 12 }} /> : 'Create webhook'}
              </button>
            </div>
          )}

          {webhooks.length > 0 ? (
            <div className="space-y-2">
              {webhooks.map((wh) => (
                <div
                  key={wh.id}
                  className="card flex items-center justify-between"
                  style={{ padding: 'var(--space-4)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Globe size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
                      <span className="font-mono truncate" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                        {wh.name}
                      </span>
                      <span
                        className="status-dot"
                        style={{ backgroundColor: wh.active ? 'var(--color-success)' : 'var(--color-text-disabled)' }}
                      />
                    </div>
                    <div className="font-mono mt-1 truncate" style={{ fontSize: '10px', color: 'var(--color-text-muted)' }}>
                      {wh.callbackUrlRedacted ? '[hidden URL]' : wh.callbackUrl}
                    </div>
                    <div className="font-mono mt-1" style={{ fontSize: '10px', color: 'var(--color-text-disabled)' }}>
                      Events: {wh.events.join(', ')}
                    </div>
                  </div>
                  <button
                    className="btn btn--danger btn--compact ml-3"
                    onClick={() => handleDelete(wh.id)}
                    title="Delete webhook"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div
              className="card"
              style={{ padding: 'var(--space-8)', textAlign: 'center' }}
            >
              <span className="font-mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                No webhooks configured yet. Use the Add button above to connect Forge to another system.
              </span>
            </div>
          )}
        </section>

        {/* System Config (read-only) */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <span className="section-number">02</span>
            <span className="label">SYSTEM CONFIG</span>
          </div>
          <div className="card">
            {health ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="label">SERVICE</span>
                  <span className="font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                    {health.service}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="label">STATUS</span>
                  <span className="font-mono" style={{ fontSize: 'var(--text-sm)', color: health.status === 'ok' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                    {health.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="label">VERSION</span>
                  <span className="font-mono" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                    v1.0.0
                  </span>
                </div>
              </div>
            ) : (
              <span className="font-mono" style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                Could not load system info
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default Settings;
