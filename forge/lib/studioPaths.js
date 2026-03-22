/**
 * Pure path helpers for Studio project directories and URLs.
 * No state, no side-effects - just path arithmetic.
 */
const path = require('node:path');

function createStudioPaths(studioProjectsRoot, studioCanvasBasePath) {
  function slugifyProjectName(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'untitled-project';
  }

  function projectDir(projectId) {
    return path.join(studioProjectsRoot, projectId);
  }

  function projectManifestPath(projectId) {
    return path.join(projectDir(projectId), 'project.json');
  }

  function currentRenderDir(projectId) {
    return path.join(projectDir(projectId), 'renders', 'current');
  }

  function currentRenderEntryPath(projectId) {
    return path.join(currentRenderDir(projectId), 'index.html');
  }

  function sourceDir(projectId) {
    return path.join(projectDir(projectId), 'source');
  }

  function reactSourceEntryPath(projectId) {
    return path.join(sourceDir(projectId), 'App.jsx');
  }

  function versionsDir(projectId) {
    return path.join(projectDir(projectId), 'renders', 'versions');
  }

  function renderEntryPathForProject(projectId) {
    return path.join(studioProjectsRoot, projectId, 'renders', 'current', 'index.html');
  }

  function canvasUrl(projectId, cacheBust = false) {
    const base = `${studioCanvasBasePath}/${encodeURIComponent(projectId)}/renders/current/index.html`;
    return cacheBust ? `${base}?t=${Date.now()}` : base;
  }

  function versionCanvasUrl(projectId, versionId, cacheBust = false) {
    const base = `${studioCanvasBasePath}/${encodeURIComponent(projectId)}/renders/versions/${encodeURIComponent(versionId)}/index.html`;
    return cacheBust ? `${base}?t=${Date.now()}` : base;
  }

  function assetsDir(projectId) {
    return path.join(projectDir(projectId), 'assets');
  }

  function legacyCanvasEntryPath() {
    return process.env.ECHO_LEGACY_CANVAS_PATH || '/var/lib/forge/echo-canvas/index.html';
  }

  return {
    slugifyProjectName,
    projectDir,
    projectManifestPath,
    currentRenderDir,
    currentRenderEntryPath,
    sourceDir,
    reactSourceEntryPath,
    versionsDir,
    renderEntryPathForProject,
    canvasUrl,
    versionCanvasUrl,
    assetsDir,
    legacyCanvasEntryPath,
  };
}

module.exports = { createStudioPaths };
