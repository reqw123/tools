import { noteImageUrl, type Note } from './api'
import { colorForTag, darken } from './color'
import { parseBody, stamp } from './format'

const AMP = /[&<>"]/g
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (s: string) => s.replace(AMP, (c) => MAP[c]!)

/** 插圖抓回來轉成 data URI 內嵌——匯出的 HTML 要能離線／換機打開，不能只留
 *  `/note-images/...` 這種相對連結。抓不到（檔案沒了、server 沒開）就當沒有圖。 */
async function imageDataUri(image: string): Promise<string | null> {
  try {
    const res = await fetch(`/note-images/${encodeURIComponent(image)}`)
    if (!res.ok) return null
    const blob = await res.blob()
    return await new Promise<string | null>((resolve) => {
      const r = new FileReader()
      r.onload = () => resolve(typeof r.result === 'string' ? r.result : null)
      r.onerror = () => resolve(null)
      r.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/** 便利貼內文 → HTML（完整內容，不截斷；清單／填空欄／段落照 parseBody 的判斷） */
function bodyHtml(body: string): string {
  const p = parseBody(body)
  if ('paragraph' in p) {
    return p.paragraph ? `<p class="para">${esc(p.paragraph)}</p>` : ''
  }
  const items = p.lines
    .map((l) =>
      l.kind === 'field'
        ? `<li class="fld"><span>${esc(l.text)}</span><i></i></li>`
        : `<li class="task"><b></b><span>${esc(l.text)}</span></li>`,
    )
    .join('')
  return `<ul class="lines">${items}</ul>`
}

const STYLE = `
:root { color-scheme: light }
* { box-sizing: border-box }
body {
  margin: 0; padding: 0 0 4rem;
  background: #efe8dc;
  color: #2a241c;
  font-family: "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif;
  line-height: 1.6;
}
header {
  max-width: 1180px; margin: 0 auto; padding: 3rem 1.5rem 1.5rem;
}
header h1 {
  font-family: "LXGW WenKai TC", "Kaiti TC", serif;
  font-size: 2rem; margin: 0 0 .4rem;
}
header .meta {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: .8rem; color: #7c7059; letter-spacing: .04em;
}
main {
  max-width: 1180px; margin: 0 auto; padding: 1rem 1.5rem;
  columns: 4 250px; column-gap: 1.8rem;
}
.note {
  break-inside: avoid;
  display: block; width: 100%;
  margin: 0 0 1.8rem; padding: 1.1rem 1.15rem 1.25rem;
  position: relative;
  background: var(--face); color: #1f2937;
  border-radius: 2px 2px 3px 3px;
  border: 0; text-align: left; font: inherit;
  box-shadow: 0 1px 1px rgba(35,26,10,.14), 0 10px 22px -12px rgba(35,26,10,.34);
  cursor: pointer;
  transition: transform .22s cubic-bezier(.2,.8,.2,1), box-shadow .22s;
}
.note:hover, .note:focus-visible {
  transform: translateY(-4px);
  box-shadow: 0 1px 1px rgba(35,26,10,.14), 0 20px 34px -16px rgba(35,26,10,.42);
}
.note:focus-visible { outline: 2px solid #a9782f; outline-offset: 3px; }
.note .curl {
  position: absolute; right: -1px; bottom: -1px; width: 34px; height: 34px;
  clip-path: polygon(100% 0, 100% 100%, 0 100%);
  background: linear-gradient(135deg, var(--fold) 0%, color-mix(in srgb, var(--fold) 55%, #fff) 52%, var(--face) 53%);
  box-shadow: -3px -3px 6px rgba(0,0,0,.14);
}
.note h2 {
  font-family: "LXGW WenKai TC", "Kaiti TC", serif;
  font-weight: 700; font-size: 1.2rem; line-height: 1.3;
  margin: 0 0 .55rem; text-wrap: balance;
}
.note .note-img {
  display: block; width: 100%; max-height: 168px; object-fit: cover;
  border-radius: 2px; margin: 0 0 .6rem; background: rgba(31,41,55,.06);
}
.lb-content .note .note-img { max-height: 60vh; object-fit: contain; }
.note .para { margin: 0; font-size: .9rem; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .32rem; font-size: .88rem; }
.lines li { display: flex; gap: .5rem; align-items: baseline; line-height: 1.5; }
.lines .task b { flex: none; width: 11px; height: 11px; margin-top: 2px; border: 1.5px solid rgba(31,41,55,.5); border-radius: 3px; }
.lines .fld span { flex: none; color: rgba(31,41,55,.82); }
.lines .fld i { flex: 1; height: 0; border-bottom: 1.4px dotted rgba(31,41,55,.42); transform: translateY(-3px); }
.foot {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: .5rem; margin-top: .95rem;
}
.foot .tag { font-family: "LXGW WenKai TC", serif; font-size: .84rem; color: rgba(31,41,55,.8); }
.foot .time {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: .66rem; letter-spacing: .05em; color: rgba(31,41,55,.5);
}

/* ── 點開的大便利貼（唯讀）────────────────────────────────── */
.lb { display: none; }
.lb.open {
  display: flex; flex-direction: column; align-items: center;
  position: fixed; inset: 0; z-index: 50;
  overflow-y: auto; padding: clamp(1rem, 5vw, 3rem);
}
.lb-scrim { position: fixed; inset: 0; background: rgba(20,15,8,.6); backdrop-filter: blur(3px); }
.lb-box {
  position: relative; margin: auto; z-index: 1;
  width: min(34rem, 100%);
}
.lb-content .note {
  margin: 0; cursor: default; transform: none;
  padding: 2rem 1.9rem 2rem;
  box-shadow: 0 40px 80px -20px rgba(0,0,0,.55);
}
.lb-content .note:hover { transform: none; }
.lb-content .note .curl { width: 46px; height: 46px; }
.lb-content .note h2 { font-size: 1.85rem; margin-bottom: 1rem; }
.lb-content .note .para { font-size: 1.05rem; }
.lb-content .note .lines { font-size: 1.02rem; gap: .5rem; }
.lb-content .note .lines .task b { width: 13px; height: 13px; }
.lb-content .note .foot { margin-top: 1.5rem; }
.lb-close {
  position: absolute; top: -.6rem; right: -.6rem; z-index: 2;
  width: 34px; height: 34px; display: grid; place-items: center;
  border: 0; border-radius: 50%; background: #2a241c; color: #fff;
  font-size: 1.2rem; line-height: 1; cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,.4);
}
.lb-close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

@media (prefers-color-scheme: dark) {
  body { background: #201b14; color: #f0e7d5; }
  header .meta { color: #a1937b; }
}
@media print {
  body { background: #fff; }
  main { columns: 3 220px; }
  .note { box-shadow: none; border: 1px solid rgba(0,0,0,.18); }
  .note .curl { display: none; }
  .lb { display: none !important; }
}
@media (prefers-reduced-motion: reduce) {
  .note { transition: none; }
}
`.trim()

const SCRIPT = `
(function () {
  var lb = document.querySelector('.lb');
  var box = lb.querySelector('.lb-box');
  var content = lb.querySelector('.lb-content');
  var last = null;
  function open(note) {
    last = document.activeElement;
    var clone = note.cloneNode(true);
    clone.removeAttribute('tabindex');
    clone.removeAttribute('role');
    box.setAttribute('aria-label', note.getAttribute('aria-label') || '便利貼');
    content.innerHTML = '';
    content.appendChild(clone);
    lb.classList.add('open');
    document.body.style.overflow = 'hidden';
    box.focus();
  }
  function close() {
    lb.classList.remove('open');
    document.body.style.overflow = '';
    content.innerHTML = '';
    if (last && last.focus) last.focus();
  }
  var wall = document.querySelector('main');
  wall.addEventListener('click', function (e) {
    var n = e.target.closest('.note');
    if (n) open(n);
  });
  wall.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('note')) {
      e.preventDefault();
      open(e.target);
    }
  });
  lb.querySelector('.lb-scrim').addEventListener('click', close);
  lb.querySelector('.lb-close').addEventListener('click', close);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lb.classList.contains('open')) close();
  });
})();
`.trim()

/** 目前這批便利貼 → 一份可離線開、可列印、可點開看大張的 HTML 文件（跟牆上同一套視覺）。
 *  有插圖的便利貼會把圖片以 data URI 內嵌進去，所以檔案可能不小——這是「可離線」的代價。 */
export async function buildStickyNotesHtml(
  notes: Note[],
  tagColors?: Record<string, string>,
): Promise<string> {
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const when = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`

  const cards = (
    await Promise.all(
      notes.map(async (n) => {
        const face = colorForTag(n.tag, tagColors)
        const fold = darken(face, 0.2)
        const tag = n.tag ? `<span class="tag"># ${esc(n.tag)}</span>` : '<span></span>'
        const dataUri = noteImageUrl(n) ? await imageDataUri(n.image) : null
        const img = dataUri ? `\n      <img class="note-img" src="${dataUri}" alt="">` : ''
        return `    <article class="note" tabindex="0" role="button" aria-label="便利貼：${esc(n.title || '(無標題)')}" style="--face:${face};--fold:${fold}">
      <span class="curl" aria-hidden="true"></span>
      <h2>${esc(n.title || '(無標題)')}</h2>${img}
      ${bodyHtml(n.body)}
      <div class="foot">${tag}<span class="time">${stamp(n.created_at)}</span></div>
    </article>`
      }),
    )
  ).join('\n')

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>便利貼匯出 · ${notes.length} 則 · ${when}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=LXGW+WenKai+TC:wght@400;700&family=Noto+Sans+TC:wght@400;500;700&display=swap">
<style>${STYLE}</style>
</head>
<body>
<header>
  <h1>📌 便利貼匯出</h1>
  <p class="meta">共 ${notes.length} 則　·　匯出時間 ${when}　·　來自 file_search_app 便利貼　·　點卡片看大張</p>
</header>
<main class="wall">
${cards}
</main>
<div class="lb" aria-hidden="true">
  <div class="lb-scrim"></div>
  <div class="lb-box" role="dialog" aria-modal="true" tabindex="-1">
    <button type="button" class="lb-close" aria-label="關閉">×</button>
    <div class="lb-content"></div>
  </div>
</div>
<script>${SCRIPT}</script>
</body>
</html>
`
}

/** 觸發下載。filename 例：便利貼_20260903_1530.html */
export async function downloadStickyNotesHtml(
  notes: Note[],
  tagColors?: Record<string, string>,
): Promise<void> {
  const html = await buildStickyNotesHtml(notes, tagColors)
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  a.href = url
  a.download = `便利貼_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
