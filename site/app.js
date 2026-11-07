const main = document.querySelector('#main');
const search = document.querySelector('#search');
const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arrow = '<span aria-hidden="true">↗</span>';
const bookDescriptions = {
  '00':'先了解学习路线，以及每种材料适合什么时候使用。',
  A:'让代码真正运行，追踪值与控制，验证并记录修改。',
  B:'看清两个程序怎样交换消息，找到请求最早失败的位置。',
  C:'查询和保存事实，用约束、事务与日志核对数据。',
  D:'面对等待、重复和失败，留下可靠的下一步。',
  E:'把模型建议放进资料、校验、权限与评测的边界内。',
  F:'从能运行到能交付，观察状态，验证备份与恢复。',
  X:'沿一条具体输入，把程序、接口、数据和交付接起来。',
  P:'从业务事实出发，选择方案，判断改变是否真的有用。',
};
const bookIcons = { '00':'↗', A:'{ }', B:'⇄', C:'▤', D:'↻', E:'✳', F:'▣', X:'⋈', P:'◇' };
const readStore = key => { try {return JSON.parse(localStorage.getItem(key));} catch {return null;} };
const writeStore = (key, value) => { try {localStorage.setItem(key, JSON.stringify(value));} catch {} };
const minutes = seconds => {const total=Math.round(seconds);return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;};
const chapterHref = (id, params='') => `#/chapter/${encodeURIComponent(id)}${params}`;
const videoHref = id => `#/video/${encodeURIComponent(id)}`;
const fileLink = (label,url,className='text-link',download=false) => `<a class="${className}" href="./${esc(url)}" target="_blank" rel="noopener"${download?' download':''}>${esc(label)} ${arrow}</a>`;
let data, books, chapters, videos, currentRoute = '/', renderId = 0;
const contentCache = new Map();
let searchIndex;

function toast(text) {
  const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('show');
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2500);
}
function closeMenu() {
  document.body.classList.remove('menu-open'); document.querySelector('#scrim').hidden=true;
  document.querySelector('#menu-toggle').setAttribute('aria-expanded','false');
}
document.querySelector('#menu-toggle').addEventListener('click',()=>{
  const open=document.body.classList.toggle('menu-open');
  document.querySelector('#scrim').hidden=!open;
  document.querySelector('#menu-toggle').setAttribute('aria-expanded',String(open));
});
document.querySelector('#scrim').addEventListener('click',closeMenu);
document.querySelector('#sidebar').addEventListener('click',e=>{if(e.target.closest('a'))closeMenu();});
document.querySelector('#search-form').addEventListener('submit',e=>{
  e.preventDefault();const q=search.value.trim();if(q)location.hash=`/search?q=${encodeURIComponent(q)}`;
});
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'&&document.body.classList.contains('menu-open')){closeMenu();document.querySelector('#menu-toggle').focus();}
  if(e.key==='/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) {e.preventDefault();search.focus();}
});

function renderNav(activeChapter) {
  const selected=activeChapter?.book;
  document.querySelector('#book-nav').innerHTML=data.books.map(b=>`
    <details class="book-nav" ${selected===b.id?'open':''}>
      <summary><span class="book-code">${esc(b.id)}</span><span>${esc(b.title)}</span></summary>
      <div>${b.chapters.map(id=>{const c=chapters.get(id);return `<a href="${chapterHref(id)}" ${activeChapter?.id===id?'aria-current="page"':''}><span>${esc(id)}</span>${esc(c.title)}</a>`;}).join('')}</div>
    </details>`).join('');
  document.querySelectorAll('#primary-nav a').forEach(a=>{
    const active=a.dataset.nav==='home'?currentRoute==='/':currentRoute.startsWith('/'+a.dataset.nav);
    if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
  });
}
function breadcrumb(parts) {
  return `<nav class="breadcrumbs" aria-label="当前位置"><a href="#/">学习首页</a>${parts.map(p=>`<span aria-hidden="true">/</span>${p.url?`<a href="${p.url}">${esc(p.text)}</a>`:`<span aria-current="page">${esc(p.text)}</span>`}`).join('')}</nav>`;
}
function pageHead(kicker,title,description='') {
  return `<header class="page-head"><p class="eyebrow">${esc(kicker)}</p><h1>${esc(title)}</h1>${description?`<p class="lead">${esc(description)}</p>`:''}</header>`;
}
function bookSelect(value,route,label='选择一册') {
  return `<label class="select-label">${label}<select data-filter-route="${route}" aria-label="${label}"><option value="all">全部内容</option>${data.books.map(b=>`<option value="${b.id}" ${value===b.id?'selected':''}>${b.id} · ${esc(b.title)}</option>`).join('')}</select></label>`;
}
function videoCard(v) {
  return `<article class="video-card"><a href="${videoHref(v.id)}" class="poster-link" aria-label="观看：${esc(v.knowledge)}"><img src="./${esc(v.poster)}" loading="lazy" width="640" height="360" alt="${esc(v.knowledge)}的讲解画面"><span class="poster-play" aria-hidden="true">▶</span><span class="duration">${minutes(v.duration)}</span></a><div class="video-card-copy"><span class="eyebrow">${esc(v.chapter)} · ${esc(books.get(chapters.get(v.chapter).book).title)}</span><h3><a href="${videoHref(v.id)}">${esc(v.knowledge)}</a></h3><p>${esc(v.title)}</p></div></article>`;
}
function chapterRow(c) {
  return `<li class="chapter-row"><a href="${chapterHref(c.id)}"><span class="chapter-number">${esc(c.id)}</span><span><strong>${esc(c.title)}</strong><small>${c.videos.length?`${c.videos.length} 支相关视频 · `:''}${c.aids.some(a=>a.kind==='memory')?'记忆表 · ':''}${c.maps?.length||c.aids.some(a=>a.kind==='map')?'关系图':''}</small></span><span class="row-arrow" aria-hidden="true">→</span></a></li>`;
}
function renderHome() {
  const last=readStore('fde-last-opened');const resume=last&&chapters.get(last.id);
  const featured=['B04-01','D04-01','P06-01'].map(id=>videos.get(id)).filter(Boolean);
  main.innerHTML=`<div class="page home">
    <section class="hero"><div class="hero-copy"><p class="eyebrow"><span class="status-dot"></span> FDE · 技术与产品学习</p><h1>把系统看明白，<br>把判断做扎实。</h1><p class="hero-lead">从一段程序开始，理解接口、数据、AI 与交付怎样连接。用具体问题建立知识，再回到真实结果作判断。</p><div class="hero-actions"><a class="button primary" href="${chapterHref(resume?resume.id:'00')}">${resume?'继续上次阅读':'从这里开始'} <span>→</span></a><a class="button quiet" href="#/videos">先看一个视频 ${arrow}</a></div>${resume?`<p class="resume-note">最近打开：${esc(resume.id)} · ${esc(resume.title)}<br><span>仅记住本机位置，不代表已经掌握。</span></p>`:''}</div>
    <div class="hero-art" aria-label="看清事实，理解机制，检验结果"><div class="diagram-caption">从问题到可用的理解</div><div class="art-row"><span class="art-index">01</span><div><b>看见对象</b><small>输入与当前事实</small></div><span class="art-symbol">↘</span></div><div class="art-row art-offset"><span class="art-index">02</span><div><b>跟住变化</b><small>机制与责任交接</small></div><span class="art-symbol">⇄</span></div><div class="art-row art-final"><span class="art-index">03</span><div><b>核对结果</b><small>证据与下一步判断</small></div><span class="art-symbol">✓</span></div><div class="diagram-foot">理解 · 实践 · 查回</div></div></section>
    <section class="start-band"><div><strong>第一次来？只选一条路。</strong><p>顺着教材读；需要看变化时打开视频，忘记时再查表和图。</p></div><a href="#/about">了解材料怎样配合 ${arrow}</a></section>
    <section class="section"><div class="section-heading"><div><p class="eyebrow">学习路线</p><h2>先连起技术，再走向业务判断</h2></div><a class="text-link" href="#/library">完整目录 →</a></div><div class="book-grid">${data.books.filter(b=>b.id!=='00').map(b=>`<a class="book-card book-${b.id}" href="#/library?book=${b.id}"><span class="book-symbol" aria-hidden="true">${bookIcons[b.id]}</span><div class="book-card-top"><span>${b.id} 册</span><span>${b.chapters.length} 章</span></div><h3>${esc(b.title)}</h3><p>${esc(bookDescriptions[b.id]||b.summary)}</p><span class="book-go" aria-hidden="true">↗</span></a>`).join('')}</div></section>
    <section class="section"><div class="section-heading"><div><p class="eyebrow">把变化看清楚</p><h2>从一个完整问题开始</h2></div><a class="text-link" href="#/videos">全部 ${data.videos.length} 支视频 →</a></div><div class="video-grid">${featured.map(videoCard).join('')}</div></section>
    ${footer()}</div>`;
}
function renderLibrary(params) {
  const selected=params.get('book')||'all';const shown=data.books.filter(b=>selected==='all'||b.id===selected);
  main.innerHTML=`<div class="page">${pageHead('教材目录','一步一步，连接整套系统','正文可以直接在线阅读，也可以下载原册 PDF。技术路线从 00 开始，产品与业务放在技术之后。')}<div class="filter-bar">${bookSelect(selected,'library')}<span>9 册 · 59 章</span></div><div class="book-sections">${shown.map(b=>`<section class="book-section"><div class="book-section-head"><span class="large-code">${esc(b.id)}</span><div><h2>${esc(b.title)}</h2><p>${esc(bookDescriptions[b.id]||b.summary)}</p>${b.guide?`<a class="text-link book-guide" href="#/guide/${b.id}">本册导读与查用 →</a>`:''}</div>${fileLink('整册 PDF',b.pdf,'button quiet')}</div><ol class="chapter-list">${b.chapters.map(id=>chapterRow(chapters.get(id))).join('')}</ol></section>`).join('')}</div>${footer()}</div>`;
}
function renderVideos(params) {
  const selected=params.get('book')||'all';const list=data.videos.filter(v=>selected==='all'||chapters.get(v.chapter).book===selected);
  main.innerHTML=`<div class="page">${pageHead('视频讲解','看清一个问题怎样发生','音乐、音效和短字幕，无旁白。按当前疑问选一支，随后回到同一章节；不需要把所有材料重复学一遍。')}<div class="filter-bar">${bookSelect(selected,'videos')}<span>${list.length} 支可观看</span></div><div class="video-grid">${list.map(videoCard).join('')}</div>${footer()}</div>`;
}
function renderResources(params) {
  const selected=params.get('book')||'all';const list=data.chapters.filter(c=>(selected==='all'||c.book===selected)&&(c.aids.length||c.maps?.length));
  main.innerHTML=`<div class="page">${pageHead('记忆与查用','忘记了，就从这里查回','记忆表帮助找重点和短用法；关系图帮助看清对象与联系。它们放在需要的时候用，不是另一套必读课程。')}<div class="filter-bar">${bookSelect(selected,'resources')}<span>${list.length} 章有查用资料</span></div><div class="resource-overviews">${data.books.filter(b=>b.memoryContent&&(selected==='all'||b.id===selected)).map(b=>`<a class="button quiet" href="#/memory/${b.id}">${b.id} 册记忆总表 →</a>`).join('')}${fileLink('完整关系图集','media/maps/atlas.pdf','button quiet')}</div><div class="resource-list">${list.map(c=>`<article class="resource-row"><div><span class="eyebrow">${esc(c.id)} · ${esc(books.get(c.book).title)}</span><h2><a href="${chapterHref(c.id)}">${esc(c.title)}</a></h2></div><div class="resource-actions">${c.aids.filter(a=>a.kind==='memory').map(a=>fileLink('记忆表 PDF',a.url,'button quiet')).join('')}${c.maps?.length?`<a class="button quiet" href="${chapterHref(c.id,'?tab=map')}">查看关系图 →</a>`:c.aids.filter(a=>a.kind==='map').map(a=>fileLink('关系图 PDF',a.url,'button quiet')).join('')}</div></article>`).join('')}</div>${footer()}</div>`;
}
async function renderSupplement(id,kind,params,token) {
  const b=books.get(id),path=kind==='guide'?b?.guide:b?.memoryContent;
  if(!path)return renderNotFound();
  const content=await chapterContent({id:`${kind}-${id}`,content:path});if(token!==renderId)return;
  const label=kind==='guide'?'导读与查用':'记忆总表';
  main.innerHTML=`<div class="reader-page">${breadcrumb([{text:b.title,url:`#/library?book=${id}`},{text:label}])}<div class="reader-heading"><div><p class="eyebrow">${id} 册 · ${label}</p><h1>${esc(b.title)}</h1></div>${fileLink('原册 PDF',b.pdf,'button quiet')}</div><div class="reader-layout"><div class="reader-body"><article class="reading-content">${content.html}</article><p><a class="button primary" href="#/library?book=${id}">回到本册目录 →</a></p></div><aside class="local-toc"><p>本页定位</p><nav>${content.toc.filter(h=>h.level<=3).map(h=>`<a href="#/${kind}/${id}?section=${encodeURIComponent(h.id)}">${esc(h.text)}</a>`).join('')}</nav></aside></div></div>`;
  if(params.get('section'))requestAnimationFrame(()=>document.getElementById(params.get('section'))?.scrollIntoView({block:'start'}));
}
async function renderSearch(params,token) {
  const q=(params.get('q')||'').trim();search.value=q;
  if(!searchIndex){const response=await fetch('./data/search-index.json');if(!response.ok)throw new Error('Search index unavailable');searchIndex=new Map((await response.json()).chapters.map(c=>[c.id,c.text]));}
  if(token!==renderId)return;
  const terms=q.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches=text=>terms.length&&terms.every(t=>text.toLocaleLowerCase().includes(t));
  const shortText=c=>[c.id,c.title,books.get(c.book).title,...c.videos.map(id=>videos.get(id)?.knowledge||'')].join(' ');
  const cs=data.chapters.filter(c=>matches(shortText(c)+' '+(searchIndex.get(c.id)||''))).sort((a,b)=>Number(matches(shortText(b)))-Number(matches(shortText(a))));
  const vs=data.videos.filter(v=>matches(`${v.id} ${v.title} ${v.knowledge} ${v.chapter}`));
  const searchRow=c=>{const text=searchIndex.get(c.id)||'',index=text.toLowerCase().indexOf(terms[0]),snippet=index>=0?text.slice(Math.max(0,index-25),index+105):'';return `<li class="chapter-row"><a href="${chapterHref(c.id)}"><span class="chapter-number">${c.id}</span><span><strong>${esc(c.title)}</strong>${snippet?`<p class="search-snippet">${index>25?'…':''}${esc(snippet)}…</p>`:''}</span><span class="row-arrow" aria-hidden="true">→</span></a></li>`;};
  main.innerHTML=`<div class="page">${pageHead('搜索结果',q?`“${q}”`:'找一个知识点或问题',`${cs.length} 个章节 · ${vs.length} 支视频`)}${!cs.length&&!vs.length?'<div class="empty"><h2>暂时没有找到</h2><p>试试更短的词，例如“请求”“保存”“重试”，或者直接输入章号 A11。</p><a class="button primary" href="#/library">查看教材目录 →</a></div>':''}${cs.length?`<section class="section"><h2>相关章节</h2><ol class="chapter-list search-results">${cs.map(searchRow).join('')}</ol></section>`:''}${vs.length?`<section class="section"><h2>相关视频</h2><div class="video-grid">${vs.map(videoCard).join('')}</div></section>`:''}${footer()}</div>`;
}
async function chapterContent(c) {
  if(!contentCache.has(c.id)) {
    const response=await fetch('./'+c.content);if(!response.ok)throw new Error('章节正文暂时无法加载');
    contentCache.set(c.id,await response.json());
  }return contentCache.get(c.id);
}
async function renderChapter(id,params,token) {
  const c=chapters.get(id);if(!c)return renderNotFound();
  const b=books.get(c.book),tab=params.get('tab')||'text';
  const content=await chapterContent(c);if(token!==renderId)return;
  const i=data.chapters.findIndex(x=>x.id===id),prev=data.chapters[i-1],next=data.chapters[i+1];
  const related=c.videos.map(id=>videos.get(id)).filter(Boolean);
  let panel='';
  if(tab==='video')panel=related.length?`<div class="panel-intro"><h2>本章的视频</h2><p>视频讲一个具体问题，完整范围仍看正文。</p></div><div class="video-grid chapter-videos">${related.map(videoCard).join('')}</div>`:'<div class="empty"><h2>本章暂时没有独立视频</h2><p>可以先沿正文的具体例子学习。</p><a href="'+chapterHref(id)+'">回到正文 →</a></div>';
  else if(tab==='map')panel=c.maps?.length?`<div class="panel-intro"><h2>本章关系图</h2><p>先看当前对象，再沿连线看它交给谁。点击图片可在新页放大。</p></div>${c.maps.map(m=>`<figure class="map-figure"><figcaption><strong>${esc(m.label)}</strong>${m.pdf?fileLink('下载 PDF',m.pdf):''}</figcaption><a href="./${esc(m.url)}" target="_blank" rel="noopener" aria-label="放大${esc(m.label)}"><img src="./${esc(m.url)}" alt="${esc(m.label)}" loading="lazy"></a></figure>`).join('')}`:`<div class="empty"><p>本章关系图可通过 PDF 查看。</p>${c.aids.filter(a=>a.kind==='map').map(a=>fileLink(a.label,a.url,'button quiet')).join('')}</div>`;
  else if(tab==='memory')panel=`<div class="panel-intro"><h2>章节记忆与查用</h2><p>找重点、看短用法；忘记原因时回到正文。英文名用于查找，不是背诵清单。</p></div>${c.aids.filter(a=>a.kind==='memory').map(a=>`<div class="download-panel"><span class="download-icon">▤</span><div><h3>${esc(c.id)} · 章节记忆表</h3><p>保留原来的排版，可阅读或下载。</p></div>${fileLink('打开 PDF',a.url,'button primary')}</div>`).join('')||'<p>本章没有单独的记忆表，直接回正文查阅即可。</p>'}`;
  else panel=`<article class="reading-content">${content.html}</article>`;
  const tabs=[['text','正文'],...(related.length?[['video',`视频 · ${related.length}`]]:[]),...(c.aids.some(a=>a.kind==='memory')?[['memory','记忆表']]:[]),...(c.maps?.length||c.aids.some(a=>a.kind==='map')?[['map','关系图']]:[])];
  main.innerHTML=`<div class="reader-page">${breadcrumb([{text:b.title,url:`#/library?book=${b.id}`},{text:c.id}])}<div class="reader-heading"><div><p class="eyebrow">${esc(c.id)} · ${esc(b.title)}</p><h1>${esc(c.title)}</h1></div>${fileLink('查看原册 PDF',`${c.pdf}#page=${c.pdfPage}`,'button quiet')}</div><nav class="chapter-tabs" aria-label="本章材料">${tabs.map(([t,label])=>`<a href="${chapterHref(id,t==='text'?'':'?tab='+t)}" ${t===tab?'aria-current="page"':''}>${label}</a>`).join('')}</nav><div class="reader-layout"><div class="reader-body">${panel}<nav class="chapter-pager" aria-label="相邻章节">${prev?`<a href="${chapterHref(prev.id)}"><small>← 上一章 · ${prev.id}</small><strong>${esc(prev.title)}</strong></a>`:'<span></span>'}${next?`<a href="${chapterHref(next.id)}"><small>下一章 · ${next.id} →</small><strong>${esc(next.title)}</strong></a>`:''}</nav></div><aside class="local-toc" aria-label="本章定位"><p>${tab==='text'?'本章内容':'继续学习'}</p>${tab==='text'?`<nav>${content.toc.filter(h=>h.level<=3).map(h=>`<a class="toc-level-${h.level}" href="${chapterHref(id,'?section='+encodeURIComponent(h.id))}">${esc(h.text)}</a>`).join('')}</nav>`:`<a href="${chapterHref(id)}">回到本章正文 →</a>`}${related.length&&tab!=='video'?`<div class="toc-related"><p>看变化</p>${related.map(v=>`<a href="${videoHref(v.id)}">▷ ${esc(v.knowledge)} <small>${minutes(v.duration)}</small></a>`).join('')}</div>`:''}</aside></div></div>`;
  writeStore('fde-last-opened',{id:c.id});
  main.querySelectorAll('.reading-content pre').forEach(pre=>{
    if(!pre.querySelector('code'))return;const button=document.createElement('button');button.type='button';button.className='copy-code';button.textContent='复制';button.setAttribute('aria-label','复制这段代码');
    button.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(pre.querySelector('code').textContent);button.textContent='已复制';setTimeout(()=>button.textContent='复制',1500);}catch{toast('请选中这段代码后复制。');}});pre.append(button);
  });
  if(params.get('section'))requestAnimationFrame(()=>document.getElementById(params.get('section'))?.scrollIntoView({block:'start'}));
}
function renderVideo(id) {
  const v=videos.get(id);if(!v)return renderNotFound();const c=chapters.get(v.chapter),b=books.get(c.book);
  main.innerHTML=`<div class="page video-page">${breadcrumb([{text:'视频讲解',url:'#/videos'},{text:v.knowledge}])}${pageHead(`${c.id} · ${b.title}`,v.knowledge,v.title)}<div class="watch-layout"><div><video id="lesson-video" class="lesson-video" controls playsinline preload="metadata" poster="./${esc(v.poster)}"><source src="./${esc(v.url)}" type="video/mp4">${v.subtitle?.endsWith('.vtt')?`<track kind="subtitles" src="./${esc(v.subtitle)}" srclang="zh" label="中文">`:''}<p>浏览器无法直接播放，${fileLink('下载视频',v.url,'',true)}后观看。</p></video><div class="video-note"><span>音乐＋音效＋画面短字幕 · ${minutes(v.duration)} · 无旁白</span>${fileLink('下载视频',v.url,'text-link',true)}</div><div class="return-to-chapter"><div><span class="eyebrow">把视频接回教材</span><h2>${esc(c.title)}</h2><p>需要完整解释或下一步实践时，回到对应章节。</p></div><a class="button primary" href="${chapterHref(c.id)}">阅读 ${c.id} →</a></div></div><aside class="video-chapters"><h2>片内定位</h2><p>只回看当前需要的部分。</p><ol>${v.scenes.map((s,i)=>`<li><button type="button" data-seek="${s.start}"><time>${minutes(s.start)}</time><span>${esc(s.title||'片段 '+(i+1))}</span></button></li>`).join('')}</ol><small>观看记录不作为掌握证据。</small></aside></div>${footer()}</div>`;
  const player=main.querySelector('video');
  main.querySelectorAll('[data-seek]').forEach(button=>button.addEventListener('click',()=>{
    player.currentTime=Number(button.dataset.seek);player.play().catch(()=>toast('点击视频的播放按钮即可继续。'));
  }));
  player.addEventListener('error',()=>toast('视频暂时无法载入，可尝试下载后观看。'));
  writeStore('fde-last-opened',{id:c.id});
}
function renderAbout() {
  main.innerHTML=`<div class="page narrow">${pageHead('使用说明','材料按需要用，学习由问题推进','这是一套自编的技术与产品学习资料。目标是理解机制、使用证据、形成判断，不是完成一张观看清单。')}<div class="about-prose"><h2>第一次从哪里开始</h2><p>先读 <a href="${chapterHref('00')}">00 · 从这里开始</a>，再沿 A → B → C → D → E → F → X 学习技术；产品与业务 P01–P13 放在后面，也可以在有具体业务问题时单独查阅。</p><h2>四种材料，分工不同</h2><dl class="material-roles"><div><dt>教材正文</dt><dd>沿完整例子学习，解释原因、条件和失败位置。</dd></div><div><dt>视频</dt><dd>看清对象、动态变化和交接。讲一个完整问题，不覆盖整章。</dd></div><div><dt>记忆表</dt><dd>忘记重点和短用法时查回，不要求先背完。</dd></div><div><dt>关系图</dt><dd>概念混在一起时，查看位置、上下级与连线。</dd></div></dl><h2>也可以请 AI 带着学</h2><p>把当前章的正文或 PDF 交给你使用的 AI，再告诉它你卡在哪里。网站本身不连接 AI，也不会读取作者的个人进度。</p><blockquote>请结合这一章带我学。先说明对象和当前问题，让我看见具体变化，再解释术语；一次推进一段完整关系。不要把复制命令、看完视频或一句“懂了”当成掌握。</blockquote><h2>关于记录和隐私</h2><p>网站不要求注册，不收集学习记录。最近打开的章节只保存在当前浏览器，换设备不会同步，也不会自动标记学完。</p><button class="button quiet" id="clear-position" type="button">清除本机阅读位置</button><h2>内容与使用边界</h2><p>正文来自当前自编教材；公开视频为已经制作的 31 支基础片。示意动画、合成例子与实际运行证据的范围以材料内说明为准。教材中的 Windows 路径是练习示例，不代表你的电脑已经配置好。</p><p>网页只调整呈现与导航，原册 PDF 可随时打开。配套运行环境需要在自己的电脑准备；遇到涉及真实账号、业务数据或部署的操作，应先核对自己的条件。</p><p>这是个人学习项目，与参考课程或工具厂商没有隶属关系。官方资料引用保留在相应教材中。</p></div>${footer()}</div>`;
  document.querySelector('#clear-position').addEventListener('click',()=>{try{localStorage.removeItem('fde-last-opened');toast('本机阅读位置已清除。');}catch{toast('当前浏览器未保存阅读位置。');}});
}
function footer(){return '<footer class="site-footer"><span>FDE · 技术与产品学习</span><span>由问题出发，让理解落到可核对的结果。</span><a href="#/about">使用说明</a></footer>';}
function renderNotFound(){main.innerHTML=`<div class="page empty">${pageHead('没有找到','这个位置暂时没有内容','可以从教材目录或视频列表重新选择。')}<a class="button primary" href="#/library">回到教材目录 →</a></div>`;}
async function route() {
  if(location.hash==='#main'){main.focus();return;}
  const token=++renderId;const raw=location.hash.slice(1)||'/';const [path,query='']=raw.split('?');const params=new URLSearchParams(query);currentRoute=path;
  const [kind,id]=path.replace(/^\//,'').split('/');const chapter=kind==='chapter'?chapters.get(decodeURIComponent(id||'')):kind==='video'?chapters.get(videos.get(decodeURIComponent(id||''))?.chapter):null;
  if(kind!=='search')search.value='';
  renderNav(chapter);closeMenu();window.scrollTo({top:0});
  try {
    if(kind==='chapter')await renderChapter(decodeURIComponent(id||''),params,token);
    else if(kind==='video')renderVideo(decodeURIComponent(id||''));
    else if(kind==='guide'||kind==='memory')await renderSupplement(decodeURIComponent(id||''),kind,params,token);
    else if(kind==='library')renderLibrary(params);
    else if(kind==='videos')renderVideos(params);
    else if(kind==='resources')renderResources(params);
    else if(kind==='search')await renderSearch(params,token);
    else if(kind==='about')renderAbout();
    else if(!kind)renderHome();else renderNotFound();
    if(token!==renderId)return;
    document.title=(main.querySelector('h1')?.textContent.replace(/\s+/g,' ').trim()||'把系统看明白')+' · FDE 学习站';
    main.querySelectorAll('[data-filter-route]').forEach(el=>el.addEventListener('change',()=>location.hash=`/${el.dataset.filterRoute}${el.value==='all'?'':'?book='+el.value}`));
    main.focus({preventScroll:true});
  }catch(error){main.innerHTML=`<div class="page empty"><h1>这页暂时没有加载成功</h1><p>请刷新后重试，或先打开原册 PDF。</p>${chapter?fileLink('打开原册 PDF',chapter.pdf,'button primary'):''}<a class="button quiet" href="#/">返回首页</a></div>`;console.error(error);}
}
try {
  const response=await fetch('./data/catalog.json');if(!response.ok)throw new Error('Cannot load catalog');data=await response.json();
  books=new Map(data.books.map(b=>[b.id,b]));chapters=new Map(data.chapters.map(c=>[c.id,c]));videos=new Map(data.videos.map(v=>[v.id,v]));
  window.addEventListener('hashchange',route);await route();
}catch(error){main.innerHTML='<div class="page empty"><h1>学习资料暂时没有加载成功</h1><p>请确认通过网站地址打开，然后刷新重试。</p><a class="button primary" href="./media/books/00.pdf">先阅读起始 PDF →</a></div>';console.error(error);}
