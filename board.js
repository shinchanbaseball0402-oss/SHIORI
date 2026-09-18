/* わが家の掲示板 (SHIORI) — Firebase版
 * 元はClaude Artifactsのdb/assets/downloads機能を使っていたが、
 * ログイン不要でどこでも使えるようFirestore + Storageに置き換えた。
 * ボードはURLの ?b=<boardId> で区別され、同じ家族は同じURLを開く。
 */

function rotFor(id){
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  const choices = [-4,-2,-1,1,2,3,-3,4];
  return choices[Math.abs(h) % choices.length];
}
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function fmtDate(iso){
  if(!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]})`;
}
function friendlyError(err){
  const map = {
    'permission-denied': '権限がありません。',
    'resource-exhausted': '少し混み合っています。しばらくしてからもう一度試してください。',
    'unavailable': '通信が不安定なようです。もう一度試してください。',
    'unauthenticated': 'アクセス権限が切れました。ページを再読み込みしてください。',
  };
  if (err && err.code && map[err.code]) return map[err.code];
  if (err && err.message) return err.message;
  return '貼れませんでした。もう一度試してください。';
}

/* ---------- board routing (?b=boardId) ---------- */
function getOrCreateBoardId(){
  const params = new URLSearchParams(location.search);
  let id = params.get('b');
  if (id) return id;
  id = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())).replace(/-/g, '').slice(0, 10);
  params.set('b', id);
  location.replace(location.pathname + '?' + params.toString());
  return null; // caller reloads via location.replace
}

let db = null, storage = null, boardId = null, boardRef = null;

async function init(){
  boardId = getOrCreateBoardId();
  if (!boardId) return; // redirecting to the ?b=... URL

  const shareUrl = location.href;
  document.getElementById('share-url').value = shareUrl;
  document.getElementById('share-copy').addEventListener('click', async () => {
    const btn = document.getElementById('share-copy');
    try {
      await navigator.clipboard.writeText(shareUrl);
      btn.textContent = 'コピーしました';
    } catch {
      btn.textContent = 'コピーできませんでした';
    }
    setTimeout(() => { btn.textContent = 'コピー'; }, 2000);
  });

  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    storage = firebase.storage();
    boardRef = db.collection('boards').doc(boardId);
  } catch (err) {
    console.error(err);
    document.getElementById('offline-notice').classList.remove('hidden');
    return;
  }

  // board metadata write happens in the background — never blocks the UI from rendering,
  // and a stale/placeholder firebase-config.js must not hang the whole page forever.
  boardRef.set({ createdAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true }).catch(err => {
    console.error(err);
  });

  // connectivity probe: if we never hear back from Firestore at all (e.g. firebase-config.js
  // still has placeholder values), surface that instead of leaving the page looking blank.
  let heardBack = false;
  boardRef.onSnapshot(() => { heardBack = true; }, () => {
    document.getElementById('offline-notice').classList.remove('hidden');
  });
  setTimeout(() => {
    if (!heardBack) document.getElementById('offline-notice').classList.remove('hidden');
  }, 6000);

  wireMemories();
  wireEvents();
  wireNews();
  wireFamily();
}

/* ---------- photo upload / save ---------- */
async function uploadPhoto(fileInput){
  if (!fileInput) return null;
  const f = fileInput.files[0];
  if (!f) return null;
  if (f.size > 20 * 1024 * 1024) throw new Error('写真が大きすぎます(20MBまで)。');
  if (!/^image\/(png|jpeg|gif|webp)$/.test(f.type)) throw new Error('その形式の写真は使えません。');
  try {
    const path = `boards/${boardId}/uploads/${Date.now()}_${Math.random().toString(36).slice(2)}_${f.name}`;
    const ref = storage.ref(path);
    await ref.put(f);
    return await ref.getDownloadURL();
  } catch (err) {
    throw new Error(friendlyError(err) === err.message ? '写真のアップロードに失敗しました。' : friendlyError(err));
  }
}
function saveLinkHtml(url, name){
  return `<a class="save-btn" href="${esc(url)}" download="${esc(name || 'photo')}" target="_blank" rel="noopener">保存</a>`;
}

/* ---------- comments (subcollection under any doc) ---------- */
function emptyHint(text){
  const p = document.createElement('p');
  p.className = 'empty-hint';
  p.dataset.live = '1';
  p.textContent = text;
  return p;
}

function wireComments(hostEl, parentCol, docId){
  if (!hostEl) return () => {};
  const wrap = document.createElement('div');
  wrap.className = 'comments';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'comments-toggle';
  toggle.textContent = 'コメント';
  toggle.setAttribute('aria-expanded', 'false');

  const body = document.createElement('div');
  body.hidden = true;

  const list = document.createElement('ul');
  list.className = 'comments-list';

  const form = document.createElement('form');
  form.className = 'comment-form';
  form.innerHTML = `
    <input type="text" name="author" placeholder="お名前" required>
    <input type="text" name="text" placeholder="ひとこと" required>
    <p class="comment-error hidden"></p>
    <button type="submit">送る</button>
  `;

  toggle.addEventListener('click', () => {
    const open = body.hidden;
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  body.appendChild(list);
  body.appendChild(form);
  wrap.appendChild(toggle);
  wrap.appendChild(body);
  hostEl.appendChild(wrap);

  const commentsCol = parentCol.doc(docId).collection('comments');
  const unsubscribe = commentsCol.orderBy('createdAt', 'asc').limit(50).onSnapshot(snap => {
    toggle.textContent = snap.docs.length ? `コメント (${snap.docs.length})` : 'コメント';
    list.innerHTML = '';
    for (const doc of snap.docs){
      const d = doc.data();
      const li = document.createElement('li');
      li.className = 'comment-item';
      li.innerHTML = `<span class="comment-author">${esc(d.author || '')}</span>${esc(d.text || '')}`;
      list.appendChild(li);
    }
  }, () => {});

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const author = form.author.value.trim();
    const text = form.text.value.trim();
    const errEl = form.querySelector('.comment-error');
    errEl.classList.add('hidden');
    if (!author || !text) return;
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await commentsCol.add({ author, text, createdAt: new Date().toISOString() });
      form.text.value = '';
    } catch (err) {
      errEl.textContent = friendlyError(err);
      errEl.classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  });

  return unsubscribe;
}

/* ---------- shared add-form wiring ---------- */
function wireAddToggle(gridEl, addBtn, formTpl, onSubmit){
  const form = formTpl.content.firstElementChild.cloneNode(true);
  form.hidden = true;
  gridEl.appendChild(addBtn);
  gridEl.appendChild(form);

  const fileInput = form.querySelector('input[type=file]');
  const preview = form.querySelector('.thumb-preview');
  if (fileInput){
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (!f){ preview.classList.add('hidden'); return; }
      const reader = new FileReader();
      reader.onload = e => { preview.src = e.target.result; preview.classList.remove('hidden'); };
      reader.readAsDataURL(f);
    });
  }

  addBtn.addEventListener('click', () => {
    addBtn.hidden = true;
    form.hidden = false;
    form.querySelector('input,textarea')?.focus();
  });
  form.querySelector('[data-cancel]').addEventListener('click', () => {
    form.reset();
    preview?.classList.add('hidden');
    form.querySelector('.form-error').classList.add('hidden');
    form.hidden = true;
    addBtn.hidden = false;
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = form.querySelector('.form-error');
    errEl.classList.add('hidden');
    const submitBtn = form.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    try {
      await onSubmit(form, fileInput);
      form.reset();
      preview?.classList.add('hidden');
      form.hidden = true;
      addBtn.hidden = false;
    } catch (err) {
      errEl.textContent = friendlyError(err);
      errEl.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

/* ---------- memories ---------- */
function wireMemories(){
  const grid = document.getElementById('memories-grid');
  const addBtn = document.createElement('button');
  addBtn.className = 'add-card';
  addBtn.textContent = '+ 思い出を貼る';
  const tpl = document.getElementById('tpl-memory-form');

  const col = boardRef.collection('memories');
  const commentUnsubs = new Map();
  col.orderBy('date', 'asc').limit(60).onSnapshot(snap => {
    commentUnsubs.forEach(fn => fn());
    commentUnsubs.clear();
    grid.querySelectorAll('[data-live]').forEach(n => n.remove());
    if (!snap.docs.length){
      grid.insertBefore(emptyHint('まだ思い出がありません。最初の1枚を貼ってみましょう。'), addBtn);
    }
    for (const doc of snap.docs){
      const d = doc.data();
      const r = rotFor(doc.id);
      const dateLabel = fmtDate(d.date);
      let card;
      if (d.imageUrl){
        card = document.createElement('figure');
        card.className = 'polaroid';
        card.style.setProperty('--r', r + 'deg');
        card.innerHTML = `
          <div class="tape-corner" aria-hidden="true"></div>
          <img src="${esc(d.imageUrl)}" alt="">
          <figcaption>
            ${dateLabel ? `<p class="cap-meta">${esc(dateLabel)}</p>` : ''}
            ${d.caption ? `<p class="cap-text">${esc(d.caption)}</p>` : ''}
            <p class="cap-meta">— ${esc(d.author || '')}</p>
            ${saveLinkHtml(d.imageUrl, d.subject || d.caption || 'omoide')}
          </figcaption>`;
      } else {
        card = document.createElement('article');
        card.className = 'note';
        card.style.setProperty('--r', r + 'deg');
        card.innerHTML = `
          <span class="note-tape" aria-hidden="true"></span>
          ${dateLabel ? `<p class="note-date">${esc(dateLabel)}</p>` : ''}
          <p class="note-body">${esc(d.caption || '')}</p>
          <p class="note-meta">— ${esc(d.author || '')}</p>`;
      }
      card.dataset.live = '1';
      grid.insertBefore(card, addBtn);
      commentUnsubs.set(doc.id, wireComments(d.imageUrl ? card.querySelector('figcaption') : card, col, doc.id));
    }
  }, () => {});

  wireAddToggle(grid, addBtn, tpl, async (form, fileInput) => {
    const author = form.author.value.trim();
    const date = form.date.value;
    const subject = form.subject.value.trim();
    const caption = form.caption.value.trim();
    if (!author){ throw new Error('お名前を入れてね。'); }
    if (!date){ throw new Error('日付を選んでね。'); }
    const imageUrl = await uploadPhoto(fileInput);
    if (!imageUrl && !caption){ throw new Error('写真かひとことのどちらかを入れてね。'); }
    await col.add({ author, date, subject, caption, imageUrl: imageUrl || null, createdAt: new Date().toISOString() });
  });

  renderGrowthFrom(col);
}

/* ---------- growth records (per subject timeline, built from memories) ---------- */
function renderGrowthFrom(memoriesCol){
  const wrap = document.getElementById('growth-wrap');
  memoriesCol.orderBy('date', 'asc').limit(200).onSnapshot(snap => {
    const bySubject = new Map();
    for (const doc of snap.docs){
      const d = doc.data();
      const subject = (d.subject || '').trim();
      if (!subject) continue;
      if (!bySubject.has(subject)) bySubject.set(subject, []);
      bySubject.get(subject).push(d);
    }
    if (!bySubject.size){
      wrap.innerHTML = '<div class="invite-card">まだ成長記録がありません。<br>思い出を貼るときに「だれ・何の記録？」を入れると、ここに時系列で並びます。</div>';
      return;
    }
    wrap.innerHTML = '';
    for (const [subject, items] of bySubject){
      const section = document.createElement('div');
      section.className = 'growth-subject';
      const rows = items.map(d => {
        const thumb = d.imageUrl
          ? `<img class="timeline-thumb" src="${esc(d.imageUrl)}" alt="">`
          : `<div class="timeline-thumb timeline-thumb-empty"></div>`;
        return `<li class="timeline-item">
          <div class="timeline-card">
            ${thumb}
            <div>
              <p class="timeline-date">${esc(fmtDate(d.date))}</p>
              ${d.caption ? `<p class="timeline-caption">${esc(d.caption)}</p>` : ''}
              <p class="timeline-meta">— ${esc(d.author || '')}</p>
            </div>
          </div>
        </li>`;
      }).join('');
      section.innerHTML = `<h3 class="growth-subject-title">${esc(subject)}</h3><ul class="timeline">${rows}</ul>`;
      wrap.appendChild(section);
    }
  }, () => {});
}

/* ---------- events ---------- */
function wireEvents(){
  const grid = document.getElementById('events-grid');
  const addBtn = document.createElement('button');
  addBtn.className = 'add-card';
  addBtn.textContent = '+ 予定をピン留め';
  const tpl = document.getElementById('tpl-event-form');

  const col = boardRef.collection('events');
  const commentUnsubs = new Map();
  col.orderBy('date', 'asc').limit(60).onSnapshot(snap => {
    commentUnsubs.forEach(fn => fn());
    commentUnsubs.clear();
    grid.querySelectorAll('[data-live]').forEach(n => n.remove());
    if (!snap.docs.length){
      grid.insertBefore(emptyHint('まだ予定がありません。最初の予定をピン留めしてみましょう。'), addBtn);
    }
    for (const doc of snap.docs){
      const d = doc.data();
      const card = document.createElement('article');
      card.className = 'note';
      card.dataset.live = '1';
      card.style.setProperty('--r', rotFor(doc.id) + 'deg');
      card.innerHTML = `
        <span class="note-pin" aria-hidden="true"></span>
        ${d.photoUrl ? `<img class="note-photo" src="${esc(d.photoUrl)}" alt="">` : ''}
        <p class="note-date">${esc(fmtDate(d.date))}</p>
        <h3 class="note-title">${esc(d.title)}</h3>
        ${d.note ? `<p class="note-body">${esc(d.note)}</p>` : ''}
        <p class="note-meta">— ${esc(d.author || '')}</p>
        ${d.photoUrl ? saveLinkHtml(d.photoUrl, d.title || 'yotei') : ''}`;
      grid.insertBefore(card, addBtn);
      commentUnsubs.set(doc.id, wireComments(card, col, doc.id));
    }
  }, () => {});

  wireAddToggle(grid, addBtn, tpl, async (form, fileInput) => {
    const author = form.author.value.trim();
    const date = form.date.value;
    const title = form.title.value.trim();
    if (!author){ throw new Error('お名前を入れてね。'); }
    if (!date){ throw new Error('日付を選んでね。'); }
    if (!title){ throw new Error('予定の名前を入れてね。'); }
    const photoUrl = await uploadPhoto(fileInput);
    await col.add({ author, date, title, note: form.note.value.trim(), photoUrl: photoUrl || null, createdAt: new Date().toISOString() });
  });
}

/* ---------- news ---------- */
function wireNews(){
  const grid = document.getElementById('news-grid');
  const addBtn = document.createElement('button');
  addBtn.className = 'add-card';
  addBtn.textContent = '+ お知らせを貼る';
  const tpl = document.getElementById('tpl-news-form');

  const col = boardRef.collection('news');
  const commentUnsubs = new Map();
  col.orderBy('createdAt', 'desc').limit(60).onSnapshot(snap => {
    commentUnsubs.forEach(fn => fn());
    commentUnsubs.clear();
    grid.querySelectorAll('[data-live]').forEach(n => n.remove());
    if (!snap.docs.length){
      grid.insertBefore(emptyHint('まだお知らせがありません。近況を貼ってみましょう。'), addBtn);
    }
    for (const doc of snap.docs){
      const d = doc.data();
      const card = document.createElement('article');
      card.className = 'note';
      card.dataset.live = '1';
      card.style.setProperty('--r', rotFor(doc.id) + 'deg');
      const dt = d.createdAt ? new Date(d.createdAt) : null;
      const dateLabel = dt && !isNaN(dt) ? `${dt.getFullYear()}/${dt.getMonth()+1}/${dt.getDate()}` : '';
      card.innerHTML = `
        <span class="note-tape" aria-hidden="true"></span>
        ${dateLabel ? `<p class="note-date">${dateLabel}</p>` : ''}
        <p class="note-body">${esc(d.text)}</p>
        <p class="note-meta">— ${esc(d.author || '')}</p>`;
      grid.insertBefore(card, addBtn);
      commentUnsubs.set(doc.id, wireComments(card, col, doc.id));
    }
  }, () => {});

  wireAddToggle(grid, addBtn, tpl, async (form) => {
    const author = form.author.value.trim();
    const text = form.text.value.trim();
    if (!author){ throw new Error('お名前を入れてね。'); }
    if (!text){ throw new Error('内容を書いてね。'); }
    await col.add({ author, text, createdAt: new Date().toISOString() });
  });
}

/* ---------- family ---------- */
function wireFamily(){
  const row = document.getElementById('family-row');
  const addBtn = document.createElement('button');
  addBtn.className = 'add-card fam-add';
  addBtn.textContent = '+ 家族を紹介する';
  const tpl = document.getElementById('tpl-family-form');

  const col = boardRef.collection('family');
  const commentUnsubs = new Map();
  col.orderBy('createdAt', 'asc').limit(60).onSnapshot(snap => {
    commentUnsubs.forEach(fn => fn());
    commentUnsubs.clear();
    row.querySelectorAll('[data-live]').forEach(n => n.remove());
    for (const doc of snap.docs){
      const d = doc.data();
      const card = document.createElement('div');
      card.className = 'fam-card';
      card.dataset.live = '1';
      const photoInner = d.photoUrl
        ? `<img src="${esc(d.photoUrl)}" alt="">`
        : `<div class="fam-initial">${esc((d.name || '?').slice(0,1))}</div>`;
      card.innerHTML = `
        <span class="clip" aria-hidden="true"></span>
        <div class="fam-photo" style="--r:${rotFor(doc.id)}deg">
          ${photoInner}
          <p class="fam-name">${esc(d.name)}</p>
          ${d.role ? `<p class="fam-role">${esc(d.role)}</p>` : ''}
          ${d.note ? `<p class="fam-note">${esc(d.note)}</p>` : ''}
          ${d.photoUrl ? saveLinkHtml(d.photoUrl, d.name || 'kazoku') : ''}
        </div>`;
      row.insertBefore(card, addBtn);
      commentUnsubs.set(doc.id, wireComments(card.querySelector('.fam-photo'), col, doc.id));
    }
  }, () => {});

  wireAddToggle(row, addBtn, tpl, async (form, fileInput) => {
    const name = form.name.value.trim();
    if (!name){ throw new Error('名前を入れてね。'); }
    const photoUrl = await uploadPhoto(fileInput);
    await col.add({
      name,
      role: form.role.value.trim(),
      note: form.note.value.trim(),
      photoUrl: photoUrl || null,
      createdAt: new Date().toISOString(),
    });
  });
}

init();
