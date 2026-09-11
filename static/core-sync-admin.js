(function (root) {
  'use strict';
  if (!root || !root.document) return;

  const state = { summary: null, error: null };
  function text(summary) {
    if (!summary) return 'Core GitHub同期: 未取得';
    return `Core GitHub同期: received=${summary.received} processed=${summary.processed} pending=${summary.pending} leased=${summary.leased} dead=${summary.dead} latest=${summary.latestCommitSha ? summary.latestCommitSha.slice(0, 12) : '-'}`;
  }
  function render() {
    let el = root.document.getElementById('tsugu-core-sync-admin');
    if (!el) {
      el = root.document.createElement('details');
      el.id = 'tsugu-core-sync-admin';
      el.setAttribute('data-core-admin', 'github-sync');
      el.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:9999;max-width:min(92vw,560px);background:Canvas;color:CanvasText;border:1px solid currentColor;border-radius:8px;padding:6px 10px;font:12px/1.5 system-ui,sans-serif;opacity:.88';
      const summary = root.document.createElement('summary');
      summary.textContent = 'Core同期状態';
      const body = root.document.createElement('div');
      body.setAttribute('data-core-sync-status', '');
      body.style.cssText = 'margin-top:6px;white-space:pre-wrap;word-break:break-all';
      el.append(summary, body);
      root.document.body.appendChild(el);
    }
    const body = el.querySelector('[data-core-sync-status]');
    body.textContent = state.error ? `Core GitHub同期: ERROR ${state.error}` : text(state.summary);
  }
  root.addEventListener('tsugu:core-sync-status', event => {
    state.summary = event.detail && event.detail.summary || null;
    state.error = event.detail && event.detail.error || null;
    render();
  });
  if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', render, { once:true });
  else render();

  root.TSUGUCoreSyncAdmin = Object.freeze({
    update(summary) {
      state.summary = summary || null;
      state.error = null;
      render();
    },
    fail(error) {
      state.error = String(error && (error.code || error.message) || error || 'UNKNOWN');
      render();
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
