/* SAME PLACE · Game Rooms v1.0 | TEST BRANCH ONLY
   Requires Supabase migration same_place_game_rooms_test.sql.
   Separate overlay: doesn't override feed, video or DM rendering. */
(()=>{
  'use strict';
  if(window.__SP_GAME_ROOMS_V1__) return;
  window.__SP_GAME_ROOMS_V1__=true;
  const $=(s,root=document)=>root.querySelector(s);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const faces=['','⚀','⚁','⚂','⚃','⚄','⚅'];
  const ctx=()=>({client:typeof sb==='undefined'?null:sb,space:typeof SP==='undefined'?null:SP,user:typeof me==='undefined'?null:me});
  let overlay=null,entry=null,section='list',room=null,roomEvents=[],members=[],round=null,profiles=new Map();
  let busy=false,pollTimer=null,requestNumber=0,previousBodyOverflow='',lastBombSignature=null,openSpaceId=null;
  const style=`
  .spg-entry{border:1px solid #627a60;background:#1b2c22;color:#c7f8d2;border-radius:12px;padding:10px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
  .spg-entry[hidden]{display:none!important}
  .spg-overlay{display:none;position:fixed;inset:0;z-index:11500;background:rgba(5,8,8,.94);color:#ebf2eb;overflow:auto;-webkit-overflow-scrolling:touch}
  .spg-overlay.open{display:block}
  .spg-wrap{box-sizing:border-box;max-width:900px;min-height:100dvh;margin:auto;padding:20px 17px 90px;font-family:inherit}
  .spg-top{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:20px}
  .spg-title{font-size:23px;font-weight:800;letter-spacing:-.5px}.spg-sub{color:#93a698;font-size:11px;margin-top:4px}
  .spg-btn{font-family:inherit;cursor:pointer;border:1px solid #46584c;border-radius:11px;background:#1a241e;color:#e4efe5;padding:10px 12px;font-size:13px;line-height:1.25}
  .spg-btn.primary{background:#c5eac0;color:#17241a;font-weight:800;border-color:#c5eac0}
  .spg-btn:disabled{opacity:.45;cursor:not-allowed}.spg-btn.danger{color:#ffb6bd;border-color:#81515a}
  .spg-card{background:#121a16;border:1px solid #33463a;border-radius:17px;padding:16px;margin-bottom:14px}
  .spg-row{display:flex;gap:9px;flex-wrap:wrap;align-items:center}.spg-flex{display:flex;flex-direction:column;gap:10px}
  .spg-input{box-sizing:border-box;min-width:0;max-width:100%;background:#0d140f;border:1px solid #405346;border-radius:11px;color:#edf5ee;font:inherit;font-size:14px;padding:11px;width:100%}
  .spg-muted{color:#94a79b;font-size:12px;line-height:1.6}.spg-label{font-size:12px;color:#b3c7b8;margin:0 0 7px}
  .spg-room{display:flex;justify-content:space-between;align-items:center;gap:10px;border-top:1px solid #27392e;padding:14px 0}
  .spg-room:first-child{border-top:none}.spg-room-name{font-size:15px;font-weight:700;word-break:break-word}
  .spg-pill{font-size:11px;color:#b3d3bb;background:#25352a;padding:4px 7px;border-radius:8px}
  .spg-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.spg-actions .spg-btn{flex:1;min-width:100px}
  .spg-feed{height:min(48vh,470px);min-height:270px;overflow:auto;background:#0b120e;border:1px solid #283b2e;border-radius:14px;padding:13px;margin:12px 0;overscroll-behavior:contain}
  .spg-event{padding:9px 0;border-bottom:1px solid #1b2a20;overflow-wrap:anywhere}
  .spg-event:last-child{border-bottom:none}.spg-sender{font-size:11px;color:#a8bead;margin-bottom:4px}
  .spg-bubble{display:inline-block;max-width:90%;font-size:14px;line-height:1.55;color:#edf5ee;white-space:pre-wrap;overflow-wrap:anywhere}
  .spg-system{background:#1d2d23;border-radius:11px;padding:10px 12px;color:#d6f1d8;font-size:13px;line-height:1.55}
  .spg-system.boom{background:#432a27;color:#ffd2bf}
  .spg-bomb{background:#18251c;border:1px solid #48634a;padding:14px;border-radius:14px;margin:10px 0}
  .spg-bomb-range{font-size:29px;font-weight:900;margin:8px 0;color:#d6fac9;font-variant-numeric:tabular-nums}
  .spg-status{min-height:20px;font-size:12px;margin:6px 0;color:#ccf5c3}
  .spg-hidden{display:none!important}
  .spg-input-area{display:flex;gap:8px}.spg-input-area .spg-btn{flex-shrink:0}
  .spg-code{font-family:ui-monospace,Menlo,monospace;letter-spacing:1.2px;font-size:14px;color:#b5eebc}
  @media(max-width:540px){.spg-wrap{padding:14px 12px 100px}.spg-title{font-size:20px}.spg-card{padding:13px}.spg-feed{height:42vh}.spg-actions .spg-btn{min-width:88px}.spg-top .spg-btn{padding:9px}}
  `;
  function showNotice(msg,warning=false){const n=$('#spg-status',overlay);if(n){n.textContent=msg;n.style.color=warning?'#ffa6aa':'#ccf5c3';}}
  function requireCtx(){const c=ctx();if(!c.client||!c.space?.id||!c.user?.id)throw Error('请先登录并进入一个同场空间');return c;}
  function controlBusy(on){busy=on;overlay?.querySelectorAll('[data-spg-action]').forEach(b=>b.disabled=on);}
  async function execute(operation){if(busy)return;controlBusy(true);try{await operation();}catch(e){console.warn('SAME PLACE game room:',e);showNotice(e?.message||'操作失败，请重试',true);}finally{controlBusy(false);}}
  function codeView(){return room?`<span class="spg-code">${esc(room.code)}</span>`:'';}
  function header(){return `<div class="spg-top"><div><div class="spg-title">🎲 游戏房间</div><div class="spg-sub">SAME PLACE · CHAT & PLAY · 不涉及下注</div></div><button class="spg-btn" data-spg-action="close">返回空间 ✕</button></div>`;}
  function opening(){if(overlay?.classList.contains('open'))return;previousBodyOverflow=document.body.style.overflow;document.body.style.overflow='hidden';overlay.classList.add('open');}
  function stopPolling(){if(pollTimer){clearInterval(pollTimer);pollTimer=null;}requestNumber++;}
  function close(){stopPolling();room=null;round=null;roomEvents=[];section='list';openSpaceId=null;overlay.classList.remove('open');document.body.style.overflow=previousBodyOverflow;}
  async function open(){try{requireCtx();}catch(e){showNotice(e.message,true);return;}opening();openSpaceId=ctx().space.id;section='list';room=null;stopPolling();await loadList();}
  function listMarkup(rows){return `${header()}
    <div class="spg-card spg-flex"><b>创建游戏房间</b><div class="spg-muted">同一个空间的成员可以加入。最多20人，聊天与游戏记录自动保存。</div>
    <div class="spg-input-area"><input class="spg-input" id="spg-new-name" maxlength="40" placeholder="房间名称，例如：午休游戏局" autocomplete="off"><button class="spg-btn primary" data-spg-action="create">创建</button></div></div>
    <div class="spg-card"><div class="spg-row" style="justify-content:space-between"><b>当前空间的游戏房间</b><button class="spg-btn" data-spg-action="reload-list">刷新</button></div>
    <div id="spg-room-list">${rows.length?rows.map(r=>`<div class="spg-room"><div><div class="spg-room-name">${esc(r.name)}</div><div class="spg-muted">房间号 <span class="spg-code">${esc(r.code)}</span></div></div><button class="spg-btn primary" data-spg-action="join" data-id="${esc(r.id)}">进入房间</button></div>`).join(''):'<p class="spg-muted">还没有房间，你可以创建第一个。</p>'}</div>
    <div class="spg-muted">仅展示当前同场空间内的房间，切换空间后不会混在一起。</div></div>
    <p class="spg-status" id="spg-status" role="status"></p>`;}
  async function loadList(){const c=requireCtx();const {data,error}=await c.client.from('sp_game_rooms').select('id,code,name,owner_id,created_at').eq('space_id',c.space.id).order('created_at',{ascending:false}).limit(50);if(error)throw error;
    if(!overlay.classList.contains('open')||room)return;section='list';overlay.innerHTML=`<div class="spg-wrap">${listMarkup(data||[])}</div>`;}
  async function create(){const name=$('#spg-new-name',overlay)?.value.trim();if(!name||name.length>40)return showNotice('请输入1～40字的房间名称',true);
    await execute(async()=>{const c=requireCtx();const {data,error}=await c.client.rpc('sp_game_create_room',{p_space:c.space.id,p_name:name});if(error)throw error;await enter(data.id);});}
  async function join(id){await execute(async()=>{const c=requireCtx();const {data,error}=await c.client.rpc('sp_game_join_room',{p_room:id});if(error)throw error;await enter(data.id);});}
  async function enter(id){const c=requireCtx(),{data,error}=await c.client.from('sp_game_rooms').select('id,name,code,space_id').eq('id',id).single();if(error)throw error;
    if(data.space_id!==c.space.id)throw Error('此房间不属于当前空间');room=data;section='room';roomEvents=[];round=null;lastBombSignature=null;members=[];profiles=new Map();stopPolling();
    renderRoomShell();await refreshRoom(true);if(!room)return;pollTimer=setInterval(()=>{if(!document.hidden&&room&&overlay.classList.contains('open'))void refreshRoom(false);},2800);}
  function renderRoomShell(){if(!room)return;overlay.innerHTML=`<div class="spg-wrap">${header()}
    <div class="spg-card"><div class="spg-row" style="justify-content:space-between"><div><b>${esc(room.name)}</b><div class="spg-muted">房间号 ${codeView()} · <span id="spg-count">成员加载中</span></div></div><button class="spg-btn" data-spg-action="back">房间列表</button></div></div>
    <div class="spg-actions"><button class="spg-btn" data-spg-action="dice">🎲 摇骰子</button><button class="spg-btn" data-spg-action="number">🎯 1～100 随机数</button><button class="spg-btn" data-spg-action="bomb">💣 开始数字炸弹</button></div>
    <div id="spg-bomb-box"></div>
    <div class="spg-card"><div style="display:flex;justify-content:space-between;align-items:center"><b>房间聊天 · 游戏记录</b><span class="spg-muted">最近100条</span></div>
    <div class="spg-feed" id="spg-feed" aria-live="polite"><p class="spg-muted">正在加载聊天…</p></div>
    <div class="spg-input-area"><input class="spg-input" id="spg-chat-input" maxlength="500" placeholder="发消息和大家聊天…" autocomplete="off"><button class="spg-btn primary" data-spg-action="send">发送</button></div>
    <p class="spg-status" id="spg-status" role="status"></p></div></div>`;}
  function nickname(user){if(!user)return '玩家';return profiles.get(user)||('玩家 '+String(user).slice(0,5));}
  function formatEvent(e){const mine=e.user_id===ctx().user?.id,who=esc(nickname(e.user_id)),p=e.payload||{};
    if(e.kind==='chat')return `<div class="spg-event"><div class="spg-sender">${mine?'我':who}</div><div class="spg-bubble">${esc(e.body)}</div></div>`;
    let msg='',cl='';
    if(e.kind==='dice')msg=`🎲 ${who} 摇出了 <b style="font-size:23px">${faces[p.value]||esc(p.value)}</b>（${esc(p.value)}点）`;
    else if(e.kind==='number')msg=`🎯 ${who} 抽到了随机数 <b>${esc(p.value)}</b>`;
    else if(e.kind==='bomb_start')msg=`💣 ${who} 开始了数字炸弹！范围是 1～100`;
    else if(e.kind==='bomb_guess')msg=`🔎 ${who} 猜 <b>${esc(p.guess)}</b>：安全！新范围 ${esc(p.min)}～${esc(p.max)}，轮到 ${esc(nickname(p.next_user_id))}`;
    else if(e.kind==='bomb_explode'){msg=`💥 爆炸！${who} 猜中 <b>${esc(p.guess)}</b>，本轮结束`;cl=' boom';}
    return `<div class="spg-event"><div class="spg-system${cl}">${msg}</div></div>`;}
  function renderEvents(){const feed=$('#spg-feed',overlay);if(!feed)return;const nearBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<110;
    feed.innerHTML=roomEvents.length?roomEvents.map(formatEvent).join(''):'<p class="spg-muted">还没有消息，发第一条吧！</p>';
    if(nearBottom)feed.scrollTop=feed.scrollHeight;}
  function renderBomb(){const box=$('#spg-bomb-box',overlay);if(!box)return;const active=round?.active,c=ctx();
    const signature=round?`${round.id}/${round.active}/${round.lower_exclusive}/${round.upper_exclusive}/${round.next_user_id}`:'none';
    if(signature===lastBombSignature)return;lastBombSignature=signature;
    if(!active){box.innerHTML='<div class="spg-bomb"><b>💣 数字炸弹</b><div class="spg-muted" style="margin-top:6px">系统秘密选取1～100的数字，大家轮流猜，越猜范围越小。猜中者爆炸。点击上方「开始数字炸弹」开启新一局。</div></div>';return;}
    const min=round.lower_exclusive+1,max=round.upper_exclusive-1,mine=round.next_user_id===c.user?.id;
    box.innerHTML=`<div class="spg-bomb"><b>💣 数字炸弹 · 正在进行</b><div class="spg-bomb-range">${min} — ${max}</div>
    <div class="spg-muted">${mine?'🎯 轮到你猜！':`等待 ${esc(nickname(round.next_user_id))} 猜数字`}</div>
    <div class="spg-input-area" style="margin-top:10px"><input id="spg-guess-input" class="spg-input" type="number" inputmode="numeric" min="${min}" max="${max}" step="1" placeholder="输入 ${min}～${max} 的整数" ${mine?'':'disabled'}><button class="spg-btn primary" data-spg-action="guess" ${mine?'':'disabled'}>猜数字</button></div></div>`;}
  async function refreshRoom(force){const c=ctx(),target=room;if(!target||!c.client||!c.space||target.space_id!==c.space.id){close();return;}
    const seq=++requestNumber;
    try{
      const [eventsR,membersR,roundsR]=await Promise.all([
        c.client.from('sp_game_events').select('id,user_id,kind,body,payload,created_at').eq('room_id',target.id).order('id',{ascending:false}).limit(100),
        c.client.from('sp_game_room_members').select('user_id,joined_at').eq('room_id',target.id).order('joined_at',{ascending:true}),
        c.client.from('sp_game_rounds').select('id,lower_exclusive,upper_exclusive,next_user_id,active,started_at').eq('room_id',target.id).order('started_at',{ascending:false}).limit(1)
      ]);
      if([eventsR,membersR,roundsR].some(x=>x.error))throw(eventsR.error||membersR.error||roundsR.error);
      if(requestNumber!==seq||room?.id!==target.id)return;
      const latest=(eventsR.data||[]).reverse(),newMembers=membersR.data||[];
      const unknown=[...new Set([...newMembers.map(m=>m.user_id),...latest.map(e=>e.user_id)])].filter(id=>!profiles.has(id));
      if(unknown.length){const p=await c.client.from('profiles').select('id,nickname').in('id',unknown.slice(0,60));if(!p.error)(p.data||[]).forEach(x=>profiles.set(x.id,x.nickname||'同学'));}
      if(requestNumber!==seq||room?.id!==target.id)return;
      const previousIds=roomEvents.map(e=>e.id).join(',');const nextIds=latest.map(e=>e.id).join(',');members=newMembers;round=(roundsR.data||[])[0]||null;
      const count=$('#spg-count',overlay);if(count)count.textContent=`${members.length} 人`;
      if(force||previousIds!==nextIds){roomEvents=latest;renderEvents();}
      renderBomb();
    }catch(e){if(requestNumber===seq)showNotice('同步失败：'+(e.message||String(e)),true);}
  }
  async function rpc(name,args,successMessage){await execute(async()=>{const c=requireCtx();const {error}=await c.client.rpc(name,args);if(error)throw error;showNotice(successMessage);await refreshRoom(false);});}
  async function send(){const input=$('#spg-chat-input',overlay),body=input?.value.trim();if(!body)return;if(body.length>500)return showNotice('聊天最多500字',true);
    await execute(async()=>{const c=requireCtx();const {error}=await c.client.rpc('sp_game_send',{p_room:room.id,p_body:body});if(error)throw error;input.value='';await refreshRoom(false);input.focus();});}
  async function guess(){const input=$('#spg-guess-input',overlay);if(!round?.active||round.next_user_id!==ctx().user?.id)return showNotice('还没有轮到你',true);
    const raw=input?.value?.trim();const n=Number(raw);if(!/^\d+$/.test(raw||'')||!Number.isInteger(n)||n<=round.lower_exclusive||n>=round.upper_exclusive)return showNotice('请输入当前范围内的整数',true);
    await rpc('sp_game_guess',{p_room:room.id,p_guess:n},'已提交本轮猜测');}
  async function onClick(e){const b=e.target.closest('[data-spg-action]');if(!b||!overlay.contains(b))return;const action=b.dataset.spgAction;
    if(action==='close')return close();
    if(action==='back'){stopPolling();room=null;round=null;return execute(loadList);}
    if(action==='create')return create();
    if(action==='join')return join(b.dataset.id);
    if(action==='reload-list')return execute(loadList);
    if(!room)return;
    if(action==='send')return send();
    if(action==='dice')return rpc('sp_game_roll',{p_room:room.id,p_kind:'dice'},'已摇骰子');
    if(action==='number')return rpc('sp_game_roll',{p_room:room.id,p_kind:'number'},'已抽取随机数');
    if(action==='bomb')return rpc('sp_game_start_bomb',{p_room:room.id},'新一轮数字炸弹开始');
    if(action==='guess')return guess();
  }
  function init(){if($('#spg-overlay'))return;const head=$('#page-feed .heading');if(!head)return;
    const css=document.createElement('style');css.textContent=style;document.head.append(css);
    const b=document.createElement('button');b.type='button';b.className='spg-entry';b.textContent='🎲 游戏房间';b.hidden=true;
    b.addEventListener('click',()=>{void open().catch(e=>showNotice(e?.message||String(e),true));});
    // Leave existing daily-food and feed buttons unchanged.
    const actions=$('.sp-meal-head-actions',head);if(actions)actions.append(b);else head.append(b);
    entry=b;overlay=document.createElement('div');overlay.id='spg-overlay';overlay.className='spg-overlay';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-label','同场游戏房间');document.body.append(overlay);
    overlay.addEventListener('click',e=>{void onClick(e);});
    overlay.addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.id==='spg-chat-input'){e.preventDefault();void send();}if(e.key==='Enter'&&e.target.id==='spg-guess-input'){e.preventDefault();void guess();}});
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&overlay.classList.contains('open'))close();});
    setInterval(()=>{const c=ctx();const valid=!!(c.client&&c.space?.id&&c.user?.id);if(entry)entry.hidden=!valid;
      if(overlay.classList.contains('open')&&(!valid||openSpaceId!==c.space?.id||(room&&room.space_id!==c.space?.id)))close();},1000);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
