import { noteImageUrl, type Note } from './api'
import { colorForTag, darken } from './color'
import { parseBody, stamp } from './format'

const AMP = /[&<>"]/g
const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const esc = (s: string) => s.replace(AMP, (c) => MAP[c]!)

/** 插圖抓回來轉成 data URI 內嵌——匯出的 HTML 要能離線／換機打開，不能只留
 *  `/note-images/...`（或研究生便利貼的 `/thesis-note-images/...`）這種相對
 *  連結。抓不到（檔案沒了、server 沒開）就當沒有圖。`url` 用 `noteImageUrl()`
 *  組好的完整路徑傳進來，不要自己另外拼——兩個集合的插圖現在分開存放、
 *  前綴不一樣，寫死 `/note-images/` 會讓研究生便利貼匯出時圖片抓不到。 */
async function imageDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
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
        : `<li class="task${l.checked ? ' done' : ''}"><b></b><span>${esc(l.text)}</span></li>`,
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
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--wall-min-col, 250px)), 1fr));
  gap: 1.8rem; align-items: start;
}
/* JS 量完高度後加上——改成列 masonry（left/top/width 由 script 寫成 inline） */
main.is-masonry { display: block; position: relative; gap: 0; }
main.is-masonry > .note { position: absolute; }
.pinned-row { display: flex; flex-wrap: wrap; gap: 1.8rem; align-items: flex-start; grid-column: 1 / -1; }
.pinned-row .note { flex: 1 1 230px; max-width: 340px; }
/* 排序「同分類集中」的分類標題——小色塊＋分類名＋底下一條細線。不用整條
   底色框住文字，改用牆色文字光暈＋色塊外圈，深色模式下也跟背景分得開。 */
main > .band-label {
  grid-column: 1 / -1;
  display: flex; align-items: center; gap: .42rem;
  font-family: "LXGW WenKai TC", "Kaiti TC", serif;
  font-weight: 700; font-size: .98rem; letter-spacing: .02em; color: #2a241c;
  padding-bottom: .32rem;
  border-bottom: 1px solid color-mix(in srgb, var(--band-color, #7c7059) 60%, #7c7059);
  text-shadow: 0 0 4px #efe8dc, 0 0 4px #efe8dc;
}
main > .band-label::before {
  content: ''; flex: none; width: .7rem; height: .7rem; border-radius: 3px;
  background: var(--band-color, #7c7059);
  box-shadow: 0 0 0 2.5px #efe8dc, inset 0 0 0 1px rgba(0,0,0,.18);
}
main.is-masonry > .band-label { position: absolute; }
.note {
  break-inside: avoid;
  display: block; width: 100%;
  margin: 0; padding: 1.1rem 1.15rem 1.25rem;
  position: relative;
  overflow-wrap: anywhere; /* 長網址／連續英數不撐破卡片 */
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
  /* 固定高度（不是 max-height）——這樣 JS 量卡片高度時，就算圖片 data URI
     還沒解碼完成，卡片高度也已經是最終值，column 版面不會先錯位再跳。 */
  display: block; width: 100%; height: 168px; object-fit: cover;
  border-radius: 2px; margin: 0 0 .6rem; background: rgba(31,41,55,.06);
}
.lb-content .note .note-img { height: auto; max-height: 70vh; object-fit: contain; }
.note .para { margin: 0; font-size: .9rem; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.lines { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .32rem; font-size: .88rem; }
.lines li { display: flex; gap: .5rem; align-items: baseline; line-height: 1.5; }
.lines li > span { min-width: 0; overflow-wrap: anywhere; }
.lines .task b { flex: none; width: 11px; height: 11px; margin-top: 2px; border: 1.5px solid rgba(31,41,55,.5); border-radius: 3px; }
.lines .task.done b { background: rgba(31,41,55,.6); border-color: rgba(31,41,55,.6); }
.lines .task.done span { text-decoration: line-through; opacity: .5; }
.note .pinned { position: absolute; top: 8px; right: 10px; color: #e0a400; font-size: .95rem; }
.note.is-pinned { box-shadow: 0 0 0 2px #e0a400 inset, 0 6px 18px rgba(0,0,0,.12); }
.lines .fld span { flex: 0 1 auto; min-width: 0; overflow-wrap: anywhere; color: rgba(31,41,55,.82); }
.lines .fld i { flex: 1; height: 0; border-bottom: 1.4px dotted rgba(31,41,55,.42); transform: translateY(-3px); }
.foot {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: .5rem; margin-top: .95rem;
}
.foot .tag { min-width: 0; overflow-wrap: anywhere; font-family: "LXGW WenKai TC", serif; font-size: .84rem; color: rgba(31,41,55,.8); }
.foot .time {
  flex: none;
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
.lb-content .note .note-img { cursor: zoom-in; }
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
/* 固定在視窗右上角（不是黏在 .lb-box 上）——長便利貼往下捲時 × 不會跟著捲走。 */
.lb-close, .iz-close {
  position: fixed; top: clamp(.6rem, 3vw, 1.4rem); right: clamp(.6rem, 3vw, 1.4rem);
  width: 40px; height: 40px; display: grid; place-items: center;
  border: 0; border-radius: 50%; background: #2a241c; color: #fff;
  font-size: 1.45rem; line-height: 1; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.45);
}
.lb-close { z-index: 3; }
.iz-close { z-index: 61; }
.lb:not(.open) .lb-close, .iz:not(.open) .iz-close { display: none; }
.lb-close:hover, .iz-close:hover { background: #000; }
.lb-close:focus-visible, .iz-close:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }

/* 燈箱裡的插圖再點一下 → 全螢幕看大圖（zoom-out：點任意處或 Esc 收回） */
.iz { display: none; }
.iz.open {
  display: flex; align-items: center; justify-content: center;
  position: fixed; inset: 0; z-index: 60;
  background: rgba(8,6,3,.92); padding: clamp(1rem, 4vw, 3rem); cursor: zoom-out;
}
.iz img { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 3px; box-shadow: 0 24px 70px rgba(0,0,0,.6); }

@media (prefers-color-scheme: dark) {
  body { background: #201b14; color: #f0e7d5; }
  header .meta { color: #a1937b; }
  main > .band-label {
    color: #f0e7d5;
    border-bottom-color: color-mix(in srgb, var(--band-color, #a1937b) 55%, #a1937b);
    text-shadow: 0 0 4px #201b14, 0 0 4px #201b14;
  }
  main > .band-label::before { box-shadow: 0 0 0 2.5px #201b14, inset 0 0 0 1px rgba(0,0,0,.18); }
}
@media print {
  body { background: #fff; }
  /* 列印切回 CSS Grid——絕對定位的卡片會被硬切在分頁線上，grid + break-inside
     才不會把單張便利貼切成兩半。script 寫的 inline left/top/width 在
     position:static 下自動失效。 */
  main.is-masonry { display: grid; position: static; height: auto !important; gap: 1.8rem; }
  /* !important 才蓋得過 script 寫在 .note 上的 inline left/top/width */
  main.is-masonry > .note { position: static !important; left: auto !important; top: auto !important; width: auto !important; }
  main.is-masonry > .band-label { position: static !important; left: auto !important; top: auto !important; width: auto !important; }
  main > .band-label { color: #2a241c; text-shadow: none; }
  main > .band-label::before { box-shadow: inset 0 0 0 1px rgba(0,0,0,.25); }
  .pinned-row { grid-column: 1 / -1; }
  main { grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr)); }
  .note { box-shadow: none; border: 1px solid rgba(0,0,0,.18); }
  .note .curl { display: none; }
  .lb, .iz { display: none !important; }
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
  var iz = document.querySelector('.iz');
  var izImg = iz.querySelector('img');
  var last = null;
  function open(note) {
    last = document.activeElement;
    var clone = note.cloneNode(true);
    clone.removeAttribute('tabindex');
    clone.removeAttribute('role');
    // layout() 會在牆上的 .note 寫死 inline left/top/width；.note 本身是
    // position:relative，複製到燈箱裡這些偏移會把大卡片推到畫面外。清掉。
    clone.style.left = clone.style.top = clone.style.width = '';
    box.setAttribute('aria-label', note.getAttribute('aria-label') || '便利貼');
    content.innerHTML = '';
    content.appendChild(clone);
    var cimg = clone.querySelector('img.note-img');
    if (cimg) cimg.addEventListener('click', function (e) {
      e.stopPropagation(); // 不要冒泡去觸發「點卡片外關燈箱」
      openImg(cimg.currentSrc || cimg.src);
    });
    lb.classList.add('open');
    lb.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    lb.scrollTop = 0;
    box.focus();
  }
  function close() {
    closeImg();
    lb.classList.remove('open');
    lb.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    content.innerHTML = '';
    if (last && last.focus) last.focus();
  }
  function openImg(src) {
    if (!src) return;
    izImg.src = src;
    iz.classList.add('open');
    iz.setAttribute('aria-hidden', 'false');
    iz.querySelector('.iz-close').focus();
  }
  function closeImg() {
    if (!iz.classList.contains('open')) return;
    iz.classList.remove('open');
    iz.setAttribute('aria-hidden', 'true');
    izImg.removeAttribute('src');
    if (lb.classList.contains('open')) box.focus();
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
  // 點大卡片「以外」的任何地方都關燈箱——scrim、四周暗area、右上角 × 都算。
  // × 是 .lb 的直接子（不在 .lb-box 裡），所以這一條也涵蓋它。
  lb.addEventListener('click', function (e) {
    if (!e.target.closest('.lb-box')) close();
  });
  iz.addEventListener('click', closeImg); // zoom-out：點任意處（含大圖、×）收回
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (iz.classList.contains('open')) { closeImg(); return; } // 先收大圖，燈箱還開著
    if (lb.classList.contains('open')) close();
  });

  // 版面跟牆上（Wall.tsx）同一套：釘選的排成頂端一列（.pinned-row），其餘
  // 走 column-major「大致等高」——照 DOM 順序把第一欄從上疊到接近平均高度
  // 才換下一欄，每欄內部完全緊貼不留空白。匯出當下若在「看全部」，便利貼
  // 已依分類排好序，同色系因此落在同一直行。列印時 @media print 把 main
  // 切回 CSS Grid（position:static），這裡寫的 inline 定位自動失效。
  var MIN_COL_W = window.__WALL_MIN_COL__ || 250, GAP = 28;
  function layout() {
    var cs = getComputedStyle(wall);
    var padL = parseFloat(cs.paddingLeft) || 0, padR = parseFloat(cs.paddingRight) || 0;
    var padT = parseFloat(cs.paddingTop) || 0, padB = parseFloat(cs.paddingBottom) || 0;
    var inner = wall.clientWidth - padL - padR;
    var cards = [].slice.call(wall.children).filter(function (el) {
      return el.classList.contains('note');
    });
    var pinnedRow = wall.querySelector('.pinned-row');
    if (inner <= 1 || (!cards.length && !pinnedRow)) return;
    var topOffset = pinnedRow ? pinnedRow.offsetHeight + GAP : 0;
    var numCols = Math.max(1, Math.floor((inner + GAP) / (MIN_COL_W + GAP)));
    var colW = (inner - GAP * (numCols - 1)) / numCols;

    if (window.__BAND_BY_TAG__) {
      // 「同分類集中」：DOM 上是 label, note, note, …, label, note, …——每條 label
      // 一整排、置頂；接著同分類的 note row-major 補最矮欄；一批排完硬留一大段
      // 空白＋下一條 label，做出分類界線。跟 Wall.tsx 的 bandByTag 一致。
      var items = [].slice.call(wall.children).filter(function (el) {
        return el.classList.contains('note') || el.classList.contains('band-label');
      });
      items.forEach(function (el) {
        el.style.width = (el.classList.contains('band-label') ? inner : colW) + 'px';
      });
      var ih = items.map(function (el) { return el.offsetHeight; });
      var BAND_GAP = GAP * 2;
      var by = padT + topOffset, contentBottom = by, bi = 0;
      while (bi < items.length) {
        if (items[bi].classList.contains('band-label')) {
          items[bi].style.left = padL + 'px';
          items[bi].style.top = by + 'px';
          by += ih[bi] + GAP * 0.55;
          bi++;
          continue;
        }
        var cb = [];
        for (var q = 0; q < numCols; q++) cb.push(by);
        while (bi < items.length && items[bi].classList.contains('note')) {
          var bc = 0;
          for (var bk = 1; bk < numCols; bk++) if (cb[bk] < cb[bc]) bc = bk;
          items[bi].style.left = (padL + bc * (colW + GAP)) + 'px';
          items[bi].style.top = cb[bc] + 'px';
          cb[bc] += ih[bi] + GAP;
          bi++;
        }
        contentBottom = Math.max.apply(null, cb) - GAP;
        by = contentBottom + BAND_GAP;
      }
      wall.style.height = (contentBottom + padB) + 'px';
      wall.classList.add('is-masonry');
      return;
    }

    var colH = [];
    for (var c = 0; c < numCols; c++) colH.push(0);
    cards.forEach(function (el) { el.style.width = colW + 'px'; });
    var hs = cards.map(function (el) { return el.offsetHeight; });
    function place(el, c, h) {
      el.style.left = (padL + c * (colW + GAP)) + 'px';
      el.style.top = (padT + topOffset + colH[c]) + 'px';
      colH[c] += h + GAP;
    }
    if (window.__TAG_AXIS__ === 'horizontal') {
      // 橫向：一張一張放進目前最矮的欄（row-major masonry）——等高卡片就是整齊
      // 一列列，有高矮則後面的卡片補進較淺的欄、不留成塊空白。跟 Wall.tsx 一致。
      cards.forEach(function (el, ix) {
        var c = 0;
        for (var k = 1; k < numCols; k++) if (colH[k] < colH[c]) c = k;
        place(el, c, hs[ix]);
      });
    } else if (window.__COLUMN_PER_TAG__) {
      // 直向 × 看全部：連續同 data-tag 的卡片當一整塊，整塊塞進當下最矮的欄
      // （前 numCols 個分類因此由左到右各佔一欄）。
      var i = 0;
      while (i < cards.length) {
        var tg = cards[i].getAttribute('data-tag') || '';
        var j = i;
        while (j < cards.length && (cards[j].getAttribute('data-tag') || '') === tg) j++;
        var c = 0;
        for (var k = 1; k < numCols; k++) if (colH[k] < colH[c]) c = k;
        for (var m = i; m < j; m++) place(cards[m], c, hs[m]);
        i = j;
      }
    } else {
      // 直向 × 有篩選：真 column-major，第一欄疊到「夠高」才換下一欄——「夠高」
      // 取「總高 / 欄數」與「約一個畫面高」的較大者，篩出來只有幾張時整疊第一欄。
      var totalH = 0;
      for (var t = 0; t < hs.length; t++) totalH += hs[t] + GAP;
      var viewH = (window.innerHeight || 1000) - padT - 40;
      var target = Math.max(totalH / numCols, viewH * 0.9);
      var col = 0;
      cards.forEach(function (el, ix) {
        if (col < numCols - 1 && colH[col] > 0 && colH[col] + hs[ix] / 2 > target) col += 1;
        place(el, col, hs[ix]);
      });
    }
    var bodyH = cards.length ? Math.max.apply(null, colH) - GAP : 0;
    wall.style.height = (padT + topOffset + bodyH + padB) + 'px';
    wall.classList.add('is-masonry');
  }
  var raf = 0;
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); }
  layout();
  window.addEventListener('resize', schedule);
  // 圖片／字型載入完會改變卡片高度——每種都重排一次。window load 是最後保險
  // （所有子資源都到齊了），另外補兩個延遲重排，處理離線開啟時字型晚套用。
  window.addEventListener('load', schedule);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
  [].slice.call(wall.querySelectorAll('img')).forEach(function (img) {
    img.addEventListener('load', schedule);
    img.addEventListener('error', schedule);
  });
  setTimeout(schedule, 250);
  setTimeout(schedule, 1500);
})();
`.trim()

/** 匯出 HTML 的版面／配色選項——對應牆上目前的狀態（見 App onExport）。 */
export interface StickyHtmlOptions {
  tagColors?: Record<string, string>
  defaultNoteColor?: string
  minColWidth?: number
  /** 「看全部＋不指定」時 true——依分類分區（直向一分類一行）。 */
  columnPerTag?: boolean
  /** 卡片排的方向。 */
  tagAxis?: 'vertical' | 'horizontal'
  /** 「同分類集中（分類間隔開）」排序時 true——每個分類一「帶」＋分隔標題條。 */
  bandByTag?: boolean
}

/** 目前這批便利貼 → 一份可離線開、可列印、可點開看大張的 HTML 文件（跟牆上同一套視覺）。
 *  有插圖的便利貼會把圖片以 data URI 內嵌進去，所以檔案可能不小——這是「可離線」的代價。 */
export async function buildStickyNotesHtml(
  notes: Note[],
  opts: StickyHtmlOptions = {},
): Promise<string> {
  const {
    tagColors,
    defaultNoteColor,
    minColWidth,
    columnPerTag = false,
    tagAxis = 'vertical',
    bandByTag = false,
  } = opts
  const minCol = minColWidth && minColWidth > 0 ? Math.round(minColWidth) : 250
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const when = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`

  const renderNote = async (n: Note) => {
    const face = colorForTag(n.tag, tagColors, defaultNoteColor)
    const fold = darken(face, 0.2)
    const tag = n.tag ? `<span class="tag"># ${esc(n.tag)}</span>` : '<span></span>'
    const imgUrl = noteImageUrl(n)
    const dataUri = imgUrl ? await imageDataUri(imgUrl) : null
    const img = dataUri ? `\n      <img class="note-img" src="${dataUri}" alt="">` : ''
    const star = n.pinned ? '<span class="pinned" aria-label="已釘選">★</span>' : ''
    return `    <article class="note${n.pinned ? ' is-pinned' : ''}" tabindex="0" role="button" data-tag="${esc(n.tag)}" aria-label="便利貼：${esc(n.title || '(無標題)')}" style="--face:${face};--fold:${fold}">
      <span class="curl" aria-hidden="true"></span>${star}
      <h2>${esc(n.title || '(無標題)')}</h2>${img}
      ${bodyHtml(n.body)}
      <div class="foot">${tag}<span class="time">${stamp(n.created_at)}</span></div>
    </article>`
  }
  // 釘選的排成頂端一列（.pinned-row），其餘走 column-major——跟牆上一致。
  const pinnedHtml = (await Promise.all(notes.filter((n) => n.pinned).map(renderNote))).join('\n')
  const restNotes = notes.filter((n) => !n.pinned)
  const restRendered = await Promise.all(restNotes.map(renderNote))
  // 「同分類集中」排序：非釘選的便利貼已依分類排好（App 那邊），每個分類前面
  // 插一條 .band-label 標題條——匯出的 layout script 會照它做分類帶。
  const restHtml = bandByTag
    ? restNotes
        .map((n, i) => {
          const sep =
            i === 0 || restNotes[i - 1].tag !== n.tag
              ? `  <div class="band-label" style="--band-color:${colorForTag(n.tag, tagColors)}">${esc(n.tag || '未分類')}</div>\n`
              : ''
          return sep + restRendered[i]
        })
        .join('\n')
    : restRendered.join('\n')
  const cards = `${
    pinnedHtml ? `  <div class="pinned-row">\n${pinnedHtml}\n  </div>\n` : ''
  }${restHtml}`

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
  <p class="meta">共 ${notes.length} 則　·　匯出時間 ${when}　·　來自 file_search_app 便利貼　·　點卡片看大張、再點插圖放大</p>
</header>
<main class="wall" style="--wall-min-col:${minCol}px">
${cards}
</main>
<div class="lb" aria-hidden="true">
  <div class="lb-scrim"></div>
  <button type="button" class="lb-close" aria-label="關閉">×</button>
  <div class="lb-box" role="dialog" aria-modal="true" tabindex="-1">
    <div class="lb-content"></div>
  </div>
</div>
<div class="iz" aria-hidden="true">
  <button type="button" class="iz-close" aria-label="關閉大圖">×</button>
  <img alt="便利貼插圖">
</div>
<script>window.__WALL_MIN_COL__=${minCol};window.__COLUMN_PER_TAG__=${columnPerTag ? 'true' : 'false'};window.__TAG_AXIS__=${tagAxis === 'horizontal' ? "'horizontal'" : "'vertical'"};window.__BAND_BY_TAG__=${bandByTag ? 'true' : 'false'}</script>
<script>${SCRIPT}</script>
</body>
</html>
`
}

/** 觸發下載。filename 例：便利貼_20260903_1530.html */
export async function downloadStickyNotesHtml(
  notes: Note[],
  opts: StickyHtmlOptions = {},
): Promise<void> {
  const html = await buildStickyNotesHtml(notes, opts)
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
