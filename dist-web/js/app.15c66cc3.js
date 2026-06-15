import{g as ae,E as oe,l as ie,s as se,b as m,d as R,m as h,_ as v,j as r,V as s,n as le,H as ue,f as ce,o as _,i as de,S as pe,p as fe,q as me,e as he,u as ve,X as be,v as ge,w as xe,x as we,y as A,z as b,A as ye,B as $,D as X,r as k,F as Ee,G as Ce,J as je,K as Fe,M as Se,N as ke,O as Y,P as Be}from"./vendors.dce27eae.js";import{c as N,P as Ne,B as E,C as Te,a as _e,b as B,d as Ae,e as Pe,t as L,T as He}from"./common.a1c080d9.js";(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))t(a);new MutationObserver(a=>{for(const i of a)if(i.type==="childList")for(const u of i.addedNodes)u.tagName==="LINK"&&u.rel==="modulepreload"&&t(u)}).observe(document,{childList:!0,subtree:!0});function n(a){const i={};return a.integrity&&(i.integrity=a.integrity),a.referrerPolicy&&(i.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?i.credentials="include":a.crossOrigin==="anonymous"?i.credentials="omit":i.credentials="same-origin",i}function t(a){if(a.ep)return;a.ep=!0;const i=n(a);fetch(a.href,i)}})();var De=`
/* H5 端隐藏 TabBar 空图标（只隐藏没有 src 的图标） */
.weui-tabbar__icon:not([src]),
.weui-tabbar__icon[src=''] {
  display: none !important;
}

.weui-tabbar__item:has(.weui-tabbar__icon:not([src])) .weui-tabbar__label,
.weui-tabbar__item:has(.weui-tabbar__icon[src='']) .weui-tabbar__label {
  margin-top: 0 !important;
}

/* Vite 错误覆盖层无法选择文本的问题 */
vite-error-overlay {
  /* stylelint-disable-next-line property-no-vendor-prefix */
  -webkit-user-select: text !important;
}

vite-error-overlay::part(window) {
  max-width: 90vw;
  padding: 10px;
}

.taro_page {
  overflow: auto;
}

::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 2px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}

/* H5 导航栏页面自动添加顶部间距 */
body.h5-navbar-visible .taro_page {
  padding-top: 44px;
}

body.h5-navbar-visible .toaster[data-position^="top"] {
  top: 44px !important;
}

/* Sheet 组件在 H5 导航栏下的位置修正 */
body.h5-navbar-visible .sheet-content:not([data-side="bottom"]) {
    top: 44px !important;
}

/*
 * H5 端 rem 适配：与小程序 rpx 缩放一致
 * 375px 屏幕：1rem = 16px，小程序 32rpx = 16px
 */
html {
    font-size: 4vw !important;
}

/* H5 端组件默认样式修复 */
taro-view-core {
    display: block;
}

taro-text-core {
    display: inline;
}

taro-input-core {
    display: block;
    width: 100%;
}

taro-input-core input {
    width: 100%;
    background: transparent;
    border: none;
    outline: none;
}

taro-input-core.taro-otp-hidden-input input {
    color: transparent;
    caret-color: transparent;
    -webkit-text-fill-color: transparent;
}

/* 全局按钮样式重置 */
taro-button-core,
button {
    margin: 0 !important;
    padding: 0 !important;
    line-height: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
}

taro-button-core::after,
button::after {
    border: none;
}

taro-textarea-core > textarea,
.taro-textarea,
textarea.taro-textarea {
    resize: none !important;
}
`,Oe=`
/* PC 宽屏适配 - 基础布局 */
@media (min-width: 769px) {
  html {
    font-size: 15px !important;
  }

  body {
    background-color: #f3f4f6 !important;
    display: flex !important;
    justify-content: center !important;
    align-items: center !important;
    min-height: 100vh !important;
  }
}
`,ze=`
/* PC 宽屏适配 - 手机框样式（有 TabBar 页面） */
@media (min-width: 769px) {
  .taro-tabbar__container {
    width: 375px !important;
    max-width: 375px !important;
    height: calc(100vh - 40px) !important;
    max-height: 900px !important;
    background-color: #fff !important;
    transform: translateX(0) !important;
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.1) !important;
    border-radius: 20px !important;
    overflow: hidden !important;
    position: relative !important;
  }

  .taro-tabbar__panel {
    height: 100% !important;
    overflow: auto !important;
  }
}

/* PC 宽屏适配 - Toast 定位到手机框范围内 */
@media (min-width: 769px) {
  body .toaster {
    left: 50% !important;
    right: auto !important;
    width: 375px !important;
    max-width: 375px !important;
    transform: translateX(-50%) !important;
    box-sizing: border-box !important;
  }
}

/* PC 宽屏适配 - 手机框样式（无 TabBar 页面，通过 JS 添加 no-tabbar 类） */
@media (min-width: 769px) {
  body.no-tabbar #app {
    width: 375px !important;
    max-width: 375px !important;
    height: calc(100vh - 40px) !important;
    max-height: 900px !important;
    background-color: #fff !important;
    box-shadow: 0 0 20px rgba(0, 0, 0, 0.1) !important;
    border-radius: 20px !important;
    overflow: hidden !important;
    position: relative !important;
    transform: translateX(0) !important;
  }

  body.no-tabbar #app .taro_router {
    height: 100% !important;
    overflow: auto !important;
  }
}
`;function Re(){var o=document.createElement("style");o.innerHTML=De+Oe+ze,document.head.appendChild(o)}function Le(){var o=function(){var t=!!document.querySelector(".taro-tabbar__container");document.body.classList.toggle("no-tabbar",!t)};o();var e=new MutationObserver(o);e.observe(document.body,{childList:!0,subtree:!0})}function Ie(){Re(),Le()}function Me(){var o=ae();if(o===oe.WEAPP)try{var e=ie(),n=e.miniProgram.envVersion;console.log("[Debug] envVersion:",n),n!=="release"&&se({enableDebug:!0})}catch(t){console.error("[Debug] 开启调试模式失败:",t)}}var Ue={visible:!1,title:"",bgColor:"#ffffff",textStyle:"black",navStyle:"default",transparent:"none",leftIcon:"none"},We=function(){var e,n=_();return(n==null||(e=n.config)===null||e===void 0?void 0:e.window)||{}},Ve=function(){var e,n,t=(e=_())===null||e===void 0||(e=e.config)===null||e===void 0?void 0:e.tabBar;return new Set((t==null||(n=t.list)===null||n===void 0?void 0:n.map(function(a){return a.pagePath}))||[])},I=function(){var e,n=_();return(n==null||(e=n.config)===null||e===void 0||(e=e.pages)===null||e===void 0?void 0:e[0])||"pages/index/index"},C=function(e){return e.replace(/^\//,"")},$e=function(e,n,t,a){if(!e)return"none";var i=C(e),u=C(a),f=i===u,l=n.has(i)||n.has("/".concat(i)),d=t>1;return l||f?"none":d?"back":"home"},Xe=function(){var e=m.useState(Ue),n=R(e,2),t=n[0],a=n[1],i=m.useState(0),u=R(i,2),f=u[0],l=u[1],d=m.useCallback(function(){var c=h.getCurrentPages();if(c.length===0){a(function(te){return v(v({},te),{},{visible:!1})});return}var p=c[c.length-1],D=(p==null?void 0:p.route)||"";if(D){var g=(p==null?void 0:p.config)||{},x=We(),w=Ve(),ee=I(),y=C(D),O=C(ee),re=y===O,ne=w.has(y)||w.has("/".concat(y)),z=w.size<=1&&c.length<=1&&(re||ne);a({visible:!z,title:document.title||g.navigationBarTitleText||x.navigationBarTitleText||"",bgColor:g.navigationBarBackgroundColor||x.navigationBarBackgroundColor||"#ffffff",textStyle:g.navigationBarTextStyle||x.navigationBarTextStyle||"black",navStyle:g.navigationStyle||x.navigationStyle||"default",transparent:g.transparentTitle||x.transparentTitle||"none",leftIcon:z?"none":$e(y,w,c.length,O)})}},[]);h.useDidShow(function(){d()}),h.usePageScroll(function(c){var p=c.scrollTop;t.transparent==="auto"&&l(Math.min(p/100,1))}),m.useEffect(function(){var c=null,p=new MutationObserver(function(){c&&clearTimeout(c),c=setTimeout(function(){d()},50)});return p.observe(document.head,{subtree:!0,childList:!0,characterData:!0}),d(),function(){p.disconnect(),c&&clearTimeout(c)}},[d]);var S=t.visible&&t.navStyle!=="custom";if(m.useEffect(function(){S?document.body.classList.add("h5-navbar-visible"):document.body.classList.remove("h5-navbar-visible")},[S]),!S)return r.jsx(r.Fragment,{});var H=t.textStyle==="white"?"#fff":"#333",J=t.textStyle==="white"?"text-white":"text-gray-800",K=function(){return t.transparent==="always"?{backgroundColor:"transparent"}:t.transparent==="auto"?{backgroundColor:t.bgColor,opacity:f}:{backgroundColor:t.bgColor}},Q=function(){return h.navigateBack()},Z=function(){var p=I();h.reLaunch({url:"/".concat(p)})};return r.jsxs(r.Fragment,{children:[r.jsxs(s,{className:"fixed top-0 left-0 right-0 h-11 flex items-center justify-center z-1000",style:K(),children:[t.leftIcon==="back"&&r.jsx(s,{className:"absolute left-2 top-1/2 -translate-y-1/2 p-1 flex items-center justify-center",onClick:Q,children:r.jsx(le,{size:24,color:H})}),t.leftIcon==="home"&&r.jsx(s,{className:"absolute left-2 top-1/2 -translate-y-1/2 p-1 flex items-center justify-center",onClick:Z,children:r.jsx(ue,{size:22,color:H})}),r.jsx(ce,{className:"text-base font-medium max-w-3/5 truncate ".concat(J),children:t.title})]}),r.jsx(s,{className:"h-11 shrink-0"})]})},Ye=function(e){var n=e.children;return r.jsxs(r.Fragment,{children:[r.jsx(Xe,{}),n]})},Ge=["className","children","orientation"],G=m.forwardRef(function(o,e){var n=o.className,t=o.children,a=o.orientation,i=a===void 0?"vertical":a,u=de(o,Ge),f=i==="horizontal"||i==="both",l=i==="vertical"||i==="both";return r.jsx(pe,v(v({ref:e,className:N("relative",n),scrollY:l,scrollX:f,style:{overflowX:f?"auto":"hidden",overflowY:l?"auto":"hidden"}},u),{},{children:t}))});G.displayName="ScrollArea";var qe={error:null,report:"",source:"",visible:!1,open:!1,timestamp:""},M="hsl(360, 100%, 45%)",U=!1,j=qe,T=new Set,Je=function(){T.forEach(function(e){return e()})},Ke=function(e){return T.add(e),function(){return T.delete(e)}},W=function(){return j},q=function(e){j=e,Je()},Qe=function(){var o=A(b().m(function e(n){var t,a,i,u,f;return b().w(function(l){for(;;)switch(l.p=l.n){case 0:if(typeof window!="undefined"){l.n=1;break}return l.a(2,!1);case 1:if(l.p=1,!((t=navigator.clipboard)!==null&&t!==void 0&&t.writeText)){l.n=3;break}return l.n=2,navigator.clipboard.writeText(n);case 2:return l.a(2,!0);case 3:l.n=5;break;case 4:l.p=4,u=l.v,console.warn("[H5ErrorBoundary] Clipboard API copy failed:",u);case 5:return l.p=5,a=document.createElement("textarea"),a.value=n,a.setAttribute("readonly","true"),a.style.position="fixed",a.style.opacity="0",document.body.appendChild(a),a.select(),i=document.execCommand("copy"),document.body.removeChild(a),l.a(2,i);case 6:return l.p=6,f=l.v,console.warn("[H5ErrorBoundary] Fallback copy failed:",f),l.a(2,!1)}},e,null,[[5,6],[1,4]])}));return function(n){return o.apply(this,arguments)}}(),Ze=function(e){if(e instanceof Error)return e;if(typeof e=="string")return new Error(e);try{return new Error(JSON.stringify(e))}catch(n){return new Error(String(e))}},er=function(e){var n=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{},t=["[H5 Runtime Error]","Time: ".concat(new Date().toISOString()),n.source?"Source: ".concat(n.source):"","Name: ".concat(e.name),"Message: ".concat(e.message),e.stack?`Stack:
`.concat(e.stack):"",n.componentStack?`Component Stack:
`.concat(n.componentStack):"",typeof navigator!="undefined"?"User Agent: ".concat(navigator.userAgent):""].filter(Boolean);return t.join(`

`)},V=function(e){j.visible&&q(v(v({},j),{},{open:e}))},P=function(e){var n=arguments.length>1&&arguments[1]!==void 0?arguments[1]:{};if(typeof window!="undefined"){var t=Ze(e),a=er(t,n),i=new Date().toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});q({error:t,report:a,source:n.source||"runtime",timestamp:i,visible:!0,open:!1}),console.error("[H5ErrorOverlay] Showing error overlay:",t,n)}},rr=function(e){var n=e.error||new Error(e.message||"Unknown H5 runtime error");P(n,{source:"window.error"})},nr=function(e){P(e.reason,{source:"window.unhandledrejection"})},tr=function(){typeof window=="undefined"||U||(U=!0,window.addEventListener("error",rr),window.addEventListener("unhandledrejection",nr))},ar=function(){var e,n,t=m.useSyncExternalStore(Ke,W,W);if(!t.visible)return null;var a=((e=t.error)===null||e===void 0?void 0:e.name)||"Error";return r.jsx(Ne,{children:r.jsxs(s,{className:"pointer-events-none fixed inset-0 z-[2147483646]",children:[r.jsx(s,{className:"pointer-events-auto fixed bottom-5 left-5",children:r.jsx(E,{variant:"outline",size:"icon",className:N("h-11 w-11 rounded-full shadow-md transition-transform"),style:{backgroundColor:"hsl(359, 100%, 97%)",borderColor:"hsl(359, 100%, 94%)",color:M},onClick:function(){return V(!t.open)},children:r.jsx(he,{size:22,color:M})})}),t.open&&r.jsx(s,{className:"pointer-events-none fixed inset-0 bg-white bg-opacity-15 supports-[backdrop-filter]:backdrop-blur-md",children:r.jsx(s,{className:"absolute inset-0 flex items-center justify-center px-4 py-4",children:r.jsx(s,{className:"w-full max-w-md",style:{width:"min(calc(100vw - 32px), var(--h5-phone-width, 390px))",height:"min(calc(100vh - 32px), 900px)"},children:r.jsx(Te,{className:N("pointer-events-auto h-full rounded-2xl border border-border bg-background text-foreground shadow-2xl"),children:r.jsxs(s,{className:"relative flex h-full flex-col",children:[r.jsxs(_e,{className:"gap-2 p-4 pb-2",children:[r.jsxs(s,{className:"flex items-start justify-between gap-3",children:[r.jsxs(s,{className:"flex flex-wrap items-center gap-2",children:[r.jsx(B,{variant:"destructive",className:"border-none bg-red-500 px-3 py-1 text-xs font-medium text-white",children:"Runtime Error"}),r.jsx(B,{variant:"outline",className:"px-3 py-1 text-xs",children:t.source})]}),r.jsxs(s,{className:"flex shrink-0 items-center gap-1",children:[r.jsx(E,{variant:"ghost",size:"icon",className:"h-8 w-8 rounded-full",onClick:function(){return window.location.reload()},children:r.jsx(ve,{size:15,color:"inherit"})}),r.jsx(E,{variant:"ghost",size:"icon",className:"h-8 w-8 rounded-full",onClick:function(){return V(!1)},children:r.jsx(be,{size:17,color:"inherit"})})]})]}),r.jsxs(s,{className:"flex items-center justify-between gap-3",children:[r.jsx(Ae,{className:"text-left text-lg",children:a}),r.jsxs(E,{variant:"outline",size:"sm",className:"shrink-0 rounded-lg",onClick:function(){var i=A(b().m(function f(){var l;return b().w(function(d){for(;;)switch(d.n){case 0:return d.n=1,Qe(t.report);case 1:if(l=d.v,!l){d.n=2;break}return L.success("已复制错误信息",{description:"可发送给 Agent 进行自动修复",position:"top-center"}),d.a(2);case 2:L.warning("复制失败",{description:"请直接选中文本后手动复制。",position:"top-center"});case 3:return d.a(2)}},f)}));function u(){return i.apply(this,arguments)}return u}(),children:[r.jsx(ge,{size:15,color:"inherit"}),r.jsx(s,{children:"复制错误"})]})]})]}),r.jsx(Pe,{className:"min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-2",children:r.jsxs(s,{className:"flex h-full min-h-0 flex-col gap-2",children:[r.jsxs(s,{className:"flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border px-3 py-2 text-sm",children:[r.jsxs(s,{className:"flex items-center gap-2",children:[r.jsx(s,{className:"text-muted-foreground",children:"Error"}),r.jsx(s,{className:"font-medium text-foreground",children:((n=t.error)===null||n===void 0?void 0:n.name)||"Error"})]}),r.jsx(s,{className:"h-4 w-px bg-border"}),r.jsxs(s,{className:"flex items-center gap-2",children:[r.jsx(s,{className:"text-muted-foreground",children:"Source"}),r.jsx(s,{className:"font-medium text-foreground",children:t.source})]})]}),r.jsxs(s,{className:"min-h-0 flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-black text-white",children:[r.jsxs(s,{className:"flex items-center justify-between border-b border-white border-opacity-10 px-3 py-3",children:[r.jsx(s,{className:"text-xs font-medium uppercase tracking-wide text-zinc-400",children:"Full Report"}),r.jsx(B,{variant:"outline",className:"border-zinc-700 bg-transparent px-2 py-1 text-xs text-zinc-400",children:t.timestamp})]}),r.jsx(G,{className:"min-h-0 flex-1 w-full",orientation:"both",children:r.jsx(s,{className:"inline-block min-w-full whitespace-pre px-3 py-3 pb-8 font-mono text-xs leading-6 text-zinc-200",children:t.report})})]})]})})]})})})})})]})})},or=function(o){function e(){var n;xe(this,e);for(var t=arguments.length,a=new Array(t),i=0;i<t;i++)a[i]=arguments[i];return n=we(this,e,[].concat(a)),n.state={error:null},n}return fe(e,o),me(e,[{key:"componentDidUpdate",value:function(t){this.state.error&&t.children!==this.props.children&&this.setState({error:null})}},{key:"componentDidCatch",value:function(t,a){P(t,{source:"React Error Boundary",componentStack:a.componentStack||""})}},{key:"render",value:function(){return r.jsxs(r.Fragment,{children:[r.jsx(ar,{}),this.state.error?null:this.props.children]})}}],[{key:"getDerivedStateFromError",value:function(t){return{error:t}}}])}(m.Component),ir=function(e){var n=e.children;return r.jsx(or,{children:n})},sr=function(e){var n=e.children;return tr(),h.useLaunch(function(){Me(),Ie()}),r.jsx(ir,{children:r.jsx(Ye,{children:n})})},lr=function(e){var n=e.children;return r.jsxs(ye,{defaultColor:"#000",defaultSize:24,children:[r.jsx(sr,{children:n}),r.jsx(He,{})]})},F=$.__taroAppConfig={router:{mode:"hash"},pages:["pages/index/index"],window:{backgroundTextStyle:"light",navigationBarBackgroundColor:"#fff",navigationBarTitleText:"股票分析助手",navigationBarTextStyle:"black"}};F.routes=[Object.assign({path:"pages/index/index",load:function(){var o=A(b().m(function n(t,a){var i;return b().w(function(u){for(;;)switch(u.n){case 0:return u.n=1,Be(()=>import("./index.2c091f7d.js"),["./index.2c091f7d.js","./vendors.dce27eae.js","../css/vendors.8886af03.css","./common.a1c080d9.js"],import.meta.url);case 1:return i=u.v,u.a(2,[i,t,a])}},n)}));function e(n,t){return o.apply(this,arguments)}return e}()},{navigationBarTitleText:"股票分析助手"})];Object.assign(X,{findDOMNode:k.findDOMNode,render:k.render,unstable_batchedUpdates:k.unstable_batchedUpdates});Ee();var ur=Ce(lr,Y,X,F),cr=je({window:$});Fe(F);Se(cr,ur,F,Y);ke({designWidth:750,deviceRatio:{375:2,640:1.17,750:1,828:.905},baseFontSize:20,unitPrecision:void 0,targetUnit:void 0});
