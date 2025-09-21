---
title: Public Kanban
nav_order: 3
---

<div id="kanban-root">Loading Kanban…</div>

<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script>
  (async function () {
    const root = document.getElementById('kanban-root');
    try {
      const repo = 'rajsekharan/kai'; // Update if the repo path changes
      const branch = 'master'; // Or 'main' if you switch
      const url = `https://raw.githubusercontent.com/${repo}/${branch}/Kanban.md`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const md = await res.text();
      root.innerHTML = marked.parse(md);
    } catch (e) {
      root.textContent = 'Failed to load Kanban. See repository Kanban.md directly.';
    }
  })();
</script>

