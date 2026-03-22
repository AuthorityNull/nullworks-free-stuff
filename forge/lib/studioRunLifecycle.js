const path = require('path');

function recordStudioRunProgress(run, stage, message, extra = {}, deps = {}) {
  const nowIso = deps.nowIso || (() => new Date().toISOString());
  const randomUUID = deps.randomUUID || (() => `id_${Date.now()}`);
  if (!run) return;
  run.updatedAt = nowIso();
  if (typeof message === 'string' && message.trim()) {
    run.progressText = message;
  }
  if (Object.prototype.hasOwnProperty.call(extra, 'partialText')) {
    run.partialText = typeof extra.partialText === 'string' && extra.partialText.trim()
      ? extra.partialText
      : null;
  }
  if (extra.clearPartialText) {
    run.partialText = null;
  }
  const tone = extra.tone || (stage === 'failed' ? 'error' : stage === 'completed' ? 'success' : 'info');
  if (typeof message === 'string' && message.trim()) {
    if (!Array.isArray(run.timeline)) run.timeline = [];
    const tail = run.timeline[run.timeline.length - 1];
    if (!tail || tail.stage !== stage || tail.message !== message || tail.tone !== tone) {
      run.timeline.push({
        id: `${Date.now()}-${randomUUID().slice(0, 6)}`,
        stage,
        message,
        tone,
        ts: run.updatedAt,
      });
      if (run.timeline.length > 20) run.timeline = run.timeline.slice(-20);
    }
  }
}

function clearStudioRunStreamingState(run) {
  if (!run) return;
  run.partialText = null;
  run.rawPartialText = '';
  run._streamSource = null;
}

function pushStudioRunPartial(run, source, chunk, deps = {}) {
  const mergeStudioStreamText = deps.mergeStudioStreamText || ((previous, next) => `${previous || ''}${next || ''}`);
  const sanitizeStudioAssistantText = deps.sanitizeStudioAssistantText || ((value) => String(value || ''));
  const emitStudioEvent = deps.emitStudioEvent || (() => {});
  const nowIso = deps.nowIso || (() => new Date().toISOString());
  if (!run) return;
  const text = String(chunk || '');
  if (!text) return;
  if (run._streamSource && run._streamSource !== source) return;
  if (!run._streamSource) run._streamSource = source;
  run.rawPartialText = mergeStudioStreamText(run.rawPartialText, text);
  const sanitized = sanitizeStudioAssistantText(run.rawPartialText);
  run.partialText = sanitized || run.rawPartialText;
  run.updatedAt = nowIso();
  emitStudioEvent('run.progress', run.projectId, {
    runId: run.id,
    stage: 'streaming',
    message: 'Echo is replying…',
    partialText: sanitized || run.rawPartialText,
  });
}

function extractHtmlFromEchoResponse(text) {
  const source = String(text || '');
  const htmlDocMatch = source.match(/<!doctype html[\s\S]*<\/html>/i)
    || source.match(/<html[\s\S]*<\/html>/i);
  if (htmlDocMatch) return htmlDocMatch[0];

  const fencedMatch = source.match(/```html\s*\n([\s\S]*?)```/i);
  if (fencedMatch) return fencedMatch[1].trim();

  const anyFenced = source.match(/```\s*\n(<!doctype|<html)([\s\S]*?)```/i);
  if (anyFenced) return (anyFenced[1] + anyFenced[2]).trim();

  return null;
}

async function finalizeStudioRunFailure(project, run, emitRunProgress, options = {}, deps = {}) {
  const appendStudioAssistantMessage = deps.appendStudioAssistantMessage || (async () => {});
  const emitStudioEvent = deps.emitStudioEvent || (() => {});
  const pruneStudioRuns = deps.pruneStudioRuns || (() => {});
  const nowIso = deps.nowIso || (() => new Date().toISOString());
  const clearState = deps.clearStudioRunStreamingState || clearStudioRunStreamingState;

  const {
    error,
    progressMessage,
    diagnosticLines = null,
  } = options;

  run.status = 'failed';
  run.error = error || run.error || 'Unknown error';
  run.note = null;
  run.completedAt = nowIso();
  run.updatedAt = run.completedAt;
  clearState(run);
  emitRunProgress('failed', progressMessage || `Studio run failed: ${run.error}`, {
    tone: 'error',
    clearPartialText: true,
  });
  if (Array.isArray(diagnosticLines) && diagnosticLines.length > 0) {
    await appendStudioAssistantMessage(project, run.projectId, diagnosticLines.join('\n'), run.id);
  }
  emitStudioEvent('run.failed', run.projectId, { runId: run.id, run });
  pruneStudioRuns();
}

async function finalizeStudioRunSuccess(project, run, emitRunProgress, options = {}, deps = {}) {
  const sanitizeStudioAssistantText = deps.sanitizeStudioAssistantText || ((value) => String(value || ''));
  const appendStudioAssistantMessage = deps.appendStudioAssistantMessage || (async () => {});
  const ensureSharedStudioDir = deps.ensureSharedStudioDir || (async () => {});
  const ensureSharedStudioFile = deps.ensureSharedStudioFile || (async () => {});
  const createStudioVersionFromCurrent = deps.createStudioVersionFromCurrent || (async () => null);
  const emitStudioEvent = deps.emitStudioEvent || (() => {});
  const pruneStudioRuns = deps.pruneStudioRuns || (() => {});
  const nowIso = deps.nowIso || (() => new Date().toISOString());
  const clearState = deps.clearStudioRunStreamingState || clearStudioRunStreamingState;
  const studioCanvasUrl = deps.studioCanvasUrl || (() => null);
  const fsp = deps.fsp;
  const extractHtml = deps.extractHtmlFromEchoResponse || extractHtmlFromEchoResponse;

  const {
    assistantText = null,
    html: initialHtml = null,
    htmlSource = null,
    entryPath,
  } = options;

  const replyText = sanitizeStudioAssistantText(assistantText || '');

  emitRunProgress(
    'response',
    initialHtml ? 'Assistant reply received. Finalizing the updated preview.' : 'Assistant reply received. Finalizing the run.',
    { clearPartialText: true },
  );

  if (replyText) {
    await appendStudioAssistantMessage(project, run.projectId, replyText, run.id);
  }

  let html = initialHtml;
  let resolvedHtmlSource = htmlSource || null;
  if (!html) {
    const extractedHtml = extractHtml(replyText);
    if (extractedHtml) {
      await ensureSharedStudioDir(path.dirname(entryPath));
      await fsp.writeFile(entryPath, extractedHtml, 'utf8');
      await ensureSharedStudioFile(entryPath);
      html = extractedHtml;
      resolvedHtmlSource = resolvedHtmlSource || 'text-extraction';
    }
  }

  run.status = 'completed';
  run.error = null;
  run.completedAt = nowIso();
  run.updatedAt = run.completedAt;
  clearState(run);

  if (html) {
    emitRunProgress('render', 'Preview saved. Writing a checkpoint into project history.');
    const postRunVersion = await createStudioVersionFromCurrent(project, 'Auto (Echo run)', 'echo-run');
    run.htmlSource = resolvedHtmlSource || null;
    run.versionId = postRunVersion?.id || null;
    run.postRunVersionId = postRunVersion?.id || null;
    run.note = null;
    emitStudioEvent('render.updated', run.projectId, {
      runId: run.id,
      renderUrl: studioCanvasUrl(run.projectId, true),
      htmlSource: run.htmlSource,
      source: run.htmlSource || 'unknown',
      versionId: run.versionId,
    });
    emitRunProgress('completed', 'Reply delivered, preview updated, and checkpoint saved.', {
      versionId: run.versionId || null,
      tone: 'success',
      clearPartialText: true,
    });
  } else {
    run.htmlSource = null;
    run.versionId = null;
    run.note = 'Response received but no Studio HTML render was produced';
    const noPreviewMessage = run.userMode === 'instruction'
      ? 'Echo replied, but this Build run did not produce a new preview file.'
      : 'Reply delivered. No new preview file was produced for this run.';
    emitRunProgress('completed', noPreviewMessage, {
      tone: run.userMode === 'instruction' ? 'warning' : 'success',
      clearPartialText: true,
    });
  }

  emitStudioEvent('run.completed', run.projectId, { runId: run.id, run });
  pruneStudioRuns();

  return { assistantText: replyText, html, htmlSource: run.htmlSource || resolvedHtmlSource || null };
}

module.exports = {
  clearStudioRunStreamingState,
  extractHtmlFromEchoResponse,
  finalizeStudioRunFailure,
  finalizeStudioRunSuccess,
  pushStudioRunPartial,
  recordStudioRunProgress,
};
