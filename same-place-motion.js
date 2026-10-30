/* SAME PLACE interaction layer. Uses existing actions and data flow. */
(()=>{'use strict';
 const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
 const css=document.createElement('style');css.textContent=`
 button,.button,.action,.sp-meal-pill{touch-action:manipulation;-webkit-tap-highlight-color:transparent}
 button:not(:disabled){transition:background-color .16s,border-color .16s,opacity .16s,transform .12s}
 button:not(:disabled):active{transform:scale(.96)}
 .button,.action,.sp-meal-btn,.spg-btn,.sp-sticker-tabs button,.sp-sticker-launch{min-height:44px}
 button:disabled{cursor:wait;opacity:.55}
 .sp-meal-form select{background:#0c120d;color:#eff5ee;border:1px solid #344235;border-radius:11px;padding:11px;min-height:44px;font:inherit;width:100%}
 @media(prefers-reduced-motion:reduce){button{transition:none!important}button:active{transform:none!important}}
 `;document.head.append(css);
 document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled||reduced()||!b.animate)return;b.animate([{transform:'scale(.96)'},{transform:'scale(1.025)',offset:.65},{transform:'scale(1)'}],{duration:300,easing:'cubic-bezier(.2,1.15,.3,1)'});});
 const watch=el=>{let open=el.classList.contains('open');new MutationObserver(()=>{const now=el.classList.contains('open');if(now===open)return;open=now;if(!now||reduced())return;const panel=el.querySelector('.profile-modal,.modal,.sp-meal-screen,.spg-wrap')||el;panel.animate?.([{opacity:.3,translate:'0 14px',scale:'.98'},{opacity:1,translate:'0 0',scale:'1'}],{duration:330,easing:'cubic-bezier(.2,1.12,.3,1)'});}).observe(el,{attributes:true,attributeFilter:['class']});};
 const init=()=>document.querySelectorAll('.profile-modal-backdrop,.modal-mask,#spMealOverlay,#spMealDetail,#spg-overlay').forEach(watch);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
