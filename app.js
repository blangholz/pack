import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const { SUPABASE_URL, SUPABASE_ANON_KEY } = (window.ENV || {});
const statusEl = document.getElementById('status');
const listEl = document.getElementById('notes-list');
const form = document.getElementById('note-form');
const bodyEl = document.getElementById('note-body');
const btn = document.getElementById('submit-btn');

function setStatus(msg, kind) {
  statusEl.textContent = msg || '';
  statusEl.classList.toggle('error', kind === 'error');
  statusEl.classList.toggle('ok', kind === 'ok');
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  setStatus('Missing SUPABASE_URL / SUPABASE_ANON_KEY. Build env not injected.', 'error');
  btn.disabled = true;
} else {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function loadNotes() {
    setStatus('Loading notes…');
    const { data, error } = await supabase
      .from('notes')
      .select('id, title, body, created_at')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      setStatus('Could not load notes: ' + error.message, 'error');
      return;
    }
    setStatus('');
    render(data || []);
  }

  function render(notes) {
    listEl.innerHTML = '';
    if (!notes.length) {
      const empty = document.createElement('li');
      empty.className = 'empty muted';
      empty.textContent = 'No notes yet — be the first.';
      listEl.appendChild(empty);
      return;
    }
    for (const n of notes) {
      const li = document.createElement('li');
      li.className = 'note';

      const titleEl = document.createElement('div');
      titleEl.className = 'note-title';
      titleEl.textContent = n.title || '(untitled)';

      const bd = document.createElement('div');
      bd.className = 'note-body';
      bd.textContent = n.body;

      const meta = document.createElement('div');
      meta.className = 'note-meta muted';
      const when = n.created_at
        ? new Date(n.created_at.endsWith('Z') ? n.created_at : n.created_at + 'Z')
        : null;
      meta.textContent = when ? when.toLocaleString() : '';

      li.append(titleEl, bd, meta);
      listEl.appendChild(li);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = bodyEl.value.trim();
    if (!text) return;
    btn.disabled = true;
    const prev = btn.textContent;
    btn.textContent = 'Posting…';
    setStatus('');
    const title = text.split('\n')[0].slice(0, 80) || '(untitled)';
    const { error } = await supabase.from('notes').insert({ title, body: text });
    btn.disabled = false;
    btn.textContent = prev;
    if (error) {
      setStatus('Could not post: ' + error.message, 'error');
      return;
    }
    bodyEl.value = '';
    setStatus('Posted.', 'ok');
    loadNotes();
  });

  loadNotes();
}
