export function renderAdminFeedback() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>tau feedback</title>
<style>body{margin:0;background:#090c16;color:#e2e8f0;font:15px system-ui}main{max-width:900px;margin:auto;padding:32px 20px}a{color:#a5b4fc}article{border:1px solid #334155;border-radius:12px;padding:20px;margin:16px 0}p{white-space:pre-wrap;overflow-wrap:anywhere}small{color:#94a3b8}ul{padding-left:20px}button{padding:10px 20px;cursor:pointer}#status{color:#94a3b8}</style></head>
<body><main><a href="/admin/ui">← Ops console</a><h1>Feedback &amp; suggestions</h1><p id="status" role="status">Loading…</p><div id="entries"></div><button id="more" hidden>Load more</button></main>
<script>
let cursor;
const status=document.getElementById('status');
const more=document.getElementById('more');
function add(parent,tag,text){const el=document.createElement(tag);el.textContent=text;parent.appendChild(el);return el;}
async function load(){
  more.disabled=true;status.textContent='Loading…';
  try{
    const response=await fetch('/admin/feedback'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{credentials:'same-origin'});
    if(!response.ok)throw new Error('Could not load feedback ('+response.status+').');
    const data=await response.json();
    for(const row of data.entries){
      const article=document.createElement('article');
      add(article,'h2',row.rating+'/5 · '+row.kind);
      add(article,'small',row.user.email+' · '+new Date(row.createdAt).toLocaleString()+' · '+row.source);
      if(row.projectId)add(article,'p','Project: '+row.projectId);
      add(article,'p',row.message||'No message');
      const list=add(article,'ul','');
      for(const file of row.attachments){const item=add(list,'li','');if(file.url){const link=add(item,'a',file.filename);link.href=file.url;link.target='_blank';link.rel='noopener noreferrer';}else add(item,'span',file.filename);}
      document.getElementById('entries').appendChild(article);
    }
    cursor=data.nextCursor;more.hidden=!cursor;
    status.textContent=document.getElementById('entries').children.length?'Latest feedback first.':'No feedback yet.';
  }catch(error){status.textContent=error.message;}
  finally{more.disabled=false;}
}
more.addEventListener('click',load);load();
</script></body></html>`;
}
