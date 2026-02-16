class EventConsolidator {
  consolidate(chunks) {
    const stats = { original: chunks.length, deduplicated: 0, textMerged: 0, toolsCollapsed: 0, systemSuperseded: 0 };
    if (chunks.length <= 1) return { consolidated: chunks, stats };

    const sorted = chunks.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    const seen = new Set();
    const deduped = [];
    for (const c of sorted) {
      const key = c.sessionId + ':' + c.sequence;
      if (c.sequence !== undefined && seen.has(key)) { stats.deduplicated++; continue; }
      if (c.sequence !== undefined) seen.add(key);
      deduped.push(c);
    }

    const bySession = {};
    for (const c of deduped) {
      const sid = c.sessionId || '_';
      if (!bySession[sid]) bySession[sid] = [];
      bySession[sid].push(c);
    }

    const result = [];
    for (const sid of Object.keys(bySession)) {
      const sessionChunks = bySession[sid];
      const merged = this._mergeTextBlocks(sessionChunks, stats);
      this._collapseToolPairs(merged, stats);
      const superseded = this._supersedeSystemBlocks(merged, stats);
      result.push(...superseded);
    }

    result.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
    return { consolidated: result, stats };
  }

  _mergeTextBlocks(chunks, stats) {
    const result = [];
    let pending = null;
    const MAX_MERGE = 50 * 1024;

    for (const c of chunks) {
      if (c.block?.type === 'text') {
        if (pending) {
          const combined = (pending.block.text || '') + '\n' + (c.block.text || '');
          if (combined.length <= MAX_MERGE) {
            pending = {
              ...pending,
              block: { ...pending.block, text: combined },
              created_at: c.created_at,
              _mergedSequences: [...(pending._mergedSequences || [pending.sequence]), c.sequence]
            };
            stats.textMerged++;
            continue;
          }
        }
        if (pending) result.push(pending);
        pending = { ...c, _mergedSequences: [c.sequence] };
      } else {
        if (pending) { result.push(pending); pending = null; }
        result.push(c);
      }
    }
    if (pending) result.push(pending);
    return result;
  }

  _collapseToolPairs(chunks, stats) {
    const toolUseMap = {};
    for (const c of chunks) {
      if (c.block?.type === 'tool_use' && c.block.id) toolUseMap[c.block.id] = c;
    }
    for (const c of chunks) {
      if (c.block?.type === 'tool_result' && c.block.tool_use_id) {
        const match = toolUseMap[c.block.tool_use_id];
        if (match) {
          match.block._hasResult = true;
          c.block._collapsed = true;
          stats.toolsCollapsed++;
        }
      }
    }
  }

  _supersedeSystemBlocks(chunks, stats) {
    const systemIndices = [];
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].block?.type === 'system') systemIndices.push(i);
    }
    if (systemIndices.length <= 1) return chunks;
    const keep = new Set();
    keep.add(systemIndices[systemIndices.length - 1]);
    stats.systemSuperseded += systemIndices.length - 1;
    return chunks.filter((_, i) => !systemIndices.includes(i) || keep.has(i));
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = EventConsolidator;
