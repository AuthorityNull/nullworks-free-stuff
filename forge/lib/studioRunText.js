function mergeStudioStreamText(previous, next) {
  const prev = String(previous || '');
  const incoming = String(next || '');
  if (!incoming) return prev;
  if (!prev) return incoming;
  if (incoming.startsWith(prev)) return incoming;
  if (prev.endsWith(incoming)) return prev;

  const maxOverlap = Math.min(prev.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (prev.slice(-overlap) === incoming.slice(0, overlap)) {
      return prev + incoming.slice(overlap);
    }
  }

  const prevLast = prev.slice(-1);
  const incomingFirst = incoming.slice(0, 1);
  const looksLikeSentenceBoundary = /[.!?]/.test(prevLast) && /[A-Za-z0-9"'`(*_#]/.test(incomingFirst);
  if (looksLikeSentenceBoundary) {
    return `${prev} ${incoming}`;
  }

  return prev + incoming;
}

function sanitizeStudioAssistantText(input) {
  const original = String(input || '').replace(/\r\n/g, '\n').trim();
  if (!original) return '';

  let text = original
    .replace(/([.!?:;])([A-Z][a-z])/g, '$1 $2')
    .replace(/([.!?:;])(\*\*[^*]+\*\*:)/g, '$1 $2')
    .replace(/([a-z0-9)])(\*\*[^*]+\*\*:)/g, '$1\n\n$2')
    .replace(/([^\n])([-*]\s+)/g, '$1\n$2');

  const lines = text.split('\n');
  const filteredLines = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      filteredLines.push('');
      continue;
    }
    if (/^(now |now let me|let me |i(?:'|')ll |i am going to |i'm going to |good, so |ok[,.: ]|okay[,.: ]|first, let me|different approach|do the same|find the closing|add the actual element|now add |now make |now switch |now fix |here(?:'|')s what|here is what|i(?:'|')ve |i have (?:now |just )?(updated|changed|modified|created|built|finished|completed|implemented|added|fixed|written|saved))/i.test(trimmed)) {
      continue;
    }
    filteredLines.push(line);
  }

  text = filteredLines.join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const structuredMarker = text.search(/(^|\n)(\*\*[^*\n]+\*\*:|#{1,3}\s|[-*]\s)/m);
  if (structuredMarker > 0) {
    const prefix = text.slice(0, structuredMarker).trim();
    if (/(let me|now let me|different approach|find the closing|now add|now fix|good, so|ok[,.: ]|okay[,.: ]|here(?:'|')s what|i(?:'|')ve )/i.test(prefix)) {
      text = text.slice(structuredMarker).trim();
    }
  }

  text = text.replace(/\*{2,3}([^*\n]+?)(?:\*{2,3})?(?=\n|$)/gm, (match, inner) => {
    if (/^\*{2,3}[^*]+\*{2,3}$/.test(match.trim())) return match;
    return inner.trim();
  });

  return text || original;
}

module.exports = {
  mergeStudioStreamText,
  sanitizeStudioAssistantText,
};
