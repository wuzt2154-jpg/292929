/* SAME PLACE · 测试整合版：公开/私密赞、动态视频、动态评论、每日餐食。 */

/* SAME PLACE · 公开赞 / 私密赞 并发及唯一键修复
 * 问题：原界面使用缓存的 posts.likes 判断是否已赞；该缓存可能过期，
 *       INSERT 一条已有 (post_id,user_id) 的赞会触发 likes_pkey / 23505。
 * 方案：在每次操作前查询服务器真实状态；已赞=取消/切换，未赞=upsert；
 *       同条动态点击时锁定操作，避免连续点击竞争，不删除任何现有赞。
 */
(() => {
  'use strict';
  const inflight = new Set();
  const escMsg = e => String(e?.message || e || '请求失败');
  function info(s){if(typeof toast === 'function') toast(s); else console.info('SAME PLACE：'+s);}
  function install(){
    if(typeof window.toggleLike !== 'function'){
      console.warn('SAME PLACE likes fix: toggleLike not found'); return;
    }
    window.toggleLike = async function(postId, makePrivate=false){
      const p = (typeof posts !== 'undefined' ? posts : []).find(x=>x.id===postId);
      if(!p || typeof me==='undefined' || !me?.id || typeof SP==='undefined' || !SP?.id) return;
      if(typeof has==='function' && !has('likes')){info('此空间未开放点赞');return;}
      if(p.author_id===me.id){info('不能给自己的动态点赞');return;}
      if(typeof blocked!=='undefined' && blocked.has(p.author_id)){info('已屏蔽该成员，无法点赞');return;}
      const key = `${me.id}:${postId}`;
      if(inflight.has(key))return;
      inflight.add(key);
      const wantPrivate=!!makePrivate, uid=me.id, sid=SP.id;
      const buttons=[...document.querySelectorAll('#feedPosts button')]
        .filter(b=>b.getAttribute('onclick')?.includes(`toggleLike('${postId}'`));
      buttons.forEach(b=>b.disabled=true);
      try{
        const existing=await sb.from('likes').select('post_id,user_id,is_private')
          .eq('post_id',postId).eq('user_id',uid).maybeSingle();
        if(existing.error)throw existing.error;
        if(SP?.id!==sid || me?.id!==uid)throw Error('空间已切换，请重新打开动态');
        let result;
        if(existing.data && !!existing.data.is_private===wantPrivate){
          // 点击同一种赞：取消；DELETE 无行也视为成功（幂等）。
          result=await sb.from('likes').delete().match({post_id:postId,user_id:uid});
        }else{
          // 唯一键冲突时安全更新，不向用户弹出 likes_pkey。
          result=await sb.from('likes').upsert(
            {post_id:postId,user_id:uid,is_private:wantPrivate},
            {onConflict:'post_id,user_id'}
          );
        }
        if(result.error)throw result.error;
      }catch(e){
        console.warn('SAME PLACE 点赞失败',e);
        info('点赞未完成：'+escMsg(e));
      }finally{
        inflight.delete(key);
        buttons.forEach(b=>b.disabled=false);
        // 无论成功或失败都从服务器刷新真实计数，不依赖旧缓存。
        if(SP?.id===sid&&me?.id===uid){
          try{await loadFeed(); renderAll();}catch(e){console.warn('SAME PLACE 刷新点赞失败',e);}
        }
      }
    };
    console.info('SAME PLACE: likes_pkey protection active');
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();


/* SAME PLACE · 动态视频 v1.1 | 非破坏性扩展，保留现有图片动态和私聊功能。
 * 在 index.html 原有脚本之后、</body>之前引入本文件。
 * 配套 SQL 将现有私有 post-images 存储桶允许上传视频；不改 posts 表结构。
 */
(() => {
  'use strict';
  const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
  const MIME_BY_EXT = {mp4:'video/mp4', mov:'video/quicktime', webm:'video/webm'};
  const videoSuffix = /\.(mp4|mov|webm)$/i;
  const randomName = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2,12)}`;
  let videoFile = null;
  let videoMime = '';
  let videoExt = '';
  let draftSpace = null;
  let previewUrl = null;
  let pending = false;

  function looksLikeVideo(path) { return videoSuffix.test(String(path||'')); }
  function notify(message) {
    if (typeof toast === 'function') toast(message);
    else console.info('[SAME PLACE 视频]',message);
  }
  function clearVideo({ keepPreview=false } = {}) {
    videoFile = null; videoMime=''; videoExt=''; draftSpace=null;
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
    const input=document.getElementById('spFeedVideoInput');if(input)input.value='';
    if(!keepPreview && document.getElementById('imagePreview')) document.getElementById('imagePreview').replaceChildren();
  }
  function mount() {
    if(document.getElementById('spFeedVideoInput')) return;
    const actions=document.querySelector('#page-feed .compose-actions');
    const photoInput=document.getElementById('postImage');
    if(!actions||!photoInput){console.warn('SAME PLACE 动态视频：未找到现有动态发布区，已跳过');return;}
    const style=document.createElement('style');style.textContent=`
      #spFeedVideoInput{display:none!important}
      .sp-feed-video-draft{width:100%;max-height:320px;border-radius:12px;background:#070908;margin:8px 0;object-fit:contain}
      .sp-feed-video{width:100%;max-height:430px;border-radius:12px;background:#070908;margin:0 0 12px;object-fit:contain}
      .sp-feed-video-error{color:#ffadad;font-size:12px;margin:5px 0 10px}
      .sp-video-upload-state{font-size:12px;margin:8px 0;color:#c7ff45;min-height:16px}
      .sp-video-disabled{opacity:.5;pointer-events:none}
    `;document.head.append(style);
    const label=document.createElement('label');label.className='file-label';
    label.textContent='＋ 添加视频';
    const input=document.createElement('input');input.type='file';input.id='spFeedVideoInput';
    input.accept='video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm';
    label.append(input);actions.insertBefore(label,photoInput.closest('label')?.nextSibling || null);
    const status=document.createElement('p');status.id='spFeedVideoStatus';status.className='sp-video-upload-state';status.setAttribute('role','status');
    document.getElementById('imagePreview').insertAdjacentElement('afterend',status);
    input.addEventListener('change',async()=>{
      const file=input.files?.[0];if(!file)return;
      const ext=file.name.split('.').pop()?.toLowerCase();
      const mime=MIME_BY_EXT[ext];
      if(!mime){notify('请选择 MP4、MOV 或 WebM 视频');input.value='';return;}
      if(file.size===0 || file.size>MAX_VIDEO_BYTES){notify('视频需要小于 25 MB 且不能是空文件');input.value='';return;}
      if(file.type && file.type!=='application/octet-stream' && !Object.values(MIME_BY_EXT).includes(file.type)){notify('视频类型暂不支持，请转换为 MP4、MOV 或 WebM');input.value='';return;}
      clearVideo({keepPreview:true});
      videoFile=file;videoMime=Object.values(MIME_BY_EXT).includes(file.type)?file.type:mime;videoExt=ext;draftSpace=typeof SP!=='undefined'?SP?.id:null;
      if(typeof state!=='undefined')state.imageDraft='';
      photoInput.value='';
      previewUrl=URL.createObjectURL(file);
      const wrap=document.getElementById('imagePreview');wrap.replaceChildren();
      const video=document.createElement('video');video.className='sp-feed-video-draft';
      video.controls=true;video.playsInline=true;video.preload='metadata';video.src=previewUrl;
      const info=document.createElement('p');info.className='small muted';info.textContent=`待发布视频：${file.name}（${(file.size/1024/1024).toFixed(1)} MB）`;
      const remove=document.createElement('button');remove.type='button';remove.className='action';remove.textContent='移除视频 ×';
      remove.addEventListener('click',()=>clearVideo());
      wrap.append(video,info,remove);
      notify('视频已添加，确认后点击发布动态');
    });
    // 原照片 onchange 仍负责照片预览；这里只取消之前的视频草稿。
    photoInput.addEventListener('change',()=>{if(photoInput.files?.length)clearVideo({keepPreview:true});},{capture:true});
    setInterval(()=>{
      if(videoFile && (typeof SP==='undefined'||SP?.id!==draftSpace))clearVideo();
    },1400);
  }

  function installOverrides(){
    if(typeof window.publishPost!=='function'||typeof window.renderFeed!=='function'){
      console.warn('SAME PLACE 动态视频：未找到动态核心函数');return;
    }
    const originalPublish=window.publishPost;
    const originalRender=window.renderFeed;
    window.renderFeed=function(...args){
      const result=originalRender.apply(this,args);
      try {
        const cards=document.querySelectorAll('#feedPosts > article.post');
        const rows=typeof posts!=='undefined'?posts:[];
        for(let i=0;i<rows.length;i++){
          const p=rows[i],card=cards[i];
          if(!card||!looksLikeVideo(p.image_path))continue;
          const image=card.querySelector('img.post-image');
          if(!p.img){
            const error=document.createElement('div');error.className='sp-feed-video-error';error.textContent='视频暂时无法加载，请刷新页面重试';
            (card.querySelector('.post-actions')||card).before(error);continue;
          }
          const video=document.createElement('video');
          video.className='sp-feed-video';video.controls=true;video.playsInline=true;
          video.preload='metadata';video.src=p.img;
          video.setAttribute('aria-label','动态视频');
          video.addEventListener('error',()=>{
            if(video.nextElementSibling?.classList?.contains('sp-feed-video-error'))return;
            const error=document.createElement('p');error.className='sp-feed-video-error';
            error.textContent='视频无法播放：请检查网络或尝试 MP4（H.264）格式';video.after(error);
          });
          if(image)image.replaceWith(video);
          else (card.querySelector('.post-actions')||card).before(video);
        }
      }catch(error){console.error('SAME PLACE 动态视频渲染异常：',error);}
      return result;
    };

    window.publishPost=async function(...args){
      if(!videoFile)return originalPublish.apply(this,args);
      if(pending||window._pub)return;
      if(typeof has!=='function'||!has('feed')){notify('此空间未开放动态发布');return;}
      if(typeof SP==='undefined'||typeof me==='undefined'||!SP?.id||!me?.id||SP.id!==draftSpace){
        notify('空间已经切换，请重新选择视频');clearVideo();return;
      }
      const input=document.getElementById('postText');
      const content=(input?.value||'').trim();
      const file=videoFile,type=videoMime,ext=videoExt,spaceId=SP.id,userId=me.id;
      const path=`${spaceId}/${userId}/${randomName()}.${ext}`;
      const status=document.getElementById('spFeedVideoStatus');
      const btn=document.querySelector('#page-feed .compose-bottom button.primary');
      let uploaded=false,saved=false;
      pending=true;window._pub=1;if(btn){btn.disabled=true;btn.classList.add('sp-video-disabled');}
      if(status)status.textContent='正在上传视频，请勿关闭网页…';
      try{
        const result=await sb.storage.from('post-images').upload(path,file,{contentType:type,upsert:false});
        if(result.error)throw result.error;
        uploaded=true;
        if(SP?.id!==spaceId||me?.id!==userId)throw Error('空间已切换，已取消发布');
        const {error}=await sb.from('posts').insert({space_id:spaceId,body:content||'🎬 视频',image_path:path});
        if(error)throw error;
        saved=true;
        if(input)input.value='';
        clearVideo();
        if(status)status.textContent='视频已发布';
        notify('视频动态发布成功');
        await loadFeed();renderAll();
      }catch(error){
        if(uploaded&&!saved){
          const cleanup=await sb.storage.from('post-images').remove([path]);
          if(cleanup.error)console.warn('视频发布失败后存储清理未成功:',cleanup.error.message);
        }
        const message=typeof msg==='function'?msg(error):(error.message||'请重试');
        if(status)status.textContent='发布失败：'+message;
        notify('视频发布失败：'+message);
      }finally{
        pending=false;window._pub=0;
        if(btn){btn.disabled=false;btn.classList.remove('sp-video-disabled');}
      }
    };
  }
  function start(){mount();installOverrides();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();


/* SAME PLACE · 普通动态评论 v1.2
 * 不更改原 posts、likes、私聊。依赖配套 02_动态评论.sql 新建 post_comments。
 * 与 feed-video.js 一起使用：只在每条动态下追加独立评论区。
 */
(() => {
  'use strict';
  const escapeText = v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let openPostId=null, list=[], countCache=new Map(), countKey='', countAt=0;
  let loading=false, submitting=false, currentSpace=null, seq=0;
  const root=()=>document.getElementById('feedPosts');
  const getCtx=()=>({space:typeof SP!=='undefined'?SP:null,user:typeof me!=='undefined'?me:null,admin:typeof role!=='undefined'&&role==='admin'});
  const show=s=>typeof toast==='function'?toast(s):console.info('SAME PLACE: '+s);
  const replyTime=s=>{const t=new Date(s);return Number.isNaN(t.getTime())?'':t.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});};
  function findPost(id){return (typeof posts!=='undefined'?posts:[]).find(p=>p.id===id);}
  function sameSpace(s){return getCtx().space?.id===s;}
  function mountCards(){
    const container=root();if(!container)return;
    const {space}=getCtx();
    if(currentSpace!==space?.id){currentSpace=space?.id||null;openPostId=null;list=[];countCache.clear();countKey='';seq++;}
    const cards=[...container.querySelectorAll(':scope > article.post')];
    const rows=typeof posts!=='undefined'?posts:[];
    rows.forEach((p,i)=>{
      const card=cards[i];if(!card||card.querySelector('[data-sp-comment-open]'))return;
      const actions=card.querySelector('.post-actions');if(!actions)return;
      const button=document.createElement('button');
      button.type='button';button.className='action';button.setAttribute('data-sp-comment-open',p.id);
      button.textContent='💬 评论';actions.append(button);
      const panel=document.createElement('div');panel.className='sp-post-comment-panel';
      panel.setAttribute('data-sp-comment-panel',p.id);panel.hidden=true;card.append(panel);
    });
    if(openPostId && findPost(openPostId)){
      const panel=container.querySelector(`[data-sp-comment-panel="${openPostId}"]`);
      if(panel){panel.hidden=false;drawPanel(panel);}
    }else{openPostId=null;list=[];}
    for(const [id,n] of countCache){const b=container.querySelector(`[data-sp-comment-open="${id}"]`);if(b)b.textContent=`💬 评论 · ${n}`;}
    scheduleCounts();
  }
  function drawPanel(panel){
    const ctx=getCtx(),s=ctx.space?.id;
    const prevDraft=panel.querySelector('[data-sp-comment-input]')?.value||'';
    const notices=loading?'<p class="sp-pc-muted">正在加载评论…</p>':(!list.length?'<p class="sp-pc-muted">还没有评论，来说一句吧。</p>':'');
    panel.innerHTML=`<div class="sp-pc-heading">评论 <span class="sp-pc-muted">${list.length?`最近 ${list.length} 条`:''}</span></div>${notices}`+
      `<div class="sp-pc-list">${list.map(c=>{const own=ctx.user?.id===c.user_id;
        return `<div class="sp-pc-item"><div class="sp-pc-meta"><b>${escapeText(c.nickname||'同学')}</b><time>${escapeText(replyTime(c.created_at))}</time></div>`+
          `<div class="sp-pc-text">${escapeText(c.body)}</div><div class="sp-pc-item-actions">`+
          `${own||ctx.admin?`<button type="button" class="action" data-sp-comment-delete="${escapeText(c.id)}" data-sp-comment-post="${escapeText(openPostId)}">删除</button>`:''}`+
          `${!own?`<button type="button" class="action" data-sp-comment-report="${escapeText(c.id)}" data-sp-comment-post="${escapeText(openPostId)}">举报</button>`:''}</div></div>`;
      }).join('')}</div>`+
      `<div class="sp-pc-compose"><input type="text" maxlength="300" aria-label="输入动态评论" placeholder="写一条评论（最多300字）" data-sp-comment-input="${escapeText(openPostId)}"><button type="button" class="button primary" data-sp-comment-send="${escapeText(openPostId)}" ${submitting?'disabled':''}>发送</button></div>`+
      `<p class="sp-pc-status" role="status"></p>`;
    const input=panel.querySelector('[data-sp-comment-input]');if(input)input.value=prevDraft;
  }
  async function openComments(id){
    const ctx=getCtx();if(!ctx.space?.id||!ctx.user?.id||!findPost(id))return;
    if(openPostId===id){openPostId=null;list=[];mountCards();return;}
    openPostId=id;list=[];loading=true;
    const thisSeq=++seq,sid=ctx.space.id;
    mountCards();
    try{
      const c=await sb.from('post_comments')
        .select('id,post_id,user_id,body,created_at')
        .eq('post_id',id).order('created_at',{ascending:false}).limit(100);
      if(c.error)throw c.error;
      const rows=(c.data||[]).slice().reverse();
      const ids=[...new Set(rows.map(x=>x.user_id).filter(Boolean))];let names=new Map();
      if(ids.length){const p=await sb.from('profiles').select('id,nickname').in('id',ids);if(p.error)console.warn('评论用户资料加载失败',p.error);else names=new Map((p.data||[]).map(x=>[x.id,x.nickname]));}
      if(thisSeq!==seq||openPostId!==id||!sameSpace(sid))return;
      list=rows.map(x=>({...x,nickname:names.get(x.user_id)||'同学'}));
      countCache.set(id,rows.length);
    }catch(e){
      if(thisSeq!==seq||openPostId!==id)return;
      console.warn('SAME PLACE 评论加载错误',e);
      list=[];show(e?.code==='42P01'?'评论数据库尚未安装，请先在测试库运行 02_动态评论.sql':'评论加载失败：'+(e?.message||e));
    }finally{
      if(thisSeq===seq && openPostId===id){loading=false;mountCards();}
    }
  }
  async function send(id){
    const ctx=getCtx();if(submitting||openPostId!==id||!ctx.user?.id||!ctx.space?.id)return;
    const input=root()?.querySelector(`[data-sp-comment-input="${id}"]`);
    const body=(input?.value||'').trim();if(!body)return show('请输入评论');if(body.length>300)return show('评论最多300字');
    submitting=true;const sid=ctx.space.id;
    const button=root()?.querySelector(`[data-sp-comment-send="${id}"]`);if(button)button.disabled=true;
    try{
      const {error}=await sb.from('post_comments').insert({post_id:id,user_id:ctx.user.id,body});
      if(error)throw error;
      countCache.set(id,(countCache.get(id)||list.length)+1);
      if(sameSpace(sid)){
        await openCommentsRefresh(id);
        show('评论已发布');
      }
    }catch(e){show('评论发布失败：'+(e?.message||e));}
    finally{submitting=false;const current=root()?.querySelector(`[data-sp-comment-send="${id}"]`);if(current)current.disabled=false;}
  }
  async function openCommentsRefresh(id){
    // 保持展开，不调用 toggle 行为。
    if(openPostId!==id)return;
    openPostId=null;seq++;await openComments(id);
  }
  async function remove(id,postId){
    if(!confirm('确定删除这条评论？'))return;
    const {error}=await sb.from('post_comments').delete().eq('id',id);
    if(error)return show('删除失败：'+error.message);
    countCache.delete(postId);countAt=0;await openCommentsRefresh(postId);show('评论已删除');
  }
  async function report(id,postId){
    const ctx=getCtx();if(!ctx.space?.id||!ctx.user?.id)return;
    const reason=prompt('举报这条评论的原因（不超过200字）');if(!reason?.trim())return;
    const body=`评论 ${id}：${reason.trim().slice(0,190)}`;
    const {error}=await sb.from('reports').insert({space_id:ctx.space.id,post_id:postId,reporter_id:ctx.user.id,reason:body.slice(0,300)});
    if(error)return show('举报失败：'+error.message);
    show('举报已提交，空间管理员可以处理');
  }
  async function loadCounts(ids,sid){
    if(!ids.length)return;
    const {data,error}=await sb.from('post_comments').select('post_id').in('post_id',ids).limit(2000);
    if(error){if(error.code!=='42P01')console.warn('评论计数暂不可用',error);return;}
    if(!sameSpace(sid))return;
    const counts=new Map(ids.map(id=>[id,0]));
    for(const x of data||[])counts.set(x.post_id,(counts.get(x.post_id)||0)+1);
    for(const [id,n] of counts)countCache.set(id,n);
    for(const [id,n] of counts){const b=root()?.querySelector(`[data-sp-comment-open="${id}"]`);if(b)b.textContent=`💬 评论 · ${n}${data?.length===2000?'+':''}`;}
  }
  function scheduleCounts(){
    const ctx=getCtx(),ids=(typeof posts!=='undefined'?posts:[]).map(p=>p.id);
    if(!ctx.space?.id||!ctx.user?.id||!ids.length)return;
    const signature=ctx.space.id+':'+ids.join(',');
    if(countKey===signature && Date.now()-countAt<45000)return;
    countKey=signature;countAt=Date.now();
    // 在旧计数缓存仍可见时，异步更新，不阻塞动态首屏。
    Promise.resolve().then(()=>loadCounts(ids,ctx.space.id)).catch(e=>console.warn('评论计数错误',e));
  }
  function click(e){
    const btn=e.target.closest('[data-sp-comment-open],[data-sp-comment-send],[data-sp-comment-delete],[data-sp-comment-report]');
    if(!btn||!root()?.contains(btn))return;
    if(btn.dataset.spCommentOpen)return void openComments(btn.dataset.spCommentOpen);
    if(btn.dataset.spCommentSend)return void send(btn.dataset.spCommentSend);
    if(btn.dataset.spCommentDelete)return void remove(btn.dataset.spCommentDelete,btn.dataset.spCommentPost);
    if(btn.dataset.spCommentReport)return void report(btn.dataset.spCommentReport,btn.dataset.spCommentPost);
  }
  function install(){
    if(typeof window.renderFeed!=='function'||!root()){console.warn('SAME PLACE comments: feed not found');return;}
    const style=document.createElement('style');style.textContent=`
      .sp-post-comment-panel{border-top:1px solid var(--line,#29312c);margin-top:13px;padding-top:10px}
      .sp-post-comment-panel[hidden]{display:none!important}.sp-pc-heading{font-size:13px;font-weight:700;margin-bottom:9px}
      .sp-pc-muted{color:var(--muted,#929d95);font-size:12px}.sp-pc-item{padding:10px 1px;border-bottom:1px solid #29332b}
      .sp-pc-meta{display:flex;align-items:center;gap:10px}.sp-pc-meta b{font-size:12px}.sp-pc-meta time{font-size:10px;color:#88988b}
      .sp-pc-text{font-size:13px;line-height:1.7;margin:4px 0;white-space:pre-wrap;overflow-wrap:anywhere}
      .sp-pc-item-actions{display:flex;gap:4px}.sp-pc-item-actions .action{font-size:11px}
      .sp-pc-compose{display:flex;gap:7px;margin-top:10px}.sp-pc-compose input{flex:1;min-width:0;border:1px solid #344235;border-radius:9px;background:#0e140f;color:#fff;padding:10px;font-size:12px}
      .sp-pc-status{font-size:11px;color:#c7ff45}
    `;document.head.append(style);
    const original=window.renderFeed;
    window.renderFeed=function(...args){const r=original.apply(this,args);mountCards();return r;};
    root().addEventListener('click',click);
    root().addEventListener('keydown',e=>{
      if(e.key==='Enter'&&e.target.matches('[data-sp-comment-input]')){
        e.preventDefault();void send(e.target.dataset.spCommentInput);
      }
    });
    mountCards();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();


/* SAME PLACE · CAMPUS / 每日餐食 · v1.1
 * 加载方式：在原 index.html 的 </body> 前加入
 * <script src="./campus-meals.js" defer></script>
 * 只增加入口和独立的餐食层，不覆盖原来的动态、登录、私聊或通知函数。
 */
(() => {
  'use strict';
  const BUCKET = 'sp-campus-menu';
  const MAX_FILE = 15 * 1024 * 1024;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const $ = (s, root=document) => root.querySelector(s);
  const $$ = (s, root=document) => [...root.querySelectorAll(s)];
  const current = () => ({
    client: typeof sb !== 'undefined' ? sb : null,
    space: typeof SP !== 'undefined' ? SP : null,
    user: typeof me !== 'undefined' ? me : null,
    admin: typeof role !== 'undefined' && role === 'admin',
    campus: typeof state !== 'undefined' && state.config?.venue === 'education',
  });
  const today = () => fmtDate(new Date());
  const fmtDate = (date) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const parseDate = (s) => { const [y,m,d] = s.split('-').map(Number); return new Date(y,m-1,d,12); };
  const addDays = (s, n) => { const d=parseDate(s); d.setDate(d.getDate()+n); return fmtDate(d); };
  const weekStart = (s) => { const d=parseDate(s); d.setDate(d.getDate()-((d.getDay()+6)%7)); return fmtDate(d); };
  const pretty = s => { const d=parseDate(s); return `${d.getMonth()+1}月${d.getDate()}日 · ${'日一二三四五六'[d.getDay()]}`; };
  const uuid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const safeURL = s => { try { const u=new URL(s); return u.protocol==='https:' ? u.href : ''; } catch {return '';} };
  const errMsg = e => String(e?.message || e || '操作失败');
  let root, entry, viewing = false, loading = false, day = today(), week = weekStart(day);
  let meal = 'lunch', pics = [], weekly = null, urlMap=new Map(), memberMap=new Map();
  let photoFile=null, weeklyFile=null, openGallery=false, detailId=null, detailLikes=[], detailComments=[];
  let pending = false, lastSpaceId = null, loadSeq = 0, previousOverflow = ''; 

  const css = `
   .sp-meal-entry{display:inline-flex;align-items:center;gap:6px;white-space:nowrap;border:1px solid #668d3a;background:#1d2a18;color:#d9ff88;border-radius:12px;padding:10px 11px;font-size:12px;font-weight:700;cursor:pointer}
   .sp-meal-entry:hover{background:#293921}.sp-meal-entry[hidden]{display:none!important}
   .sp-meal-head-actions{display:flex;flex-wrap:wrap;gap:7px;align-items:center;justify-content:flex-end}
   .sp-meal-mask{position:fixed;inset:0;z-index:150;background:#080a09;display:none;overflow-y:auto;overscroll-behavior:contain;color:#f1f4f1}
   .sp-meal-mask.open{display:block}.sp-meal-screen{max-width:850px;margin:0 auto;padding:18px 18px max(40px,env(safe-area-inset-bottom))}
   .sp-meal-top{position:sticky;top:0;z-index:2;background:#080a09ef;backdrop-filter:blur(16px);padding:10px 0 16px;display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid #303c32}
   .sp-meal-title{font-size:23px;font-weight:800;letter-spacing:.5px}.sp-meal-sub{color:#8e9b90;font-size:10px;letter-spacing:2px;margin-top:4px}
   .sp-meal-btn{border:1px solid #354437;border-radius:11px;background:#17201a;color:#f0f6ee;padding:10px 12px;font-size:12px;cursor:pointer}
   .sp-meal-btn.primary{background:#c7ff45;color:#15200c;border-color:#c7ff45;font-weight:800}.sp-meal-btn:disabled{opacity:.45;cursor:not-allowed}
   .sp-meal-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:17px 0}.sp-meal-row .sp-meal-btn{flex:none}
   .sp-meal-pill{border:1px solid #313b34;background:#131914;border-radius:100px;padding:9px 16px;color:#b9c5bb;cursor:pointer;font-size:13px}
   .sp-meal-pill.selected{background:#c7ff45;color:#131b0c;border-color:#c7ff45;font-weight:700}
   .sp-meal-panel{border:1px solid #2c382f;background:#111713;border-radius:18px;padding:17px;margin:14px 0}
   .sp-meal-card-title{display:flex;justify-content:space-between;gap:8px;align-items:center;font-size:16px;font-weight:700;margin-bottom:11px}
   .sp-meal-muted{font-size:12px;line-height:1.7;color:#a3b0a5}.sp-meal-cover{width:100%;display:block;border-radius:13px;object-fit:cover;max-height:340px;cursor:pointer}
   .sp-meal-photo-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}
   .sp-meal-item{padding:10px;border:1px solid #29352c;border-radius:14px;background:#0d120e;min-width:0}
   .sp-meal-item img{width:100%;height:185px;object-fit:cover;border-radius:10px;display:block;cursor:pointer}
   .sp-meal-author{font-size:12px;margin:9px 0 5px;color:#e2e9e2;overflow-wrap:anywhere}
   .sp-meal-caption{font-size:12px;color:#aebcac;line-height:1.6;overflow-wrap:anywhere}
   .sp-meal-form{display:grid;gap:9px}.sp-meal-form input[type=date],.sp-meal-form input[type=text],.sp-meal-form textarea{border:1px solid #344235;border-radius:11px;padding:11px;color:#eff5ee;background:#0c120d;width:100%;font-size:13px}
   .sp-meal-file{display:flex;flex-direction:column;gap:6px;border:1px dashed #688345;border-radius:11px;padding:13px;cursor:pointer;color:#d1f5a0;font-size:12px}
   .sp-meal-file input{max-width:100%;color:#e9ffe1;font-size:12px}.sp-meal-divider{border-top:1px solid #324032;margin:17px 0}
   .sp-meal-feedback{font-size:12px;color:#c7ff45;min-height:18px;margin-top:8px;white-space:pre-line}
   .sp-meal-detail{position:fixed;inset:0;z-index:160;background:#080a09;overflow-y:auto;display:none}
   .sp-meal-detail.open{display:block}.sp-meal-detail-inner{max-width:650px;margin:auto;padding:16px 18px 60px}
   .sp-meal-detail-img{width:100%;max-height:58vh;object-fit:contain;border-radius:12px;background:#151915}
   .sp-meal-comment{border-bottom:1px solid #253127;padding:11px 0;font-size:12px;line-height:1.7;overflow-wrap:anywhere}
   .sp-meal-comment small{color:#879a89;font-size:10px}.sp-meal-comment strong{color:#e9f6e5}
   .sp-meal-comment-row{display:flex;gap:8px;align-items:center}.sp-meal-comment-row input{min-width:0;flex:1;background:#0f160f;border:1px solid #354437;border-radius:10px;padding:11px;color:#fff}
   @media(max-width:650px){.sp-meal-screen{padding:10px 13px 70px}.sp-meal-title{font-size:20px}.sp-meal-photo-grid{grid-template-columns:1fr 1fr;gap:8px}.sp-meal-item img{height:125px}.sp-meal-top{padding-top:9px}.sp-meal-btn{padding:9px 10px}.sp-meal-entry{padding:8px 9px;font-size:11px}.sp-meal-head-actions .button{padding:8px 9px;font-size:11px}.sp-meal-item{padding:7px}}
   @media(max-width:380px){.sp-meal-photo-grid{grid-template-columns:1fr}.sp-meal-item img{height:230px}}
  `;

  function init() {
    if ($('#spMealOverlay')) return;
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
    const head=$('#page-feed .heading');
    if (!head) return;
    const originalButton=$('button',head);
    const actions=document.createElement('div');actions.className='sp-meal-head-actions';
    if (originalButton) actions.append(originalButton);
    const b=document.createElement('button');b.type='button';b.className='sp-meal-entry';b.textContent='◌ 每日餐食';b.hidden=true;
    b.addEventListener('click',open);actions.append(b);head.append(actions);entry=b;
    root=document.createElement('div');root.id='spMealOverlay';root.className='sp-meal-mask';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','每日餐食');
    root.innerHTML=`<div class="sp-meal-screen"><div class="sp-meal-top"><div><div class="sp-meal-title">每日餐食</div><div class="sp-meal-sub">SAME PLACE · CAMPUS</div></div><button class="sp-meal-btn" data-action="close">返回空间 ✕</button></div><div id="spMealContent"></div></div>`;
    document.body.append(root);
    root.addEventListener('click',onClick);
    root.addEventListener('change',onChange);
    const detail=document.createElement('div');detail.id='spMealDetail';detail.className='sp-meal-detail';detail.setAttribute('role','dialog');detail.setAttribute('aria-modal','true');
    detail.innerHTML='<div class="sp-meal-detail-inner" id="spMealDetailContent"></div>';
    document.body.append(detail);detail.addEventListener('click',onClick);
    const check=()=>{
      const ctx=current();const show=!!(ctx.space?.id && ctx.user?.id && ctx.campus);
      if(entry) entry.hidden=!show;
      if (viewing && (!show || ctx.space.id!==lastSpaceId)) close();
    };
    check();setInterval(check,900);
    document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(detailId)closeDetail();else if(viewing)close();}});
  }
  function notify(s, failed=false) {const el=$('#spMealFeedback');if(el){el.textContent=s;el.style.color=failed?'#ff8190':'#c7ff45'}else if(typeof toast==='function')toast(s);}
  function close(){viewing=false;loadSeq++;root?.classList.remove('open');closeDetail();document.body.style.overflow=previousOverflow;}
  function closeDetail(){detailId=null;$('#spMealDetail')?.classList.remove('open');}
  async function open(){const ctx=current();if(!ctx.client||!ctx.space?.id||!ctx.user?.id||!ctx.campus){return;}
    lastSpaceId=ctx.space.id;viewing=true;openGallery=false;day=today();week=weekStart(day);
    previousOverflow=document.body.style.overflow;root.classList.add('open');document.body.style.overflow='hidden';await load();}
  function guard(){const ctx=current();if(!ctx.client||!ctx.space?.id||!ctx.user?.id||!ctx.campus||ctx.space.id!==lastSpaceId)throw Error('空间已切换，请重新进入每日餐食');return ctx;}
  function pathPrefix(ctx,kind){return `${ctx.space.id}/${kind}/${ctx.user.id}/${uuid()}.jpg`;}
  async function imageBlob(file,kind){
    if (!file || !(file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name))) throw Error('请选择图片文件');
    if (file.size>MAX_FILE)throw Error('原图片不能超过 15MB');
    const u=URL.createObjectURL(file);let img=new Image();
    try {img.src=u;await img.decode().catch(()=>{throw Error('当前浏览器无法读取这张图片，请在相册中转换为 JPG 后重试');});if(img.naturalWidth*img.naturalHeight>45000000)throw Error('图片像素过大，请先缩小后上传');const limit=kind==='weekly'?3600:1700;
      const scale=Math.min(1,limit/Math.max(img.naturalWidth,img.naturalHeight));
      const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
      canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
      const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',kind==='weekly'?.91:.84));
      if(!blob)throw Error('无法处理图片');if(blob.size>12*1024*1024)throw Error('图片处理后仍然过大');return blob;
    }finally{URL.revokeObjectURL(u);img=null;}
  }
  // 批量创建限时签名 URL，避免同一天几十张照片各发一次网络请求。
  async function signPhotos(paths){
    const pathsToSign=[...new Set(paths.filter(Boolean))].filter(path=>{
      const cached=urlMap.get(path);return !(cached?.url&&cached.exp>Date.now());
    });
    if(!pathsToSign.length)return;
    const {client}=guard();
    for(let offset=0;offset<pathsToSign.length;offset+=40){
      const batch=pathsToSign.slice(offset,offset+40);
      const {data,error}=await client.storage.from(BUCKET).createSignedUrls(batch,3600);
      if(error){console.warn('餐食签名失败:',error.message);continue;}
      (data||[]).forEach((item,i)=>{
        const path=item.path||batch[i],url=safeURL(item.signedUrl||'');
        if(path&&url)urlMap.set(path,{url,exp:Date.now()+3500*1000});
      });
    }
  }
  async function load(){
    const seq=++loadSeq;loading=true;const ctx=guard(), requestedDay=day;
    $('#spMealContent').innerHTML='<div class="sp-meal-panel sp-meal-muted">正在加载餐食…</div>';
    try {
      const ws=weekStart(requestedDay);
      const [w,p,m] = await Promise.all([
        ctx.client.from('campus_menu_weeks').select('*').eq('space_id',ctx.space.id).eq('week_start',ws).maybeSingle(),
        ctx.client.from('campus_meal_photos').select('*').eq('space_id',ctx.space.id).eq('meal_date',requestedDay).order('created_at',{ascending:false}).limit(80),
        ctx.client.from('space_members').select('user_id,role,profiles(nickname)').eq('space_id',ctx.space.id)
      ]);
      if (w.error)throw w.error;if(p.error)throw p.error;if(m.error)throw m.error;
      if(seq!==loadSeq||current().space?.id!==lastSpaceId||!viewing)return;
      const photoRows=p.data||[], weekRow=w.data;
      const allPaths=[...(weekRow?[weekRow.image_path]:[]),...photoRows.map(p=>p.image_path)].filter(Boolean);
      await signPhotos(allPaths);
      if(seq!==loadSeq||current().space?.id!==lastSpaceId||!viewing)return;
      week=ws;weekly=weekRow;pics=photoRows;
      memberMap=new Map((m.data||[]).map(x=>[x.user_id,{name:x.profiles?.nickname||'同学',admin:x.role==='admin'}]));
      render();
    }catch(e){if(seq===loadSeq&&viewing)$('#spMealContent').innerHTML=`<div class="sp-meal-panel"><b>餐食加载失败</b><p class="sp-meal-muted">${esc(errMsg(e))}</p><button class="sp-meal-btn" data-action="reload">重试</button></div>`;}
    finally{if(seq===loadSeq)loading=false;}
  }
  const imgUrl=p=>urlMap.get(p)?.url||'';
  function render(){const ctx=guard(),selected=pics.filter(p=>p.meal_type===meal),cover=selected.find(p=>imgUrl(p.image_path));
    const displayed=selected.slice(0,80);const menuUrl=weekly?imgUrl(weekly.image_path):'';
    $('#spMealContent').innerHTML=`
      <div class="sp-meal-row" style="justify-content:space-between"><div style="display:flex;align-items:center;gap:5px"><button class="sp-meal-btn" data-action="prev" aria-label="前一天">‹</button><b style="font-size:14px;min-width:125px;text-align:center">${esc(pretty(day))}</b><button class="sp-meal-btn" data-action="next" aria-label="后一天">›</button></div><button class="sp-meal-btn" data-action="today">回到今天</button></div>
      <div class="sp-meal-row"><button class="sp-meal-pill ${meal==='lunch'?'selected':''}" data-action="lunch">午餐 LUNCH</button><button class="sp-meal-pill ${meal==='dinner'?'selected':''}" data-action="dinner">晚餐 DINNER</button></div>
      <div class="sp-meal-panel"><div class="sp-meal-card-title"><span>${meal==='lunch'?'午餐':'晚餐'}实拍</span><span class="sp-meal-muted">${selected.length} 张分享</span></div>
         ${cover&&imgUrl(cover.image_path)?`<img class="sp-meal-cover" src="${esc(imgUrl(cover.image_path))}" data-action="gallery" alt="${meal==='lunch'?'午餐':'晚餐'}实拍">`:'<p class="sp-meal-muted">还没有实拍照片。欢迎分享你看到的餐食。</p>'}
         <div class="sp-meal-row"><button class="sp-meal-btn" data-action="gallery">${openGallery?'收起照片':'查看全部照片'} ${selected.length?`(${selected.length})`:''}</button></div>
         ${openGallery?`<div class="sp-meal-photo-grid">${displayed.map(p=>{const user=memberMap.get(p.uploaded_by)||{name:'同学',admin:false};const u=imgUrl(p.image_path);return `<div class="sp-meal-item">${u?`<img src="${esc(u)}" loading="lazy" data-action="detail" data-id="${esc(p.id)}" alt="餐食实拍">`:'<p class="sp-meal-muted">图片暂时无法显示</p>'}<div class="sp-meal-author">${user.admin?'✓ 管理员实拍':'📷 同学分享'} · ${esc(user.name)}</div>${p.caption?`<div class="sp-meal-caption">${esc(p.caption)}</div>`:''}<button class="sp-meal-btn" data-action="detail" data-id="${esc(p.id)}">点赞 / 评论</button></div>`;}).join('')}</div>`:''}
         <div class="sp-meal-divider"></div><b style="font-size:13px">＋ 分享这顿餐食</b><p class="sp-meal-muted">中餐、西餐、特色餐可一起拍进展示柜。请避免拍到未经同意的同学。</p>
         <div class="sp-meal-form"><label class="sp-meal-file">选择餐食照片<input id="spMealPhotoInput" type="file" accept="image/*,.heic,.heif"></label><span class="sp-meal-muted" id="spMealPhotoName">尚未选择图片</span><input id="spMealCaption" type="text" maxlength="180" placeholder="简单说说这顿饭（选填）"><div><button class="sp-meal-btn primary" data-action="uploadPhoto">发布照片</button></div></div>
      </div>
      <div class="sp-meal-panel"><div class="sp-meal-card-title"><span>本周学校菜单</span><span class="sp-meal-muted">${esc(week)} 起</span></div>
         ${menuUrl?`<a href="${esc(menuUrl)}" target="_blank" rel="noopener noreferrer" title="放大查看学校菜单"><img class="sp-meal-cover" src="${esc(menuUrl)}" alt="本周学校公布的菜单"></a><p class="sp-meal-muted">点击图片可放大查看，实际供应请以学校为准。</p>`:'<p class="sp-meal-muted">管理员尚未上传本周学校菜单。</p>'}
         ${ctx.admin?`<div class="sp-meal-divider"></div><b style="font-size:13px">管理员 · 更新每周菜单</b><p class="sp-meal-muted">每周上传一次学校公布的整张菜单图片，不需要逐项录入。</p><div class="sp-meal-form"><label class="sp-meal-muted">菜单所属周（选该周任意一天）<input type="date" id="spMealWeekDate" value="${esc(day)}"></label><label class="sp-meal-file">选择学校菜单图片<input id="spMealWeeklyInput" type="file" accept="image/*,.heic,.heif"></label><span class="sp-meal-muted" id="spMealWeeklyName">尚未选择图片</span><div><button class="sp-meal-btn primary" data-action="uploadWeek">保存本周菜单</button></div></div>`:''}
         <p id="spMealFeedback" class="sp-meal-feedback" aria-live="polite"></p>
      </div>`;
    photoFile=null;weeklyFile=null;
  }
  function onChange(e){if(e.target.id==='spMealPhotoInput'){photoFile=e.target.files?.[0]||null;$('#spMealPhotoName').textContent=photoFile?`已选择：${photoFile.name}`:'尚未选择图片';}
    if(e.target.id==='spMealWeeklyInput'){weeklyFile=e.target.files?.[0]||null;$('#spMealWeeklyName').textContent=weeklyFile?`已选择：${weeklyFile.name}`:'尚未选择图片';}}
  async function run(operation){if(pending)return;pending=true;
    $$('[data-action="uploadPhoto"],[data-action="uploadWeek"],[data-action="sendComment"]',document).forEach(b=>b.disabled=true);
    try{await operation();}catch(e){notify(errMsg(e),true);}finally{pending=false;$$('[data-action="uploadPhoto"],[data-action="uploadWeek"],[data-action="sendComment"]',document).forEach(b=>b.disabled=false);}
  }
  async function uploadPhoto(){if(!photoFile){notify('先选择一张餐食照片',true);return;}
    const ctx=guard(),file=photoFile,d=day,t=meal,caption=($('#spMealCaption')?.value||'').trim().slice(0,180);
    await run(async()=>{notify('正在压缩和上传照片…');const blob=await imageBlob(file,'meal'),path=pathPrefix(ctx,'meals');
      const uploaded=await ctx.client.storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:false});if(uploaded.error)throw uploaded.error;
      const inserted=await ctx.client.from('campus_meal_photos').insert({space_id:ctx.space.id,meal_date:d,meal_type:t,image_path:path,caption,uploaded_by:ctx.user.id});
      if(inserted.error){await ctx.client.storage.from(BUCKET).remove([path]);throw inserted.error;}
      openGallery=true;await load();notify('照片发布成功');
    });
  }
  async function uploadWeek(){const ctx=guard();if(!ctx.admin){notify('只有空间管理员可以修改本周菜单',true);return;}
    if(!weeklyFile){notify('先选择学校菜单图片',true);return;}
    const file=weeklyFile,selected=$('#spMealWeekDate')?.value;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(selected||'')){notify('请选择所属日期',true);return;}
    const w=weekStart(selected);
    await run(async()=>{notify('正在保存学校菜单…');const blob=await imageBlob(file,'weekly');const path=pathPrefix(ctx,'weekly');
      const prev=await ctx.client.from('campus_menu_weeks').select('image_path').eq('space_id',ctx.space.id).eq('week_start',w).maybeSingle();if(prev.error)throw prev.error;
      const upl=await ctx.client.storage.from(BUCKET).upload(path,blob,{contentType:'image/jpeg',upsert:false});if(upl.error)throw upl.error;
      const row={space_id:ctx.space.id,week_start:w,image_path:path,uploaded_by:ctx.user.id,updated_at:new Date().toISOString()};
      const saved=await ctx.client.from('campus_menu_weeks').upsert(row,{onConflict:'space_id,week_start'});
      if(saved.error){await ctx.client.storage.from(BUCKET).remove([path]);throw saved.error;}
      // 在数据库保存成功后才移除旧图片；如果权限或网络异常，图片仍保留但不影响最新菜单。
      if(prev.data?.image_path&&prev.data.image_path!==path){const removed=await ctx.client.storage.from(BUCKET).remove([prev.data.image_path]);if(removed.error)console.warn('旧菜单图片未能清理:',removed.error.message);}
      if(week===w)await load();else {day=selected;await load();}
      notify('本周菜单已保存');
    });
  }
  function onClick(e){const b=e.target.closest('[data-action]');if(!b)return;const act=b.dataset.action;
    if(act==='close')return close();if(act==='detailClose')return closeDetail();
    if(act==='prev'||act==='next'||act==='today'){day=act==='today'?today():addDays(day,act==='prev'?-1:1);openGallery=false;closeDetail();return load();}
    if(act==='lunch'||act==='dinner'){meal=act;openGallery=false;render();return;}
    if(act==='gallery'){openGallery=!openGallery;render();return;}
    if(act==='reload')return load();
    if(act==='uploadPhoto')return uploadPhoto();if(act==='uploadWeek')return uploadWeek();
    if(act==='detail')return showDetail(b.dataset.id);
    if(act==='like')return toggleLike();if(act==='sendComment')return sendComment();
    if(act==='deletePhoto')return deletePhoto();if(act==='deleteComment')return deleteComment(b.dataset.id);
  }
  async function showDetail(id){const pic=pics.find(p=>p.id===id);if(!pic)return;
    detailId=id;$('#spMealDetail').classList.add('open');$('#spMealDetailContent').innerHTML='<p class="sp-meal-muted">正在加载评论…</p>';
    const ctx=guard();
    const [likes,comments]=await Promise.all([
      ctx.client.from('campus_meal_photo_likes').select('user_id').eq('photo_id',id),
      ctx.client.from('campus_meal_photo_comments').select('id,user_id,body,created_at').eq('photo_id',id).order('created_at',{ascending:true}).limit(100)
    ]);
    if(detailId!==id)return;if(likes.error||comments.error){$('#spMealDetailContent').textContent='评论加载失败：'+errMsg(likes.error||comments.error);return;}
    detailLikes=likes.data||[];detailComments=comments.data||[];
    const missing=[...new Set(detailComments.map(c=>c.user_id))].filter(u=>!memberMap.has(u));
    if(missing.length){const p=await ctx.client.from('profiles').select('id,nickname').in('id',missing);(p.data||[]).forEach(u=>memberMap.set(u.id,{name:u.nickname||'同学',admin:false}));}
    drawDetail();
  }
  function drawDetail(){const id=detailId,p= pics.find(x=>x.id===id);if(!p)return;const ctx=guard(),u=imgUrl(p.image_path),user=memberMap.get(p.uploaded_by)||{name:'同学',admin:false};
    const liked=detailLikes.some(l=>l.user_id===ctx.user.id);const remove=ctx.admin||p.uploaded_by===ctx.user.id;
    $('#spMealDetailContent').innerHTML=`<div class="sp-meal-top"><strong>餐食实拍 · ${esc(pretty(p.meal_date))}</strong><button class="sp-meal-btn" data-action="detailClose">返回 ✕</button></div>
      ${u?`<img class="sp-meal-detail-img" src="${esc(u)}" alt="餐食实拍">`:'<p class="sp-meal-muted">图片链接失效，请重新打开。</p>'}
      <p class="sp-meal-author">${user.admin?'✓ 管理员实拍':'📷 同学分享'} · ${esc(user.name)}</p>
      ${p.caption?`<p class="sp-meal-caption">${esc(p.caption)}</p>`:''}
      <div class="sp-meal-row"><button class="sp-meal-btn" data-action="like">${liked?'♥ 已赞':'♡ 点赞'} ${detailLikes.length}</button><span class="sp-meal-muted">💬 ${detailComments.length} 条评论</span>${remove?'<button class="sp-meal-btn" data-action="deletePhoto">删除照片</button>':''}</div>
      <div class="sp-meal-panel"><b>评论</b><div>${detailComments.length?detailComments.map(c=>{const person=memberMap.get(c.user_id)||{name:'同学'};return `<div class="sp-meal-comment"><strong>${esc(person.name)}</strong> <small>${esc(new Date(c.created_at).toLocaleString('zh-CN'))}</small><div>${esc(c.body)}</div>${ctx.admin||c.user_id===ctx.user.id?`<button class="sp-meal-btn" data-action="deleteComment" data-id="${esc(c.id)}">删除</button>`:''}</div>`}).join(''):'<p class="sp-meal-muted">还没有评论，说说你的想法。</p>'}</div>
      <div class="sp-meal-comment-row"><input id="spMealCommentInput" maxlength="300" placeholder="写一条评论（最多300字）"><button class="sp-meal-btn primary" data-action="sendComment">发送</button></div><p class="sp-meal-feedback" id="spMealDetailFeedback"></p></div>`;
  }
  async function toggleLike(){if(pending)return;const ctx=guard(),id=detailId;if(!id)return;
    pending=true;try{const liked=detailLikes.some(l=>l.user_id===ctx.user.id);
      const q=liked?ctx.client.from('campus_meal_photo_likes').delete().match({photo_id:id,user_id:ctx.user.id}):ctx.client.from('campus_meal_photo_likes').insert({photo_id:id,user_id:ctx.user.id});
      const {error}=await q;if(error)throw error;await showDetail(id);
    }catch(e){alert('点赞失败：'+errMsg(e));}finally{pending=false;}
  }
  async function sendComment(){const id=detailId,ctx=guard(),text=$('#spMealCommentInput')?.value.trim();if(!text)return;
    if(text.length>300)return alert('评论最多300字');
    if(pending)return;pending=true;
    try{const {error}=await ctx.client.from('campus_meal_photo_comments').insert({photo_id:id,user_id:ctx.user.id,body:text});if(error)throw error;await showDetail(id);}catch(e){alert('评论失败：'+errMsg(e));}finally{pending=false;}
  }
  async function deleteComment(id){const ctx=guard();if(!confirm('确认删除这条评论？'))return;
    const {error}=await ctx.client.from('campus_meal_photo_comments').delete().eq('id',id);if(error)return alert('删除失败：'+errMsg(error));await showDetail(detailId);
  }
  async function deletePhoto(){const ctx=guard(),p=pics.find(x=>x.id===detailId);if(!p||!confirm('确认删除这张照片和下面的评论？'))return;
    const {error}=await ctx.client.from('campus_meal_photos').delete().eq('id',p.id);if(error)return alert('删除失败：'+errMsg(error));
    const removed=await ctx.client.storage.from(BUCKET).remove([p.image_path]);if(removed.error)console.warn('图片存储清理失败:',removed.error.message);closeDetail();openGallery=true;await load();
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();

