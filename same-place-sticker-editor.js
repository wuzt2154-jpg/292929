/* SAME PLACE — touch sticker editor. No uploads until Save is pressed. */
(()=>{
 'use strict';
 const editors=new WeakMap();
 const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
 function wrap(ctx,text,width){
  const lines=[];
  for(const paragraph of text.split('\n')){
   let line='';
   for(const ch of Array.from(paragraph)){
    if(line&&ctx.measureText(line+ch).width>width){lines.push(line);line=ch;}else line+=ch;
   }
   lines.push(line);
  }
  return lines;
 }
 function mount(root){
  root.innerHTML=`<div class="sp-sticker-making">
   <div class="sp-sticker-hint">拖动图片裁剪；切换「移动文字」后，拖动文字到合适的位置。保存的图片与预览一致。</div>
   <input type="file" accept="image/jpeg,image/png,image/webp" data-se-file aria-label="选择表情包图片">
   <div class="sp-sticker-tabs"><label>比例 <select data-se-ratio aria-label="裁剪比例"><option value="1">正方形</option><option value="1.3333333333333333">横图 4:3</option><option value="0.75">竖图 3:4</option></select></label><button type="button" data-se-mode="image" class="active">移动图片</button><button type="button" data-se-mode="text">移动文字</button></div>
   <canvas data-se-canvas width="640" height="640" aria-label="表情包编辑预览，拖动图片或文字" style="display:block;width:100%;height:auto;max-height:none;touch-action:none;background:#222;border-radius:10px"></canvas>
   <label class="sp-sticker-hint">图片缩放 <input data-se-zoom type="range" min="1" max="4" step="0.01" value="1" style="width:100%"></label>
   <textarea data-se-caption rows="2" maxlength="120" placeholder="添加文字，可换行（选填）" aria-label="表情包文字" style="width:100%;box-sizing:border-box;background:#182018;border:1px solid #354634;border-radius:8px;color:#fff;padding:10px;font:inherit"></textarea>
   <div class="sp-sticker-tabs"><label>字号 <input data-se-size type="range" min="18" max="80" value="42" aria-label="文字大小" style="width:100px"></label><label>颜色 <input data-se-color type="color" value="#ffffff" aria-label="文字颜色" style="width:40px;padding:2px"></label><label><input data-se-outline type="checkbox" checked> 描边</label></div>
   <div class="sp-sticker-tabs"><button type="button" data-se-place="top">文字置顶</button><button type="button" data-se-place="bottom">文字置底</button><button type="button" data-se-reset>重置位置</button></div>
   <button type="button" class="sp-sticker-button" id="spStickerSave" disabled>制作并收藏</button><div id="spStickerStatus" class="sp-sticker-hint" role="status">请先选择图片</div>
  </div>`;
  const q=s=>root.querySelector(s),canvas=q('[data-se-canvas]'),ctx=canvas.getContext('2d');
  const state={image:null,zoom:1,x:0,y:0,tx:.5,ty:.88,mode:'image',box:null,points:new Map(),drag:null,load:0};
  const status=q('#spStickerStatus'),save=q('#spStickerSave');
  function geometry(){
   const fit=Math.max(canvas.width/state.image.naturalWidth,canvas.height/state.image.naturalHeight);
   return {w:state.image.naturalWidth*fit*state.zoom,h:state.image.naturalHeight*fit*state.zoom};
  }
  function contain(){if(!state.image)return;const {w,h}=geometry();state.x=clamp(state.x,(canvas.width-w)/2,(w-canvas.width)/2);state.y=clamp(state.y,(canvas.height-h)/2,(h-canvas.height)/2);}
  function paint(target=canvas,selection=true){
   const c=target.getContext('2d'),w=canvas.width,h=canvas.height;c.clearRect(0,0,w,h);c.fillStyle='#202820';c.fillRect(0,0,w,h);
   if(!state.image){c.font='26px sans-serif';c.textAlign='center';c.fillStyle='#aab9aa';c.fillText('选择图片后开始制作',w/2,h/2);return;}
   contain();const g=geometry();c.drawImage(state.image,(w-g.w)/2+state.x,(h-g.h)/2+state.y,g.w,g.h);
   const text=q('[data-se-caption]').value.trim();state.box=null;if(!text)return;
   const size=+q('[data-se-size]').value,padding=14,lineHeight=size*1.22;
   c.font=`bold ${size}px -apple-system, "PingFang SC", sans-serif`;c.textAlign='center';c.textBaseline='middle';
   const lines=wrap(c,text,w-2*padding),textHeight=lines.length*lineHeight;
   if(textHeight>h-2*padding){status.textContent='文字超出画面，请减小字号或减少换行。';return;}
   const tw=Math.min(w-2*padding,Math.max(...lines.map(l=>c.measureText(l).width))),th=textHeight;
   const x=clamp(state.tx*w,tw/2+padding,w-tw/2-padding),y=clamp(state.ty*h,th/2+padding,h-th/2-padding);
   state.tx=x/w;state.ty=y/h;state.box={x:x-tw/2-7,y:y-th/2-5,w:tw+14,h:th+10};
   c.lineJoin='round';c.lineWidth=Math.max(3,size*.12);c.strokeStyle=q('[data-se-color]').value.toLowerCase()==='#000000'?'#fff':'#111';c.fillStyle=q('[data-se-color]').value;
   lines.forEach((line,i)=>{const ly=y+(i-(lines.length-1)/2)*lineHeight;if(q('[data-se-outline]').checked)c.strokeText(line,x,ly);c.fillText(line,x,ly);});
   if(selection&&state.mode==='text'){c.save();c.strokeStyle='#c7ff45';c.lineWidth=2;c.setLineDash([8,5]);const b=state.box;c.strokeRect(b.x,b.y,b.w,b.h);c.restore();}
  }
  function setZoom(value){state.zoom=clamp(value,1,4);q('[data-se-zoom]').value=String(state.zoom);paint();}
  function point(e){const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
  function startGesture(){
   const pts=[...state.points.values()];
   if(pts.length>=2&&state.mode==='image')state.drag={pinch:Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),zoom:state.zoom};
   else if(pts.length===1)state.drag={p:pts[0],x:state.x,y:state.y,tx:state.tx,ty:state.ty};
   else state.drag=null;
  }
  canvas.addEventListener('pointerdown',e=>{if(!state.image)return;e.preventDefault();canvas.setPointerCapture(e.pointerId);state.points.set(e.pointerId,point(e));startGesture();});
  canvas.addEventListener('pointermove',e=>{
   if(!state.points.has(e.pointerId))return;e.preventDefault();state.points.set(e.pointerId,point(e));const d=state.drag;if(!d)return;
   const pts=[...state.points.values()];
   if(d.pinch&&pts.length>=2){setZoom(d.zoom*Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)/Math.max(1,d.pinch));return;}
   if(!d.p)return;const p=pts[0],dx=p.x-d.p.x,dy=p.y-d.p.y;
   if(state.mode==='text'){state.tx=d.tx+dx/canvas.width;state.ty=d.ty+dy/canvas.height;}else{state.x=d.x+dx;state.y=d.y+dy;}paint();
  });
  const release=e=>{state.points.delete(e.pointerId);startGesture();};
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',release);canvas.addEventListener('lostpointercapture',release);
  q('[data-se-file]').addEventListener('change',async()=>{
   const token=++state.load,file=q('[data-se-file]').files?.[0];state.image=null;save.disabled=true;paint();
   if(!file){status.textContent='请先选择图片';return;}if(file.size>8*1024*1024){status.textContent='原图不能超过8MB';return;}
   const url=URL.createObjectURL(file),img=new Image();
   try{await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('无法读取图片，请换一张 JPG 或 PNG 图片'));img.src=url;});
    if(token!==state.load||!root.isConnected)return;state.image=img;state.zoom=1;state.x=state.y=0;q('[data-se-zoom]').value='1';save.disabled=false;status.textContent='拖动图片调整裁剪，文字可单独移动。';paint();
   }catch(e){if(token===state.load)status.textContent=e.message;}finally{URL.revokeObjectURL(url);}
  });
  q('[data-se-ratio]').onchange=()=>{canvas.height=Math.round(640/+q('[data-se-ratio]').value);state.x=state.y=0;state.zoom=1;q('[data-se-zoom]').value='1';paint();};
  q('[data-se-zoom]').oninput=()=>setZoom(+q('[data-se-zoom]').value);
  root.querySelectorAll('[data-se-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.seMode;state.points.clear();state.drag=null;root.querySelectorAll('[data-se-mode]').forEach(x=>x.classList.toggle('active',x===b));paint();});
  root.querySelectorAll('[data-se-place]').forEach(b=>b.onclick=()=>{state.ty=b.dataset.sePlace==='top'?.12:.88;paint();});
  for(const selector of ['[data-se-caption]','[data-se-size]','[data-se-color]','[data-se-outline]'])q(selector).addEventListener('input',()=>{status.textContent='保存的图片与预览一致。';paint();});
  q('[data-se-reset]').onclick=()=>{state.x=state.y=0;state.zoom=1;state.tx=.5;state.ty=.88;q('[data-se-zoom]').value='1';paint();};
  editors.set(root,{async export(){
   if(!state.image)throw Error('请先选择图片');paint();
   if(q('[data-se-caption]').value.trim()&&!state.box)throw Error('文字超出画面，请减小字号或减少换行');
   const out=document.createElement('canvas');out.width=canvas.width;out.height=canvas.height;paint(out,false);
   const blob=await new Promise(resolve=>out.toBlob(resolve,'image/jpeg',.88));if(!blob)throw Error('图片处理失败');return blob;
  }});paint();
 }
 window.spStickerEditor={mount,export:root=>{const editor=editors.get(root);if(!editor)throw Error('请重新打开表情包制作');return editor.export();}};
})();
