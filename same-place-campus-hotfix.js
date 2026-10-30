/* SAME PLACE Campus — isolated test-site hotfix v0.5
   Load AFTER same-place-campus-upgrade.js. No production changes. */
(()=>{'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const get=(id)=>document.getElementById(id), notify=t=>{if(typeof toast==='function')toast(t);else alert(t)};
 const current=()=>({space:typeof SP!=='undefined'?SP:null,user:typeof me!=='undefined'?me:null,client:typeof sb!=='undefined'?sb:null});
 // FIX 1: Keep media DOM alive across periodic realtime/poll renders when post data has not changed.
 // A newly signed URL is NOT a content change. Recreating <video> resets playback, causing flicker.
 let lastFeedKey=null,lastRoot=null;
 function feedKey(){const {space}=current();const items=typeof posts!=='undefined'?posts:[];
  return JSON.stringify([space?.id,items.map(p=>[p.id,p.author_id,p.body,p.image_path,p.created_at,p.removed, (p.likes||[]).map(l=>[l.user_id,l.is_private]).sort().join(';')])]);}
 function installFeedGuard(){if(typeof window.renderFeed!=='function'||window.renderFeed.__spStable)return;
  const original=window.renderFeed;
  const wrapped=function(...args){const root=get('feedPosts'),key=feedKey();
   if(root&&root===lastRoot&&key===lastFeedKey&&root.childElementCount>0)return;
   // Preserve live video DOM nodes across likes/comments/count refreshes, not only identical data.
   const retained=new Map();
   if(root){const cards=[...root.querySelectorAll(':scope > article.post')];const oldPosts=typeof posts!=='undefined'?posts:[];
    cards.forEach((card,i)=>{const video=card.querySelector('video.sp-feed-video');if(!video)return;
      const id=card.dataset.spPostId||oldPosts[i]?.id;if(!id)return;
      retained.set(id,{node:video,path:video.dataset.spPath||oldPosts[i]?.image_path||''});
      // Remove before innerHTML replacement so media is not destroyed by the DOM rewrite.
      video.remove();
    });
   }
   let value;try{value=original.apply(this,args)}catch(e){console.error('Feed refresh:',e);throw e}
   if(root){const newPosts=typeof posts!=='undefined'?posts:[];
    [...root.querySelectorAll(':scope > article.post')].forEach((card,i)=>{const p=newPosts[i];if(!p)return;
      card.dataset.spPostId=p.id;
      const replacement=card.querySelector('video.sp-feed-video'),keep=retained.get(p.id);
      if(keep&&keep.path===p.image_path){
       if(replacement)replacement.replaceWith(keep.node);
       else{const point=card.querySelector('.post-actions');if(point)point.before(keep.node)}
      }else if(replacement){replacement.dataset.spPath=p.image_path||''}
    });
   }
   lastFeedKey=key;lastRoot=root;return value;};
  wrapped.__spStable=true;window.renderFeed=wrapped;
 }
 // FIX 2: avatar + nickname inside post comments open the existing member profile card.
 // Match the displayed comment ID to its author from a fresh scoped query, never from nickname alone.
 const commentCache=new Map(),busy=new Set();
 async function enhanceCommentPanel(panel){const {space,client}=current();if(!client||!space?.id||!panel||panel.hidden)return;
  const postId=panel.getAttribute('data-sp-comment-panel');if(!postId||busy.has(postId))return;
  const nodes=[...panel.querySelectorAll('.sp-pc-item')];if(!nodes.length||nodes.every(n=>n.dataset.spPerson==='yes'))return;
  busy.add(postId);
  try{const result=await client.from('post_comments').select('id,user_id').eq('post_id',postId).order('created_at',{ascending:false}).limit(100);
   if(result.error)throw result.error; if(!panel.isConnected||panel.hidden)return;
   const ids=(result.data||[]).reverse();const membersList=typeof members!=='undefined'?members:[];
   [...panel.querySelectorAll('.sp-pc-item')].forEach((node,i)=>{if(node.dataset.spPerson==='yes')return;
    const uid=ids[i]?.user_id;if(!uid||!membersList.some(m=>m.user_id===uid))return;
    const meta=node.querySelector('.sp-pc-meta'),name=meta?.querySelector('b');if(!meta||!name)return;
    const m=membersList.find(x=>x.user_id===uid),button=document.createElement('button');button.type='button';button.className='sp-comment-avatar';
    button.setAttribute('aria-label','查看评论者资料');button.textContent=m?.profiles?.avatar_emoji||'◉';
    if(m?.profiles?.avatar_url){button.textContent='';const img=document.createElement('img');img.src=m.profiles.avatar_url;img.alt='';button.append(img)}
    button.addEventListener('click',()=>{if(typeof window.openMemberProfile==='function')window.openMemberProfile(uid)});
    name.style.cursor='pointer';name.addEventListener('click',()=>{if(typeof window.openMemberProfile==='function')window.openMemberProfile(uid)});
    meta.prepend(button);node.dataset.spPerson='yes';
   });
  }catch(e){console.warn('comment-avatar enhancement',e)}finally{busy.delete(postId)}
 }
 // FIX 3: render a genuinely useful sticker tray, shared between DMs and post comments.
 // In this first safe patch, emoji stickers work immediately; saved image stickers require the SQL migration.
 const emojis=['😀','😂','🥹','😭','🥰','😍','😎','🤔','😤','😳','🫠','🤝','👍','👏','🔥','❤️','💚','💀','🐱','🐶','🎉','🙌','👀','✨'];
 let tray=null, targetInput=null, activeTab='emoji',list=[],stickerCache=new Map();
 function createTray(){if(tray)return;const style=document.createElement('style');style.textContent=`
  .sp-comment-avatar{flex:0 0 27px;width:27px;height:27px;border-radius:9px;border:1px solid #354537;background:#171e17;color:#c7ff45;display:grid;place-items:center;cursor:pointer;font-size:16px;padding:0;overflow:hidden}
  .sp-comment-avatar img{width:100%;height:100%;object-fit:cover}.sp-sticker-launch{height:37px;border:1px solid #3b4d36;background:#151e15;border-radius:9px;color:#c7ff45;cursor:pointer;flex:0 0 36px}
  .sp-sticker-tray{position:fixed;bottom:env(safe-area-inset-bottom, 16px);left:50%;transform:translateX(-50%);width:min(420px,calc(100vw - 20px));max-height:min(450px,70vh);overflow:auto;z-index:100000;background:#101710;border:1px solid #41523f;border-radius:16px;box-shadow:0 10px 45px #000b;padding:14px;color:#eee}
  .sp-sticker-tabs{display:flex;gap:6px;align-items:center;margin-bottom:12px}.sp-sticker-tabs button,.sp-sticker-item{background:#1d281c;color:#eee;border:1px solid #354634;border-radius:9px;cursor:pointer;padding:8px}
  .sp-sticker-tabs button.active{background:#c7ff45;color:#101510}.sp-sticker-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px}
  .sp-sticker-item{font-size:24px;aspect-ratio:1;display:grid;place-items:center;padding:2px;overflow:hidden}.sp-sticker-item img{width:100%;height:100%;object-fit:contain}
  .sp-sticker-hint{font-size:11px;color:#9aaa9a;line-height:1.7}.sp-sticker-making{display:grid;gap:8px}.sp-sticker-making input{background:#182018;border:1px solid #354634;border-radius:8px;color:white;padding:10px;max-width:100%}
  .sp-sticker-preview{width:100%;height:155px;object-fit:contain;background:#1a221a;border-radius:12px}
  .sp-sticker-button{border:0;border-radius:9px;padding:10px;background:#c7ff45;color:#111810;font-weight:700;cursor:pointer}
  `;document.head.append(style);
  tray=document.createElement('div');tray.className='sp-sticker-tray';tray.hidden=true;tray.setAttribute('role','dialog');tray.setAttribute('aria-label','同场表情包');document.body.append(tray);
  document.addEventListener('keydown',e=>{if(e.key==='Escape')tray.hidden=true});
  document.addEventListener('pointerdown',e=>{if(!tray.hidden&&!tray.contains(e.target)&&!e.target.closest('.sp-sticker-launch'))tray.hidden=true});
 }
 function renderTray(){if(!tray)return;
  tray.innerHTML=`<div class="sp-sticker-tabs"><button data-tab="emoji" class="${activeTab==='emoji'?'active':''}">😀 Emoji</button><button data-tab="saved" class="${activeTab==='saved'?'active':''}">⭐ 我的表情</button><button data-tab="make" class="${activeTab==='make'?'active':''}">＋ 制作</button><button data-close style="margin-left:auto">✕</button></div><div id="spStickerBody"></div>`;
  tray.querySelectorAll('[data-tab]').forEach(x=>x.onclick=()=>{activeTab=x.dataset.tab;renderTray()});tray.querySelector('[data-close]').onclick=()=>tray.hidden=true;
  const body=tray.querySelector('#spStickerBody');
  if(activeTab==='emoji'){body.innerHTML='<div class="sp-sticker-grid">'+emojis.map((x,i)=>`<button class="sp-sticker-item" data-e="${i}">${x}</button>`).join('')+'</div>';
   body.querySelectorAll('[data-e]').forEach(b=>b.onclick=()=>insertText(emojis[+b.dataset.e]));}
  else if(activeTab==='saved'){body.innerHTML='<div class="sp-sticker-hint">加载我的表情包…</div>';void loadSaved(body)}
  else{if(!window.spStickerEditor){body.textContent='编辑器未加载，请刷新后重试';return;}
   window.spStickerEditor.mount(body);
   body.querySelector('#spStickerSave').onclick=()=>void makeSticker(body);}

 }
 function insertText(text){if(!targetInput||!targetInput.isConnected){notify('请先打开私聊或评论输入框');return};const start=targetInput.selectionStart??targetInput.value.length,end=targetInput.selectionEnd??start;
  targetInput.value=targetInput.value.slice(0,start)+text+targetInput.value.slice(end);targetInput.dispatchEvent(new Event('input',{bubbles:true}));targetInput.focus();targetInput.setSelectionRange(start+text.length,start+text.length);tray.hidden=true;}
 function openTray(input){targetInput=input;createTray();activeTab='emoji';renderTray();tray.hidden=false;}
 function mountButtons(){const chat=get('chatInput');if(chat&&chat.parentElement&&!chat.parentElement.querySelector('[data-sp-sticker-for="chat"]')){
  const btn=document.createElement('button');btn.type='button';btn.className='sp-sticker-launch';btn.textContent='☺';btn.title='表情包';btn.dataset.spStickerFor='chat';btn.onclick=()=>openTray(chat);chat.before(btn)}
  document.querySelectorAll('[data-sp-comment-input],.sp-meal-comment-row input').forEach(input=>{const parent=input.parentElement;if(!parent||parent.querySelector('.sp-sticker-launch'))return;
   const btn=document.createElement('button');btn.type='button';btn.className='sp-sticker-launch';btn.textContent='☺';btn.title='表情包';btn.onclick=()=>openTray(input);input.before(btn)});
 }
 async function loadSaved(body){const {client,user}=current();if(!client||!user){body.textContent='请先登录';return}
  const r=await client.from('user_sticker_saves').select('sticker_id,user_stickers(id,storage_path)').eq('user_id',user.id).limit(100);
  if(!body.isConnected)return;if(r.error){body.textContent='尚未安装表情包数据库。需要先执行随附的 SQL 文件。';return}
  const a=(r.data||[]).map(x=>x.user_stickers).filter(Boolean);if(!a.length){body.innerHTML='<p class="sp-sticker-hint">还没有收藏的表情包。选择「制作」添加第一张。</p>';return}
  const paths=a.map(x=>x.storage_path);const urls=await client.storage.from('sp-stickers').createSignedUrls(paths,1800);
  if(urls.error){body.textContent='表情包加载失败：'+urls.error.message;return}
  const mapped=new Map((urls.data||[]).map(x=>[x.path,x.signedUrl]));body.innerHTML='<div class="sp-sticker-grid">'+a.map((x,i)=>`<button class="sp-sticker-item" data-sticker="${i}"><img alt="表情包" src="${esc(mapped.get(x.storage_path)||'')}"></button>`).join('')+'</div>';
  body.querySelectorAll('[data-sticker]').forEach(btn=>btn.onclick=()=>insertText('[[SPSTICKER:'+a[+btn.dataset.sticker].id+']]'));
 }
 async function makeSticker(body){const {client,user}=current();if(!client||!user)return notify('请先登录');const status=body.querySelector('#spStickerStatus');
  const save=body.querySelector('#spStickerSave');save.disabled=true;status.textContent='正在保存…';
  try{const blob=await window.spStickerEditor.export(body);if(blob.size>2*1024*1024)throw Error('图片超过2MB，请换一张图片');const path=user.id+'/'+crypto.randomUUID()+'.jpg';const up=await client.storage.from('sp-stickers').upload(path,blob,{contentType:'image/jpeg'});if(up.error)throw up.error;
   const row=await client.from('user_stickers').insert({owner_id:user.id,storage_path:path}).select('id').single();if(row.error){await client.storage.from('sp-stickers').remove([path]);throw row.error}
   const fav=await client.from('user_sticker_saves').insert({user_id:user.id,sticker_id:row.data.id});if(fav.error)throw fav.error;
   status.textContent='制作完成，已加入我的表情！';activeTab='saved';renderTray();
  }catch(e){status.textContent='制作失败：'+e.message}finally{save.disabled=false}
 }
 // Read-only upgrade of rendered sticker markers. Handles periodically recreated comment/chat nodes.
 let markerBusy=false;const TOKEN=/\[\[SPSTICKER:([0-9a-f-]{36})\]\]/g;
 async function renderMarkers(){if(markerBusy)return;const {client}=current();if(!client)return;
  const roots=[get('messages'),get('feedPosts'),get('spMealDetailContent')].filter(Boolean),found=[];
  for(const root of roots){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while((n=walker.nextNode())){const s=n.nodeValue||'';if(s.includes('[[SPSTICKER:')&&TOKEN.test(s))found.push(n);TOKEN.lastIndex=0;if(found.length>50)break;}}
  if(!found.length)return;markerBusy=true;
  try{const ids=[...new Set(found.flatMap(n=>[...n.nodeValue.matchAll(TOKEN)].map(m=>m[1])))];const db=await client.from('user_stickers').select('id,storage_path').in('id',ids);if(db.error)return;
   const rows=db.data||[];const urls=await client.storage.from('sp-stickers').createSignedUrls(rows.map(x=>x.storage_path),1800);const m=new Map(rows.map((x,i)=>[x.id,urls.data?.[i]?.signedUrl]));
   for(const n of found){if(!n.isConnected)continue;const frag=document.createDocumentFragment();let at=0;const s=n.nodeValue;for(const match of s.matchAll(TOKEN)){
    frag.append(document.createTextNode(s.slice(at,match.index)));const url=m.get(match[1]);if(url){const img=document.createElement('img');img.src=url;img.alt='表情包';img.style.cssText='width:110px;height:110px;max-width:100%;object-fit:contain;vertical-align:middle;cursor:pointer';img.onclick=()=>void saveSharedSticker(match[1]);img.title='点击收藏表情包';frag.append(img)}else frag.append(document.createTextNode('［表情包暂不可用］'));at=match.index+match[0].length}
    frag.append(document.createTextNode(s.slice(at)));n.replaceWith(frag)}
  }catch(e){console.warn('Sticker render',e)}finally{markerBusy=false}
 }
 async function saveSharedSticker(id){const {client,user}=current();if(!client||!user)return;const r=await client.from('user_sticker_saves').upsert({user_id:user.id,sticker_id:id},{onConflict:'user_id,sticker_id',ignoreDuplicates:true});notify(r.error?'收藏失败：'+r.error.message:'已收藏表情包')}
 let scheduled=false;function refresh(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;installFeedGuard();mountButtons();for(const p of document.querySelectorAll('[data-sp-comment-panel]'))void enhanceCommentPanel(p);void renderMarkers()},220)}
 function init(){createTray();installFeedGuard();mountButtons();const root=get('feedPosts');if(root)new MutationObserver(refresh).observe(root,{subtree:true,childList:true});const msg=get('messages');if(msg)new MutationObserver(refresh).observe(msg,{subtree:true,childList:true});const meals=get('spMealDetailContent');if(meals)new MutationObserver(refresh).observe(meals,{subtree:true,childList:true});refresh();}
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();


/* SAME PLACE Campus: weekly menu deletion control, test branch only. v1 */
(() => {
  'use strict';
  const $ = (s, root = document) => root.querySelector(s);
  const BUCKET = 'sp-campus-menu';
  let busy = false;
  function weekMonday(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const dt = new Date(y, m - 1, d, 12);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
    dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }
  function findCard() {
    const root = $('#spMealContent');
    if (!root) return null;
    return [...root.querySelectorAll('.sp-meal-panel')].find(p => $('#spMealWeekDate', p) && $('[data-action="uploadWeek"]', p)) || null;
  }
  function getCurrentWeek(card) {
    // The original Campus view writes the actual displayed Monday as YYYY-MM-DD 起.
    // Never take a user-edited upload date as the delete target.
    const header = $('.sp-meal-card-title', card);
    const monday = (header?.textContent || '').match(/\b(\d{4}-\d{2}-\d{2})\s*起/);
    return monday ? weekMonday(monday[1]) : null;
  }
  function feedback(card, message, error = false) {
    let el = $('[data-sp-week-delete-feedback]', card);
    if (!el) {
      el = document.createElement('p');
      el.dataset.spWeekDeleteFeedback = '';
      el.setAttribute('role', 'status');
      el.style.cssText = 'font-size:12px;line-height:1.6;margin:8px 0;';
      $('[data-action="uploadWeek"]', card)?.parentElement?.append(el);
    }
    el.textContent = message;
    el.style.color = error ? '#ff9fa5' : '#c7ff45';
  }
  async function removeMenu(card, button) {
    if (busy) return;
    const space = typeof SP === 'undefined' ? null : SP;
    const user = typeof me === 'undefined' ? null : me;
    const client = typeof sb === 'undefined' ? null : sb;
    const roleName = typeof role === 'undefined' ? '' : role;
    if (!space?.id || !user?.id || !client || roleName !== 'admin') return feedback(card, '只有当前空间管理员可以删除总菜单。', true);
    const monday = getCurrentWeek(card);
    if (!monday) return feedback(card, '无法安全确定当前显示的菜单周。请先使用原始菜单视图，或重新打开每日餐食。', true);
    const visibleImage = $('img[alt*="菜单"]', card);
    if (!visibleImage) return feedback(card, '当前周没有总菜单照片，不需要删除。', true);
    busy = true; button.disabled = true;
    try {
      const result = await client.from('campus_menu_weeks')
        .select('id, image_path').eq('space_id', space.id).eq('week_start', monday).maybeSingle();
      if (result.error) throw result.error;
      const record = result.data;
      if (!record) throw new Error('找不到这周的总菜单记录，请重新打开每日餐食。');
      // Guard against a stale or mismatched panel, including a week changed in the upload date input.
      const displayedSrc = decodeURIComponent(visibleImage.currentSrc || visibleImage.src || '');
      if (!displayedSrc.includes(record.image_path)) throw new Error('菜单显示内容与数据库不一致。请重新打开每日餐食后再删除。');
      if (!confirm(`确定删除 ${monday} 开始的这一周学校总菜单吗？\n\n仅删除整周总菜单，不影响任何午餐、晚餐实拍照片。`)) return;
      const deleted = await client.from('campus_menu_weeks').delete()
        .eq('id', record.id).eq('space_id', space.id);
      if (deleted.error) throw deleted.error;
      const storage = await client.storage.from(BUCKET).remove([record.image_path]);
      if (storage.error) console.warn('SAME PLACE weekly menu storage cleanup:', storage.error.message);
      visibleImage.closest('a')?.remove();
      const p = document.createElement('p'); p.className = 'sp-meal-muted';
      p.textContent = '本周学校总菜单已删除。可以在下方重新上传正确的整周菜单。';
      $('.sp-meal-card-title', card)?.after(p);
      button.remove();
      feedback(card, storage.error ? '菜单记录已删除，旧图片清理未完成。' : '已删除本周总菜单。每日餐食照片不受影响。');
    } catch (e) {
      feedback(card, `删除失败：${String(e?.message || e)}`, true);
    } finally { busy = false; button.disabled = false; }
  }
  function mount() {
    const card = findCard();
    if (!card || $('[data-sp-delete-weekly]', card)) return;
    if (!$('img[alt*="菜单"]', card)) return;
    if (typeof role === 'undefined' || role !== 'admin') return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sp-meal-btn';
    b.dataset.spDeleteWeekly = '';
    b.textContent = '删除本周总菜单';
    b.style.cssText = 'margin-left:8px;border-color:#825058;color:#ffb4b9;';
    const save = $('[data-action="uploadWeek"]', card);
    save.parentElement.append(b);
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); void removeMenu(card, b); });
  }
  function init() {
    const root = document.getElementById('spMealContent');
    if (!root) return;
    const observer = new MutationObserver(mount);
    observer.observe(root, {childList:true, subtree:true});
    mount();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();

