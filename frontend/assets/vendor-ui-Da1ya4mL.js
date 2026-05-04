import{r as h,R as je,a as Pi,b as tu,c as Ai}from"./vendor-react-jwcFVDcr.js";import{j as b,_ as Ae,a as Ti,b as nu}from"./vendor-data-CLVn9T7b.js";function V(e,t,{checkForDefaultPrevented:n=!0}={}){return function(o){if(e==null||e(o),n===!1||!o.defaultPrevented)return t==null?void 0:t(o)}}function _o(e,t){if(typeof e=="function")return e(t);e!=null&&(e.current=t)}function Ue(...e){return t=>{let n=!1;const r=e.map(o=>{const s=_o(o,t);return!n&&typeof s=="function"&&(n=!0),s});if(n)return()=>{for(let o=0;o<r.length;o++){const s=r[o];typeof s=="function"?s():_o(e[o],null)}}}}function G(...e){return h.useCallback(Ue(...e),e)}function ru(e,t){const n=h.createContext(t),r=s=>{const{children:i,...a}=s,c=h.useMemo(()=>a,Object.values(a));return b.jsx(n.Provider,{value:c,children:i})};r.displayName=e+"Provider";function o(s){const i=h.useContext(n);if(i)return i;if(t!==void 0)return t;throw new Error(`\`${s}\` must be used within \`${e}\``)}return[r,o]}function lt(e,t=[]){let n=[];function r(s,i){const a=h.createContext(i),c=n.length;n=[...n,i];const l=d=>{var k;const{scope:p,children:y,...g}=d,m=((k=p==null?void 0:p[e])==null?void 0:k[c])||a,v=h.useMemo(()=>g,Object.values(g));return b.jsx(m.Provider,{value:v,children:y})};l.displayName=s+"Provider";function u(d,p){var m;const y=((m=p==null?void 0:p[e])==null?void 0:m[c])||a,g=h.useContext(y);if(g)return g;if(i!==void 0)return i;throw new Error(`\`${d}\` must be used within \`${s}\``)}return[l,u]}const o=()=>{const s=n.map(i=>h.createContext(i));return function(a){const c=(a==null?void 0:a[e])||s;return h.useMemo(()=>({[`__scope${e}`]:{...a,[e]:c}}),[a,c])}};return o.scopeName=e,[r,ou(o,...t)]}function ou(...e){const t=e[0];if(e.length===1)return t;const n=()=>{const r=e.map(o=>({useScope:o(),scopeName:o.scopeName}));return function(s){const i=r.reduce((a,{useScope:c,scopeName:l})=>{const d=c(s)[`__scope${l}`];return{...a,...d}},{});return h.useMemo(()=>({[`__scope${t.scopeName}`]:i}),[i])}};return n.scopeName=t.scopeName,n}function Bo(e){const t=su(e),n=h.forwardRef((r,o)=>{const{children:s,...i}=r,a=h.Children.toArray(s),c=a.find(au);if(c){const l=c.props.children,u=a.map(d=>d===c?h.Children.count(l)>1?h.Children.only(null):h.isValidElement(l)?l.props.children:null:d);return b.jsx(t,{...i,ref:o,children:h.isValidElement(l)?h.cloneElement(l,void 0,u):null})}return b.jsx(t,{...i,ref:o,children:s})});return n.displayName=`${e}.Slot`,n}function su(e){const t=h.forwardRef((n,r)=>{const{children:o,...s}=n;if(h.isValidElement(o)){const i=lu(o),a=cu(s,o.props);return o.type!==h.Fragment&&(a.ref=r?Ue(r,i):i),h.cloneElement(o,a)}return h.Children.count(o)>1?h.Children.only(null):null});return t.displayName=`${e}.SlotClone`,t}var iu=Symbol("radix.slottable");function au(e){return h.isValidElement(e)&&typeof e.type=="function"&&"__radixId"in e.type&&e.type.__radixId===iu}function cu(e,t){const n={...t};for(const r in t){const o=e[r],s=t[r];/^on[A-Z]/.test(r)?o&&s?n[r]=(...a)=>{const c=s(...a);return o(...a),c}:o&&(n[r]=o):r==="style"?n[r]={...o,...s}:r==="className"&&(n[r]=[o,s].filter(Boolean).join(" "))}return{...e,...n}}function lu(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}function Ri(e){const t=e+"CollectionProvider",[n,r]=lt(t),[o,s]=n(t,{collectionRef:{current:null},itemMap:new Map}),i=m=>{const{scope:v,children:k}=m,x=je.useRef(null),M=je.useRef(new Map).current;return b.jsx(o,{scope:v,itemMap:M,collectionRef:x,children:k})};i.displayName=t;const a=e+"CollectionSlot",c=Bo(a),l=je.forwardRef((m,v)=>{const{scope:k,children:x}=m,M=s(a,k),C=G(v,M.collectionRef);return b.jsx(c,{ref:C,children:x})});l.displayName=a;const u=e+"CollectionItemSlot",d="data-radix-collection-item",p=Bo(u),y=je.forwardRef((m,v)=>{const{scope:k,children:x,...M}=m,C=je.useRef(null),w=G(v,C),S=s(u,k);return je.useEffect(()=>(S.itemMap.set(C,{ref:C,...M}),()=>void S.itemMap.delete(C))),b.jsx(p,{[d]:"",ref:w,children:x})});y.displayName=u;function g(m){const v=s(e+"CollectionConsumer",m);return je.useCallback(()=>{const x=v.collectionRef.current;if(!x)return[];const M=Array.from(x.querySelectorAll(`[${d}]`));return Array.from(v.itemMap.values()).sort((S,P)=>M.indexOf(S.ref.current)-M.indexOf(P.ref.current))},[v.collectionRef,v.itemMap])}return[{Provider:i,Slot:l,ItemSlot:y},g,r]}function uu(e){const t=du(e),n=h.forwardRef((r,o)=>{const{children:s,...i}=r,a=h.Children.toArray(s),c=a.find(fu);if(c){const l=c.props.children,u=a.map(d=>d===c?h.Children.count(l)>1?h.Children.only(null):h.isValidElement(l)?l.props.children:null:d);return b.jsx(t,{...i,ref:o,children:h.isValidElement(l)?h.cloneElement(l,void 0,u):null})}return b.jsx(t,{...i,ref:o,children:s})});return n.displayName=`${e}.Slot`,n}function du(e){const t=h.forwardRef((n,r)=>{const{children:o,...s}=n;if(h.isValidElement(o)){const i=yu(o),a=pu(s,o.props);return o.type!==h.Fragment&&(a.ref=r?Ue(r,i):i),h.cloneElement(o,a)}return h.Children.count(o)>1?h.Children.only(null):null});return t.displayName=`${e}.SlotClone`,t}var hu=Symbol("radix.slottable");function fu(e){return h.isValidElement(e)&&typeof e.type=="function"&&"__radixId"in e.type&&e.type.__radixId===hu}function pu(e,t){const n={...t};for(const r in t){const o=e[r],s=t[r];/^on[A-Z]/.test(r)?o&&s?n[r]=(...a)=>{const c=s(...a);return o(...a),c}:o&&(n[r]=o):r==="style"?n[r]={...o,...s}:r==="className"&&(n[r]=[o,s].filter(Boolean).join(" "))}return{...e,...n}}function yu(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}var mu=["a","button","div","form","h2","h3","img","input","label","li","nav","ol","p","select","span","svg","ul"],$=mu.reduce((e,t)=>{const n=uu(`Primitive.${t}`),r=h.forwardRef((o,s)=>{const{asChild:i,...a}=o,c=i?n:t;return typeof window<"u"&&(window[Symbol.for("radix-ui")]=!0),b.jsx(c,{...a,ref:s})});return r.displayName=`Primitive.${t}`,{...e,[t]:r}},{});function Ei(e,t){e&&Pi.flushSync(()=>e.dispatchEvent(t))}function Me(e){const t=h.useRef(e);return h.useEffect(()=>{t.current=e}),h.useMemo(()=>(...n)=>{var r;return(r=t.current)==null?void 0:r.call(t,...n)},[])}function gu(e,t=globalThis==null?void 0:globalThis.document){const n=Me(e);h.useEffect(()=>{const r=o=>{o.key==="Escape"&&n(o)};return t.addEventListener("keydown",r,{capture:!0}),()=>t.removeEventListener("keydown",r,{capture:!0})},[n,t])}var vu="DismissableLayer",ur="dismissableLayer.update",ku="dismissableLayer.pointerDownOutside",xu="dismissableLayer.focusOutside",zo,Di=h.createContext({layers:new Set,layersWithOutsidePointerEventsDisabled:new Set,branches:new Set}),Sn=h.forwardRef((e,t)=>{const{disableOutsidePointerEvents:n=!1,onEscapeKeyDown:r,onPointerDownOutside:o,onFocusOutside:s,onInteractOutside:i,onDismiss:a,...c}=e,l=h.useContext(Di),[u,d]=h.useState(null),p=(u==null?void 0:u.ownerDocument)??(globalThis==null?void 0:globalThis.document),[,y]=h.useState({}),g=G(t,P=>d(P)),m=Array.from(l.layers),[v]=[...l.layersWithOutsidePointerEventsDisabled].slice(-1),k=m.indexOf(v),x=u?m.indexOf(u):-1,M=l.layersWithOutsidePointerEventsDisabled.size>0,C=x>=k,w=wu(P=>{const A=P.target,D=[...l.branches].some(L=>L.contains(A));!C||D||(o==null||o(P),i==null||i(P),P.defaultPrevented||a==null||a())},p),S=bu(P=>{const A=P.target;[...l.branches].some(L=>L.contains(A))||(s==null||s(P),i==null||i(P),P.defaultPrevented||a==null||a())},p);return gu(P=>{x===l.layers.size-1&&(r==null||r(P),!P.defaultPrevented&&a&&(P.preventDefault(),a()))},p),h.useEffect(()=>{if(u)return n&&(l.layersWithOutsidePointerEventsDisabled.size===0&&(zo=p.body.style.pointerEvents,p.body.style.pointerEvents="none"),l.layersWithOutsidePointerEventsDisabled.add(u)),l.layers.add(u),Ho(),()=>{n&&l.layersWithOutsidePointerEventsDisabled.size===1&&(p.body.style.pointerEvents=zo)}},[u,p,n,l]),h.useEffect(()=>()=>{u&&(l.layers.delete(u),l.layersWithOutsidePointerEventsDisabled.delete(u),Ho())},[u,l]),h.useEffect(()=>{const P=()=>y({});return document.addEventListener(ur,P),()=>document.removeEventListener(ur,P)},[]),b.jsx($.div,{...c,ref:g,style:{pointerEvents:M?C?"auto":"none":void 0,...e.style},onFocusCapture:V(e.onFocusCapture,S.onFocusCapture),onBlurCapture:V(e.onBlurCapture,S.onBlurCapture),onPointerDownCapture:V(e.onPointerDownCapture,w.onPointerDownCapture)})});Sn.displayName=vu;var Mu="DismissableLayerBranch",Li=h.forwardRef((e,t)=>{const n=h.useContext(Di),r=h.useRef(null),o=G(t,r);return h.useEffect(()=>{const s=r.current;if(s)return n.branches.add(s),()=>{n.branches.delete(s)}},[n.branches]),b.jsx($.div,{...e,ref:o})});Li.displayName=Mu;function wu(e,t=globalThis==null?void 0:globalThis.document){const n=Me(e),r=h.useRef(!1),o=h.useRef(()=>{});return h.useEffect(()=>{const s=a=>{if(a.target&&!r.current){let c=function(){Vi(ku,n,l,{discrete:!0})};const l={originalEvent:a};a.pointerType==="touch"?(t.removeEventListener("click",o.current),o.current=c,t.addEventListener("click",o.current,{once:!0})):c()}else t.removeEventListener("click",o.current);r.current=!1},i=window.setTimeout(()=>{t.addEventListener("pointerdown",s)},0);return()=>{window.clearTimeout(i),t.removeEventListener("pointerdown",s),t.removeEventListener("click",o.current)}},[t,n]),{onPointerDownCapture:()=>r.current=!0}}function bu(e,t=globalThis==null?void 0:globalThis.document){const n=Me(e),r=h.useRef(!1);return h.useEffect(()=>{const o=s=>{s.target&&!r.current&&Vi(xu,n,{originalEvent:s},{discrete:!1})};return t.addEventListener("focusin",o),()=>t.removeEventListener("focusin",o)},[t,n]),{onFocusCapture:()=>r.current=!0,onBlurCapture:()=>r.current=!1}}function Ho(){const e=new CustomEvent(ur);document.dispatchEvent(e)}function Vi(e,t,n,{discrete:r}){const o=n.originalEvent.target,s=new CustomEvent(e,{bubbles:!1,cancelable:!0,detail:n});t&&o.addEventListener(e,t,{once:!0}),r?Ei(o,s):o.dispatchEvent(s)}var cm=Sn,lm=Li,Te=globalThis!=null&&globalThis.document?h.useLayoutEffect:()=>{},Cu="Portal",Lr=h.forwardRef((e,t)=>{var a;const{container:n,...r}=e,[o,s]=h.useState(!1);Te(()=>s(!0),[]);const i=n||o&&((a=globalThis==null?void 0:globalThis.document)==null?void 0:a.body);return i?tu.createPortal(b.jsx($.div,{...r,ref:t}),i):null});Lr.displayName=Cu;function Su(e,t){return h.useReducer((n,r)=>t[n][r]??n,e)}var Ve=e=>{const{present:t,children:n}=e,r=Pu(t),o=typeof n=="function"?n({present:r.isPresent}):h.Children.only(n),s=G(r.ref,Au(o));return typeof n=="function"||r.isPresent?h.cloneElement(o,{ref:s}):null};Ve.displayName="Presence";function Pu(e){const[t,n]=h.useState(),r=h.useRef(null),o=h.useRef(e),s=h.useRef("none"),i=e?"mounted":"unmounted",[a,c]=Su(i,{mounted:{UNMOUNT:"unmounted",ANIMATION_OUT:"unmountSuspended"},unmountSuspended:{MOUNT:"mounted",ANIMATION_END:"unmounted"},unmounted:{MOUNT:"mounted"}});return h.useEffect(()=>{const l=Kt(r.current);s.current=a==="mounted"?l:"none"},[a]),Te(()=>{const l=r.current,u=o.current;if(u!==e){const p=s.current,y=Kt(l);e?c("MOUNT"):y==="none"||(l==null?void 0:l.display)==="none"?c("UNMOUNT"):c(u&&p!==y?"ANIMATION_OUT":"UNMOUNT"),o.current=e}},[e,c]),Te(()=>{if(t){let l;const u=t.ownerDocument.defaultView??window,d=y=>{const m=Kt(r.current).includes(CSS.escape(y.animationName));if(y.target===t&&m&&(c("ANIMATION_END"),!o.current)){const v=t.style.animationFillMode;t.style.animationFillMode="forwards",l=u.setTimeout(()=>{t.style.animationFillMode==="forwards"&&(t.style.animationFillMode=v)})}},p=y=>{y.target===t&&(s.current=Kt(r.current))};return t.addEventListener("animationstart",p),t.addEventListener("animationcancel",d),t.addEventListener("animationend",d),()=>{u.clearTimeout(l),t.removeEventListener("animationstart",p),t.removeEventListener("animationcancel",d),t.removeEventListener("animationend",d)}}else c("ANIMATION_END")},[t,c]),{isPresent:["mounted","unmountSuspended"].includes(a),ref:h.useCallback(l=>{r.current=l?getComputedStyle(l):null,n(l)},[])}}function Kt(e){return(e==null?void 0:e.animationName)||"none"}function Au(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}var Tu=Ai[" useInsertionEffect ".trim().toString()]||Te;function Vr({prop:e,defaultProp:t,onChange:n=()=>{},caller:r}){const[o,s,i]=Ru({defaultProp:t,onChange:n}),a=e!==void 0,c=a?e:o;{const u=h.useRef(e!==void 0);h.useEffect(()=>{const d=u.current;d!==a&&console.warn(`${r} is changing from ${d?"controlled":"uncontrolled"} to ${a?"controlled":"uncontrolled"}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`),u.current=a},[a,r])}const l=h.useCallback(u=>{var d;if(a){const p=Eu(u)?u(e):u;p!==e&&((d=i.current)==null||d.call(i,p))}else s(u)},[a,e,s,i]);return[c,l]}function Ru({defaultProp:e,onChange:t}){const[n,r]=h.useState(e),o=h.useRef(n),s=h.useRef(t);return Tu(()=>{s.current=t},[t]),h.useEffect(()=>{var i;o.current!==n&&((i=s.current)==null||i.call(s,n),o.current=n)},[n,o]),[n,r,s]}function Eu(e){return typeof e=="function"}/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Du=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),Oi=(...e)=>e.filter((t,n,r)=>!!t&&r.indexOf(t)===n).join(" ");/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var Lu={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vu=h.forwardRef(({color:e="currentColor",size:t=24,strokeWidth:n=2,absoluteStrokeWidth:r,className:o="",children:s,iconNode:i,...a},c)=>h.createElement("svg",{ref:c,...Lu,width:t,height:t,stroke:e,strokeWidth:r?Number(n)*24/Number(t):n,className:Oi("lucide",o),...a},[...i.map(([l,u])=>h.createElement(l,u)),...Array.isArray(s)?s:[s]]));/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f=(e,t)=>{const n=h.forwardRef(({className:r,...o},s)=>h.createElement(Vu,{ref:s,iconNode:t,className:Oi(`lucide-${Du(e)}`,r),...o}));return n.displayName=`${e}`,n};/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const um=f("Activity",[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",key:"169zse"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dm=f("AlignLeft",[["line",{x1:"21",x2:"3",y1:"6",y2:"6",key:"1fp77t"}],["line",{x1:"15",x2:"3",y1:"12",y2:"12",key:"v6grx8"}],["line",{x1:"17",x2:"3",y1:"18",y2:"18",key:"1awlsn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hm=f("Anchor",[["path",{d:"M12 22V8",key:"qkxhtm"}],["path",{d:"M5 12H2a10 10 0 0 0 20 0h-3",key:"1hv3nh"}],["circle",{cx:"12",cy:"5",r:"3",key:"rqqgnr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fm=f("Archive",[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pm=f("Armchair",[["path",{d:"M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3",key:"irtipd"}],["path",{d:"M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z",key:"1e01m0"}],["path",{d:"M5 18v2",key:"ppbyun"}],["path",{d:"M19 18v2",key:"gy7782"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ym=f("ArrowDownLeft",[["path",{d:"M17 7 7 17",key:"15tmo1"}],["path",{d:"M17 17H7V7",key:"1org7z"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mm=f("ArrowDownRight",[["path",{d:"m7 7 10 10",key:"1fmybs"}],["path",{d:"M17 7v10H7",key:"6fjiku"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gm=f("ArrowDownToLine",[["path",{d:"M12 17V3",key:"1cwfxf"}],["path",{d:"m6 11 6 6 6-6",key:"12ii2o"}],["path",{d:"M19 21H5",key:"150jfl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vm=f("ArrowDownUp",[["path",{d:"m3 16 4 4 4-4",key:"1co6wj"}],["path",{d:"M7 20V4",key:"1yoxec"}],["path",{d:"m21 8-4-4-4 4",key:"1c9v7m"}],["path",{d:"M17 4v16",key:"7dpous"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("ArrowDownWideNarrow",[["path",{d:"m3 16 4 4 4-4",key:"1co6wj"}],["path",{d:"M7 20V4",key:"1yoxec"}],["path",{d:"M11 4h10",key:"1w87gc"}],["path",{d:"M11 8h7",key:"djye34"}],["path",{d:"M11 12h4",key:"q8tih4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const km=f("ArrowDown",[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xm=f("ArrowLeftRight",[["path",{d:"M8 3 4 7l4 4",key:"9rb6wj"}],["path",{d:"M4 7h16",key:"6tx8e3"}],["path",{d:"m16 21 4-4-4-4",key:"siv7j2"}],["path",{d:"M20 17H4",key:"h6l3hr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mm=f("ArrowLeft",[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wm=f("ArrowRightLeft",[["path",{d:"m16 3 4 4-4 4",key:"1x1c3m"}],["path",{d:"M20 7H4",key:"zbl0bi"}],["path",{d:"m8 21-4-4 4-4",key:"h9nckh"}],["path",{d:"M4 17h16",key:"g4d7ey"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bm=f("ArrowRight",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"m12 5 7 7-7 7",key:"xquz4c"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Cm=f("ArrowUpDown",[["path",{d:"m21 16-4 4-4-4",key:"f6ql7i"}],["path",{d:"M17 20V4",key:"1ejh1v"}],["path",{d:"m3 8 4-4 4 4",key:"11wl7u"}],["path",{d:"M7 4v16",key:"1glfcx"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sm=f("ArrowUpFromLine",[["path",{d:"m18 9-6-6-6 6",key:"kcunyi"}],["path",{d:"M12 3v14",key:"7cf3v8"}],["path",{d:"M5 21h14",key:"11awu3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("ArrowUpNarrowWide",[["path",{d:"m3 8 4-4 4 4",key:"11wl7u"}],["path",{d:"M7 4v16",key:"1glfcx"}],["path",{d:"M11 12h4",key:"q8tih4"}],["path",{d:"M11 16h7",key:"uosisv"}],["path",{d:"M11 20h10",key:"jvxblo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pm=f("ArrowUpRight",[["path",{d:"M7 7h10v10",key:"1tivn9"}],["path",{d:"M7 17 17 7",key:"1vkiza"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Am=f("ArrowUp",[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("AtSign",[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tm=f("Award",[["path",{d:"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526",key:"1yiouv"}],["circle",{cx:"12",cy:"8",r:"6",key:"1vp47v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rm=f("BadgeCheck",[["path",{d:"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z",key:"3c2336"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Em=f("Ban",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m4.9 4.9 14.2 14.2",key:"1m5liu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dm=f("Banknote",[["rect",{width:"20",height:"12",x:"2",y:"6",rx:"2",key:"9lu3g6"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}],["path",{d:"M6 12h.01M18 12h.01",key:"113zkx"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lm=f("BarChart2",[["line",{x1:"18",x2:"18",y1:"20",y2:"10",key:"1xfpm4"}],["line",{x1:"12",x2:"12",y1:"20",y2:"4",key:"be30l9"}],["line",{x1:"6",x2:"6",y1:"20",y2:"14",key:"1r4le6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vm=f("BarChart3",[["path",{d:"M3 3v18h18",key:"1s2lah"}],["path",{d:"M18 17V9",key:"2bz60n"}],["path",{d:"M13 17V5",key:"1frdt8"}],["path",{d:"M8 17v-3",key:"17ska0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("BarChart",[["line",{x1:"12",x2:"12",y1:"20",y2:"10",key:"1vz5eb"}],["line",{x1:"18",x2:"18",y1:"20",y2:"4",key:"cun8e5"}],["line",{x1:"6",x2:"6",y1:"20",y2:"16",key:"hq0ia6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Om=f("Barcode",[["path",{d:"M3 5v14",key:"1nt18q"}],["path",{d:"M8 5v14",key:"1ybrkv"}],["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"M17 5v14",key:"ycjyhj"}],["path",{d:"M21 5v14",key:"nzette"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Im=f("Beaker",[["path",{d:"M4.5 3h15",key:"c7n0jr"}],["path",{d:"M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3",key:"m1uhx7"}],["path",{d:"M6 14h12",key:"4cwo0f"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jm=f("BellOff",[["path",{d:"M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5",key:"o7mx20"}],["path",{d:"M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7",key:"16f1lm"}],["path",{d:"M10.3 21a1.94 1.94 0 0 0 3.4 0",key:"qgo35s"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fm=f("BellRing",[["path",{d:"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9",key:"1qo2s2"}],["path",{d:"M10.3 21a1.94 1.94 0 0 0 3.4 0",key:"qgo35s"}],["path",{d:"M4 2C2.8 3.7 2 5.7 2 8",key:"tap9e0"}],["path",{d:"M22 8c0-2.3-.8-4.3-2-6",key:"5bb3ad"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nm=f("Bell",[["path",{d:"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9",key:"1qo2s2"}],["path",{d:"M10.3 21a1.94 1.94 0 0 0 3.4 0",key:"qgo35s"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Bike",[["circle",{cx:"18.5",cy:"17.5",r:"3.5",key:"15x4ox"}],["circle",{cx:"5.5",cy:"17.5",r:"3.5",key:"1noe27"}],["circle",{cx:"15",cy:"5",r:"1",key:"19l28e"}],["path",{d:"M12 17.5V14l-3-3 4-3 2 3h2",key:"1npguv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _m=f("BookCheck",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["path",{d:"m9 9.5 2 2 4-4",key:"1dth82"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bm=f("BookMarked",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["polyline",{points:"10 2 10 10 13 7 16 10 16 2",key:"13o6vz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zm=f("BookOpen",[["path",{d:"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z",key:"vv98re"}],["path",{d:"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",key:"1cyq3y"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hm=f("BookX",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["path",{d:"m14.5 7-5 5",key:"dy991v"}],["path",{d:"m9.5 7 5 5",key:"s45iea"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qm=f("Book",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Bookmark",[["path",{d:"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",key:"1fy3hk"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Um=f("Bot",[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $m=f("Box",[["path",{d:"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",key:"hh9hay"}],["path",{d:"m3.3 7 8.7 5 8.7-5",key:"g66t2b"}],["path",{d:"M12 22V12",key:"d0xqtd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wm=f("Boxes",[["path",{d:"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z",key:"lc1i9w"}],["path",{d:"m7 16.5-4.74-2.85",key:"1o9zyk"}],["path",{d:"m7 16.5 5-3",key:"va8pkn"}],["path",{d:"M7 16.5v5.17",key:"jnp8gn"}],["path",{d:"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z",key:"8zsnat"}],["path",{d:"m17 16.5-5-3",key:"8arw3v"}],["path",{d:"m17 16.5 4.74-2.85",key:"8rfmw"}],["path",{d:"M17 16.5v5.17",key:"k6z78m"}],["path",{d:"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z",key:"1xygjf"}],["path",{d:"M12 8 7.26 5.15",key:"1vbdud"}],["path",{d:"m12 8 4.74-2.85",key:"3rx089"}],["path",{d:"M12 13.5V8",key:"1io7kd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Km=f("Brain",[["path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",key:"l5xja"}],["path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",key:"ep3f8r"}],["path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",key:"1p4c4q"}],["path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375",key:"tmeiqw"}],["path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5",key:"105sqy"}],["path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396",key:"ql3yin"}],["path",{d:"M19.938 10.5a4 4 0 0 1 .585.396",key:"1qfode"}],["path",{d:"M6 18a4 4 0 0 1-1.967-.516",key:"2e4loj"}],["path",{d:"M19.967 17.484A4 4 0 0 1 18 18",key:"159ez6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gm=f("Briefcase",[["path",{d:"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",key:"jecpp"}],["rect",{width:"20",height:"14",x:"2",y:"6",rx:"2",key:"i6l2r4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zm=f("Brush",[["path",{d:"m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08",key:"1styjt"}],["path",{d:"M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z",key:"z0l1mu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xm=f("Building2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ym=f("Building",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["path",{d:"M9 22v-4h6v4",key:"r93iot"}],["path",{d:"M8 6h.01",key:"1dz90k"}],["path",{d:"M16 6h.01",key:"1x0f13"}],["path",{d:"M12 6h.01",key:"1vi96p"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M8 14h.01",key:"6423bh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qm=f("Calculator",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",key:"1nb95v"}],["line",{x1:"8",x2:"16",y1:"6",y2:"6",key:"x4nwl0"}],["line",{x1:"16",x2:"16",y1:"14",y2:"18",key:"wjye3r"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M8 14h.01",key:"6423bh"}],["path",{d:"M12 18h.01",key:"mhygvu"}],["path",{d:"M8 18h.01",key:"lrp35t"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jm=f("CalendarCheck",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"m9 16 2 2 4-4",key:"19s6y9"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const eg=f("CalendarClock",[["path",{d:"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5",key:"1osxxc"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M3 10h5",key:"r794hk"}],["path",{d:"M17.5 17.5 16 16.3V14",key:"akvzfd"}],["circle",{cx:"16",cy:"16",r:"6",key:"qoo3c4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tg=f("CalendarDays",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"M8 14h.01",key:"6423bh"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M8 18h.01",key:"lrp35t"}],["path",{d:"M12 18h.01",key:"mhygvu"}],["path",{d:"M16 18h.01",key:"kzsmim"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ng=f("CalendarPlus",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8",key:"3spt84"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"M16 19h6",key:"xwg31i"}],["path",{d:"M19 16v6",key:"tddt3s"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rg=f("CalendarRange",[["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M17 14h-6",key:"bkmgh3"}],["path",{d:"M13 18H7",key:"bb0bb7"}],["path",{d:"M7 14h.01",key:"1qa3f1"}],["path",{d:"M17 18h.01",key:"1bdyru"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("CalendarX",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"m14 14-4 4",key:"rymu2i"}],["path",{d:"m10 14 4 4",key:"3sz06r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const og=f("Calendar",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const sg=f("Camera",[["path",{d:"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",key:"1tc9qg"}],["circle",{cx:"12",cy:"13",r:"3",key:"1vg3eu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ig=f("Car",[["path",{d:"M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2",key:"5owen"}],["circle",{cx:"7",cy:"17",r:"2",key:"u2ysq9"}],["path",{d:"M9 17h6",key:"r8uit2"}],["circle",{cx:"17",cy:"17",r:"2",key:"axvx0g"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ag=f("CheckCheck",[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const cg=f("Check",[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lg=f("ChevronDown",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ug=f("ChevronLeft",[["path",{d:"m15 18-6-6 6-6",key:"1wnfg3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dg=f("ChevronRight",[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hg=f("ChevronUp",[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fg=f("ChevronsDownUp",[["path",{d:"m7 20 5-5 5 5",key:"13a0gw"}],["path",{d:"m7 4 5 5 5-5",key:"1kwcof"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("ChevronsDown",[["path",{d:"m7 6 5 5 5-5",key:"1lc07p"}],["path",{d:"m7 13 5 5 5-5",key:"1d48rs"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pg=f("ChevronsLeft",[["path",{d:"m11 17-5-5 5-5",key:"13zhaf"}],["path",{d:"m18 17-5-5 5-5",key:"h8a8et"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yg=f("ChevronsRight",[["path",{d:"m6 17 5-5-5-5",key:"xnjwq"}],["path",{d:"m13 17 5-5-5-5",key:"17xmmf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mg=f("ChevronsUpDown",[["path",{d:"m7 15 5 5 5-5",key:"1hf1tw"}],["path",{d:"m7 9 5-5 5 5",key:"sgt6xg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("ChevronsUp",[["path",{d:"m17 11-5-5-5 5",key:"e8nh98"}],["path",{d:"m17 18-5-5-5 5",key:"2avn1x"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gg=f("CircleAlert",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vg=f("CircleArrowDown",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 8v8",key:"napkw2"}],["path",{d:"m8 12 4 4 4-4",key:"k98ssh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kg=f("CircleArrowRight",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M8 12h8",key:"1wcyev"}],["path",{d:"m12 16 4-4-4-4",key:"1i9zcv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xg=f("CircleArrowUp",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m16 12-4-4-4 4",key:"177agl"}],["path",{d:"M12 16V8",key:"1sbj14"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mg=f("CircleCheckBig",[["path",{d:"M22 11.08V12a10 10 0 1 1-5.93-9.14",key:"g774vq"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wg=f("CircleCheck",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bg=f("CircleDollarSign",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",key:"1h4pet"}],["path",{d:"M12 18V6",key:"zqpxq5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Cg=f("CircleDot",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sg=f("CircleHelp",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pg=f("CirclePause",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"10",x2:"10",y1:"15",y2:"9",key:"c1nkhi"}],["line",{x1:"14",x2:"14",y1:"15",y2:"9",key:"h65svq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ag=f("CirclePlay",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polygon",{points:"10 8 16 12 10 16 10 8",key:"1cimsy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tg=f("CirclePlus",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M8 12h8",key:"1wcyev"}],["path",{d:"M12 8v8",key:"napkw2"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rg=f("CircleUserRound",[["path",{d:"M18 20a6 6 0 0 0-12 0",key:"1qehca"}],["circle",{cx:"12",cy:"10",r:"4",key:"1h16sb"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Eg=f("CircleUser",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"10",r:"3",key:"ilqhr7"}],["path",{d:"M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662",key:"154egf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dg=f("CircleX",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lg=f("Circle",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vg=f("ClipboardCheck",[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}],["path",{d:"m9 14 2 2 4-4",key:"df797q"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Og=f("ClipboardList",[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}],["path",{d:"M12 11h4",key:"1jrz19"}],["path",{d:"M12 16h4",key:"n85exb"}],["path",{d:"M8 11h.01",key:"1dfujw"}],["path",{d:"M8 16h.01",key:"18s6g9"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Clipboard",[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ig=f("Clock",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16 14",key:"68esgv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("CloudDownload",[["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",key:"1pljnt"}],["path",{d:"M12 12v9",key:"192myk"}],["path",{d:"m8 17 4 4 4-4",key:"1ul180"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jg=f("CloudOff",[["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193",key:"yfwify"}],["path",{d:"M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07",key:"jlfiyv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("CloudUpload",[["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",key:"1pljnt"}],["path",{d:"M12 12v9",key:"192myk"}],["path",{d:"m16 16-4-4-4 4",key:"119tzi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fg=f("Cloud",[["path",{d:"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",key:"p7xjir"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("CodeXml",[["path",{d:"m18 16 4-4-4-4",key:"1inbqp"}],["path",{d:"m6 8-4 4 4 4",key:"15zrgr"}],["path",{d:"m14.5 4-5 16",key:"e7oirm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ng=f("Code",[["polyline",{points:"16 18 22 12 16 6",key:"z7tu5w"}],["polyline",{points:"8 6 2 12 8 18",key:"1eg1df"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _g=f("Coins",[["circle",{cx:"8",cy:"8",r:"6",key:"3yglwk"}],["path",{d:"M18.09 10.37A6 6 0 1 1 10.34 18",key:"t5s6rm"}],["path",{d:"M7 6h1v4",key:"1obek4"}],["path",{d:"m16.71 13.88.7.71-2.82 2.82",key:"1rbuyh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bg=f("Columns2",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zg=f("Columns3",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Compass",[["path",{d:"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z",key:"9ktpf1"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hg=f("Container",[["path",{d:"M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z",key:"1t2lqe"}],["path",{d:"M10 21.9V14L2.1 9.1",key:"o7czzq"}],["path",{d:"m10 14 11.9-6.9",key:"zm5e20"}],["path",{d:"M14 19.8v-8.1",key:"159ecu"}],["path",{d:"M18 17.5V9.4",key:"11uown"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qg=f("Copy",[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ug=f("CornerDownLeft",[["polyline",{points:"9 10 4 15 9 20",key:"r3jprv"}],["path",{d:"M20 4v7a4 4 0 0 1-4 4H4",key:"6o5b7l"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $g=f("Cpu",[["rect",{width:"16",height:"16",x:"4",y:"4",rx:"2",key:"14l7u7"}],["rect",{width:"6",height:"6",x:"9",y:"9",rx:"1",key:"5aljv4"}],["path",{d:"M15 2v2",key:"13l42r"}],["path",{d:"M15 20v2",key:"15mkzm"}],["path",{d:"M2 15h2",key:"1gxd5l"}],["path",{d:"M2 9h2",key:"1bbxkp"}],["path",{d:"M20 15h2",key:"19e6y8"}],["path",{d:"M20 9h2",key:"19tzq7"}],["path",{d:"M9 2v2",key:"165o2o"}],["path",{d:"M9 20v2",key:"i2bqo8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wg=f("CreditCard",[["rect",{width:"20",height:"14",x:"2",y:"5",rx:"2",key:"ynyp8z"}],["line",{x1:"2",x2:"22",y1:"10",y2:"10",key:"1b3vmo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Kg=f("Crown",[["path",{d:"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z",key:"1vdc57"}],["path",{d:"M5 21h14",key:"11awu3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gg=f("Cylinder",[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3",key:"msslwz"}],["path",{d:"M3 5v14a9 3 0 0 0 18 0V5",key:"aqi0yr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zg=f("Database",[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3",key:"msslwz"}],["path",{d:"M3 5V19A9 3 0 0 0 21 19V5",key:"1wlel7"}],["path",{d:"M3 12A9 3 0 0 0 21 12",key:"mv7ke4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xg=f("DollarSign",[["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}],["path",{d:"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",key:"1b0p4s"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yg=f("Download",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"7 10 12 15 17 10",key:"2ggqvy"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3",key:"1vk2je"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qg=f("Earth",[["path",{d:"M21.54 15H17a2 2 0 0 0-2 2v4.54",key:"1djwo0"}],["path",{d:"M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17",key:"1tzkfa"}],["path",{d:"M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05",key:"14pb5j"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jg=f("EllipsisVertical",[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"12",cy:"5",r:"1",key:"gxeob9"}],["circle",{cx:"12",cy:"19",r:"1",key:"lyex9k"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ev=f("Ellipsis",[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tv=f("Equal",[["line",{x1:"5",x2:"19",y1:"9",y2:"9",key:"1nwqeh"}],["line",{x1:"5",x2:"19",y1:"15",y2:"15",key:"g8yjpy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const nv=f("Euro",[["path",{d:"M4 10h12",key:"1y6xl8"}],["path",{d:"M4 14h9",key:"1loblj"}],["path",{d:"M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2",key:"1j6lzo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rv=f("ExternalLink",[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ov=f("EyeOff",[["path",{d:"M9.88 9.88a3 3 0 1 0 4.24 4.24",key:"1jxqfv"}],["path",{d:"M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68",key:"9wicm4"}],["path",{d:"M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61",key:"1jreej"}],["line",{x1:"2",x2:"22",y1:"2",y2:"22",key:"a6p6uj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const sv=f("Eye",[["path",{d:"M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z",key:"rwhkz3"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const iv=f("Factory",[["path",{d:"M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",key:"159hny"}],["path",{d:"M17 18h1",key:"uldtlt"}],["path",{d:"M12 18h1",key:"s9uhes"}],["path",{d:"M7 18h1",key:"1neino"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const av=f("FastForward",[["polygon",{points:"13 19 22 12 13 5 13 19",key:"587y9g"}],["polygon",{points:"2 19 11 12 2 5 2 19",key:"3pweh0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const cv=f("FileBarChart",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M8 18v-2",key:"qcmpov"}],["path",{d:"M12 18v-4",key:"q1q25u"}],["path",{d:"M16 18v-6",key:"15y0np"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lv=f("FileCheck",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"m9 15 2 2 4-4",key:"1grp1n"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const uv=f("FileCode",[["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",key:"1mlx9k"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dv=f("FileDown",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M12 18v-6",key:"17g6i2"}],["path",{d:"m9 15 3 3 3-3",key:"1npd3o"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hv=f("FileImage",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("FileMinus",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M9 15h6",key:"cctwl0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fv=f("FilePenLine",[["path",{d:"m18 5-2.414-2.414A2 2 0 0 0 14.172 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2",key:"142zxg"}],["path",{d:"M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z",key:"2t3380"}],["path",{d:"M8 18h1",key:"13wk12"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pv=f("FilePen",[["path",{d:"M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5",key:"1couwa"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z",key:"1y4qbx"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yv=f("FilePlus",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M9 15h6",key:"cctwl0"}],["path",{d:"M12 18v-6",key:"17g6i2"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mv=f("FileQuestion",[["path",{d:"M12 17h.01",key:"p32p05"}],["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",key:"1mlx9k"}],["path",{d:"M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3",key:"mhlwft"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gv=f("FileSearch",[["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3",key:"ms7g94"}],["path",{d:"m9 18-1.5-1.5",key:"1j6qii"}],["circle",{cx:"5",cy:"14",r:"3",key:"ufru5t"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vv=f("FileSpreadsheet",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M8 13h2",key:"yr2amv"}],["path",{d:"M14 13h2",key:"un5t4a"}],["path",{d:"M8 17h2",key:"2yhykz"}],["path",{d:"M14 17h2",key:"10kma7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kv=f("FileText",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xv=f("FileType2",[["path",{d:"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4",key:"1pf5j1"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M2 13v-1h6v1",key:"1dh9dg"}],["path",{d:"M5 12v6",key:"150t9c"}],["path",{d:"M4 18h2",key:"1xrofg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mv=f("FileUp",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"m15 15-3-3-3 3",key:"15xj92"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wv=f("FileX",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"m14.5 12.5-5 5",key:"b62r18"}],["path",{d:"m9.5 12.5 5 5",key:"1rk7el"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bv=f("File",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Cv=f("Files",[["path",{d:"M20 7h-3a2 2 0 0 1-2-2V2",key:"x099mo"}],["path",{d:"M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z",key:"18t6ie"}],["path",{d:"M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8",key:"1nja0z"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sv=f("Filter",[["polygon",{points:"22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3",key:"1yg77f"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pv=f("Fingerprint",[["path",{d:"M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4",key:"1nerag"}],["path",{d:"M14 13.12c0 2.38 0 6.38-1 8.88",key:"o46ks0"}],["path",{d:"M17.29 21.02c.12-.6.43-2.3.5-3.02",key:"ptglia"}],["path",{d:"M2 12a10 10 0 0 1 18-6",key:"ydlgp0"}],["path",{d:"M2 16h.01",key:"1gqxmh"}],["path",{d:"M21.8 16c.2-2 .131-5.354 0-6",key:"drycrb"}],["path",{d:"M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2",key:"1tidbn"}],["path",{d:"M8.65 22c.21-.66.45-1.32.57-2",key:"13wd9y"}],["path",{d:"M9 6.8a6 6 0 0 1 9 5.2v2",key:"1fr1j5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Av=f("Flag",[["path",{d:"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z",key:"i9b6wo"}],["line",{x1:"4",x2:"4",y1:"22",y2:"15",key:"1cm3nv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tv=f("FlaskConical",[["path",{d:"M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2",key:"pzvekw"}],["path",{d:"M8.5 2h7",key:"csnxdl"}],["path",{d:"M7 16h10",key:"wp8him"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rv=f("FolderOpen",[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ev=f("FolderPlus",[["path",{d:"M12 10v6",key:"1bos4e"}],["path",{d:"M9 13h6",key:"1uhe8q"}],["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dv=f("FolderTree",[["path",{d:"M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z",key:"hod4my"}],["path",{d:"M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z",key:"w4yl2u"}],["path",{d:"M3 5a2 2 0 0 0 2 2h3",key:"f2jnh7"}],["path",{d:"M3 3v13a2 2 0 0 0 2 2h3",key:"k8epm1"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lv=f("Folder",[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vv=f("GalleryHorizontalEnd",[["path",{d:"M2 7v10",key:"a2pl2d"}],["path",{d:"M6 5v14",key:"1kq3d7"}],["rect",{width:"12",height:"18",x:"10",y:"3",rx:"2",key:"13i7bc"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Gauge",[["path",{d:"m12 14 4-4",key:"9kzdfg"}],["path",{d:"M3.34 19a10 10 0 1 1 17.32 0",key:"19p75a"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ov=f("Gift",[["rect",{x:"3",y:"8",width:"18",height:"4",rx:"1",key:"bkv52"}],["path",{d:"M12 8v13",key:"1c76mn"}],["path",{d:"M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7",key:"6wjy6b"}],["path",{d:"M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5",key:"1ihvrl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Iv=f("GitBranch",[["line",{x1:"6",x2:"6",y1:"3",y2:"15",key:"17qcm7"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}],["path",{d:"M18 9a9 9 0 0 1-9 9",key:"n2h4wq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Github",[["path",{d:"M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",key:"tonef"}],["path",{d:"M9 18c-4.51 2-5-2-7-2",key:"9comsn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jv=f("Globe",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fv=f("GraduationCap",[["path",{d:"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z",key:"j76jl0"}],["path",{d:"M22 10v6",key:"1lu8f3"}],["path",{d:"M6 12.5V16a6 3 0 0 0 12 0v-3.5",key:"1r8lef"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nv=f("Grid3x3",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}],["path",{d:"M3 15h18",key:"5xshup"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _v=f("GripVertical",[["circle",{cx:"9",cy:"12",r:"1",key:"1vctgf"}],["circle",{cx:"9",cy:"5",r:"1",key:"hp0tcf"}],["circle",{cx:"9",cy:"19",r:"1",key:"fkjjf6"}],["circle",{cx:"15",cy:"12",r:"1",key:"1tmaij"}],["circle",{cx:"15",cy:"5",r:"1",key:"19l28e"}],["circle",{cx:"15",cy:"19",r:"1",key:"f4zoj3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bv=f("Handshake",[["path",{d:"m11 17 2 2a1 1 0 1 0 3-3",key:"efffak"}],["path",{d:"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4",key:"9pr0kb"}],["path",{d:"m21 3 1 11h-2",key:"1tisrp"}],["path",{d:"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3",key:"1uvwmv"}],["path",{d:"M3 4h8",key:"1ep09j"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zv=f("HardDrive",[["line",{x1:"22",x2:"2",y1:"12",y2:"12",key:"1y58io"}],["path",{d:"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",key:"oot6mr"}],["line",{x1:"6",x2:"6.01",y1:"16",y2:"16",key:"sgf278"}],["line",{x1:"10",x2:"10.01",y1:"16",y2:"16",key:"1l4acy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hv=f("Hash",[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qv=f("Headphones",[["path",{d:"M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",key:"1xhozi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Uv=f("Heart",[["path",{d:"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",key:"c3ymky"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $v=f("History",[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wv=f("Home",[["path",{d:"m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"y5dka4"}],["polyline",{points:"9 22 9 12 15 12 15 22",key:"e2us08"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Hourglass",[["path",{d:"M5 22h14",key:"ehvnwv"}],["path",{d:"M5 2h14",key:"pdyrp9"}],["path",{d:"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22",key:"1d314k"}],["path",{d:"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2",key:"1vvvr6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Kv=f("ImagePlus",[["path",{d:"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7",key:"31hg93"}],["line",{x1:"16",x2:"22",y1:"5",y2:"5",key:"ez7e4s"}],["line",{x1:"19",x2:"19",y1:"2",y2:"8",key:"1gkr8c"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gv=f("Image",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",ry:"2",key:"1m3agn"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zv=f("Import",[["path",{d:"M12 3v12",key:"1x0j5s"}],["path",{d:"m8 11 4 4 4-4",key:"1dohi6"}],["path",{d:"M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4",key:"1ywtjm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xv=f("Inbox",[["polyline",{points:"22 12 16 12 14 15 10 15 8 12 2 12",key:"o97t9d"}],["path",{d:"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",key:"oot6mr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yv=f("Info",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qv=f("KeyRound",[["path",{d:"M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z",key:"167ctg"}],["circle",{cx:"16.5",cy:"7.5",r:".5",fill:"currentColor",key:"w0ekpg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jv=f("Key",[["path",{d:"m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4",key:"g0fldk"}],["path",{d:"m21 2-9.6 9.6",key:"1j0ho8"}],["circle",{cx:"7.5",cy:"15.5",r:"5.5",key:"yqb3hr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ek=f("Keyboard",[["path",{d:"M10 8h.01",key:"1r9ogq"}],["path",{d:"M12 12h.01",key:"1mp3jc"}],["path",{d:"M14 8h.01",key:"1primd"}],["path",{d:"M16 12h.01",key:"1l6xoz"}],["path",{d:"M18 8h.01",key:"emo2bl"}],["path",{d:"M6 8h.01",key:"x9i8wu"}],["path",{d:"M7 16h10",key:"wp8him"}],["path",{d:"M8 12h.01",key:"czm47f"}],["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2",key:"18n3k1"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tk=f("Landmark",[["line",{x1:"3",x2:"21",y1:"22",y2:"22",key:"j8o0r"}],["line",{x1:"6",x2:"6",y1:"18",y2:"11",key:"10tf0k"}],["line",{x1:"10",x2:"10",y1:"18",y2:"11",key:"54lgf6"}],["line",{x1:"14",x2:"14",y1:"18",y2:"11",key:"380y"}],["line",{x1:"18",x2:"18",y1:"18",y2:"11",key:"1kevvc"}],["polygon",{points:"12 2 20 7 4 7",key:"jkujk7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const nk=f("Languages",[["path",{d:"m5 8 6 6",key:"1wu5hv"}],["path",{d:"m4 14 6-6 2-3",key:"1k1g8d"}],["path",{d:"M2 5h12",key:"or177f"}],["path",{d:"M7 2h1",key:"1t2jsx"}],["path",{d:"m22 22-5-10-5 10",key:"don7ne"}],["path",{d:"M14 18h6",key:"1m8k6r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rk=f("Laptop",[["path",{d:"M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16",key:"tarvll"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ok=f("Layers",[["path",{d:"m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",key:"8b97xw"}],["path",{d:"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65",key:"dd6zsq"}],["path",{d:"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65",key:"ep9fru"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const sk=f("LayoutDashboard",[["rect",{width:"7",height:"9",x:"3",y:"3",rx:"1",key:"10lvy0"}],["rect",{width:"7",height:"5",x:"14",y:"3",rx:"1",key:"16une8"}],["rect",{width:"7",height:"9",x:"14",y:"12",rx:"1",key:"1hutg5"}],["rect",{width:"7",height:"5",x:"3",y:"16",rx:"1",key:"ldoo1y"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ik=f("LayoutGrid",[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"14",y:"3",rx:"1",key:"6d4xhi"}],["rect",{width:"7",height:"7",x:"14",y:"14",rx:"1",key:"nxv5o0"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ak=f("LayoutList",[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ck=f("LayoutTemplate",[["rect",{width:"18",height:"7",x:"3",y:"3",rx:"1",key:"f1a2em"}],["rect",{width:"9",height:"7",x:"3",y:"14",rx:"1",key:"jqznyg"}],["rect",{width:"5",height:"7",x:"16",y:"14",rx:"1",key:"q5h2i8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lk=f("Lightbulb",[["path",{d:"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",key:"1gvzjb"}],["path",{d:"M9 18h6",key:"x1upvd"}],["path",{d:"M10 22h4",key:"ceow96"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("LineChart",[["path",{d:"M3 3v18h18",key:"1s2lah"}],["path",{d:"m19 9-5 5-4-4-3 3",key:"2osh9i"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const uk=f("Link2",[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dk=f("Link",[["path",{d:"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",key:"1cjeqo"}],["path",{d:"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",key:"19qd67"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hk=f("ListChecks",[["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}],["path",{d:"M13 6h8",key:"15sg57"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 18h8",key:"oe0vm4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fk=f("ListOrdered",[["line",{x1:"10",x2:"21",y1:"6",y2:"6",key:"76qw6h"}],["line",{x1:"10",x2:"21",y1:"12",y2:"12",key:"16nom4"}],["line",{x1:"10",x2:"21",y1:"18",y2:"18",key:"u3jurt"}],["path",{d:"M4 6h1v4",key:"cnovpq"}],["path",{d:"M4 10h2",key:"16xx2s"}],["path",{d:"M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",key:"m9a95d"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pk=f("List",[["line",{x1:"8",x2:"21",y1:"6",y2:"6",key:"7ey8pc"}],["line",{x1:"8",x2:"21",y1:"12",y2:"12",key:"rjfblc"}],["line",{x1:"8",x2:"21",y1:"18",y2:"18",key:"c3b1m8"}],["line",{x1:"3",x2:"3.01",y1:"6",y2:"6",key:"1g7gq3"}],["line",{x1:"3",x2:"3.01",y1:"12",y2:"12",key:"1pjlvk"}],["line",{x1:"3",x2:"3.01",y1:"18",y2:"18",key:"28t2mc"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yk=f("LoaderCircle",[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mk=f("LockKeyhole",[["circle",{cx:"12",cy:"16",r:"1",key:"1au0dj"}],["rect",{x:"3",y:"10",width:"18",height:"12",rx:"2",key:"6s8ecr"}],["path",{d:"M7 10V7a5 5 0 0 1 10 0v3",key:"1pqi11"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gk=f("LockOpen",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 9.9-1",key:"1mm8w8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vk=f("Lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kk=f("LogIn",[["path",{d:"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4",key:"u53s6r"}],["polyline",{points:"10 17 15 12 10 7",key:"1ail0h"}],["line",{x1:"15",x2:"3",y1:"12",y2:"12",key:"v6grx8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xk=f("LogOut",[["path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",key:"1uf3rs"}],["polyline",{points:"16 17 21 12 16 7",key:"1gabdz"}],["line",{x1:"21",x2:"9",y1:"12",y2:"12",key:"1uyos4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("MailOpen",[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mk=f("Mail",[["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2",key:"18n3k1"}],["path",{d:"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",key:"1ocrg3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wk=f("MapPin",[["path",{d:"M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z",key:"2oe9fu"}],["circle",{cx:"12",cy:"10",r:"3",key:"ilqhr7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bk=f("MapPinned",[["path",{d:"M18 8c0 4.5-6 9-6 9s-6-4.5-6-9a6 6 0 0 1 12 0",key:"yrbn30"}],["circle",{cx:"12",cy:"8",r:"2",key:"1822b1"}],["path",{d:"M8.835 14H5a1 1 0 0 0-.9.7l-2 6c-.1.1-.1.2-.1.3 0 .6.4 1 1 1h18c.6 0 1-.4 1-1 0-.1 0-.2-.1-.3l-2-6a1 1 0 0 0-.9-.7h-3.835",key:"112zkj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ck=f("Map",[["path",{d:"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z",key:"169xi5"}],["path",{d:"M15 5.764v15",key:"1pn4in"}],["path",{d:"M9 3.236v15",key:"1uimfh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sk=f("Maximize2",[["polyline",{points:"15 3 21 3 21 9",key:"mznyad"}],["polyline",{points:"9 21 3 21 3 15",key:"1avn1i"}],["line",{x1:"21",x2:"14",y1:"3",y2:"10",key:"ota7mn"}],["line",{x1:"3",x2:"10",y1:"21",y2:"14",key:"1atl0r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Medal",[["path",{d:"M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15",key:"143lza"}],["path",{d:"M11 12 5.12 2.2",key:"qhuxz6"}],["path",{d:"m13 12 5.88-9.8",key:"hbye0f"}],["path",{d:"M8 7h8",key:"i86dvs"}],["circle",{cx:"12",cy:"17",r:"5",key:"qbz8iq"}],["path",{d:"M12 18v-2h-.5",key:"fawc4q"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pk=f("Megaphone",[["path",{d:"m3 11 18-5v12L3 14v-3z",key:"n962bs"}],["path",{d:"M11.6 16.8a3 3 0 1 1-5.8-1.6",key:"1yl0tm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Menu",[["line",{x1:"4",x2:"20",y1:"12",y2:"12",key:"1e0a9i"}],["line",{x1:"4",x2:"20",y1:"6",y2:"6",key:"1owob3"}],["line",{x1:"4",x2:"20",y1:"18",y2:"18",key:"yk5zj1"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Merge",[["path",{d:"m8 6 4-4 4 4",key:"ybng9g"}],["path",{d:"M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22",key:"1hyw0i"}],["path",{d:"m20 22-5-5",key:"1m27yz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ak=f("MessageCircle",[["path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z",key:"vv11sd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tk=f("MessageSquareQuote",[["path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",key:"1lielz"}],["path",{d:"M8 12a2 2 0 0 0 2-2V8H8",key:"1jfesj"}],["path",{d:"M14 12a2 2 0 0 0 2-2V8h-2",key:"1dq9mh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rk=f("MessageSquare",[["path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",key:"1lielz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ek=f("Minimize2",[["polyline",{points:"4 14 10 14 10 20",key:"11kfnr"}],["polyline",{points:"20 10 14 10 14 4",key:"rlmsce"}],["line",{x1:"14",x2:"21",y1:"10",y2:"3",key:"o5lafz"}],["line",{x1:"3",x2:"10",y1:"21",y2:"14",key:"1atl0r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dk=f("Minus",[["path",{d:"M5 12h14",key:"1ays0h"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lk=f("Monitor",[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vk=f("Moon",[["path",{d:"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",key:"a7tn18"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ok=f("MoveRight",[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ik=f("Move",[["polyline",{points:"5 9 2 12 5 15",key:"1r5uj5"}],["polyline",{points:"9 5 12 2 15 5",key:"5v383o"}],["polyline",{points:"15 19 12 22 9 19",key:"g7qi8m"}],["polyline",{points:"19 9 22 12 19 15",key:"tpp73q"}],["line",{x1:"2",x2:"22",y1:"12",y2:"12",key:"1dnqot"}],["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jk=f("Navigation",[["polygon",{points:"3 11 22 2 13 21 11 13 3 11",key:"1ltx0t"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fk=f("Network",[["rect",{x:"16",y:"16",width:"6",height:"6",rx:"1",key:"4q2zg0"}],["rect",{x:"2",y:"16",width:"6",height:"6",rx:"1",key:"8cvhb9"}],["rect",{x:"9",y:"2",width:"6",height:"6",rx:"1",key:"1egb70"}],["path",{d:"M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3",key:"1jsf9p"}],["path",{d:"M12 12V8",key:"2874zd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nk=f("Newspaper",[["path",{d:"M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2",key:"7pis2x"}],["path",{d:"M18 14h-8",key:"sponae"}],["path",{d:"M15 18h-5",key:"95g1m2"}],["path",{d:"M10 6h8v4h-8V6Z",key:"smlsk5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _k=f("PackageCheck",[["path",{d:"m16 16 2 2 4-4",key:"gfu2re"}],["path",{d:"M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14",key:"e7tb2h"}],["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["polyline",{points:"3.29 7 12 12 20.71 7",key:"ousv84"}],["line",{x1:"12",x2:"12",y1:"22",y2:"12",key:"a4e8g8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bk=f("PackageMinus",[["path",{d:"M16 16h6",key:"100bgy"}],["path",{d:"M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14",key:"e7tb2h"}],["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["polyline",{points:"3.29 7 12 12 20.71 7",key:"ousv84"}],["line",{x1:"12",x2:"12",y1:"22",y2:"12",key:"a4e8g8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zk=f("PackageOpen",[["path",{d:"M12 22v-9",key:"x3hkom"}],["path",{d:"M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z",key:"2ntwy6"}],["path",{d:"M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13",key:"1pmm1c"}],["path",{d:"M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z",key:"12ttoo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hk=f("PackagePlus",[["path",{d:"M16 16h6",key:"100bgy"}],["path",{d:"M19 13v6",key:"85cyf1"}],["path",{d:"M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14",key:"e7tb2h"}],["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["polyline",{points:"3.29 7 12 12 20.71 7",key:"ousv84"}],["line",{x1:"12",x2:"12",y1:"22",y2:"12",key:"a4e8g8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qk=f("Package",[["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["path",{d:"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",key:"hh9hay"}],["path",{d:"m3.3 7 8.7 5 8.7-5",key:"g66t2b"}],["path",{d:"M12 22V12",key:"d0xqtd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Uk=f("Paintbrush",[["path",{d:"m14.622 17.897-10.68-2.913",key:"vj2p1u"}],["path",{d:"M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z",key:"18tc5c"}],["path",{d:"M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15",key:"ytzfxy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $k=f("Palette",[["circle",{cx:"13.5",cy:"6.5",r:".5",fill:"currentColor",key:"1okk4w"}],["circle",{cx:"17.5",cy:"10.5",r:".5",fill:"currentColor",key:"f64h9f"}],["circle",{cx:"8.5",cy:"7.5",r:".5",fill:"currentColor",key:"fotxhn"}],["circle",{cx:"6.5",cy:"12.5",r:".5",fill:"currentColor",key:"qy21gx"}],["path",{d:"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z",key:"12rzf8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wk=f("PanelLeftClose",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Kk=f("PanelLeft",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gk=f("PanelTop",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zk=f("PanelsTopLeft",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}],["path",{d:"M9 21V9",key:"1oto5p"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xk=f("Paperclip",[["path",{d:"m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",key:"1u3ebp"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yk=f("PartyPopper",[["path",{d:"M5.8 11.3 2 22l10.7-3.79",key:"gwxi1d"}],["path",{d:"M4 3h.01",key:"1vcuye"}],["path",{d:"M22 8h.01",key:"1mrtc2"}],["path",{d:"M15 2h.01",key:"1cjtqr"}],["path",{d:"M22 20h.01",key:"1mrys2"}],["path",{d:"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10",key:"hbicv8"}],["path",{d:"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17",key:"1i94pl"}],["path",{d:"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7",key:"1cofks"}],["path",{d:"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z",key:"4kbmks"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qk=f("Pause",[["rect",{x:"14",y:"4",width:"4",height:"16",rx:"1",key:"zuxfzm"}],["rect",{x:"6",y:"4",width:"4",height:"16",rx:"1",key:"1okwgv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jk=f("PenLine",[["path",{d:"M12 20h9",key:"t2du7b"}],["path",{d:"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z",key:"1ykcvy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ex=f("PenTool",[["path",{d:"M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z",key:"nt11vn"}],["path",{d:"m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18",key:"15qc1e"}],["path",{d:"m2.3 2.3 7.286 7.286",key:"1wuzzi"}],["circle",{cx:"11",cy:"11",r:"2",key:"xmgehs"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tx=f("Pen",[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const nx=f("Pencil",[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rx=f("Percent",[["line",{x1:"19",x2:"5",y1:"5",y2:"19",key:"1x9vlm"}],["circle",{cx:"6.5",cy:"6.5",r:"2.5",key:"4mh3h7"}],["circle",{cx:"17.5",cy:"17.5",r:"2.5",key:"1mdrzq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ox=f("PhoneCall",[["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}],["path",{d:"M14.05 2a9 9 0 0 1 8 7.94",key:"vmijpz"}],["path",{d:"M14.05 6A5 5 0 0 1 18 10",key:"13nbpp"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const sx=f("PhoneIncoming",[["polyline",{points:"16 2 16 8 22 8",key:"1ygljm"}],["line",{x1:"22",x2:"16",y1:"2",y2:"8",key:"1xzwqn"}],["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ix=f("PhoneMissed",[["line",{x1:"22",x2:"16",y1:"2",y2:"8",key:"1xzwqn"}],["line",{x1:"16",x2:"22",y1:"2",y2:"8",key:"13zxdn"}],["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ax=f("PhoneOff",[["path",{d:"M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91",key:"z86iuo"}],["line",{x1:"22",x2:"2",y1:"2",y2:"22",key:"11kh81"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const cx=f("PhoneOutgoing",[["polyline",{points:"22 8 22 2 16 2",key:"1g204g"}],["line",{x1:"16",x2:"22",y1:"8",y2:"2",key:"1ggias"}],["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lx=f("Phone",[["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ux=f("PieChart",[["path",{d:"M21.21 15.89A10 10 0 1 1 8 2.83",key:"k2fpak"}],["path",{d:"M22 12A10 10 0 0 0 12 2v10z",key:"1rfc4y"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("PiggyBank",[["path",{d:"M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z",key:"1ivx2i"}],["path",{d:"M2 9v1c0 1.1.9 2 2 2h1",key:"nm575m"}],["path",{d:"M16 11h.01",key:"xkw8gn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dx=f("Pill",[["path",{d:"m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z",key:"wa1lgi"}],["path",{d:"m8.5 8.5 7 7",key:"rvfmvr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hx=f("PinOff",[["line",{x1:"2",x2:"22",y1:"2",y2:"22",key:"a6p6uj"}],["line",{x1:"12",x2:"12",y1:"17",y2:"22",key:"1jrz49"}],["path",{d:"M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12",key:"13x2n8"}],["path",{d:"M15 9.34V6h1a2 2 0 0 0 0-4H7.89",key:"reo3ki"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fx=f("Pin",[["line",{x1:"12",x2:"12",y1:"17",y2:"22",key:"1jrz49"}],["path",{d:"M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z",key:"13yl11"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Plane",[["path",{d:"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",key:"1v9wt8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const px=f("Play",[["polygon",{points:"6 3 20 12 6 21 6 3",key:"1oa8hb"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yx=f("Plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mx=f("PowerOff",[["path",{d:"M18.36 6.64A9 9 0 0 1 20.77 15",key:"dxknvb"}],["path",{d:"M6.16 6.16a9 9 0 1 0 12.68 12.68",key:"1x7qb5"}],["path",{d:"M12 2v4",key:"3427ic"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gx=f("Power",[["path",{d:"M12 2v10",key:"mnfbl"}],["path",{d:"M18.4 6.6a9 9 0 1 1-12.77.04",key:"obofu9"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vx=f("Printer",[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kx=f("Puzzle",[["path",{d:"M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z",key:"i0oyt7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xx=f("QrCode",[["rect",{width:"5",height:"5",x:"3",y:"3",rx:"1",key:"1tu5fj"}],["rect",{width:"5",height:"5",x:"16",y:"3",rx:"1",key:"1v8r4q"}],["rect",{width:"5",height:"5",x:"3",y:"16",rx:"1",key:"1x03jg"}],["path",{d:"M21 16h-3a2 2 0 0 0-2 2v3",key:"177gqh"}],["path",{d:"M21 21v.01",key:"ents32"}],["path",{d:"M12 7v3a2 2 0 0 1-2 2H7",key:"8crl2c"}],["path",{d:"M3 12h.01",key:"nlz23k"}],["path",{d:"M12 3h.01",key:"n36tog"}],["path",{d:"M12 16v.01",key:"133mhm"}],["path",{d:"M16 12h1",key:"1slzba"}],["path",{d:"M21 12v.01",key:"1lwtk9"}],["path",{d:"M12 21v-1",key:"1880an"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mx=f("Radio",[["path",{d:"M4.9 19.1C1 15.2 1 8.8 4.9 4.9",key:"1vaf9d"}],["path",{d:"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5",key:"u1ii0m"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}],["path",{d:"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5",key:"1j5fej"}],["path",{d:"M19.1 4.9C23 8.8 23 15.1 19.1 19",key:"10b0cb"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wx=f("Receipt",[["path",{d:"M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z",key:"q3az6g"}],["path",{d:"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",key:"1h4pet"}],["path",{d:"M12 17.5v-11",key:"1jc1ny"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bx=f("RefreshCcw",[["path",{d:"M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"14sxne"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16",key:"1hlbsb"}],["path",{d:"M16 16h5v5",key:"ccwih5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Cx=f("RefreshCw",[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sx=f("Repeat",[["path",{d:"m17 2 4 4-4 4",key:"nntrym"}],["path",{d:"M3 11v-1a4 4 0 0 1 4-4h14",key:"84bu3i"}],["path",{d:"m7 22-4-4 4-4",key:"1wqhfi"}],["path",{d:"M21 13v1a4 4 0 0 1-4 4H3",key:"1rx37r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Px=f("Rocket",[["path",{d:"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",key:"m3kijz"}],["path",{d:"m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",key:"1fmvmk"}],["path",{d:"M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",key:"1f8sc4"}],["path",{d:"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",key:"qeys4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ax=f("RotateCcw",[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("RotateCw",[["path",{d:"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8",key:"1p45f6"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tx=f("Rows2",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 12h18",key:"1i2n21"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rx=f("Ruler",[["path",{d:"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z",key:"icamh8"}],["path",{d:"m14.5 12.5 2-2",key:"inckbg"}],["path",{d:"m11.5 9.5 2-2",key:"fmmyf7"}],["path",{d:"m8.5 6.5 2-2",key:"vc6u1g"}],["path",{d:"m17.5 15.5 2-2",key:"wo5hmg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ex=f("Save",[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dx=f("Scale",[["path",{d:"m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",key:"7g6ntu"}],["path",{d:"m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",key:"ijws7r"}],["path",{d:"M7 21h10",key:"1b0cd5"}],["path",{d:"M12 3v18",key:"108xh3"}],["path",{d:"M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2",key:"3gwbw2"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lx=f("ScanBarcode",[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["path",{d:"M8 7v10",key:"23sfjj"}],["path",{d:"M12 7v10",key:"jspqdw"}],["path",{d:"M17 7v10",key:"578dap"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vx=f("ScanLine",[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["path",{d:"M7 12h10",key:"b7w52i"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ox=f("Scan",[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ix=f("Scissors",[["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M8.12 8.12 12 12",key:"1alkpv"}],["path",{d:"M20 4 8.12 15.88",key:"xgtan2"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}],["path",{d:"M14.8 14.8 20 20",key:"ptml3r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jx=f("ScrollText",[["path",{d:"M15 12h-5",key:"r7krc0"}],["path",{d:"M15 8h-5",key:"1khuty"}],["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",key:"1ph1d7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fx=f("Scroll",[["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",key:"1ph1d7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nx=f("Search",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["path",{d:"m21 21-4.3-4.3",key:"1qie3q"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _x=f("Send",[["path",{d:"m22 2-7 20-4-9-9-4Z",key:"1q3vgg"}],["path",{d:"M22 2 11 13",key:"nzbqef"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bx=f("SeparatorHorizontal",[["line",{x1:"3",x2:"21",y1:"12",y2:"12",key:"10d38w"}],["polyline",{points:"8 8 12 4 16 8",key:"zo8t4w"}],["polyline",{points:"16 16 12 20 8 16",key:"1oyrid"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zx=f("Server",[["rect",{width:"20",height:"8",x:"2",y:"2",rx:"2",ry:"2",key:"ngkwjq"}],["rect",{width:"20",height:"8",x:"2",y:"14",rx:"2",ry:"2",key:"iecqi9"}],["line",{x1:"6",x2:"6.01",y1:"6",y2:"6",key:"16zg32"}],["line",{x1:"6",x2:"6.01",y1:"18",y2:"18",key:"nzw8ys"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hx=f("Settings2",[["path",{d:"M20 7h-9",key:"3s1dr2"}],["path",{d:"M14 17H5",key:"gfn3mx"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}],["circle",{cx:"7",cy:"7",r:"3",key:"dfmy0x"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qx=f("Settings",[["path",{d:"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",key:"1qme2f"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ux=f("Share2",[["circle",{cx:"18",cy:"5",r:"3",key:"gq8acd"}],["circle",{cx:"6",cy:"12",r:"3",key:"w7nqdw"}],["circle",{cx:"18",cy:"19",r:"3",key:"1xt0gg"}],["line",{x1:"8.59",x2:"15.42",y1:"13.51",y2:"17.49",key:"47mynk"}],["line",{x1:"15.41",x2:"8.59",y1:"6.51",y2:"10.49",key:"1n3mei"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $x=f("Sheet",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",ry:"2",key:"1m3agn"}],["line",{x1:"3",x2:"21",y1:"9",y2:"9",key:"1vqk6q"}],["line",{x1:"3",x2:"21",y1:"15",y2:"15",key:"o2sbyz"}],["line",{x1:"9",x2:"9",y1:"9",y2:"21",key:"1ib60c"}],["line",{x1:"15",x2:"15",y1:"9",y2:"21",key:"1n26ft"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wx=f("ShieldAlert",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Kx=f("ShieldCheck",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gx=f("Shield",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zx=f("Ship",[["path",{d:"M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",key:"iegodh"}],["path",{d:"M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76",key:"fp8vka"}],["path",{d:"M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6",key:"qpkstq"}],["path",{d:"M12 10v4",key:"1kjpxc"}],["path",{d:"M12 2v3",key:"qbqxhf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xx=f("Shirt",[["path",{d:"M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z",key:"1wgbhj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yx=f("ShoppingBag",[["path",{d:"M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z",key:"hou9p0"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M16 10a4 4 0 0 1-8 0",key:"1ltviw"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qx=f("ShoppingCart",[["circle",{cx:"8",cy:"21",r:"1",key:"jimo8o"}],["circle",{cx:"19",cy:"21",r:"1",key:"13723u"}],["path",{d:"M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12",key:"9zh506"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jx=f("SkipForward",[["polygon",{points:"5 4 15 12 5 20 5 4",key:"16p6eg"}],["line",{x1:"19",x2:"19",y1:"5",y2:"19",key:"futhcm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const e4=f("Smartphone",[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const t4=f("Smile",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M8 14s1.5 2 4 2 4-2 4-2",key:"1y1vjs"}],["line",{x1:"9",x2:"9.01",y1:"9",y2:"9",key:"yxxnd0"}],["line",{x1:"15",x2:"15.01",y1:"9",y2:"9",key:"1p4y9e"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const n4=f("Snowflake",[["line",{x1:"2",x2:"22",y1:"12",y2:"12",key:"1dnqot"}],["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}],["path",{d:"m20 16-4-4 4-4",key:"rquw4f"}],["path",{d:"m4 8 4 4-4 4",key:"12s3z9"}],["path",{d:"m16 4-4 4-4-4",key:"1tumq1"}],["path",{d:"m8 20 4-4 4 4",key:"9p200w"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const r4=f("Sparkles",[["path",{d:"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",key:"4pj2yx"}],["path",{d:"M20 3v4",key:"1olli1"}],["path",{d:"M22 5h-4",key:"1gvqau"}],["path",{d:"M4 17v2",key:"vumght"}],["path",{d:"M5 18H3",key:"zchphs"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Split",[["path",{d:"M16 3h5v5",key:"1806ms"}],["path",{d:"M8 3H3v5",key:"15dfkv"}],["path",{d:"M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3",key:"1qrqzj"}],["path",{d:"m15 9 6-6",key:"ko1vev"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const o4=f("SquareCheckBig",[["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}],["path",{d:"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",key:"1jnkn4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const s4=f("SquarePen",[["path",{d:"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",key:"1m0v6g"}],["path",{d:"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",key:"ohrbg2"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i4=f("Square",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const a4=f("Stamp",[["path",{d:"M5 22h14",key:"ehvnwv"}],["path",{d:"M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z",key:"1sy9ra"}],["path",{d:"M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.66 0-3 1-3 3s1 2 1 3.5V13",key:"cnxgux"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c4=f("StarOff",[["path",{d:"M8.34 8.34 2 9.27l5 4.87L5.82 21 12 17.77 18.18 21l-.59-3.43",key:"16m0ql"}],["path",{d:"M18.42 12.76 22 9.27l-6.91-1L12 2l-1.44 2.91",key:"1vt8nq"}],["line",{x1:"2",x2:"22",y1:"2",y2:"22",key:"a6p6uj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const l4=f("Star",[["polygon",{points:"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",key:"8f66p6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u4=f("Stethoscope",[["path",{d:"M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3",key:"10lez9"}],["path",{d:"M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4",key:"ce9bce"}],["circle",{cx:"20",cy:"10",r:"2",key:"ts1r5v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d4=f("StickyNote",[["path",{d:"M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z",key:"qazsjp"}],["path",{d:"M15 3v4a2 2 0 0 0 2 2h4",key:"40519r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h4=f("Store",[["path",{d:"m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7",key:"ztvudi"}],["path",{d:"M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8",key:"1b2hhj"}],["path",{d:"M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4",key:"2ebpfo"}],["path",{d:"M2 7h20",key:"1fcdvo"}],["path",{d:"M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7",key:"6c3vgh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f4=f("Sun",[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M12 2v2",key:"tus03m"}],["path",{d:"M12 20v2",key:"1lh1kg"}],["path",{d:"m4.93 4.93 1.41 1.41",key:"149t6j"}],["path",{d:"m17.66 17.66 1.41 1.41",key:"ptbguv"}],["path",{d:"M2 12h2",key:"1t8f8n"}],["path",{d:"M20 12h2",key:"1q8mjw"}],["path",{d:"m6.34 17.66-1.41 1.41",key:"1m8zz5"}],["path",{d:"m19.07 4.93-1.41 1.41",key:"1shlcs"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p4=f("Table2",[["path",{d:"M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18",key:"gugj83"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y4=f("Table",[["path",{d:"M12 3v18",key:"108xh3"}],["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}],["path",{d:"M3 15h18",key:"5xshup"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m4=f("Tablet",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g4=f("Tag",[["path",{d:"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",key:"vktsd0"}],["circle",{cx:"7.5",cy:"7.5",r:".5",fill:"currentColor",key:"kqv944"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Tags",[["path",{d:"m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19",key:"1cbfv1"}],["path",{d:"M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z",key:"135mg7"}],["circle",{cx:"6.5",cy:"9.5",r:".5",fill:"currentColor",key:"5pm5xn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v4=f("Target",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"6",key:"1vlfrh"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Terminal",[["polyline",{points:"4 17 10 11 4 5",key:"akl6gq"}],["line",{x1:"12",x2:"20",y1:"19",y2:"19",key:"q2wloq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k4=f("TestTubeDiagonal",[["path",{d:"M21 7 6.82 21.18a2.83 2.83 0 0 1-3.99-.01a2.83 2.83 0 0 1 0-4L17 3",key:"1ub6xw"}],["path",{d:"m16 2 6 6",key:"1gw87d"}],["path",{d:"M12 16H4",key:"1cjfip"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x4=f("TestTube",[["path",{d:"M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5c-1.4 0-2.5-1.1-2.5-2.5V2",key:"125lnx"}],["path",{d:"M8.5 2h7",key:"csnxdl"}],["path",{d:"M14.5 16h-5",key:"1ox875"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M4=f("ThumbsDown",[["path",{d:"M17 14V2",key:"8ymqnk"}],["path",{d:"M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",key:"m61m77"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const w4=f("ThumbsUp",[["path",{d:"M7 10v12",key:"1qc93n"}],["path",{d:"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",key:"emmmcr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b4=f("Ticket",[["path",{d:"M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",key:"qn84l0"}],["path",{d:"M13 5v2",key:"dyzc3o"}],["path",{d:"M13 17v2",key:"1ont0d"}],["path",{d:"M13 11v2",key:"1wjjxi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C4=f("Timer",[["line",{x1:"10",x2:"14",y1:"2",y2:"2",key:"14vaq8"}],["line",{x1:"12",x2:"15",y1:"14",y2:"11",key:"17fdiu"}],["circle",{cx:"12",cy:"14",r:"8",key:"1e1u0o"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const S4=f("ToggleRight",[["rect",{width:"20",height:"12",x:"2",y:"6",rx:"6",ry:"6",key:"f2vt7d"}],["circle",{cx:"16",cy:"12",r:"2",key:"4ma0v8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("TramFront",[["rect",{width:"16",height:"16",x:"4",y:"3",rx:"2",key:"1wxw4b"}],["path",{d:"M4 11h16",key:"mpoxn0"}],["path",{d:"M12 3v8",key:"1h2ygw"}],["path",{d:"m8 19-2 3",key:"13i0xs"}],["path",{d:"m18 22-2-3",key:"1p0ohu"}],["path",{d:"M8 15h.01",key:"a7atzg"}],["path",{d:"M16 15h.01",key:"rnfrdf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const P4=f("Trash2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const A4=f("TreePine",[["path",{d:"m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z",key:"cpyugq"}],["path",{d:"M12 22v-3",key:"kmzjlo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const T4=f("TrendingDown",[["polyline",{points:"22 17 13.5 8.5 8.5 13.5 2 7",key:"1r2t7k"}],["polyline",{points:"16 17 22 17 22 11",key:"11uiuu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const R4=f("TrendingUp",[["polyline",{points:"22 7 13.5 15.5 8.5 10.5 2 17",key:"126l90"}],["polyline",{points:"16 7 22 7 22 13",key:"kwv8wd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const E4=f("TriangleAlert",[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("Trophy",[["path",{d:"M6 9H4.5a2.5 2.5 0 0 1 0-5H6",key:"17hqa7"}],["path",{d:"M18 9h1.5a2.5 2.5 0 0 0 0-5H18",key:"lmptdp"}],["path",{d:"M4 22h16",key:"57wxv0"}],["path",{d:"M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22",key:"1nw9bq"}],["path",{d:"M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22",key:"1np0yb"}],["path",{d:"M18 2H6v7a6 6 0 0 0 12 0V2Z",key:"u46fv3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const D4=f("Truck",[["path",{d:"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2",key:"wrbu53"}],["path",{d:"M15 18H9",key:"1lyqi6"}],["path",{d:"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14",key:"lysw3i"}],["circle",{cx:"17",cy:"18",r:"2",key:"332jqn"}],["circle",{cx:"7",cy:"18",r:"2",key:"19iecd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const L4=f("Type",[["polyline",{points:"4 7 4 4 20 4 20 7",key:"1nosan"}],["line",{x1:"9",x2:"15",y1:"20",y2:"20",key:"swin9y"}],["line",{x1:"12",x2:"12",y1:"4",y2:"20",key:"1tx1rr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const V4=f("Undo2",[["path",{d:"M9 14 4 9l5-5",key:"102s5s"}],["path",{d:"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11",key:"f3b9sd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const O4=f("Unlink",[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I4=f("Upload",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"17 8 12 3 7 8",key:"t8dd8p"}],["line",{x1:"12",x2:"12",y1:"3",y2:"15",key:"widbto"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j4=f("UserCheck",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["polyline",{points:"16 11 18 13 22 9",key:"1pwet4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const F4=f("UserCog",[["circle",{cx:"18",cy:"15",r:"3",key:"gjjjvw"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M10 15H6a4 4 0 0 0-4 4v2",key:"1nfge6"}],["path",{d:"m21.7 16.4-.9-.3",key:"12j9ji"}],["path",{d:"m15.2 13.9-.9-.3",key:"1fdjdi"}],["path",{d:"m16.6 18.7.3-.9",key:"heedtr"}],["path",{d:"m19.1 12.2.3-.9",key:"1af3ki"}],["path",{d:"m19.6 18.7-.4-1",key:"1x9vze"}],["path",{d:"m16.8 12.3-.4-1",key:"vqeiwj"}],["path",{d:"m14.3 16.6 1-.4",key:"1qlj63"}],["path",{d:"m20.7 13.8 1-.4",key:"1v5t8k"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const N4=f("UserMinus",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _4=f("UserPlus",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"19",x2:"19",y1:"8",y2:"14",key:"1bvyxn"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("UserX",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"17",x2:"22",y1:"8",y2:"13",key:"3nzzx3"}],["line",{x1:"22",x2:"17",y1:"8",y2:"13",key:"1swrse"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B4=f("User",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */f("UsersRound",[["path",{d:"M18 21a8 8 0 0 0-16 0",key:"3ypg7q"}],["circle",{cx:"10",cy:"8",r:"5",key:"o932ke"}],["path",{d:"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3",key:"10s06x"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const z4=f("Users",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["path",{d:"M16 3.13a4 4 0 0 1 0 7.75",key:"1da9ce"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const H4=f("Variable",[["path",{d:"M8 21s-4-3-4-9 4-9 4-9",key:"uto9ud"}],["path",{d:"M16 3s4 3 4 9-4 9-4 9",key:"4w2vsq"}],["line",{x1:"15",x2:"9",y1:"9",y2:"15",key:"f7djnv"}],["line",{x1:"9",x2:"15",y1:"9",y2:"15",key:"1shsy8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const q4=f("Video",[["path",{d:"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5",key:"ftymec"}],["rect",{x:"2",y:"6",width:"14",height:"12",rx:"2",key:"158x01"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const U4=f("Voicemail",[["circle",{cx:"6",cy:"12",r:"4",key:"1ehtga"}],["circle",{cx:"18",cy:"12",r:"4",key:"4vafl8"}],["line",{x1:"6",x2:"18",y1:"16",y2:"16",key:"pmt8us"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $4=f("Volume2",[["polygon",{points:"11 5 6 9 2 9 2 15 6 15 11 19 11 5",key:"16drj5"}],["path",{d:"M15.54 8.46a5 5 0 0 1 0 7.07",key:"ltjumu"}],["path",{d:"M19.07 4.93a10 10 0 0 1 0 14.14",key:"1kegas"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const W4=f("Wallet",[["path",{d:"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1",key:"18etb6"}],["path",{d:"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",key:"xoc0q4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const K4=f("WandSparkles",[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const G4=f("Warehouse",[["path",{d:"M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z",key:"gksnxg"}],["path",{d:"M6 18h12",key:"9pbo8z"}],["path",{d:"M6 14h12",key:"4cwo0f"}],["rect",{width:"12",height:"12",x:"6",y:"10",key:"apd30q"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Z4=f("Webhook",[["path",{d:"M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2",key:"q3hayz"}],["path",{d:"m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06",key:"1go1hn"}],["path",{d:"m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8",key:"qlwsc0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const X4=f("Weight",[["circle",{cx:"12",cy:"5",r:"3",key:"rqqgnr"}],["path",{d:"M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z",key:"56o5sh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Y4=f("WifiOff",[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Q4=f("Wifi",[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const J4=f("Wrench",[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",key:"cbrjhi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const e5=f("X",[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const t5=f("Zap",[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",key:"1xq2db"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const n5=f("ZoomIn",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["line",{x1:"21",x2:"16.65",y1:"21",y2:"16.65",key:"13gj7c"}],["line",{x1:"11",x2:"11",y1:"8",y2:"14",key:"1vmskp"}],["line",{x1:"8",x2:"14",y1:"11",y2:"11",key:"durymu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const r5=f("ZoomOut",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["line",{x1:"21",x2:"16.65",y1:"21",y2:"16.65",key:"13gj7c"}],["line",{x1:"8",x2:"14",y1:"11",y2:"11",key:"durymu"}]]),Or=h.createContext({});function Ir(e){const t=h.useRef(null);return t.current===null&&(t.current=e()),t.current}const Pn=h.createContext(null),jr=h.createContext({transformPagePoint:e=>e,isStatic:!1,reducedMotion:"never"});class Ou extends h.Component{getSnapshotBeforeUpdate(t){const n=this.props.childRef.current;if(n&&t.isPresent&&!this.props.isPresent){const r=this.props.sizeRef.current;r.height=n.offsetHeight||0,r.width=n.offsetWidth||0,r.top=n.offsetTop,r.left=n.offsetLeft}return null}componentDidUpdate(){}render(){return this.props.children}}function Iu({children:e,isPresent:t}){const n=h.useId(),r=h.useRef(null),o=h.useRef({width:0,height:0,top:0,left:0}),{nonce:s}=h.useContext(jr);return h.useInsertionEffect(()=>{const{width:i,height:a,top:c,left:l}=o.current;if(t||!r.current||!i||!a)return;r.current.dataset.motionPopId=n;const u=document.createElement("style");return s&&(u.nonce=s),document.head.appendChild(u),u.sheet&&u.sheet.insertRule(`
          [data-motion-pop-id="${n}"] {
            position: absolute !important;
            width: ${i}px !important;
            height: ${a}px !important;
            top: ${c}px !important;
            left: ${l}px !important;
          }
        `),()=>{document.head.removeChild(u)}},[t]),b.jsx(Ou,{isPresent:t,childRef:r,sizeRef:o,children:h.cloneElement(e,{ref:r})})}const ju=({children:e,initial:t,isPresent:n,onExitComplete:r,custom:o,presenceAffectsLayout:s,mode:i})=>{const a=Ir(Fu),c=h.useId(),l=h.useCallback(d=>{a.set(d,!0);for(const p of a.values())if(!p)return;r&&r()},[a,r]),u=h.useMemo(()=>({id:c,initial:t,isPresent:n,custom:o,onExitComplete:l,register:d=>(a.set(d,!1),()=>a.delete(d))}),s?[Math.random(),l]:[n,l]);return h.useMemo(()=>{a.forEach((d,p)=>a.set(p,!1))},[n]),h.useEffect(()=>{!n&&!a.size&&r&&r()},[n]),i==="popLayout"&&(e=b.jsx(Iu,{isPresent:n,children:e})),b.jsx(Pn.Provider,{value:u,children:e})};function Fu(){return new Map}function Ii(e=!0){const t=h.useContext(Pn);if(t===null)return[!0,null];const{isPresent:n,onExitComplete:r,register:o}=t,s=h.useId();h.useEffect(()=>{e&&o(s)},[e]);const i=h.useCallback(()=>e&&r&&r(s),[s,r,e]);return!n&&r?[!1,i]:[!0]}const Gt=e=>e.key||"";function qo(e){const t=[];return h.Children.forEach(e,n=>{h.isValidElement(n)&&t.push(n)}),t}const Fr=typeof window<"u",ji=Fr?h.useLayoutEffect:h.useEffect,o5=({children:e,custom:t,initial:n=!0,onExitComplete:r,presenceAffectsLayout:o=!0,mode:s="sync",propagate:i=!1})=>{const[a,c]=Ii(i),l=h.useMemo(()=>qo(e),[e]),u=i&&!a?[]:l.map(Gt),d=h.useRef(!0),p=h.useRef(l),y=Ir(()=>new Map),[g,m]=h.useState(l),[v,k]=h.useState(l);ji(()=>{d.current=!1,p.current=l;for(let C=0;C<v.length;C++){const w=Gt(v[C]);u.includes(w)?y.delete(w):y.get(w)!==!0&&y.set(w,!1)}},[v,u.length,u.join("-")]);const x=[];if(l!==g){let C=[...l];for(let w=0;w<v.length;w++){const S=v[w],P=Gt(S);u.includes(P)||(C.splice(w,0,S),x.push(S))}s==="wait"&&x.length&&(C=x),k(qo(C)),m(l);return}const{forceRender:M}=h.useContext(Or);return b.jsx(b.Fragment,{children:v.map(C=>{const w=Gt(C),S=i&&!a?!1:l===v||u.includes(w),P=()=>{if(y.has(w))y.set(w,!0);else return;let A=!0;y.forEach(D=>{D||(A=!1)}),A&&(M==null||M(),k(p.current),i&&(c==null||c()),r&&r())};return b.jsx(ju,{isPresent:S,initial:!d.current||n?void 0:!1,custom:S?void 0:t,presenceAffectsLayout:o,mode:s,onExitComplete:S?void 0:P,children:C},w)})})},ee=e=>e;let Fi=ee;function Nr(e){let t;return()=>(t===void 0&&(t=e()),t)}const st=(e,t,n)=>{const r=t-e;return r===0?1:(n-e)/r},ke=e=>e*1e3,xe=e=>e/1e3,Nu={useManualTiming:!1};function _u(e){let t=new Set,n=new Set,r=!1,o=!1;const s=new WeakSet;let i={delta:0,timestamp:0,isProcessing:!1};function a(l){s.has(l)&&(c.schedule(l),e()),l(i)}const c={schedule:(l,u=!1,d=!1)=>{const y=d&&r?t:n;return u&&s.add(l),y.has(l)||y.add(l),l},cancel:l=>{n.delete(l),s.delete(l)},process:l=>{if(i=l,r){o=!0;return}r=!0,[t,n]=[n,t],t.forEach(a),t.clear(),r=!1,o&&(o=!1,c.process(l))}};return c}const Zt=["read","resolveKeyframes","update","preRender","render","postRender"],Bu=40;function Ni(e,t){let n=!1,r=!0;const o={delta:0,timestamp:0,isProcessing:!1},s=()=>n=!0,i=Zt.reduce((k,x)=>(k[x]=_u(s),k),{}),{read:a,resolveKeyframes:c,update:l,preRender:u,render:d,postRender:p}=i,y=()=>{const k=performance.now();n=!1,o.delta=r?1e3/60:Math.max(Math.min(k-o.timestamp,Bu),1),o.timestamp=k,o.isProcessing=!0,a.process(o),c.process(o),l.process(o),u.process(o),d.process(o),p.process(o),o.isProcessing=!1,n&&t&&(r=!1,e(y))},g=()=>{n=!0,r=!0,o.isProcessing||e(y)};return{schedule:Zt.reduce((k,x)=>{const M=i[x];return k[x]=(C,w=!1,S=!1)=>(n||g(),M.schedule(C,w,S)),k},{}),cancel:k=>{for(let x=0;x<Zt.length;x++)i[Zt[x]].cancel(k)},state:o,steps:i}}const{schedule:z,cancel:Re,state:K,steps:zn}=Ni(typeof requestAnimationFrame<"u"?requestAnimationFrame:ee,!0),_i=h.createContext({strict:!1}),Uo={animation:["animate","variants","whileHover","whileTap","exit","whileInView","whileFocus","whileDrag"],exit:["exit"],drag:["drag","dragControls"],focus:["whileFocus"],hover:["whileHover","onHoverStart","onHoverEnd"],tap:["whileTap","onTap","onTapStart","onTapCancel"],pan:["onPan","onPanStart","onPanSessionStart","onPanEnd"],inView:["whileInView","onViewportEnter","onViewportLeave"],layout:["layout","layoutId"]},it={};for(const e in Uo)it[e]={isEnabled:t=>Uo[e].some(n=>!!t[n])};function zu(e){for(const t in e)it[t]={...it[t],...e[t]}}const Hu=new Set(["animate","exit","variants","initial","style","values","variants","transition","transformTemplate","custom","inherit","onBeforeLayoutMeasure","onAnimationStart","onAnimationComplete","onUpdate","onDragStart","onDrag","onDragEnd","onMeasureDragConstraints","onDirectionLock","onDragTransitionEnd","_dragX","_dragY","onHoverStart","onHoverEnd","onViewportEnter","onViewportLeave","globalTapTarget","ignoreStrict","viewport"]);function un(e){return e.startsWith("while")||e.startsWith("drag")&&e!=="draggable"||e.startsWith("layout")||e.startsWith("onTap")||e.startsWith("onPan")||e.startsWith("onLayout")||Hu.has(e)}let Bi=e=>!un(e);function qu(e){e&&(Bi=t=>t.startsWith("on")?!un(t):e(t))}try{qu(require("@emotion/is-prop-valid").default)}catch{}function Uu(e,t,n){const r={};for(const o in e)o==="values"&&typeof e.values=="object"||(Bi(o)||n===!0&&un(o)||!t&&!un(o)||e.draggable&&o.startsWith("onDrag"))&&(r[o]=e[o]);return r}function $u(e){if(typeof Proxy>"u")return e;const t=new Map,n=(...r)=>e(...r);return new Proxy(n,{get:(r,o)=>o==="create"?e:(t.has(o)||t.set(o,e(o)),t.get(o))})}const An=h.createContext({});function Tt(e){return typeof e=="string"||Array.isArray(e)}function Tn(e){return e!==null&&typeof e=="object"&&typeof e.start=="function"}const _r=["animate","whileInView","whileFocus","whileHover","whileTap","whileDrag","exit"],Br=["initial",..._r];function Rn(e){return Tn(e.animate)||Br.some(t=>Tt(e[t]))}function zi(e){return!!(Rn(e)||e.variants)}function Wu(e,t){if(Rn(e)){const{initial:n,animate:r}=e;return{initial:n===!1||Tt(n)?n:void 0,animate:Tt(r)?r:void 0}}return e.inherit!==!1?t:{}}function Ku(e){const{initial:t,animate:n}=Wu(e,h.useContext(An));return h.useMemo(()=>({initial:t,animate:n}),[$o(t),$o(n)])}function $o(e){return Array.isArray(e)?e.join(" "):e}const Gu=Symbol.for("motionComponentSymbol");function Ye(e){return e&&typeof e=="object"&&Object.prototype.hasOwnProperty.call(e,"current")}function Zu(e,t,n){return h.useCallback(r=>{r&&e.onMount&&e.onMount(r),t&&(r?t.mount(r):t.unmount()),n&&(typeof n=="function"?n(r):Ye(n)&&(n.current=r))},[t])}const zr=e=>e.replace(/([a-z])([A-Z])/gu,"$1-$2").toLowerCase(),Xu="framerAppearId",Hi="data-"+zr(Xu),{schedule:Hr}=Ni(queueMicrotask,!1),qi=h.createContext({});function Yu(e,t,n,r,o){var s,i;const{visualElement:a}=h.useContext(An),c=h.useContext(_i),l=h.useContext(Pn),u=h.useContext(jr).reducedMotion,d=h.useRef(null);r=r||c.renderer,!d.current&&r&&(d.current=r(e,{visualState:t,parent:a,props:n,presenceContext:l,blockInitialAnimation:l?l.initial===!1:!1,reducedMotionConfig:u}));const p=d.current,y=h.useContext(qi);p&&!p.projection&&o&&(p.type==="html"||p.type==="svg")&&Qu(d.current,n,o,y);const g=h.useRef(!1);h.useInsertionEffect(()=>{p&&g.current&&p.update(n,l)});const m=n[Hi],v=h.useRef(!!m&&!(!((s=window.MotionHandoffIsComplete)===null||s===void 0)&&s.call(window,m))&&((i=window.MotionHasOptimisedAnimation)===null||i===void 0?void 0:i.call(window,m)));return ji(()=>{p&&(g.current=!0,window.MotionIsMounted=!0,p.updateFeatures(),Hr.render(p.render),v.current&&p.animationState&&p.animationState.animateChanges())}),h.useEffect(()=>{p&&(!v.current&&p.animationState&&p.animationState.animateChanges(),v.current&&(queueMicrotask(()=>{var k;(k=window.MotionHandoffMarkAsComplete)===null||k===void 0||k.call(window,m)}),v.current=!1))}),p}function Qu(e,t,n,r){const{layoutId:o,layout:s,drag:i,dragConstraints:a,layoutScroll:c,layoutRoot:l}=t;e.projection=new n(e.latestValues,t["data-framer-portal-id"]?void 0:Ui(e.parent)),e.projection.setOptions({layoutId:o,layout:s,alwaysMeasureLayout:!!i||a&&Ye(a),visualElement:e,animationType:typeof s=="string"?s:"both",initialPromotionConfig:r,layoutScroll:c,layoutRoot:l})}function Ui(e){if(e)return e.options.allowProjection!==!1?e.projection:Ui(e.parent)}function Ju({preloadedFeatures:e,createVisualElement:t,useRender:n,useVisualState:r,Component:o}){var s,i;e&&zu(e);function a(l,u){let d;const p={...h.useContext(jr),...l,layoutId:e1(l)},{isStatic:y}=p,g=Ku(l),m=r(l,y);if(!y&&Fr){t1();const v=n1(p);d=v.MeasureLayout,g.visualElement=Yu(o,m,p,t,v.ProjectionNode)}return b.jsxs(An.Provider,{value:g,children:[d&&g.visualElement?b.jsx(d,{visualElement:g.visualElement,...p}):null,n(o,l,Zu(m,g.visualElement,u),m,y,g.visualElement)]})}a.displayName=`motion.${typeof o=="string"?o:`create(${(i=(s=o.displayName)!==null&&s!==void 0?s:o.name)!==null&&i!==void 0?i:""})`}`;const c=h.forwardRef(a);return c[Gu]=o,c}function e1({layoutId:e}){const t=h.useContext(Or).id;return t&&e!==void 0?t+"-"+e:e}function t1(e,t){h.useContext(_i).strict}function n1(e){const{drag:t,layout:n}=it;if(!t&&!n)return{};const r={...t,...n};return{MeasureLayout:t!=null&&t.isEnabled(e)||n!=null&&n.isEnabled(e)?r.MeasureLayout:void 0,ProjectionNode:r.ProjectionNode}}const r1=["animate","circle","defs","desc","ellipse","g","image","line","filter","marker","mask","metadata","path","pattern","polygon","polyline","rect","stop","switch","symbol","svg","text","tspan","use","view"];function qr(e){return typeof e!="string"||e.includes("-")?!1:!!(r1.indexOf(e)>-1||/[A-Z]/u.test(e))}function Wo(e){const t=[{},{}];return e==null||e.values.forEach((n,r)=>{t[0][r]=n.get(),t[1][r]=n.getVelocity()}),t}function Ur(e,t,n,r){if(typeof t=="function"){const[o,s]=Wo(r);t=t(n!==void 0?n:e.custom,o,s)}if(typeof t=="string"&&(t=e.variants&&e.variants[t]),typeof t=="function"){const[o,s]=Wo(r);t=t(n!==void 0?n:e.custom,o,s)}return t}const dr=e=>Array.isArray(e),o1=e=>!!(e&&typeof e=="object"&&e.mix&&e.toValue),s1=e=>dr(e)?e[e.length-1]||0:e,X=e=>!!(e&&e.getVelocity);function rn(e){const t=X(e)?e.get():e;return o1(t)?t.toValue():t}function i1({scrapeMotionValuesFromProps:e,createRenderState:t,onUpdate:n},r,o,s){const i={latestValues:a1(r,o,s,e),renderState:t()};return n&&(i.onMount=a=>n({props:r,current:a,...i}),i.onUpdate=a=>n(a)),i}const $i=e=>(t,n)=>{const r=h.useContext(An),o=h.useContext(Pn),s=()=>i1(e,t,r,o);return n?s():Ir(s)};function a1(e,t,n,r){const o={},s=r(e,{});for(const p in s)o[p]=rn(s[p]);let{initial:i,animate:a}=e;const c=Rn(e),l=zi(e);t&&l&&!c&&e.inherit!==!1&&(i===void 0&&(i=t.initial),a===void 0&&(a=t.animate));let u=n?n.initial===!1:!1;u=u||i===!1;const d=u?a:i;if(d&&typeof d!="boolean"&&!Tn(d)){const p=Array.isArray(d)?d:[d];for(let y=0;y<p.length;y++){const g=Ur(e,p[y]);if(g){const{transitionEnd:m,transition:v,...k}=g;for(const x in k){let M=k[x];if(Array.isArray(M)){const C=u?M.length-1:0;M=M[C]}M!==null&&(o[x]=M)}for(const x in m)o[x]=m[x]}}}return o}const ut=["transformPerspective","x","y","z","translateX","translateY","translateZ","scale","scaleX","scaleY","rotate","rotateX","rotateY","rotateZ","skew","skewX","skewY"],$e=new Set(ut),Wi=e=>t=>typeof t=="string"&&t.startsWith(e),Ki=Wi("--"),c1=Wi("var(--"),$r=e=>c1(e)?l1.test(e.split("/*")[0].trim()):!1,l1=/var\(--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)$/iu,Gi=(e,t)=>t&&typeof e=="number"?t.transform(e):e,we=(e,t,n)=>n>t?t:n<e?e:n,dt={test:e=>typeof e=="number",parse:parseFloat,transform:e=>e},Rt={...dt,transform:e=>we(0,1,e)},Xt={...dt,default:1},Ft=e=>({test:t=>typeof t=="string"&&t.endsWith(e)&&t.split(" ").length===1,parse:parseFloat,transform:t=>`${t}${e}`}),Se=Ft("deg"),fe=Ft("%"),E=Ft("px"),u1=Ft("vh"),d1=Ft("vw"),Ko={...fe,parse:e=>fe.parse(e)/100,transform:e=>fe.transform(e*100)},h1={borderWidth:E,borderTopWidth:E,borderRightWidth:E,borderBottomWidth:E,borderLeftWidth:E,borderRadius:E,radius:E,borderTopLeftRadius:E,borderTopRightRadius:E,borderBottomRightRadius:E,borderBottomLeftRadius:E,width:E,maxWidth:E,height:E,maxHeight:E,top:E,right:E,bottom:E,left:E,padding:E,paddingTop:E,paddingRight:E,paddingBottom:E,paddingLeft:E,margin:E,marginTop:E,marginRight:E,marginBottom:E,marginLeft:E,backgroundPositionX:E,backgroundPositionY:E},f1={rotate:Se,rotateX:Se,rotateY:Se,rotateZ:Se,scale:Xt,scaleX:Xt,scaleY:Xt,scaleZ:Xt,skew:Se,skewX:Se,skewY:Se,distance:E,translateX:E,translateY:E,translateZ:E,x:E,y:E,z:E,perspective:E,transformPerspective:E,opacity:Rt,originX:Ko,originY:Ko,originZ:E},Go={...dt,transform:Math.round},Wr={...h1,...f1,zIndex:Go,size:E,fillOpacity:Rt,strokeOpacity:Rt,numOctaves:Go},p1={x:"translateX",y:"translateY",z:"translateZ",transformPerspective:"perspective"},y1=ut.length;function m1(e,t,n){let r="",o=!0;for(let s=0;s<y1;s++){const i=ut[s],a=e[i];if(a===void 0)continue;let c=!0;if(typeof a=="number"?c=a===(i.startsWith("scale")?1:0):c=parseFloat(a)===0,!c||n){const l=Gi(a,Wr[i]);if(!c){o=!1;const u=p1[i]||i;r+=`${u}(${l}) `}n&&(t[i]=l)}}return r=r.trim(),n?r=n(t,o?"":r):o&&(r="none"),r}function Kr(e,t,n){const{style:r,vars:o,transformOrigin:s}=e;let i=!1,a=!1;for(const c in t){const l=t[c];if($e.has(c)){i=!0;continue}else if(Ki(c)){o[c]=l;continue}else{const u=Gi(l,Wr[c]);c.startsWith("origin")?(a=!0,s[c]=u):r[c]=u}}if(t.transform||(i||n?r.transform=m1(t,e.transform,n):r.transform&&(r.transform="none")),a){const{originX:c="50%",originY:l="50%",originZ:u=0}=s;r.transformOrigin=`${c} ${l} ${u}`}}const g1={offset:"stroke-dashoffset",array:"stroke-dasharray"},v1={offset:"strokeDashoffset",array:"strokeDasharray"};function k1(e,t,n=1,r=0,o=!0){e.pathLength=1;const s=o?g1:v1;e[s.offset]=E.transform(-r);const i=E.transform(t),a=E.transform(n);e[s.array]=`${i} ${a}`}function Zo(e,t,n){return typeof e=="string"?e:E.transform(t+n*e)}function x1(e,t,n){const r=Zo(t,e.x,e.width),o=Zo(n,e.y,e.height);return`${r} ${o}`}function Gr(e,{attrX:t,attrY:n,attrScale:r,originX:o,originY:s,pathLength:i,pathSpacing:a=1,pathOffset:c=0,...l},u,d){if(Kr(e,l,d),u){e.style.viewBox&&(e.attrs.viewBox=e.style.viewBox);return}e.attrs=e.style,e.style={};const{attrs:p,style:y,dimensions:g}=e;p.transform&&(g&&(y.transform=p.transform),delete p.transform),g&&(o!==void 0||s!==void 0||y.transform)&&(y.transformOrigin=x1(g,o!==void 0?o:.5,s!==void 0?s:.5)),t!==void 0&&(p.x=t),n!==void 0&&(p.y=n),r!==void 0&&(p.scale=r),i!==void 0&&k1(p,i,a,c,!1)}const Zr=()=>({style:{},transform:{},transformOrigin:{},vars:{}}),Zi=()=>({...Zr(),attrs:{}}),Xr=e=>typeof e=="string"&&e.toLowerCase()==="svg";function Xi(e,{style:t,vars:n},r,o){Object.assign(e.style,t,o&&o.getProjectionStyles(r));for(const s in n)e.style.setProperty(s,n[s])}const Yi=new Set(["baseFrequency","diffuseConstant","kernelMatrix","kernelUnitLength","keySplines","keyTimes","limitingConeAngle","markerHeight","markerWidth","numOctaves","targetX","targetY","surfaceScale","specularConstant","specularExponent","stdDeviation","tableValues","viewBox","gradientTransform","pathLength","startOffset","textLength","lengthAdjust"]);function Qi(e,t,n,r){Xi(e,t,void 0,r);for(const o in t.attrs)e.setAttribute(Yi.has(o)?o:zr(o),t.attrs[o])}const dn={};function M1(e){Object.assign(dn,e)}function Ji(e,{layout:t,layoutId:n}){return $e.has(e)||e.startsWith("origin")||(t||n!==void 0)&&(!!dn[e]||e==="opacity")}function Yr(e,t,n){var r;const{style:o}=e,s={};for(const i in o)(X(o[i])||t.style&&X(t.style[i])||Ji(i,e)||((r=n==null?void 0:n.getValue(i))===null||r===void 0?void 0:r.liveStyle)!==void 0)&&(s[i]=o[i]);return s}function ea(e,t,n){const r=Yr(e,t,n);for(const o in e)if(X(e[o])||X(t[o])){const s=ut.indexOf(o)!==-1?"attr"+o.charAt(0).toUpperCase()+o.substring(1):o;r[s]=e[o]}return r}function w1(e,t){try{t.dimensions=typeof e.getBBox=="function"?e.getBBox():e.getBoundingClientRect()}catch{t.dimensions={x:0,y:0,width:0,height:0}}}const Xo=["x","y","width","height","cx","cy","r"],b1={useVisualState:$i({scrapeMotionValuesFromProps:ea,createRenderState:Zi,onUpdate:({props:e,prevProps:t,current:n,renderState:r,latestValues:o})=>{if(!n)return;let s=!!e.drag;if(!s){for(const a in o)if($e.has(a)){s=!0;break}}if(!s)return;let i=!t;if(t)for(let a=0;a<Xo.length;a++){const c=Xo[a];e[c]!==t[c]&&(i=!0)}i&&z.read(()=>{w1(n,r),z.render(()=>{Gr(r,o,Xr(n.tagName),e.transformTemplate),Qi(n,r)})})}})},C1={useVisualState:$i({scrapeMotionValuesFromProps:Yr,createRenderState:Zr})};function ta(e,t,n){for(const r in t)!X(t[r])&&!Ji(r,n)&&(e[r]=t[r])}function S1({transformTemplate:e},t){return h.useMemo(()=>{const n=Zr();return Kr(n,t,e),Object.assign({},n.vars,n.style)},[t])}function P1(e,t){const n=e.style||{},r={};return ta(r,n,e),Object.assign(r,S1(e,t)),r}function A1(e,t){const n={},r=P1(e,t);return e.drag&&e.dragListener!==!1&&(n.draggable=!1,r.userSelect=r.WebkitUserSelect=r.WebkitTouchCallout="none",r.touchAction=e.drag===!0?"none":`pan-${e.drag==="x"?"y":"x"}`),e.tabIndex===void 0&&(e.onTap||e.onTapStart||e.whileTap)&&(n.tabIndex=0),n.style=r,n}function T1(e,t,n,r){const o=h.useMemo(()=>{const s=Zi();return Gr(s,t,Xr(r),e.transformTemplate),{...s.attrs,style:{...s.style}}},[t]);if(e.style){const s={};ta(s,e.style,e),o.style={...s,...o.style}}return o}function R1(e=!1){return(n,r,o,{latestValues:s},i)=>{const c=(qr(n)?T1:A1)(r,s,i,n),l=Uu(r,typeof n=="string",e),u=n!==h.Fragment?{...l,...c,ref:o}:{},{children:d}=r,p=h.useMemo(()=>X(d)?d.get():d,[d]);return h.createElement(n,{...u,children:p})}}function E1(e,t){return function(r,{forwardMotionProps:o}={forwardMotionProps:!1}){const i={...qr(r)?b1:C1,preloadedFeatures:e,useRender:R1(o),createVisualElement:t,Component:r};return Ju(i)}}function na(e,t){if(!Array.isArray(t))return!1;const n=t.length;if(n!==e.length)return!1;for(let r=0;r<n;r++)if(t[r]!==e[r])return!1;return!0}function En(e,t,n){const r=e.getProps();return Ur(r,t,n!==void 0?n:r.custom,e)}const D1=Nr(()=>window.ScrollTimeline!==void 0);class L1{constructor(t){this.stop=()=>this.runAll("stop"),this.animations=t.filter(Boolean)}get finished(){return Promise.all(this.animations.map(t=>"finished"in t?t.finished:t))}getAll(t){return this.animations[0][t]}setAll(t,n){for(let r=0;r<this.animations.length;r++)this.animations[r][t]=n}attachTimeline(t,n){const r=this.animations.map(o=>{if(D1()&&o.attachTimeline)return o.attachTimeline(t);if(typeof n=="function")return n(o)});return()=>{r.forEach((o,s)=>{o&&o(),this.animations[s].stop()})}}get time(){return this.getAll("time")}set time(t){this.setAll("time",t)}get speed(){return this.getAll("speed")}set speed(t){this.setAll("speed",t)}get startTime(){return this.getAll("startTime")}get duration(){let t=0;for(let n=0;n<this.animations.length;n++)t=Math.max(t,this.animations[n].duration);return t}runAll(t){this.animations.forEach(n=>n[t]())}flatten(){this.runAll("flatten")}play(){this.runAll("play")}pause(){this.runAll("pause")}cancel(){this.runAll("cancel")}complete(){this.runAll("complete")}}class V1 extends L1{then(t,n){return Promise.all(this.animations).then(t).catch(n)}}function Qr(e,t){return e?e[t]||e.default||e:void 0}const hr=2e4;function ra(e){let t=0;const n=50;let r=e.next(t);for(;!r.done&&t<hr;)t+=n,r=e.next(t);return t>=hr?1/0:t}function Jr(e){return typeof e=="function"}function Yo(e,t){e.timeline=t,e.onfinish=null}const eo=e=>Array.isArray(e)&&typeof e[0]=="number",O1={linearEasing:void 0};function I1(e,t){const n=Nr(e);return()=>{var r;return(r=O1[t])!==null&&r!==void 0?r:n()}}const hn=I1(()=>{try{document.createElement("div").animate({opacity:0},{easing:"linear(0, 1)"})}catch{return!1}return!0},"linearEasing"),oa=(e,t,n=10)=>{let r="";const o=Math.max(Math.round(t/n),2);for(let s=0;s<o;s++)r+=e(st(0,o-1,s))+", ";return`linear(${r.substring(0,r.length-2)})`};function sa(e){return!!(typeof e=="function"&&hn()||!e||typeof e=="string"&&(e in fr||hn())||eo(e)||Array.isArray(e)&&e.every(sa))}const xt=([e,t,n,r])=>`cubic-bezier(${e}, ${t}, ${n}, ${r})`,fr={linear:"linear",ease:"ease",easeIn:"ease-in",easeOut:"ease-out",easeInOut:"ease-in-out",circIn:xt([0,.65,.55,1]),circOut:xt([.55,0,1,.45]),backIn:xt([.31,.01,.66,-.59]),backOut:xt([.33,1.53,.69,.99])};function ia(e,t){if(e)return typeof e=="function"&&hn()?oa(e,t):eo(e)?xt(e):Array.isArray(e)?e.map(n=>ia(n,t)||fr.easeOut):fr[e]}const ae={x:!1,y:!1};function aa(){return ae.x||ae.y}function j1(e,t,n){var r;if(e instanceof Element)return[e];if(typeof e=="string"){let o=document;const s=(r=void 0)!==null&&r!==void 0?r:o.querySelectorAll(e);return s?Array.from(s):[]}return Array.from(e)}function ca(e,t){const n=j1(e),r=new AbortController,o={passive:!0,...t,signal:r.signal};return[n,o,()=>r.abort()]}function Qo(e){return t=>{t.pointerType==="touch"||aa()||e(t)}}function F1(e,t,n={}){const[r,o,s]=ca(e,n),i=Qo(a=>{const{target:c}=a,l=t(a);if(typeof l!="function"||!c)return;const u=Qo(d=>{l(d),c.removeEventListener("pointerleave",u)});c.addEventListener("pointerleave",u,o)});return r.forEach(a=>{a.addEventListener("pointerenter",i,o)}),s}const la=(e,t)=>t?e===t?!0:la(e,t.parentElement):!1,to=e=>e.pointerType==="mouse"?typeof e.button!="number"||e.button<=0:e.isPrimary!==!1,N1=new Set(["BUTTON","INPUT","SELECT","TEXTAREA","A"]);function _1(e){return N1.has(e.tagName)||e.tabIndex!==-1}const Mt=new WeakSet;function Jo(e){return t=>{t.key==="Enter"&&e(t)}}function Hn(e,t){e.dispatchEvent(new PointerEvent("pointer"+t,{isPrimary:!0,bubbles:!0}))}const B1=(e,t)=>{const n=e.currentTarget;if(!n)return;const r=Jo(()=>{if(Mt.has(n))return;Hn(n,"down");const o=Jo(()=>{Hn(n,"up")}),s=()=>Hn(n,"cancel");n.addEventListener("keyup",o,t),n.addEventListener("blur",s,t)});n.addEventListener("keydown",r,t),n.addEventListener("blur",()=>n.removeEventListener("keydown",r),t)};function es(e){return to(e)&&!aa()}function z1(e,t,n={}){const[r,o,s]=ca(e,n),i=a=>{const c=a.currentTarget;if(!es(a)||Mt.has(c))return;Mt.add(c);const l=t(a),u=(y,g)=>{window.removeEventListener("pointerup",d),window.removeEventListener("pointercancel",p),!(!es(y)||!Mt.has(c))&&(Mt.delete(c),typeof l=="function"&&l(y,{success:g}))},d=y=>{u(y,n.useGlobalTarget||la(c,y.target))},p=y=>{u(y,!1)};window.addEventListener("pointerup",d,o),window.addEventListener("pointercancel",p,o)};return r.forEach(a=>{!_1(a)&&a.getAttribute("tabindex")===null&&(a.tabIndex=0),(n.useGlobalTarget?window:a).addEventListener("pointerdown",i,o),a.addEventListener("focus",l=>B1(l,o),o)}),s}function H1(e){return e==="x"||e==="y"?ae[e]?null:(ae[e]=!0,()=>{ae[e]=!1}):ae.x||ae.y?null:(ae.x=ae.y=!0,()=>{ae.x=ae.y=!1})}const ua=new Set(["width","height","top","left","right","bottom",...ut]);let on;function q1(){on=void 0}const pe={now:()=>(on===void 0&&pe.set(K.isProcessing||Nu.useManualTiming?K.timestamp:performance.now()),on),set:e=>{on=e,queueMicrotask(q1)}};function no(e,t){e.indexOf(t)===-1&&e.push(t)}function ro(e,t){const n=e.indexOf(t);n>-1&&e.splice(n,1)}class oo{constructor(){this.subscriptions=[]}add(t){return no(this.subscriptions,t),()=>ro(this.subscriptions,t)}notify(t,n,r){const o=this.subscriptions.length;if(o)if(o===1)this.subscriptions[0](t,n,r);else for(let s=0;s<o;s++){const i=this.subscriptions[s];i&&i(t,n,r)}}getSize(){return this.subscriptions.length}clear(){this.subscriptions.length=0}}function da(e,t){return t?e*(1e3/t):0}const ts=30,U1=e=>!isNaN(parseFloat(e));class $1{constructor(t,n={}){this.version="11.18.2",this.canTrackVelocity=null,this.events={},this.updateAndNotify=(r,o=!0)=>{const s=pe.now();this.updatedAt!==s&&this.setPrevFrameValue(),this.prev=this.current,this.setCurrent(r),this.current!==this.prev&&this.events.change&&this.events.change.notify(this.current),o&&this.events.renderRequest&&this.events.renderRequest.notify(this.current)},this.hasAnimated=!1,this.setCurrent(t),this.owner=n.owner}setCurrent(t){this.current=t,this.updatedAt=pe.now(),this.canTrackVelocity===null&&t!==void 0&&(this.canTrackVelocity=U1(this.current))}setPrevFrameValue(t=this.current){this.prevFrameValue=t,this.prevUpdatedAt=this.updatedAt}onChange(t){return this.on("change",t)}on(t,n){this.events[t]||(this.events[t]=new oo);const r=this.events[t].add(n);return t==="change"?()=>{r(),z.read(()=>{this.events.change.getSize()||this.stop()})}:r}clearListeners(){for(const t in this.events)this.events[t].clear()}attach(t,n){this.passiveEffect=t,this.stopPassiveEffect=n}set(t,n=!0){!n||!this.passiveEffect?this.updateAndNotify(t,n):this.passiveEffect(t,this.updateAndNotify)}setWithVelocity(t,n,r){this.set(n),this.prev=void 0,this.prevFrameValue=t,this.prevUpdatedAt=this.updatedAt-r}jump(t,n=!0){this.updateAndNotify(t),this.prev=t,this.prevUpdatedAt=this.prevFrameValue=void 0,n&&this.stop(),this.stopPassiveEffect&&this.stopPassiveEffect()}get(){return this.current}getPrevious(){return this.prev}getVelocity(){const t=pe.now();if(!this.canTrackVelocity||this.prevFrameValue===void 0||t-this.updatedAt>ts)return 0;const n=Math.min(this.updatedAt-this.prevUpdatedAt,ts);return da(parseFloat(this.current)-parseFloat(this.prevFrameValue),n)}start(t){return this.stop(),new Promise(n=>{this.hasAnimated=!0,this.animation=t(n),this.events.animationStart&&this.events.animationStart.notify()}).then(()=>{this.events.animationComplete&&this.events.animationComplete.notify(),this.clearAnimation()})}stop(){this.animation&&(this.animation.stop(),this.events.animationCancel&&this.events.animationCancel.notify()),this.clearAnimation()}isAnimating(){return!!this.animation}clearAnimation(){delete this.animation}destroy(){this.clearListeners(),this.stop(),this.stopPassiveEffect&&this.stopPassiveEffect()}}function Et(e,t){return new $1(e,t)}function W1(e,t,n){e.hasValue(t)?e.getValue(t).set(n):e.addValue(t,Et(n))}function K1(e,t){const n=En(e,t);let{transitionEnd:r={},transition:o={},...s}=n||{};s={...s,...r};for(const i in s){const a=s1(s[i]);W1(e,i,a)}}function G1(e){return!!(X(e)&&e.add)}function pr(e,t){const n=e.getValue("willChange");if(G1(n))return n.add(t)}function ha(e){return e.props[Hi]}const fa=(e,t,n)=>(((1-3*n+3*t)*e+(3*n-6*t))*e+3*t)*e,Z1=1e-7,X1=12;function Y1(e,t,n,r,o){let s,i,a=0;do i=t+(n-t)/2,s=fa(i,r,o)-e,s>0?n=i:t=i;while(Math.abs(s)>Z1&&++a<X1);return i}function Nt(e,t,n,r){if(e===t&&n===r)return ee;const o=s=>Y1(s,0,1,e,n);return s=>s===0||s===1?s:fa(o(s),t,r)}const pa=e=>t=>t<=.5?e(2*t)/2:(2-e(2*(1-t)))/2,ya=e=>t=>1-e(1-t),ma=Nt(.33,1.53,.69,.99),so=ya(ma),ga=pa(so),va=e=>(e*=2)<1?.5*so(e):.5*(2-Math.pow(2,-10*(e-1))),io=e=>1-Math.sin(Math.acos(e)),ka=ya(io),xa=pa(io),Ma=e=>/^0[^.\s]+$/u.test(e);function Q1(e){return typeof e=="number"?e===0:e!==null?e==="none"||e==="0"||Ma(e):!0}const Ct=e=>Math.round(e*1e5)/1e5,ao=/-?(?:\d+(?:\.\d+)?|\.\d+)/gu;function J1(e){return e==null}const ed=/^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))$/iu,co=(e,t)=>n=>!!(typeof n=="string"&&ed.test(n)&&n.startsWith(e)||t&&!J1(n)&&Object.prototype.hasOwnProperty.call(n,t)),wa=(e,t,n)=>r=>{if(typeof r!="string")return r;const[o,s,i,a]=r.match(ao);return{[e]:parseFloat(o),[t]:parseFloat(s),[n]:parseFloat(i),alpha:a!==void 0?parseFloat(a):1}},td=e=>we(0,255,e),qn={...dt,transform:e=>Math.round(td(e))},Be={test:co("rgb","red"),parse:wa("red","green","blue"),transform:({red:e,green:t,blue:n,alpha:r=1})=>"rgba("+qn.transform(e)+", "+qn.transform(t)+", "+qn.transform(n)+", "+Ct(Rt.transform(r))+")"};function nd(e){let t="",n="",r="",o="";return e.length>5?(t=e.substring(1,3),n=e.substring(3,5),r=e.substring(5,7),o=e.substring(7,9)):(t=e.substring(1,2),n=e.substring(2,3),r=e.substring(3,4),o=e.substring(4,5),t+=t,n+=n,r+=r,o+=o),{red:parseInt(t,16),green:parseInt(n,16),blue:parseInt(r,16),alpha:o?parseInt(o,16)/255:1}}const yr={test:co("#"),parse:nd,transform:Be.transform},Qe={test:co("hsl","hue"),parse:wa("hue","saturation","lightness"),transform:({hue:e,saturation:t,lightness:n,alpha:r=1})=>"hsla("+Math.round(e)+", "+fe.transform(Ct(t))+", "+fe.transform(Ct(n))+", "+Ct(Rt.transform(r))+")"},Z={test:e=>Be.test(e)||yr.test(e)||Qe.test(e),parse:e=>Be.test(e)?Be.parse(e):Qe.test(e)?Qe.parse(e):yr.parse(e),transform:e=>typeof e=="string"?e:e.hasOwnProperty("red")?Be.transform(e):Qe.transform(e)},rd=/(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))/giu;function od(e){var t,n;return isNaN(e)&&typeof e=="string"&&(((t=e.match(ao))===null||t===void 0?void 0:t.length)||0)+(((n=e.match(rd))===null||n===void 0?void 0:n.length)||0)>0}const ba="number",Ca="color",sd="var",id="var(",ns="${}",ad=/var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)|#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)|-?(?:\d+(?:\.\d+)?|\.\d+)/giu;function Dt(e){const t=e.toString(),n=[],r={color:[],number:[],var:[]},o=[];let s=0;const a=t.replace(ad,c=>(Z.test(c)?(r.color.push(s),o.push(Ca),n.push(Z.parse(c))):c.startsWith(id)?(r.var.push(s),o.push(sd),n.push(c)):(r.number.push(s),o.push(ba),n.push(parseFloat(c))),++s,ns)).split(ns);return{values:n,split:a,indexes:r,types:o}}function Sa(e){return Dt(e).values}function Pa(e){const{split:t,types:n}=Dt(e),r=t.length;return o=>{let s="";for(let i=0;i<r;i++)if(s+=t[i],o[i]!==void 0){const a=n[i];a===ba?s+=Ct(o[i]):a===Ca?s+=Z.transform(o[i]):s+=o[i]}return s}}const cd=e=>typeof e=="number"?0:e;function ld(e){const t=Sa(e);return Pa(e)(t.map(cd))}const Ee={test:od,parse:Sa,createTransformer:Pa,getAnimatableNone:ld},ud=new Set(["brightness","contrast","saturate","opacity"]);function dd(e){const[t,n]=e.slice(0,-1).split("(");if(t==="drop-shadow")return e;const[r]=n.match(ao)||[];if(!r)return e;const o=n.replace(r,"");let s=ud.has(t)?1:0;return r!==n&&(s*=100),t+"("+s+o+")"}const hd=/\b([a-z-]*)\(.*?\)/gu,mr={...Ee,getAnimatableNone:e=>{const t=e.match(hd);return t?t.map(dd).join(" "):e}},fd={...Wr,color:Z,backgroundColor:Z,outlineColor:Z,fill:Z,stroke:Z,borderColor:Z,borderTopColor:Z,borderRightColor:Z,borderBottomColor:Z,borderLeftColor:Z,filter:mr,WebkitFilter:mr},lo=e=>fd[e];function Aa(e,t){let n=lo(e);return n!==mr&&(n=Ee),n.getAnimatableNone?n.getAnimatableNone(t):void 0}const pd=new Set(["auto","none","0"]);function yd(e,t,n){let r=0,o;for(;r<e.length&&!o;){const s=e[r];typeof s=="string"&&!pd.has(s)&&Dt(s).values.length&&(o=e[r]),r++}if(o&&n)for(const s of t)e[s]=Aa(n,o)}const rs=e=>e===dt||e===E,os=(e,t)=>parseFloat(e.split(", ")[t]),ss=(e,t)=>(n,{transform:r})=>{if(r==="none"||!r)return 0;const o=r.match(/^matrix3d\((.+)\)$/u);if(o)return os(o[1],t);{const s=r.match(/^matrix\((.+)\)$/u);return s?os(s[1],e):0}},md=new Set(["x","y","z"]),gd=ut.filter(e=>!md.has(e));function vd(e){const t=[];return gd.forEach(n=>{const r=e.getValue(n);r!==void 0&&(t.push([n,r.get()]),r.set(n.startsWith("scale")?1:0))}),t}const at={width:({x:e},{paddingLeft:t="0",paddingRight:n="0"})=>e.max-e.min-parseFloat(t)-parseFloat(n),height:({y:e},{paddingTop:t="0",paddingBottom:n="0"})=>e.max-e.min-parseFloat(t)-parseFloat(n),top:(e,{top:t})=>parseFloat(t),left:(e,{left:t})=>parseFloat(t),bottom:({y:e},{top:t})=>parseFloat(t)+(e.max-e.min),right:({x:e},{left:t})=>parseFloat(t)+(e.max-e.min),x:ss(4,13),y:ss(5,14)};at.translateX=at.x;at.translateY=at.y;const ze=new Set;let gr=!1,vr=!1;function Ta(){if(vr){const e=Array.from(ze).filter(r=>r.needsMeasurement),t=new Set(e.map(r=>r.element)),n=new Map;t.forEach(r=>{const o=vd(r);o.length&&(n.set(r,o),r.render())}),e.forEach(r=>r.measureInitialState()),t.forEach(r=>{r.render();const o=n.get(r);o&&o.forEach(([s,i])=>{var a;(a=r.getValue(s))===null||a===void 0||a.set(i)})}),e.forEach(r=>r.measureEndState()),e.forEach(r=>{r.suspendedScrollY!==void 0&&window.scrollTo(0,r.suspendedScrollY)})}vr=!1,gr=!1,ze.forEach(e=>e.complete()),ze.clear()}function Ra(){ze.forEach(e=>{e.readKeyframes(),e.needsMeasurement&&(vr=!0)})}function kd(){Ra(),Ta()}class uo{constructor(t,n,r,o,s,i=!1){this.isComplete=!1,this.isAsync=!1,this.needsMeasurement=!1,this.isScheduled=!1,this.unresolvedKeyframes=[...t],this.onComplete=n,this.name=r,this.motionValue=o,this.element=s,this.isAsync=i}scheduleResolve(){this.isScheduled=!0,this.isAsync?(ze.add(this),gr||(gr=!0,z.read(Ra),z.resolveKeyframes(Ta))):(this.readKeyframes(),this.complete())}readKeyframes(){const{unresolvedKeyframes:t,name:n,element:r,motionValue:o}=this;for(let s=0;s<t.length;s++)if(t[s]===null)if(s===0){const i=o==null?void 0:o.get(),a=t[t.length-1];if(i!==void 0)t[0]=i;else if(r&&n){const c=r.readValue(n,a);c!=null&&(t[0]=c)}t[0]===void 0&&(t[0]=a),o&&i===void 0&&o.set(t[0])}else t[s]=t[s-1]}setFinalKeyframe(){}measureInitialState(){}renderEndStyles(){}measureEndState(){}complete(){this.isComplete=!0,this.onComplete(this.unresolvedKeyframes,this.finalKeyframe),ze.delete(this)}cancel(){this.isComplete||(this.isScheduled=!1,ze.delete(this))}resume(){this.isComplete||this.scheduleResolve()}}const Ea=e=>/^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(e),xd=/^var\(--(?:([\w-]+)|([\w-]+), ?([a-zA-Z\d ()%#.,-]+))\)/u;function Md(e){const t=xd.exec(e);if(!t)return[,];const[,n,r,o]=t;return[`--${n??r}`,o]}function Da(e,t,n=1){const[r,o]=Md(e);if(!r)return;const s=window.getComputedStyle(t).getPropertyValue(r);if(s){const i=s.trim();return Ea(i)?parseFloat(i):i}return $r(o)?Da(o,t,n+1):o}const La=e=>t=>t.test(e),wd={test:e=>e==="auto",parse:e=>e},Va=[dt,E,fe,Se,d1,u1,wd],is=e=>Va.find(La(e));class Oa extends uo{constructor(t,n,r,o,s){super(t,n,r,o,s,!0)}readKeyframes(){const{unresolvedKeyframes:t,element:n,name:r}=this;if(!n||!n.current)return;super.readKeyframes();for(let c=0;c<t.length;c++){let l=t[c];if(typeof l=="string"&&(l=l.trim(),$r(l))){const u=Da(l,n.current);u!==void 0&&(t[c]=u),c===t.length-1&&(this.finalKeyframe=l)}}if(this.resolveNoneKeyframes(),!ua.has(r)||t.length!==2)return;const[o,s]=t,i=is(o),a=is(s);if(i!==a)if(rs(i)&&rs(a))for(let c=0;c<t.length;c++){const l=t[c];typeof l=="string"&&(t[c]=parseFloat(l))}else this.needsMeasurement=!0}resolveNoneKeyframes(){const{unresolvedKeyframes:t,name:n}=this,r=[];for(let o=0;o<t.length;o++)Q1(t[o])&&r.push(o);r.length&&yd(t,r,n)}measureInitialState(){const{element:t,unresolvedKeyframes:n,name:r}=this;if(!t||!t.current)return;r==="height"&&(this.suspendedScrollY=window.pageYOffset),this.measuredOrigin=at[r](t.measureViewportBox(),window.getComputedStyle(t.current)),n[0]=this.measuredOrigin;const o=n[n.length-1];o!==void 0&&t.getValue(r,o).jump(o,!1)}measureEndState(){var t;const{element:n,name:r,unresolvedKeyframes:o}=this;if(!n||!n.current)return;const s=n.getValue(r);s&&s.jump(this.measuredOrigin,!1);const i=o.length-1,a=o[i];o[i]=at[r](n.measureViewportBox(),window.getComputedStyle(n.current)),a!==null&&this.finalKeyframe===void 0&&(this.finalKeyframe=a),!((t=this.removedTransforms)===null||t===void 0)&&t.length&&this.removedTransforms.forEach(([c,l])=>{n.getValue(c).set(l)}),this.resolveNoneKeyframes()}}const as=(e,t)=>t==="zIndex"?!1:!!(typeof e=="number"||Array.isArray(e)||typeof e=="string"&&(Ee.test(e)||e==="0")&&!e.startsWith("url("));function bd(e){const t=e[0];if(e.length===1)return!0;for(let n=0;n<e.length;n++)if(e[n]!==t)return!0}function Cd(e,t,n,r){const o=e[0];if(o===null)return!1;if(t==="display"||t==="visibility")return!0;const s=e[e.length-1],i=as(o,t),a=as(s,t);return!i||!a?!1:bd(e)||(n==="spring"||Jr(n))&&r}const Sd=e=>e!==null;function Dn(e,{repeat:t,repeatType:n="loop"},r){const o=e.filter(Sd),s=t&&n!=="loop"&&t%2===1?0:o.length-1;return!s||r===void 0?o[s]:r}const Pd=40;class Ia{constructor({autoplay:t=!0,delay:n=0,type:r="keyframes",repeat:o=0,repeatDelay:s=0,repeatType:i="loop",...a}){this.isStopped=!1,this.hasAttemptedResolve=!1,this.createdAt=pe.now(),this.options={autoplay:t,delay:n,type:r,repeat:o,repeatDelay:s,repeatType:i,...a},this.updateFinishedPromise()}calcStartTime(){return this.resolvedAt?this.resolvedAt-this.createdAt>Pd?this.resolvedAt:this.createdAt:this.createdAt}get resolved(){return!this._resolved&&!this.hasAttemptedResolve&&kd(),this._resolved}onKeyframesResolved(t,n){this.resolvedAt=pe.now(),this.hasAttemptedResolve=!0;const{name:r,type:o,velocity:s,delay:i,onComplete:a,onUpdate:c,isGenerator:l}=this.options;if(!l&&!Cd(t,r,o,s))if(i)this.options.duration=0;else{c&&c(Dn(t,this.options,n)),a&&a(),this.resolveFinishedPromise();return}const u=this.initPlayback(t,n);u!==!1&&(this._resolved={keyframes:t,finalKeyframe:n,...u},this.onPostResolved())}onPostResolved(){}then(t,n){return this.currentFinishedPromise.then(t,n)}flatten(){this.options.type="keyframes",this.options.ease="linear"}updateFinishedPromise(){this.currentFinishedPromise=new Promise(t=>{this.resolveFinishedPromise=t})}}const H=(e,t,n)=>e+(t-e)*n;function Un(e,t,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?e+(t-e)*6*n:n<1/2?t:n<2/3?e+(t-e)*(2/3-n)*6:e}function Ad({hue:e,saturation:t,lightness:n,alpha:r}){e/=360,t/=100,n/=100;let o=0,s=0,i=0;if(!t)o=s=i=n;else{const a=n<.5?n*(1+t):n+t-n*t,c=2*n-a;o=Un(c,a,e+1/3),s=Un(c,a,e),i=Un(c,a,e-1/3)}return{red:Math.round(o*255),green:Math.round(s*255),blue:Math.round(i*255),alpha:r}}function fn(e,t){return n=>n>0?t:e}const $n=(e,t,n)=>{const r=e*e,o=n*(t*t-r)+r;return o<0?0:Math.sqrt(o)},Td=[yr,Be,Qe],Rd=e=>Td.find(t=>t.test(e));function cs(e){const t=Rd(e);if(!t)return!1;let n=t.parse(e);return t===Qe&&(n=Ad(n)),n}const ls=(e,t)=>{const n=cs(e),r=cs(t);if(!n||!r)return fn(e,t);const o={...n};return s=>(o.red=$n(n.red,r.red,s),o.green=$n(n.green,r.green,s),o.blue=$n(n.blue,r.blue,s),o.alpha=H(n.alpha,r.alpha,s),Be.transform(o))},Ed=(e,t)=>n=>t(e(n)),_t=(...e)=>e.reduce(Ed),kr=new Set(["none","hidden"]);function Dd(e,t){return kr.has(e)?n=>n<=0?e:t:n=>n>=1?t:e}function Ld(e,t){return n=>H(e,t,n)}function ho(e){return typeof e=="number"?Ld:typeof e=="string"?$r(e)?fn:Z.test(e)?ls:Id:Array.isArray(e)?ja:typeof e=="object"?Z.test(e)?ls:Vd:fn}function ja(e,t){const n=[...e],r=n.length,o=e.map((s,i)=>ho(s)(s,t[i]));return s=>{for(let i=0;i<r;i++)n[i]=o[i](s);return n}}function Vd(e,t){const n={...e,...t},r={};for(const o in n)e[o]!==void 0&&t[o]!==void 0&&(r[o]=ho(e[o])(e[o],t[o]));return o=>{for(const s in r)n[s]=r[s](o);return n}}function Od(e,t){var n;const r=[],o={color:0,var:0,number:0};for(let s=0;s<t.values.length;s++){const i=t.types[s],a=e.indexes[i][o[i]],c=(n=e.values[a])!==null&&n!==void 0?n:0;r[s]=c,o[i]++}return r}const Id=(e,t)=>{const n=Ee.createTransformer(t),r=Dt(e),o=Dt(t);return r.indexes.var.length===o.indexes.var.length&&r.indexes.color.length===o.indexes.color.length&&r.indexes.number.length>=o.indexes.number.length?kr.has(e)&&!o.values.length||kr.has(t)&&!r.values.length?Dd(e,t):_t(ja(Od(r,o),o.values),n):fn(e,t)};function Fa(e,t,n){return typeof e=="number"&&typeof t=="number"&&typeof n=="number"?H(e,t,n):ho(e)(e,t)}const jd=5;function Na(e,t,n){const r=Math.max(t-jd,0);return da(n-e(r),t-r)}const q={stiffness:100,damping:10,mass:1,velocity:0,duration:800,bounce:.3,visualDuration:.3,restSpeed:{granular:.01,default:2},restDelta:{granular:.005,default:.5},minDuration:.01,maxDuration:10,minDamping:.05,maxDamping:1},Wn=.001;function Fd({duration:e=q.duration,bounce:t=q.bounce,velocity:n=q.velocity,mass:r=q.mass}){let o,s,i=1-t;i=we(q.minDamping,q.maxDamping,i),e=we(q.minDuration,q.maxDuration,xe(e)),i<1?(o=l=>{const u=l*i,d=u*e,p=u-n,y=xr(l,i),g=Math.exp(-d);return Wn-p/y*g},s=l=>{const d=l*i*e,p=d*n+n,y=Math.pow(i,2)*Math.pow(l,2)*e,g=Math.exp(-d),m=xr(Math.pow(l,2),i);return(-o(l)+Wn>0?-1:1)*((p-y)*g)/m}):(o=l=>{const u=Math.exp(-l*e),d=(l-n)*e+1;return-Wn+u*d},s=l=>{const u=Math.exp(-l*e),d=(n-l)*(e*e);return u*d});const a=5/e,c=_d(o,s,a);if(e=ke(e),isNaN(c))return{stiffness:q.stiffness,damping:q.damping,duration:e};{const l=Math.pow(c,2)*r;return{stiffness:l,damping:i*2*Math.sqrt(r*l),duration:e}}}const Nd=12;function _d(e,t,n){let r=n;for(let o=1;o<Nd;o++)r=r-e(r)/t(r);return r}function xr(e,t){return e*Math.sqrt(1-t*t)}const Bd=["duration","bounce"],zd=["stiffness","damping","mass"];function us(e,t){return t.some(n=>e[n]!==void 0)}function Hd(e){let t={velocity:q.velocity,stiffness:q.stiffness,damping:q.damping,mass:q.mass,isResolvedFromDuration:!1,...e};if(!us(e,zd)&&us(e,Bd))if(e.visualDuration){const n=e.visualDuration,r=2*Math.PI/(n*1.2),o=r*r,s=2*we(.05,1,1-(e.bounce||0))*Math.sqrt(o);t={...t,mass:q.mass,stiffness:o,damping:s}}else{const n=Fd(e);t={...t,...n,mass:q.mass},t.isResolvedFromDuration=!0}return t}function _a(e=q.visualDuration,t=q.bounce){const n=typeof e!="object"?{visualDuration:e,keyframes:[0,1],bounce:t}:e;let{restSpeed:r,restDelta:o}=n;const s=n.keyframes[0],i=n.keyframes[n.keyframes.length-1],a={done:!1,value:s},{stiffness:c,damping:l,mass:u,duration:d,velocity:p,isResolvedFromDuration:y}=Hd({...n,velocity:-xe(n.velocity||0)}),g=p||0,m=l/(2*Math.sqrt(c*u)),v=i-s,k=xe(Math.sqrt(c/u)),x=Math.abs(v)<5;r||(r=x?q.restSpeed.granular:q.restSpeed.default),o||(o=x?q.restDelta.granular:q.restDelta.default);let M;if(m<1){const w=xr(k,m);M=S=>{const P=Math.exp(-m*k*S);return i-P*((g+m*k*v)/w*Math.sin(w*S)+v*Math.cos(w*S))}}else if(m===1)M=w=>i-Math.exp(-k*w)*(v+(g+k*v)*w);else{const w=k*Math.sqrt(m*m-1);M=S=>{const P=Math.exp(-m*k*S),A=Math.min(w*S,300);return i-P*((g+m*k*v)*Math.sinh(A)+w*v*Math.cosh(A))/w}}const C={calculatedDuration:y&&d||null,next:w=>{const S=M(w);if(y)a.done=w>=d;else{let P=0;m<1&&(P=w===0?ke(g):Na(M,w,S));const A=Math.abs(P)<=r,D=Math.abs(i-S)<=o;a.done=A&&D}return a.value=a.done?i:S,a},toString:()=>{const w=Math.min(ra(C),hr),S=oa(P=>C.next(w*P).value,w,30);return w+"ms "+S}};return C}function ds({keyframes:e,velocity:t=0,power:n=.8,timeConstant:r=325,bounceDamping:o=10,bounceStiffness:s=500,modifyTarget:i,min:a,max:c,restDelta:l=.5,restSpeed:u}){const d=e[0],p={done:!1,value:d},y=A=>a!==void 0&&A<a||c!==void 0&&A>c,g=A=>a===void 0?c:c===void 0||Math.abs(a-A)<Math.abs(c-A)?a:c;let m=n*t;const v=d+m,k=i===void 0?v:i(v);k!==v&&(m=k-d);const x=A=>-m*Math.exp(-A/r),M=A=>k+x(A),C=A=>{const D=x(A),L=M(A);p.done=Math.abs(D)<=l,p.value=p.done?k:L};let w,S;const P=A=>{y(p.value)&&(w=A,S=_a({keyframes:[p.value,g(p.value)],velocity:Na(M,A,p.value),damping:o,stiffness:s,restDelta:l,restSpeed:u}))};return P(0),{calculatedDuration:null,next:A=>{let D=!1;return!S&&w===void 0&&(D=!0,C(A),P(A)),w!==void 0&&A>=w?S.next(A-w):(!D&&C(A),p)}}}const qd=Nt(.42,0,1,1),Ud=Nt(0,0,.58,1),Ba=Nt(.42,0,.58,1),$d=e=>Array.isArray(e)&&typeof e[0]!="number",Wd={linear:ee,easeIn:qd,easeInOut:Ba,easeOut:Ud,circIn:io,circInOut:xa,circOut:ka,backIn:so,backInOut:ga,backOut:ma,anticipate:va},hs=e=>{if(eo(e)){Fi(e.length===4);const[t,n,r,o]=e;return Nt(t,n,r,o)}else if(typeof e=="string")return Wd[e];return e};function Kd(e,t,n){const r=[],o=n||Fa,s=e.length-1;for(let i=0;i<s;i++){let a=o(e[i],e[i+1]);if(t){const c=Array.isArray(t)?t[i]||ee:t;a=_t(c,a)}r.push(a)}return r}function Gd(e,t,{clamp:n=!0,ease:r,mixer:o}={}){const s=e.length;if(Fi(s===t.length),s===1)return()=>t[0];if(s===2&&t[0]===t[1])return()=>t[1];const i=e[0]===e[1];e[0]>e[s-1]&&(e=[...e].reverse(),t=[...t].reverse());const a=Kd(t,r,o),c=a.length,l=u=>{if(i&&u<e[0])return t[0];let d=0;if(c>1)for(;d<e.length-2&&!(u<e[d+1]);d++);const p=st(e[d],e[d+1],u);return a[d](p)};return n?u=>l(we(e[0],e[s-1],u)):l}function Zd(e,t){const n=e[e.length-1];for(let r=1;r<=t;r++){const o=st(0,t,r);e.push(H(n,1,o))}}function Xd(e){const t=[0];return Zd(t,e.length-1),t}function Yd(e,t){return e.map(n=>n*t)}function Qd(e,t){return e.map(()=>t||Ba).splice(0,e.length-1)}function pn({duration:e=300,keyframes:t,times:n,ease:r="easeInOut"}){const o=$d(r)?r.map(hs):hs(r),s={done:!1,value:t[0]},i=Yd(n&&n.length===t.length?n:Xd(t),e),a=Gd(i,t,{ease:Array.isArray(o)?o:Qd(t,o)});return{calculatedDuration:e,next:c=>(s.value=a(c),s.done=c>=e,s)}}const Jd=e=>{const t=({timestamp:n})=>e(n);return{start:()=>z.update(t,!0),stop:()=>Re(t),now:()=>K.isProcessing?K.timestamp:pe.now()}},eh={decay:ds,inertia:ds,tween:pn,keyframes:pn,spring:_a},th=e=>e/100;class fo extends Ia{constructor(t){super(t),this.holdTime=null,this.cancelTime=null,this.currentTime=0,this.playbackSpeed=1,this.pendingPlayState="running",this.startTime=null,this.state="idle",this.stop=()=>{if(this.resolver.cancel(),this.isStopped=!0,this.state==="idle")return;this.teardown();const{onStop:c}=this.options;c&&c()};const{name:n,motionValue:r,element:o,keyframes:s}=this.options,i=(o==null?void 0:o.KeyframeResolver)||uo,a=(c,l)=>this.onKeyframesResolved(c,l);this.resolver=new i(s,a,n,r,o),this.resolver.scheduleResolve()}flatten(){super.flatten(),this._resolved&&Object.assign(this._resolved,this.initPlayback(this._resolved.keyframes))}initPlayback(t){const{type:n="keyframes",repeat:r=0,repeatDelay:o=0,repeatType:s,velocity:i=0}=this.options,a=Jr(n)?n:eh[n]||pn;let c,l;a!==pn&&typeof t[0]!="number"&&(c=_t(th,Fa(t[0],t[1])),t=[0,100]);const u=a({...this.options,keyframes:t});s==="mirror"&&(l=a({...this.options,keyframes:[...t].reverse(),velocity:-i})),u.calculatedDuration===null&&(u.calculatedDuration=ra(u));const{calculatedDuration:d}=u,p=d+o,y=p*(r+1)-o;return{generator:u,mirroredGenerator:l,mapPercentToKeyframes:c,calculatedDuration:d,resolvedDuration:p,totalDuration:y}}onPostResolved(){const{autoplay:t=!0}=this.options;this.play(),this.pendingPlayState==="paused"||!t?this.pause():this.state=this.pendingPlayState}tick(t,n=!1){const{resolved:r}=this;if(!r){const{keyframes:A}=this.options;return{done:!0,value:A[A.length-1]}}const{finalKeyframe:o,generator:s,mirroredGenerator:i,mapPercentToKeyframes:a,keyframes:c,calculatedDuration:l,totalDuration:u,resolvedDuration:d}=r;if(this.startTime===null)return s.next(0);const{delay:p,repeat:y,repeatType:g,repeatDelay:m,onUpdate:v}=this.options;this.speed>0?this.startTime=Math.min(this.startTime,t):this.speed<0&&(this.startTime=Math.min(t-u/this.speed,this.startTime)),n?this.currentTime=t:this.holdTime!==null?this.currentTime=this.holdTime:this.currentTime=Math.round(t-this.startTime)*this.speed;const k=this.currentTime-p*(this.speed>=0?1:-1),x=this.speed>=0?k<0:k>u;this.currentTime=Math.max(k,0),this.state==="finished"&&this.holdTime===null&&(this.currentTime=u);let M=this.currentTime,C=s;if(y){const A=Math.min(this.currentTime,u)/d;let D=Math.floor(A),L=A%1;!L&&A>=1&&(L=1),L===1&&D--,D=Math.min(D,y+1),!!(D%2)&&(g==="reverse"?(L=1-L,m&&(L-=m/d)):g==="mirror"&&(C=i)),M=we(0,1,L)*d}const w=x?{done:!1,value:c[0]}:C.next(M);a&&(w.value=a(w.value));let{done:S}=w;!x&&l!==null&&(S=this.speed>=0?this.currentTime>=u:this.currentTime<=0);const P=this.holdTime===null&&(this.state==="finished"||this.state==="running"&&S);return P&&o!==void 0&&(w.value=Dn(c,this.options,o)),v&&v(w.value),P&&this.finish(),w}get duration(){const{resolved:t}=this;return t?xe(t.calculatedDuration):0}get time(){return xe(this.currentTime)}set time(t){t=ke(t),this.currentTime=t,this.holdTime!==null||this.speed===0?this.holdTime=t:this.driver&&(this.startTime=this.driver.now()-t/this.speed)}get speed(){return this.playbackSpeed}set speed(t){const n=this.playbackSpeed!==t;this.playbackSpeed=t,n&&(this.time=xe(this.currentTime))}play(){if(this.resolver.isScheduled||this.resolver.resume(),!this._resolved){this.pendingPlayState="running";return}if(this.isStopped)return;const{driver:t=Jd,onPlay:n,startTime:r}=this.options;this.driver||(this.driver=t(s=>this.tick(s))),n&&n();const o=this.driver.now();this.holdTime!==null?this.startTime=o-this.holdTime:this.startTime?this.state==="finished"&&(this.startTime=o):this.startTime=r??this.calcStartTime(),this.state==="finished"&&this.updateFinishedPromise(),this.cancelTime=this.startTime,this.holdTime=null,this.state="running",this.driver.start()}pause(){var t;if(!this._resolved){this.pendingPlayState="paused";return}this.state="paused",this.holdTime=(t=this.currentTime)!==null&&t!==void 0?t:0}complete(){this.state!=="running"&&this.play(),this.pendingPlayState=this.state="finished",this.holdTime=null}finish(){this.teardown(),this.state="finished";const{onComplete:t}=this.options;t&&t()}cancel(){this.cancelTime!==null&&this.tick(this.cancelTime),this.teardown(),this.updateFinishedPromise()}teardown(){this.state="idle",this.stopDriver(),this.resolveFinishedPromise(),this.updateFinishedPromise(),this.startTime=this.cancelTime=null,this.resolver.cancel()}stopDriver(){this.driver&&(this.driver.stop(),this.driver=void 0)}sample(t){return this.startTime=0,this.tick(t,!0)}}const nh=new Set(["opacity","clipPath","filter","transform"]);function rh(e,t,n,{delay:r=0,duration:o=300,repeat:s=0,repeatType:i="loop",ease:a="easeInOut",times:c}={}){const l={[t]:n};c&&(l.offset=c);const u=ia(a,o);return Array.isArray(u)&&(l.easing=u),e.animate(l,{delay:r,duration:o,easing:Array.isArray(u)?"linear":u,fill:"both",iterations:s+1,direction:i==="reverse"?"alternate":"normal"})}const oh=Nr(()=>Object.hasOwnProperty.call(Element.prototype,"animate")),yn=10,sh=2e4;function ih(e){return Jr(e.type)||e.type==="spring"||!sa(e.ease)}function ah(e,t){const n=new fo({...t,keyframes:e,repeat:0,delay:0,isGenerator:!0});let r={done:!1,value:e[0]};const o=[];let s=0;for(;!r.done&&s<sh;)r=n.sample(s),o.push(r.value),s+=yn;return{times:void 0,keyframes:o,duration:s-yn,ease:"linear"}}const za={anticipate:va,backInOut:ga,circInOut:xa};function ch(e){return e in za}class fs extends Ia{constructor(t){super(t);const{name:n,motionValue:r,element:o,keyframes:s}=this.options;this.resolver=new Oa(s,(i,a)=>this.onKeyframesResolved(i,a),n,r,o),this.resolver.scheduleResolve()}initPlayback(t,n){let{duration:r=300,times:o,ease:s,type:i,motionValue:a,name:c,startTime:l}=this.options;if(!a.owner||!a.owner.current)return!1;if(typeof s=="string"&&hn()&&ch(s)&&(s=za[s]),ih(this.options)){const{onComplete:d,onUpdate:p,motionValue:y,element:g,...m}=this.options,v=ah(t,m);t=v.keyframes,t.length===1&&(t[1]=t[0]),r=v.duration,o=v.times,s=v.ease,i="keyframes"}const u=rh(a.owner.current,c,t,{...this.options,duration:r,times:o,ease:s});return u.startTime=l??this.calcStartTime(),this.pendingTimeline?(Yo(u,this.pendingTimeline),this.pendingTimeline=void 0):u.onfinish=()=>{const{onComplete:d}=this.options;a.set(Dn(t,this.options,n)),d&&d(),this.cancel(),this.resolveFinishedPromise()},{animation:u,duration:r,times:o,type:i,ease:s,keyframes:t}}get duration(){const{resolved:t}=this;if(!t)return 0;const{duration:n}=t;return xe(n)}get time(){const{resolved:t}=this;if(!t)return 0;const{animation:n}=t;return xe(n.currentTime||0)}set time(t){const{resolved:n}=this;if(!n)return;const{animation:r}=n;r.currentTime=ke(t)}get speed(){const{resolved:t}=this;if(!t)return 1;const{animation:n}=t;return n.playbackRate}set speed(t){const{resolved:n}=this;if(!n)return;const{animation:r}=n;r.playbackRate=t}get state(){const{resolved:t}=this;if(!t)return"idle";const{animation:n}=t;return n.playState}get startTime(){const{resolved:t}=this;if(!t)return null;const{animation:n}=t;return n.startTime}attachTimeline(t){if(!this._resolved)this.pendingTimeline=t;else{const{resolved:n}=this;if(!n)return ee;const{animation:r}=n;Yo(r,t)}return ee}play(){if(this.isStopped)return;const{resolved:t}=this;if(!t)return;const{animation:n}=t;n.playState==="finished"&&this.updateFinishedPromise(),n.play()}pause(){const{resolved:t}=this;if(!t)return;const{animation:n}=t;n.pause()}stop(){if(this.resolver.cancel(),this.isStopped=!0,this.state==="idle")return;this.resolveFinishedPromise(),this.updateFinishedPromise();const{resolved:t}=this;if(!t)return;const{animation:n,keyframes:r,duration:o,type:s,ease:i,times:a}=t;if(n.playState==="idle"||n.playState==="finished")return;if(this.time){const{motionValue:l,onUpdate:u,onComplete:d,element:p,...y}=this.options,g=new fo({...y,keyframes:r,duration:o,type:s,ease:i,times:a,isGenerator:!0}),m=ke(this.time);l.setWithVelocity(g.sample(m-yn).value,g.sample(m).value,yn)}const{onStop:c}=this.options;c&&c(),this.cancel()}complete(){const{resolved:t}=this;t&&t.animation.finish()}cancel(){const{resolved:t}=this;t&&t.animation.cancel()}static supports(t){const{motionValue:n,name:r,repeatDelay:o,repeatType:s,damping:i,type:a}=t;if(!n||!n.owner||!(n.owner.current instanceof HTMLElement))return!1;const{onUpdate:c,transformTemplate:l}=n.owner.getProps();return oh()&&r&&nh.has(r)&&!c&&!l&&!o&&s!=="mirror"&&i!==0&&a!=="inertia"}}const lh={type:"spring",stiffness:500,damping:25,restSpeed:10},uh=e=>({type:"spring",stiffness:550,damping:e===0?2*Math.sqrt(550):30,restSpeed:10}),dh={type:"keyframes",duration:.8},hh={type:"keyframes",ease:[.25,.1,.35,1],duration:.3},fh=(e,{keyframes:t})=>t.length>2?dh:$e.has(e)?e.startsWith("scale")?uh(t[1]):lh:hh;function ph({when:e,delay:t,delayChildren:n,staggerChildren:r,staggerDirection:o,repeat:s,repeatType:i,repeatDelay:a,from:c,elapsed:l,...u}){return!!Object.keys(u).length}const po=(e,t,n,r={},o,s)=>i=>{const a=Qr(r,e)||{},c=a.delay||r.delay||0;let{elapsed:l=0}=r;l=l-ke(c);let u={keyframes:Array.isArray(n)?n:[null,n],ease:"easeOut",velocity:t.getVelocity(),...a,delay:-l,onUpdate:p=>{t.set(p),a.onUpdate&&a.onUpdate(p)},onComplete:()=>{i(),a.onComplete&&a.onComplete()},name:e,motionValue:t,element:s?void 0:o};ph(a)||(u={...u,...fh(e,u)}),u.duration&&(u.duration=ke(u.duration)),u.repeatDelay&&(u.repeatDelay=ke(u.repeatDelay)),u.from!==void 0&&(u.keyframes[0]=u.from);let d=!1;if((u.type===!1||u.duration===0&&!u.repeatDelay)&&(u.duration=0,u.delay===0&&(d=!0)),d&&!s&&t.get()!==void 0){const p=Dn(u.keyframes,a);if(p!==void 0)return z.update(()=>{u.onUpdate(p),u.onComplete()}),new V1([])}return!s&&fs.supports(u)?new fs(u):new fo(u)};function yh({protectedKeys:e,needsAnimating:t},n){const r=e.hasOwnProperty(n)&&t[n]!==!0;return t[n]=!1,r}function Ha(e,t,{delay:n=0,transitionOverride:r,type:o}={}){var s;let{transition:i=e.getDefaultTransition(),transitionEnd:a,...c}=t;r&&(i=r);const l=[],u=o&&e.animationState&&e.animationState.getState()[o];for(const d in c){const p=e.getValue(d,(s=e.latestValues[d])!==null&&s!==void 0?s:null),y=c[d];if(y===void 0||u&&yh(u,d))continue;const g={delay:n,...Qr(i||{},d)};let m=!1;if(window.MotionHandoffAnimation){const k=ha(e);if(k){const x=window.MotionHandoffAnimation(k,d,z);x!==null&&(g.startTime=x,m=!0)}}pr(e,d),p.start(po(d,p,y,e.shouldReduceMotion&&ua.has(d)?{type:!1}:g,e,m));const v=p.animation;v&&l.push(v)}return a&&Promise.all(l).then(()=>{z.update(()=>{a&&K1(e,a)})}),l}function Mr(e,t,n={}){var r;const o=En(e,t,n.type==="exit"?(r=e.presenceContext)===null||r===void 0?void 0:r.custom:void 0);let{transition:s=e.getDefaultTransition()||{}}=o||{};n.transitionOverride&&(s=n.transitionOverride);const i=o?()=>Promise.all(Ha(e,o,n)):()=>Promise.resolve(),a=e.variantChildren&&e.variantChildren.size?(l=0)=>{const{delayChildren:u=0,staggerChildren:d,staggerDirection:p}=s;return mh(e,t,u+l,d,p,n)}:()=>Promise.resolve(),{when:c}=s;if(c){const[l,u]=c==="beforeChildren"?[i,a]:[a,i];return l().then(()=>u())}else return Promise.all([i(),a(n.delay)])}function mh(e,t,n=0,r=0,o=1,s){const i=[],a=(e.variantChildren.size-1)*r,c=o===1?(l=0)=>l*r:(l=0)=>a-l*r;return Array.from(e.variantChildren).sort(gh).forEach((l,u)=>{l.notify("AnimationStart",t),i.push(Mr(l,t,{...s,delay:n+c(u)}).then(()=>l.notify("AnimationComplete",t)))}),Promise.all(i)}function gh(e,t){return e.sortNodePosition(t)}function vh(e,t,n={}){e.notify("AnimationStart",t);let r;if(Array.isArray(t)){const o=t.map(s=>Mr(e,s,n));r=Promise.all(o)}else if(typeof t=="string")r=Mr(e,t,n);else{const o=typeof t=="function"?En(e,t,n.custom):t;r=Promise.all(Ha(e,o,n))}return r.then(()=>{e.notify("AnimationComplete",t)})}const kh=Br.length;function qa(e){if(!e)return;if(!e.isControllingVariants){const n=e.parent?qa(e.parent)||{}:{};return e.props.initial!==void 0&&(n.initial=e.props.initial),n}const t={};for(let n=0;n<kh;n++){const r=Br[n],o=e.props[r];(Tt(o)||o===!1)&&(t[r]=o)}return t}const xh=[..._r].reverse(),Mh=_r.length;function wh(e){return t=>Promise.all(t.map(({animation:n,options:r})=>vh(e,n,r)))}function bh(e){let t=wh(e),n=ps(),r=!0;const o=c=>(l,u)=>{var d;const p=En(e,u,c==="exit"?(d=e.presenceContext)===null||d===void 0?void 0:d.custom:void 0);if(p){const{transition:y,transitionEnd:g,...m}=p;l={...l,...m,...g}}return l};function s(c){t=c(e)}function i(c){const{props:l}=e,u=qa(e.parent)||{},d=[],p=new Set;let y={},g=1/0;for(let v=0;v<Mh;v++){const k=xh[v],x=n[k],M=l[k]!==void 0?l[k]:u[k],C=Tt(M),w=k===c?x.isActive:null;w===!1&&(g=v);let S=M===u[k]&&M!==l[k]&&C;if(S&&r&&e.manuallyAnimateOnMount&&(S=!1),x.protectedKeys={...y},!x.isActive&&w===null||!M&&!x.prevProp||Tn(M)||typeof M=="boolean")continue;const P=Ch(x.prevProp,M);let A=P||k===c&&x.isActive&&!S&&C||v>g&&C,D=!1;const L=Array.isArray(M)?M:[M];let I=L.reduce(o(k),{});w===!1&&(I={});const{prevResolvedValues:N={}}=x,B={...N,...I},F=O=>{A=!0,p.has(O)&&(D=!0,p.delete(O)),x.needsAnimating[O]=!0;const R=e.getValue(O);R&&(R.liveStyle=!1)};for(const O in B){const R=I[O],T=N[O];if(y.hasOwnProperty(O))continue;let _=!1;dr(R)&&dr(T)?_=!na(R,T):_=R!==T,_?R!=null?F(O):p.add(O):R!==void 0&&p.has(O)?F(O):x.protectedKeys[O]=!0}x.prevProp=M,x.prevResolvedValues=I,x.isActive&&(y={...y,...I}),r&&e.blockInitialAnimation&&(A=!1),A&&(!(S&&P)||D)&&d.push(...L.map(O=>({animation:O,options:{type:k}})))}if(p.size){const v={};p.forEach(k=>{const x=e.getBaseTarget(k),M=e.getValue(k);M&&(M.liveStyle=!0),v[k]=x??null}),d.push({animation:v})}let m=!!d.length;return r&&(l.initial===!1||l.initial===l.animate)&&!e.manuallyAnimateOnMount&&(m=!1),r=!1,m?t(d):Promise.resolve()}function a(c,l){var u;if(n[c].isActive===l)return Promise.resolve();(u=e.variantChildren)===null||u===void 0||u.forEach(p=>{var y;return(y=p.animationState)===null||y===void 0?void 0:y.setActive(c,l)}),n[c].isActive=l;const d=i(c);for(const p in n)n[p].protectedKeys={};return d}return{animateChanges:i,setActive:a,setAnimateFunction:s,getState:()=>n,reset:()=>{n=ps(),r=!0}}}function Ch(e,t){return typeof t=="string"?t!==e:Array.isArray(t)?!na(t,e):!1}function Fe(e=!1){return{isActive:e,protectedKeys:{},needsAnimating:{},prevResolvedValues:{}}}function ps(){return{animate:Fe(!0),whileInView:Fe(),whileHover:Fe(),whileTap:Fe(),whileDrag:Fe(),whileFocus:Fe(),exit:Fe()}}class Oe{constructor(t){this.isMounted=!1,this.node=t}update(){}}class Sh extends Oe{constructor(t){super(t),t.animationState||(t.animationState=bh(t))}updateAnimationControlsSubscription(){const{animate:t}=this.node.getProps();Tn(t)&&(this.unmountControls=t.subscribe(this.node))}mount(){this.updateAnimationControlsSubscription()}update(){const{animate:t}=this.node.getProps(),{animate:n}=this.node.prevProps||{};t!==n&&this.updateAnimationControlsSubscription()}unmount(){var t;this.node.animationState.reset(),(t=this.unmountControls)===null||t===void 0||t.call(this)}}let Ph=0;class Ah extends Oe{constructor(){super(...arguments),this.id=Ph++}update(){if(!this.node.presenceContext)return;const{isPresent:t,onExitComplete:n}=this.node.presenceContext,{isPresent:r}=this.node.prevPresenceContext||{};if(!this.node.animationState||t===r)return;const o=this.node.animationState.setActive("exit",!t);n&&!t&&o.then(()=>n(this.id))}mount(){const{register:t}=this.node.presenceContext||{};t&&(this.unmount=t(this.id))}unmount(){}}const Th={animation:{Feature:Sh},exit:{Feature:Ah}};function Lt(e,t,n,r={passive:!0}){return e.addEventListener(t,n,r),()=>e.removeEventListener(t,n)}function Bt(e){return{point:{x:e.pageX,y:e.pageY}}}const Rh=e=>t=>to(t)&&e(t,Bt(t));function St(e,t,n,r){return Lt(e,t,Rh(n),r)}const ys=(e,t)=>Math.abs(e-t);function Eh(e,t){const n=ys(e.x,t.x),r=ys(e.y,t.y);return Math.sqrt(n**2+r**2)}class Ua{constructor(t,n,{transformPagePoint:r,contextWindow:o,dragSnapToOrigin:s=!1}={}){if(this.startEvent=null,this.lastMoveEvent=null,this.lastMoveEventInfo=null,this.handlers={},this.contextWindow=window,this.updatePoint=()=>{if(!(this.lastMoveEvent&&this.lastMoveEventInfo))return;const d=Gn(this.lastMoveEventInfo,this.history),p=this.startEvent!==null,y=Eh(d.offset,{x:0,y:0})>=3;if(!p&&!y)return;const{point:g}=d,{timestamp:m}=K;this.history.push({...g,timestamp:m});const{onStart:v,onMove:k}=this.handlers;p||(v&&v(this.lastMoveEvent,d),this.startEvent=this.lastMoveEvent),k&&k(this.lastMoveEvent,d)},this.handlePointerMove=(d,p)=>{this.lastMoveEvent=d,this.lastMoveEventInfo=Kn(p,this.transformPagePoint),z.update(this.updatePoint,!0)},this.handlePointerUp=(d,p)=>{this.end();const{onEnd:y,onSessionEnd:g,resumeAnimation:m}=this.handlers;if(this.dragSnapToOrigin&&m&&m(),!(this.lastMoveEvent&&this.lastMoveEventInfo))return;const v=Gn(d.type==="pointercancel"?this.lastMoveEventInfo:Kn(p,this.transformPagePoint),this.history);this.startEvent&&y&&y(d,v),g&&g(d,v)},!to(t))return;this.dragSnapToOrigin=s,this.handlers=n,this.transformPagePoint=r,this.contextWindow=o||window;const i=Bt(t),a=Kn(i,this.transformPagePoint),{point:c}=a,{timestamp:l}=K;this.history=[{...c,timestamp:l}];const{onSessionStart:u}=n;u&&u(t,Gn(a,this.history)),this.removeListeners=_t(St(this.contextWindow,"pointermove",this.handlePointerMove),St(this.contextWindow,"pointerup",this.handlePointerUp),St(this.contextWindow,"pointercancel",this.handlePointerUp))}updateHandlers(t){this.handlers=t}end(){this.removeListeners&&this.removeListeners(),Re(this.updatePoint)}}function Kn(e,t){return t?{point:t(e.point)}:e}function ms(e,t){return{x:e.x-t.x,y:e.y-t.y}}function Gn({point:e},t){return{point:e,delta:ms(e,$a(t)),offset:ms(e,Dh(t)),velocity:Lh(t,.1)}}function Dh(e){return e[0]}function $a(e){return e[e.length-1]}function Lh(e,t){if(e.length<2)return{x:0,y:0};let n=e.length-1,r=null;const o=$a(e);for(;n>=0&&(r=e[n],!(o.timestamp-r.timestamp>ke(t)));)n--;if(!r)return{x:0,y:0};const s=xe(o.timestamp-r.timestamp);if(s===0)return{x:0,y:0};const i={x:(o.x-r.x)/s,y:(o.y-r.y)/s};return i.x===1/0&&(i.x=0),i.y===1/0&&(i.y=0),i}const Wa=1e-4,Vh=1-Wa,Oh=1+Wa,Ka=.01,Ih=0-Ka,jh=0+Ka;function ne(e){return e.max-e.min}function Fh(e,t,n){return Math.abs(e-t)<=n}function gs(e,t,n,r=.5){e.origin=r,e.originPoint=H(t.min,t.max,e.origin),e.scale=ne(n)/ne(t),e.translate=H(n.min,n.max,e.origin)-e.originPoint,(e.scale>=Vh&&e.scale<=Oh||isNaN(e.scale))&&(e.scale=1),(e.translate>=Ih&&e.translate<=jh||isNaN(e.translate))&&(e.translate=0)}function Pt(e,t,n,r){gs(e.x,t.x,n.x,r?r.originX:void 0),gs(e.y,t.y,n.y,r?r.originY:void 0)}function vs(e,t,n){e.min=n.min+t.min,e.max=e.min+ne(t)}function Nh(e,t,n){vs(e.x,t.x,n.x),vs(e.y,t.y,n.y)}function ks(e,t,n){e.min=t.min-n.min,e.max=e.min+ne(t)}function At(e,t,n){ks(e.x,t.x,n.x),ks(e.y,t.y,n.y)}function _h(e,{min:t,max:n},r){return t!==void 0&&e<t?e=r?H(t,e,r.min):Math.max(e,t):n!==void 0&&e>n&&(e=r?H(n,e,r.max):Math.min(e,n)),e}function xs(e,t,n){return{min:t!==void 0?e.min+t:void 0,max:n!==void 0?e.max+n-(e.max-e.min):void 0}}function Bh(e,{top:t,left:n,bottom:r,right:o}){return{x:xs(e.x,n,o),y:xs(e.y,t,r)}}function Ms(e,t){let n=t.min-e.min,r=t.max-e.max;return t.max-t.min<e.max-e.min&&([n,r]=[r,n]),{min:n,max:r}}function zh(e,t){return{x:Ms(e.x,t.x),y:Ms(e.y,t.y)}}function Hh(e,t){let n=.5;const r=ne(e),o=ne(t);return o>r?n=st(t.min,t.max-r,e.min):r>o&&(n=st(e.min,e.max-o,t.min)),we(0,1,n)}function qh(e,t){const n={};return t.min!==void 0&&(n.min=t.min-e.min),t.max!==void 0&&(n.max=t.max-e.min),n}const wr=.35;function Uh(e=wr){return e===!1?e=0:e===!0&&(e=wr),{x:ws(e,"left","right"),y:ws(e,"top","bottom")}}function ws(e,t,n){return{min:bs(e,t),max:bs(e,n)}}function bs(e,t){return typeof e=="number"?e:e[t]||0}const Cs=()=>({translate:0,scale:1,origin:0,originPoint:0}),Je=()=>({x:Cs(),y:Cs()}),Ss=()=>({min:0,max:0}),U=()=>({x:Ss(),y:Ss()});function se(e){return[e("x"),e("y")]}function Ga({top:e,left:t,right:n,bottom:r}){return{x:{min:t,max:n},y:{min:e,max:r}}}function $h({x:e,y:t}){return{top:t.min,right:e.max,bottom:t.max,left:e.min}}function Wh(e,t){if(!t)return e;const n=t({x:e.left,y:e.top}),r=t({x:e.right,y:e.bottom});return{top:n.y,left:n.x,bottom:r.y,right:r.x}}function Zn(e){return e===void 0||e===1}function br({scale:e,scaleX:t,scaleY:n}){return!Zn(e)||!Zn(t)||!Zn(n)}function Ne(e){return br(e)||Za(e)||e.z||e.rotate||e.rotateX||e.rotateY||e.skewX||e.skewY}function Za(e){return Ps(e.x)||Ps(e.y)}function Ps(e){return e&&e!=="0%"}function mn(e,t,n){const r=e-n,o=t*r;return n+o}function As(e,t,n,r,o){return o!==void 0&&(e=mn(e,o,r)),mn(e,n,r)+t}function Cr(e,t=0,n=1,r,o){e.min=As(e.min,t,n,r,o),e.max=As(e.max,t,n,r,o)}function Xa(e,{x:t,y:n}){Cr(e.x,t.translate,t.scale,t.originPoint),Cr(e.y,n.translate,n.scale,n.originPoint)}const Ts=.999999999999,Rs=1.0000000000001;function Kh(e,t,n,r=!1){const o=n.length;if(!o)return;t.x=t.y=1;let s,i;for(let a=0;a<o;a++){s=n[a],i=s.projectionDelta;const{visualElement:c}=s.options;c&&c.props.style&&c.props.style.display==="contents"||(r&&s.options.layoutScroll&&s.scroll&&s!==s.root&&tt(e,{x:-s.scroll.offset.x,y:-s.scroll.offset.y}),i&&(t.x*=i.x.scale,t.y*=i.y.scale,Xa(e,i)),r&&Ne(s.latestValues)&&tt(e,s.latestValues))}t.x<Rs&&t.x>Ts&&(t.x=1),t.y<Rs&&t.y>Ts&&(t.y=1)}function et(e,t){e.min=e.min+t,e.max=e.max+t}function Es(e,t,n,r,o=.5){const s=H(e.min,e.max,o);Cr(e,t,n,s,r)}function tt(e,t){Es(e.x,t.x,t.scaleX,t.scale,t.originX),Es(e.y,t.y,t.scaleY,t.scale,t.originY)}function Ya(e,t){return Ga(Wh(e.getBoundingClientRect(),t))}function Gh(e,t,n){const r=Ya(e,n),{scroll:o}=t;return o&&(et(r.x,o.offset.x),et(r.y,o.offset.y)),r}const Qa=({current:e})=>e?e.ownerDocument.defaultView:null,Zh=new WeakMap;class Xh{constructor(t){this.openDragLock=null,this.isDragging=!1,this.currentDirection=null,this.originPoint={x:0,y:0},this.constraints=!1,this.hasMutatedConstraints=!1,this.elastic=U(),this.visualElement=t}start(t,{snapToCursor:n=!1}={}){const{presenceContext:r}=this.visualElement;if(r&&r.isPresent===!1)return;const o=u=>{const{dragSnapToOrigin:d}=this.getProps();d?this.pauseAnimation():this.stopAnimation(),n&&this.snapToCursor(Bt(u).point)},s=(u,d)=>{const{drag:p,dragPropagation:y,onDragStart:g}=this.getProps();if(p&&!y&&(this.openDragLock&&this.openDragLock(),this.openDragLock=H1(p),!this.openDragLock))return;this.isDragging=!0,this.currentDirection=null,this.resolveConstraints(),this.visualElement.projection&&(this.visualElement.projection.isAnimationBlocked=!0,this.visualElement.projection.target=void 0),se(v=>{let k=this.getAxisMotionValue(v).get()||0;if(fe.test(k)){const{projection:x}=this.visualElement;if(x&&x.layout){const M=x.layout.layoutBox[v];M&&(k=ne(M)*(parseFloat(k)/100))}}this.originPoint[v]=k}),g&&z.postRender(()=>g(u,d)),pr(this.visualElement,"transform");const{animationState:m}=this.visualElement;m&&m.setActive("whileDrag",!0)},i=(u,d)=>{const{dragPropagation:p,dragDirectionLock:y,onDirectionLock:g,onDrag:m}=this.getProps();if(!p&&!this.openDragLock)return;const{offset:v}=d;if(y&&this.currentDirection===null){this.currentDirection=Yh(v),this.currentDirection!==null&&g&&g(this.currentDirection);return}this.updateAxis("x",d.point,v),this.updateAxis("y",d.point,v),this.visualElement.render(),m&&m(u,d)},a=(u,d)=>this.stop(u,d),c=()=>se(u=>{var d;return this.getAnimationState(u)==="paused"&&((d=this.getAxisMotionValue(u).animation)===null||d===void 0?void 0:d.play())}),{dragSnapToOrigin:l}=this.getProps();this.panSession=new Ua(t,{onSessionStart:o,onStart:s,onMove:i,onSessionEnd:a,resumeAnimation:c},{transformPagePoint:this.visualElement.getTransformPagePoint(),dragSnapToOrigin:l,contextWindow:Qa(this.visualElement)})}stop(t,n){const r=this.isDragging;if(this.cancel(),!r)return;const{velocity:o}=n;this.startAnimation(o);const{onDragEnd:s}=this.getProps();s&&z.postRender(()=>s(t,n))}cancel(){this.isDragging=!1;const{projection:t,animationState:n}=this.visualElement;t&&(t.isAnimationBlocked=!1),this.panSession&&this.panSession.end(),this.panSession=void 0;const{dragPropagation:r}=this.getProps();!r&&this.openDragLock&&(this.openDragLock(),this.openDragLock=null),n&&n.setActive("whileDrag",!1)}updateAxis(t,n,r){const{drag:o}=this.getProps();if(!r||!Yt(t,o,this.currentDirection))return;const s=this.getAxisMotionValue(t);let i=this.originPoint[t]+r[t];this.constraints&&this.constraints[t]&&(i=_h(i,this.constraints[t],this.elastic[t])),s.set(i)}resolveConstraints(){var t;const{dragConstraints:n,dragElastic:r}=this.getProps(),o=this.visualElement.projection&&!this.visualElement.projection.layout?this.visualElement.projection.measure(!1):(t=this.visualElement.projection)===null||t===void 0?void 0:t.layout,s=this.constraints;n&&Ye(n)?this.constraints||(this.constraints=this.resolveRefConstraints()):n&&o?this.constraints=Bh(o.layoutBox,n):this.constraints=!1,this.elastic=Uh(r),s!==this.constraints&&o&&this.constraints&&!this.hasMutatedConstraints&&se(i=>{this.constraints!==!1&&this.getAxisMotionValue(i)&&(this.constraints[i]=qh(o.layoutBox[i],this.constraints[i]))})}resolveRefConstraints(){const{dragConstraints:t,onMeasureDragConstraints:n}=this.getProps();if(!t||!Ye(t))return!1;const r=t.current,{projection:o}=this.visualElement;if(!o||!o.layout)return!1;const s=Gh(r,o.root,this.visualElement.getTransformPagePoint());let i=zh(o.layout.layoutBox,s);if(n){const a=n($h(i));this.hasMutatedConstraints=!!a,a&&(i=Ga(a))}return i}startAnimation(t){const{drag:n,dragMomentum:r,dragElastic:o,dragTransition:s,dragSnapToOrigin:i,onDragTransitionEnd:a}=this.getProps(),c=this.constraints||{},l=se(u=>{if(!Yt(u,n,this.currentDirection))return;let d=c&&c[u]||{};i&&(d={min:0,max:0});const p=o?200:1e6,y=o?40:1e7,g={type:"inertia",velocity:r?t[u]:0,bounceStiffness:p,bounceDamping:y,timeConstant:750,restDelta:1,restSpeed:10,...s,...d};return this.startAxisValueAnimation(u,g)});return Promise.all(l).then(a)}startAxisValueAnimation(t,n){const r=this.getAxisMotionValue(t);return pr(this.visualElement,t),r.start(po(t,r,0,n,this.visualElement,!1))}stopAnimation(){se(t=>this.getAxisMotionValue(t).stop())}pauseAnimation(){se(t=>{var n;return(n=this.getAxisMotionValue(t).animation)===null||n===void 0?void 0:n.pause()})}getAnimationState(t){var n;return(n=this.getAxisMotionValue(t).animation)===null||n===void 0?void 0:n.state}getAxisMotionValue(t){const n=`_drag${t.toUpperCase()}`,r=this.visualElement.getProps(),o=r[n];return o||this.visualElement.getValue(t,(r.initial?r.initial[t]:void 0)||0)}snapToCursor(t){se(n=>{const{drag:r}=this.getProps();if(!Yt(n,r,this.currentDirection))return;const{projection:o}=this.visualElement,s=this.getAxisMotionValue(n);if(o&&o.layout){const{min:i,max:a}=o.layout.layoutBox[n];s.set(t[n]-H(i,a,.5))}})}scalePositionWithinConstraints(){if(!this.visualElement.current)return;const{drag:t,dragConstraints:n}=this.getProps(),{projection:r}=this.visualElement;if(!Ye(n)||!r||!this.constraints)return;this.stopAnimation();const o={x:0,y:0};se(i=>{const a=this.getAxisMotionValue(i);if(a&&this.constraints!==!1){const c=a.get();o[i]=Hh({min:c,max:c},this.constraints[i])}});const{transformTemplate:s}=this.visualElement.getProps();this.visualElement.current.style.transform=s?s({},""):"none",r.root&&r.root.updateScroll(),r.updateLayout(),this.resolveConstraints(),se(i=>{if(!Yt(i,t,null))return;const a=this.getAxisMotionValue(i),{min:c,max:l}=this.constraints[i];a.set(H(c,l,o[i]))})}addListeners(){if(!this.visualElement.current)return;Zh.set(this.visualElement,this);const t=this.visualElement.current,n=St(t,"pointerdown",c=>{const{drag:l,dragListener:u=!0}=this.getProps();l&&u&&this.start(c)}),r=()=>{const{dragConstraints:c}=this.getProps();Ye(c)&&c.current&&(this.constraints=this.resolveRefConstraints())},{projection:o}=this.visualElement,s=o.addEventListener("measure",r);o&&!o.layout&&(o.root&&o.root.updateScroll(),o.updateLayout()),z.read(r);const i=Lt(window,"resize",()=>this.scalePositionWithinConstraints()),a=o.addEventListener("didUpdate",({delta:c,hasLayoutChanged:l})=>{this.isDragging&&l&&(se(u=>{const d=this.getAxisMotionValue(u);d&&(this.originPoint[u]+=c[u].translate,d.set(d.get()+c[u].translate))}),this.visualElement.render())});return()=>{i(),n(),s(),a&&a()}}getProps(){const t=this.visualElement.getProps(),{drag:n=!1,dragDirectionLock:r=!1,dragPropagation:o=!1,dragConstraints:s=!1,dragElastic:i=wr,dragMomentum:a=!0}=t;return{...t,drag:n,dragDirectionLock:r,dragPropagation:o,dragConstraints:s,dragElastic:i,dragMomentum:a}}}function Yt(e,t,n){return(t===!0||t===e)&&(n===null||n===e)}function Yh(e,t=10){let n=null;return Math.abs(e.y)>t?n="y":Math.abs(e.x)>t&&(n="x"),n}class Qh extends Oe{constructor(t){super(t),this.removeGroupControls=ee,this.removeListeners=ee,this.controls=new Xh(t)}mount(){const{dragControls:t}=this.node.getProps();t&&(this.removeGroupControls=t.subscribe(this.controls)),this.removeListeners=this.controls.addListeners()||ee}unmount(){this.removeGroupControls(),this.removeListeners()}}const Ds=e=>(t,n)=>{e&&z.postRender(()=>e(t,n))};class Jh extends Oe{constructor(){super(...arguments),this.removePointerDownListener=ee}onPointerDown(t){this.session=new Ua(t,this.createPanHandlers(),{transformPagePoint:this.node.getTransformPagePoint(),contextWindow:Qa(this.node)})}createPanHandlers(){const{onPanSessionStart:t,onPanStart:n,onPan:r,onPanEnd:o}=this.node.getProps();return{onSessionStart:Ds(t),onStart:Ds(n),onMove:r,onEnd:(s,i)=>{delete this.session,o&&z.postRender(()=>o(s,i))}}}mount(){this.removePointerDownListener=St(this.node.current,"pointerdown",t=>this.onPointerDown(t))}update(){this.session&&this.session.updateHandlers(this.createPanHandlers())}unmount(){this.removePointerDownListener(),this.session&&this.session.end()}}const sn={hasAnimatedSinceResize:!0,hasEverUpdated:!1};function Ls(e,t){return t.max===t.min?0:e/(t.max-t.min)*100}const kt={correct:(e,t)=>{if(!t.target)return e;if(typeof e=="string")if(E.test(e))e=parseFloat(e);else return e;const n=Ls(e,t.target.x),r=Ls(e,t.target.y);return`${n}% ${r}%`}},ef={correct:(e,{treeScale:t,projectionDelta:n})=>{const r=e,o=Ee.parse(e);if(o.length>5)return r;const s=Ee.createTransformer(e),i=typeof o[0]!="number"?1:0,a=n.x.scale*t.x,c=n.y.scale*t.y;o[0+i]/=a,o[1+i]/=c;const l=H(a,c,.5);return typeof o[2+i]=="number"&&(o[2+i]/=l),typeof o[3+i]=="number"&&(o[3+i]/=l),s(o)}};class tf extends h.Component{componentDidMount(){const{visualElement:t,layoutGroup:n,switchLayoutGroup:r,layoutId:o}=this.props,{projection:s}=t;M1(nf),s&&(n.group&&n.group.add(s),r&&r.register&&o&&r.register(s),s.root.didUpdate(),s.addEventListener("animationComplete",()=>{this.safeToRemove()}),s.setOptions({...s.options,onExitComplete:()=>this.safeToRemove()})),sn.hasEverUpdated=!0}getSnapshotBeforeUpdate(t){const{layoutDependency:n,visualElement:r,drag:o,isPresent:s}=this.props,i=r.projection;return i&&(i.isPresent=s,o||t.layoutDependency!==n||n===void 0?i.willUpdate():this.safeToRemove(),t.isPresent!==s&&(s?i.promote():i.relegate()||z.postRender(()=>{const a=i.getStack();(!a||!a.members.length)&&this.safeToRemove()}))),null}componentDidUpdate(){const{projection:t}=this.props.visualElement;t&&(t.root.didUpdate(),Hr.postRender(()=>{!t.currentAnimation&&t.isLead()&&this.safeToRemove()}))}componentWillUnmount(){const{visualElement:t,layoutGroup:n,switchLayoutGroup:r}=this.props,{projection:o}=t;o&&(o.scheduleCheckAfterUnmount(),n&&n.group&&n.group.remove(o),r&&r.deregister&&r.deregister(o))}safeToRemove(){const{safeToRemove:t}=this.props;t&&t()}render(){return null}}function Ja(e){const[t,n]=Ii(),r=h.useContext(Or);return b.jsx(tf,{...e,layoutGroup:r,switchLayoutGroup:h.useContext(qi),isPresent:t,safeToRemove:n})}const nf={borderRadius:{...kt,applyTo:["borderTopLeftRadius","borderTopRightRadius","borderBottomLeftRadius","borderBottomRightRadius"]},borderTopLeftRadius:kt,borderTopRightRadius:kt,borderBottomLeftRadius:kt,borderBottomRightRadius:kt,boxShadow:ef};function rf(e,t,n){const r=X(e)?e:Et(e);return r.start(po("",r,t,n)),r.animation}function of(e){return e instanceof SVGElement&&e.tagName!=="svg"}const sf=(e,t)=>e.depth-t.depth;class af{constructor(){this.children=[],this.isDirty=!1}add(t){no(this.children,t),this.isDirty=!0}remove(t){ro(this.children,t),this.isDirty=!0}forEach(t){this.isDirty&&this.children.sort(sf),this.isDirty=!1,this.children.forEach(t)}}function cf(e,t){const n=pe.now(),r=({timestamp:o})=>{const s=o-n;s>=t&&(Re(r),e(s-t))};return z.read(r,!0),()=>Re(r)}const ec=["TopLeft","TopRight","BottomLeft","BottomRight"],lf=ec.length,Vs=e=>typeof e=="string"?parseFloat(e):e,Os=e=>typeof e=="number"||E.test(e);function uf(e,t,n,r,o,s){o?(e.opacity=H(0,n.opacity!==void 0?n.opacity:1,df(r)),e.opacityExit=H(t.opacity!==void 0?t.opacity:1,0,hf(r))):s&&(e.opacity=H(t.opacity!==void 0?t.opacity:1,n.opacity!==void 0?n.opacity:1,r));for(let i=0;i<lf;i++){const a=`border${ec[i]}Radius`;let c=Is(t,a),l=Is(n,a);if(c===void 0&&l===void 0)continue;c||(c=0),l||(l=0),c===0||l===0||Os(c)===Os(l)?(e[a]=Math.max(H(Vs(c),Vs(l),r),0),(fe.test(l)||fe.test(c))&&(e[a]+="%")):e[a]=l}(t.rotate||n.rotate)&&(e.rotate=H(t.rotate||0,n.rotate||0,r))}function Is(e,t){return e[t]!==void 0?e[t]:e.borderRadius}const df=tc(0,.5,ka),hf=tc(.5,.95,ee);function tc(e,t,n){return r=>r<e?0:r>t?1:n(st(e,t,r))}function js(e,t){e.min=t.min,e.max=t.max}function oe(e,t){js(e.x,t.x),js(e.y,t.y)}function Fs(e,t){e.translate=t.translate,e.scale=t.scale,e.originPoint=t.originPoint,e.origin=t.origin}function Ns(e,t,n,r,o){return e-=t,e=mn(e,1/n,r),o!==void 0&&(e=mn(e,1/o,r)),e}function ff(e,t=0,n=1,r=.5,o,s=e,i=e){if(fe.test(t)&&(t=parseFloat(t),t=H(i.min,i.max,t/100)-i.min),typeof t!="number")return;let a=H(s.min,s.max,r);e===s&&(a-=t),e.min=Ns(e.min,t,n,a,o),e.max=Ns(e.max,t,n,a,o)}function _s(e,t,[n,r,o],s,i){ff(e,t[n],t[r],t[o],t.scale,s,i)}const pf=["x","scaleX","originX"],yf=["y","scaleY","originY"];function Bs(e,t,n,r){_s(e.x,t,pf,n?n.x:void 0,r?r.x:void 0),_s(e.y,t,yf,n?n.y:void 0,r?r.y:void 0)}function zs(e){return e.translate===0&&e.scale===1}function nc(e){return zs(e.x)&&zs(e.y)}function Hs(e,t){return e.min===t.min&&e.max===t.max}function mf(e,t){return Hs(e.x,t.x)&&Hs(e.y,t.y)}function qs(e,t){return Math.round(e.min)===Math.round(t.min)&&Math.round(e.max)===Math.round(t.max)}function rc(e,t){return qs(e.x,t.x)&&qs(e.y,t.y)}function Us(e){return ne(e.x)/ne(e.y)}function $s(e,t){return e.translate===t.translate&&e.scale===t.scale&&e.originPoint===t.originPoint}class gf{constructor(){this.members=[]}add(t){no(this.members,t),t.scheduleRender()}remove(t){if(ro(this.members,t),t===this.prevLead&&(this.prevLead=void 0),t===this.lead){const n=this.members[this.members.length-1];n&&this.promote(n)}}relegate(t){const n=this.members.findIndex(o=>t===o);if(n===0)return!1;let r;for(let o=n;o>=0;o--){const s=this.members[o];if(s.isPresent!==!1){r=s;break}}return r?(this.promote(r),!0):!1}promote(t,n){const r=this.lead;if(t!==r&&(this.prevLead=r,this.lead=t,t.show(),r)){r.instance&&r.scheduleRender(),t.scheduleRender(),t.resumeFrom=r,n&&(t.resumeFrom.preserveOpacity=!0),r.snapshot&&(t.snapshot=r.snapshot,t.snapshot.latestValues=r.animationValues||r.latestValues),t.root&&t.root.isUpdating&&(t.isLayoutDirty=!0);const{crossfade:o}=t.options;o===!1&&r.hide()}}exitAnimationComplete(){this.members.forEach(t=>{const{options:n,resumingFrom:r}=t;n.onExitComplete&&n.onExitComplete(),r&&r.options.onExitComplete&&r.options.onExitComplete()})}scheduleRender(){this.members.forEach(t=>{t.instance&&t.scheduleRender(!1)})}removeLeadSnapshot(){this.lead&&this.lead.snapshot&&(this.lead.snapshot=void 0)}}function vf(e,t,n){let r="";const o=e.x.translate/t.x,s=e.y.translate/t.y,i=(n==null?void 0:n.z)||0;if((o||s||i)&&(r=`translate3d(${o}px, ${s}px, ${i}px) `),(t.x!==1||t.y!==1)&&(r+=`scale(${1/t.x}, ${1/t.y}) `),n){const{transformPerspective:l,rotate:u,rotateX:d,rotateY:p,skewX:y,skewY:g}=n;l&&(r=`perspective(${l}px) ${r}`),u&&(r+=`rotate(${u}deg) `),d&&(r+=`rotateX(${d}deg) `),p&&(r+=`rotateY(${p}deg) `),y&&(r+=`skewX(${y}deg) `),g&&(r+=`skewY(${g}deg) `)}const a=e.x.scale*t.x,c=e.y.scale*t.y;return(a!==1||c!==1)&&(r+=`scale(${a}, ${c})`),r||"none"}const _e={type:"projectionFrame",totalNodes:0,resolvedTargetDeltas:0,recalculatedProjection:0},wt=typeof window<"u"&&window.MotionDebug!==void 0,Xn=["","X","Y","Z"],kf={visibility:"hidden"},Ws=1e3;let xf=0;function Yn(e,t,n,r){const{latestValues:o}=t;o[e]&&(n[e]=o[e],t.setStaticValue(e,0),r&&(r[e]=0))}function oc(e){if(e.hasCheckedOptimisedAppear=!0,e.root===e)return;const{visualElement:t}=e.options;if(!t)return;const n=ha(t);if(window.MotionHasOptimisedAnimation(n,"transform")){const{layout:o,layoutId:s}=e.options;window.MotionCancelOptimisedAnimation(n,"transform",z,!(o||s))}const{parent:r}=e;r&&!r.hasCheckedOptimisedAppear&&oc(r)}function sc({attachResizeListener:e,defaultParent:t,measureScroll:n,checkIsScrollRoot:r,resetTransform:o}){return class{constructor(i={},a=t==null?void 0:t()){this.id=xf++,this.animationId=0,this.children=new Set,this.options={},this.isTreeAnimating=!1,this.isAnimationBlocked=!1,this.isLayoutDirty=!1,this.isProjectionDirty=!1,this.isSharedProjectionDirty=!1,this.isTransformDirty=!1,this.updateManuallyBlocked=!1,this.updateBlockedByResize=!1,this.isUpdating=!1,this.isSVG=!1,this.needsReset=!1,this.shouldResetTransform=!1,this.hasCheckedOptimisedAppear=!1,this.treeScale={x:1,y:1},this.eventHandlers=new Map,this.hasTreeAnimated=!1,this.updateScheduled=!1,this.scheduleUpdate=()=>this.update(),this.projectionUpdateScheduled=!1,this.checkUpdateFailed=()=>{this.isUpdating&&(this.isUpdating=!1,this.clearAllSnapshots())},this.updateProjection=()=>{this.projectionUpdateScheduled=!1,wt&&(_e.totalNodes=_e.resolvedTargetDeltas=_e.recalculatedProjection=0),this.nodes.forEach(bf),this.nodes.forEach(Tf),this.nodes.forEach(Rf),this.nodes.forEach(Cf),wt&&window.MotionDebug.record(_e)},this.resolvedRelativeTargetAt=0,this.hasProjected=!1,this.isVisible=!0,this.animationProgress=0,this.sharedNodes=new Map,this.latestValues=i,this.root=a?a.root||a:this,this.path=a?[...a.path,a]:[],this.parent=a,this.depth=a?a.depth+1:0;for(let c=0;c<this.path.length;c++)this.path[c].shouldResetTransform=!0;this.root===this&&(this.nodes=new af)}addEventListener(i,a){return this.eventHandlers.has(i)||this.eventHandlers.set(i,new oo),this.eventHandlers.get(i).add(a)}notifyListeners(i,...a){const c=this.eventHandlers.get(i);c&&c.notify(...a)}hasListeners(i){return this.eventHandlers.has(i)}mount(i,a=this.root.hasTreeAnimated){if(this.instance)return;this.isSVG=of(i),this.instance=i;const{layoutId:c,layout:l,visualElement:u}=this.options;if(u&&!u.current&&u.mount(i),this.root.nodes.add(this),this.parent&&this.parent.children.add(this),a&&(l||c)&&(this.isLayoutDirty=!0),e){let d;const p=()=>this.root.updateBlockedByResize=!1;e(i,()=>{this.root.updateBlockedByResize=!0,d&&d(),d=cf(p,250),sn.hasAnimatedSinceResize&&(sn.hasAnimatedSinceResize=!1,this.nodes.forEach(Gs))})}c&&this.root.registerSharedNode(c,this),this.options.animate!==!1&&u&&(c||l)&&this.addEventListener("didUpdate",({delta:d,hasLayoutChanged:p,hasRelativeTargetChanged:y,layout:g})=>{if(this.isTreeAnimationBlocked()){this.target=void 0,this.relativeTarget=void 0;return}const m=this.options.transition||u.getDefaultTransition()||Of,{onLayoutAnimationStart:v,onLayoutAnimationComplete:k}=u.getProps(),x=!this.targetLayout||!rc(this.targetLayout,g)||y,M=!p&&y;if(this.options.layoutRoot||this.resumeFrom&&this.resumeFrom.instance||M||p&&(x||!this.currentAnimation)){this.resumeFrom&&(this.resumingFrom=this.resumeFrom,this.resumingFrom.resumingFrom=void 0),this.setAnimationOrigin(d,M);const C={...Qr(m,"layout"),onPlay:v,onComplete:k};(u.shouldReduceMotion||this.options.layoutRoot)&&(C.delay=0,C.type=!1),this.startAnimation(C)}else p||Gs(this),this.isLead()&&this.options.onExitComplete&&this.options.onExitComplete();this.targetLayout=g})}unmount(){this.options.layoutId&&this.willUpdate(),this.root.nodes.remove(this);const i=this.getStack();i&&i.remove(this),this.parent&&this.parent.children.delete(this),this.instance=void 0,Re(this.updateProjection)}blockUpdate(){this.updateManuallyBlocked=!0}unblockUpdate(){this.updateManuallyBlocked=!1}isUpdateBlocked(){return this.updateManuallyBlocked||this.updateBlockedByResize}isTreeAnimationBlocked(){return this.isAnimationBlocked||this.parent&&this.parent.isTreeAnimationBlocked()||!1}startUpdate(){this.isUpdateBlocked()||(this.isUpdating=!0,this.nodes&&this.nodes.forEach(Ef),this.animationId++)}getTransformTemplate(){const{visualElement:i}=this.options;return i&&i.getProps().transformTemplate}willUpdate(i=!0){if(this.root.hasTreeAnimated=!0,this.root.isUpdateBlocked()){this.options.onExitComplete&&this.options.onExitComplete();return}if(window.MotionCancelOptimisedAnimation&&!this.hasCheckedOptimisedAppear&&oc(this),!this.root.isUpdating&&this.root.startUpdate(),this.isLayoutDirty)return;this.isLayoutDirty=!0;for(let u=0;u<this.path.length;u++){const d=this.path[u];d.shouldResetTransform=!0,d.updateScroll("snapshot"),d.options.layoutRoot&&d.willUpdate(!1)}const{layoutId:a,layout:c}=this.options;if(a===void 0&&!c)return;const l=this.getTransformTemplate();this.prevTransformTemplateValue=l?l(this.latestValues,""):void 0,this.updateSnapshot(),i&&this.notifyListeners("willUpdate")}update(){if(this.updateScheduled=!1,this.isUpdateBlocked()){this.unblockUpdate(),this.clearAllSnapshots(),this.nodes.forEach(Ks);return}this.isUpdating||this.nodes.forEach(Pf),this.isUpdating=!1,this.nodes.forEach(Af),this.nodes.forEach(Mf),this.nodes.forEach(wf),this.clearAllSnapshots();const a=pe.now();K.delta=we(0,1e3/60,a-K.timestamp),K.timestamp=a,K.isProcessing=!0,zn.update.process(K),zn.preRender.process(K),zn.render.process(K),K.isProcessing=!1}didUpdate(){this.updateScheduled||(this.updateScheduled=!0,Hr.read(this.scheduleUpdate))}clearAllSnapshots(){this.nodes.forEach(Sf),this.sharedNodes.forEach(Df)}scheduleUpdateProjection(){this.projectionUpdateScheduled||(this.projectionUpdateScheduled=!0,z.preRender(this.updateProjection,!1,!0))}scheduleCheckAfterUnmount(){z.postRender(()=>{this.isLayoutDirty?this.root.didUpdate():this.root.checkUpdateFailed()})}updateSnapshot(){this.snapshot||!this.instance||(this.snapshot=this.measure())}updateLayout(){if(!this.instance||(this.updateScroll(),!(this.options.alwaysMeasureLayout&&this.isLead())&&!this.isLayoutDirty))return;if(this.resumeFrom&&!this.resumeFrom.instance)for(let c=0;c<this.path.length;c++)this.path[c].updateScroll();const i=this.layout;this.layout=this.measure(!1),this.layoutCorrected=U(),this.isLayoutDirty=!1,this.projectionDelta=void 0,this.notifyListeners("measure",this.layout.layoutBox);const{visualElement:a}=this.options;a&&a.notify("LayoutMeasure",this.layout.layoutBox,i?i.layoutBox:void 0)}updateScroll(i="measure"){let a=!!(this.options.layoutScroll&&this.instance);if(this.scroll&&this.scroll.animationId===this.root.animationId&&this.scroll.phase===i&&(a=!1),a){const c=r(this.instance);this.scroll={animationId:this.root.animationId,phase:i,isRoot:c,offset:n(this.instance),wasRoot:this.scroll?this.scroll.isRoot:c}}}resetTransform(){if(!o)return;const i=this.isLayoutDirty||this.shouldResetTransform||this.options.alwaysMeasureLayout,a=this.projectionDelta&&!nc(this.projectionDelta),c=this.getTransformTemplate(),l=c?c(this.latestValues,""):void 0,u=l!==this.prevTransformTemplateValue;i&&(a||Ne(this.latestValues)||u)&&(o(this.instance,l),this.shouldResetTransform=!1,this.scheduleRender())}measure(i=!0){const a=this.measurePageBox();let c=this.removeElementScroll(a);return i&&(c=this.removeTransform(c)),If(c),{animationId:this.root.animationId,measuredBox:a,layoutBox:c,latestValues:{},source:this.id}}measurePageBox(){var i;const{visualElement:a}=this.options;if(!a)return U();const c=a.measureViewportBox();if(!(((i=this.scroll)===null||i===void 0?void 0:i.wasRoot)||this.path.some(jf))){const{scroll:u}=this.root;u&&(et(c.x,u.offset.x),et(c.y,u.offset.y))}return c}removeElementScroll(i){var a;const c=U();if(oe(c,i),!((a=this.scroll)===null||a===void 0)&&a.wasRoot)return c;for(let l=0;l<this.path.length;l++){const u=this.path[l],{scroll:d,options:p}=u;u!==this.root&&d&&p.layoutScroll&&(d.wasRoot&&oe(c,i),et(c.x,d.offset.x),et(c.y,d.offset.y))}return c}applyTransform(i,a=!1){const c=U();oe(c,i);for(let l=0;l<this.path.length;l++){const u=this.path[l];!a&&u.options.layoutScroll&&u.scroll&&u!==u.root&&tt(c,{x:-u.scroll.offset.x,y:-u.scroll.offset.y}),Ne(u.latestValues)&&tt(c,u.latestValues)}return Ne(this.latestValues)&&tt(c,this.latestValues),c}removeTransform(i){const a=U();oe(a,i);for(let c=0;c<this.path.length;c++){const l=this.path[c];if(!l.instance||!Ne(l.latestValues))continue;br(l.latestValues)&&l.updateSnapshot();const u=U(),d=l.measurePageBox();oe(u,d),Bs(a,l.latestValues,l.snapshot?l.snapshot.layoutBox:void 0,u)}return Ne(this.latestValues)&&Bs(a,this.latestValues),a}setTargetDelta(i){this.targetDelta=i,this.root.scheduleUpdateProjection(),this.isProjectionDirty=!0}setOptions(i){this.options={...this.options,...i,crossfade:i.crossfade!==void 0?i.crossfade:!0}}clearMeasurements(){this.scroll=void 0,this.layout=void 0,this.snapshot=void 0,this.prevTransformTemplateValue=void 0,this.targetDelta=void 0,this.target=void 0,this.isLayoutDirty=!1}forceRelativeParentToResolveTarget(){this.relativeParent&&this.relativeParent.resolvedRelativeTargetAt!==K.timestamp&&this.relativeParent.resolveTargetDelta(!0)}resolveTargetDelta(i=!1){var a;const c=this.getLead();this.isProjectionDirty||(this.isProjectionDirty=c.isProjectionDirty),this.isTransformDirty||(this.isTransformDirty=c.isTransformDirty),this.isSharedProjectionDirty||(this.isSharedProjectionDirty=c.isSharedProjectionDirty);const l=!!this.resumingFrom||this!==c;if(!(i||l&&this.isSharedProjectionDirty||this.isProjectionDirty||!((a=this.parent)===null||a===void 0)&&a.isProjectionDirty||this.attemptToResolveRelativeTarget||this.root.updateBlockedByResize))return;const{layout:d,layoutId:p}=this.options;if(!(!this.layout||!(d||p))){if(this.resolvedRelativeTargetAt=K.timestamp,!this.targetDelta&&!this.relativeTarget){const y=this.getClosestProjectingParent();y&&y.layout&&this.animationProgress!==1?(this.relativeParent=y,this.forceRelativeParentToResolveTarget(),this.relativeTarget=U(),this.relativeTargetOrigin=U(),At(this.relativeTargetOrigin,this.layout.layoutBox,y.layout.layoutBox),oe(this.relativeTarget,this.relativeTargetOrigin)):this.relativeParent=this.relativeTarget=void 0}if(!(!this.relativeTarget&&!this.targetDelta)){if(this.target||(this.target=U(),this.targetWithTransforms=U()),this.relativeTarget&&this.relativeTargetOrigin&&this.relativeParent&&this.relativeParent.target?(this.forceRelativeParentToResolveTarget(),Nh(this.target,this.relativeTarget,this.relativeParent.target)):this.targetDelta?(this.resumingFrom?this.target=this.applyTransform(this.layout.layoutBox):oe(this.target,this.layout.layoutBox),Xa(this.target,this.targetDelta)):oe(this.target,this.layout.layoutBox),this.attemptToResolveRelativeTarget){this.attemptToResolveRelativeTarget=!1;const y=this.getClosestProjectingParent();y&&!!y.resumingFrom==!!this.resumingFrom&&!y.options.layoutScroll&&y.target&&this.animationProgress!==1?(this.relativeParent=y,this.forceRelativeParentToResolveTarget(),this.relativeTarget=U(),this.relativeTargetOrigin=U(),At(this.relativeTargetOrigin,this.target,y.target),oe(this.relativeTarget,this.relativeTargetOrigin)):this.relativeParent=this.relativeTarget=void 0}wt&&_e.resolvedTargetDeltas++}}}getClosestProjectingParent(){if(!(!this.parent||br(this.parent.latestValues)||Za(this.parent.latestValues)))return this.parent.isProjecting()?this.parent:this.parent.getClosestProjectingParent()}isProjecting(){return!!((this.relativeTarget||this.targetDelta||this.options.layoutRoot)&&this.layout)}calcProjection(){var i;const a=this.getLead(),c=!!this.resumingFrom||this!==a;let l=!0;if((this.isProjectionDirty||!((i=this.parent)===null||i===void 0)&&i.isProjectionDirty)&&(l=!1),c&&(this.isSharedProjectionDirty||this.isTransformDirty)&&(l=!1),this.resolvedRelativeTargetAt===K.timestamp&&(l=!1),l)return;const{layout:u,layoutId:d}=this.options;if(this.isTreeAnimating=!!(this.parent&&this.parent.isTreeAnimating||this.currentAnimation||this.pendingAnimation),this.isTreeAnimating||(this.targetDelta=this.relativeTarget=void 0),!this.layout||!(u||d))return;oe(this.layoutCorrected,this.layout.layoutBox);const p=this.treeScale.x,y=this.treeScale.y;Kh(this.layoutCorrected,this.treeScale,this.path,c),a.layout&&!a.target&&(this.treeScale.x!==1||this.treeScale.y!==1)&&(a.target=a.layout.layoutBox,a.targetWithTransforms=U());const{target:g}=a;if(!g){this.prevProjectionDelta&&(this.createProjectionDeltas(),this.scheduleRender());return}!this.projectionDelta||!this.prevProjectionDelta?this.createProjectionDeltas():(Fs(this.prevProjectionDelta.x,this.projectionDelta.x),Fs(this.prevProjectionDelta.y,this.projectionDelta.y)),Pt(this.projectionDelta,this.layoutCorrected,g,this.latestValues),(this.treeScale.x!==p||this.treeScale.y!==y||!$s(this.projectionDelta.x,this.prevProjectionDelta.x)||!$s(this.projectionDelta.y,this.prevProjectionDelta.y))&&(this.hasProjected=!0,this.scheduleRender(),this.notifyListeners("projectionUpdate",g)),wt&&_e.recalculatedProjection++}hide(){this.isVisible=!1}show(){this.isVisible=!0}scheduleRender(i=!0){var a;if((a=this.options.visualElement)===null||a===void 0||a.scheduleRender(),i){const c=this.getStack();c&&c.scheduleRender()}this.resumingFrom&&!this.resumingFrom.instance&&(this.resumingFrom=void 0)}createProjectionDeltas(){this.prevProjectionDelta=Je(),this.projectionDelta=Je(),this.projectionDeltaWithTransform=Je()}setAnimationOrigin(i,a=!1){const c=this.snapshot,l=c?c.latestValues:{},u={...this.latestValues},d=Je();(!this.relativeParent||!this.relativeParent.options.layoutRoot)&&(this.relativeTarget=this.relativeTargetOrigin=void 0),this.attemptToResolveRelativeTarget=!a;const p=U(),y=c?c.source:void 0,g=this.layout?this.layout.source:void 0,m=y!==g,v=this.getStack(),k=!v||v.members.length<=1,x=!!(m&&!k&&this.options.crossfade===!0&&!this.path.some(Vf));this.animationProgress=0;let M;this.mixTargetDelta=C=>{const w=C/1e3;Zs(d.x,i.x,w),Zs(d.y,i.y,w),this.setTargetDelta(d),this.relativeTarget&&this.relativeTargetOrigin&&this.layout&&this.relativeParent&&this.relativeParent.layout&&(At(p,this.layout.layoutBox,this.relativeParent.layout.layoutBox),Lf(this.relativeTarget,this.relativeTargetOrigin,p,w),M&&mf(this.relativeTarget,M)&&(this.isProjectionDirty=!1),M||(M=U()),oe(M,this.relativeTarget)),m&&(this.animationValues=u,uf(u,l,this.latestValues,w,x,k)),this.root.scheduleUpdateProjection(),this.scheduleRender(),this.animationProgress=w},this.mixTargetDelta(this.options.layoutRoot?1e3:0)}startAnimation(i){this.notifyListeners("animationStart"),this.currentAnimation&&this.currentAnimation.stop(),this.resumingFrom&&this.resumingFrom.currentAnimation&&this.resumingFrom.currentAnimation.stop(),this.pendingAnimation&&(Re(this.pendingAnimation),this.pendingAnimation=void 0),this.pendingAnimation=z.update(()=>{sn.hasAnimatedSinceResize=!0,this.currentAnimation=rf(0,Ws,{...i,onUpdate:a=>{this.mixTargetDelta(a),i.onUpdate&&i.onUpdate(a)},onComplete:()=>{i.onComplete&&i.onComplete(),this.completeAnimation()}}),this.resumingFrom&&(this.resumingFrom.currentAnimation=this.currentAnimation),this.pendingAnimation=void 0})}completeAnimation(){this.resumingFrom&&(this.resumingFrom.currentAnimation=void 0,this.resumingFrom.preserveOpacity=void 0);const i=this.getStack();i&&i.exitAnimationComplete(),this.resumingFrom=this.currentAnimation=this.animationValues=void 0,this.notifyListeners("animationComplete")}finishAnimation(){this.currentAnimation&&(this.mixTargetDelta&&this.mixTargetDelta(Ws),this.currentAnimation.stop()),this.completeAnimation()}applyTransformsToTarget(){const i=this.getLead();let{targetWithTransforms:a,target:c,layout:l,latestValues:u}=i;if(!(!a||!c||!l)){if(this!==i&&this.layout&&l&&ic(this.options.animationType,this.layout.layoutBox,l.layoutBox)){c=this.target||U();const d=ne(this.layout.layoutBox.x);c.x.min=i.target.x.min,c.x.max=c.x.min+d;const p=ne(this.layout.layoutBox.y);c.y.min=i.target.y.min,c.y.max=c.y.min+p}oe(a,c),tt(a,u),Pt(this.projectionDeltaWithTransform,this.layoutCorrected,a,u)}}registerSharedNode(i,a){this.sharedNodes.has(i)||this.sharedNodes.set(i,new gf),this.sharedNodes.get(i).add(a);const l=a.options.initialPromotionConfig;a.promote({transition:l?l.transition:void 0,preserveFollowOpacity:l&&l.shouldPreserveFollowOpacity?l.shouldPreserveFollowOpacity(a):void 0})}isLead(){const i=this.getStack();return i?i.lead===this:!0}getLead(){var i;const{layoutId:a}=this.options;return a?((i=this.getStack())===null||i===void 0?void 0:i.lead)||this:this}getPrevLead(){var i;const{layoutId:a}=this.options;return a?(i=this.getStack())===null||i===void 0?void 0:i.prevLead:void 0}getStack(){const{layoutId:i}=this.options;if(i)return this.root.sharedNodes.get(i)}promote({needsReset:i,transition:a,preserveFollowOpacity:c}={}){const l=this.getStack();l&&l.promote(this,c),i&&(this.projectionDelta=void 0,this.needsReset=!0),a&&this.setOptions({transition:a})}relegate(){const i=this.getStack();return i?i.relegate(this):!1}resetSkewAndRotation(){const{visualElement:i}=this.options;if(!i)return;let a=!1;const{latestValues:c}=i;if((c.z||c.rotate||c.rotateX||c.rotateY||c.rotateZ||c.skewX||c.skewY)&&(a=!0),!a)return;const l={};c.z&&Yn("z",i,l,this.animationValues);for(let u=0;u<Xn.length;u++)Yn(`rotate${Xn[u]}`,i,l,this.animationValues),Yn(`skew${Xn[u]}`,i,l,this.animationValues);i.render();for(const u in l)i.setStaticValue(u,l[u]),this.animationValues&&(this.animationValues[u]=l[u]);i.scheduleRender()}getProjectionStyles(i){var a,c;if(!this.instance||this.isSVG)return;if(!this.isVisible)return kf;const l={visibility:""},u=this.getTransformTemplate();if(this.needsReset)return this.needsReset=!1,l.opacity="",l.pointerEvents=rn(i==null?void 0:i.pointerEvents)||"",l.transform=u?u(this.latestValues,""):"none",l;const d=this.getLead();if(!this.projectionDelta||!this.layout||!d.target){const m={};return this.options.layoutId&&(m.opacity=this.latestValues.opacity!==void 0?this.latestValues.opacity:1,m.pointerEvents=rn(i==null?void 0:i.pointerEvents)||""),this.hasProjected&&!Ne(this.latestValues)&&(m.transform=u?u({},""):"none",this.hasProjected=!1),m}const p=d.animationValues||d.latestValues;this.applyTransformsToTarget(),l.transform=vf(this.projectionDeltaWithTransform,this.treeScale,p),u&&(l.transform=u(p,l.transform));const{x:y,y:g}=this.projectionDelta;l.transformOrigin=`${y.origin*100}% ${g.origin*100}% 0`,d.animationValues?l.opacity=d===this?(c=(a=p.opacity)!==null&&a!==void 0?a:this.latestValues.opacity)!==null&&c!==void 0?c:1:this.preserveOpacity?this.latestValues.opacity:p.opacityExit:l.opacity=d===this?p.opacity!==void 0?p.opacity:"":p.opacityExit!==void 0?p.opacityExit:0;for(const m in dn){if(p[m]===void 0)continue;const{correct:v,applyTo:k}=dn[m],x=l.transform==="none"?p[m]:v(p[m],d);if(k){const M=k.length;for(let C=0;C<M;C++)l[k[C]]=x}else l[m]=x}return this.options.layoutId&&(l.pointerEvents=d===this?rn(i==null?void 0:i.pointerEvents)||"":"none"),l}clearSnapshot(){this.resumeFrom=this.snapshot=void 0}resetTree(){this.root.nodes.forEach(i=>{var a;return(a=i.currentAnimation)===null||a===void 0?void 0:a.stop()}),this.root.nodes.forEach(Ks),this.root.sharedNodes.clear()}}}function Mf(e){e.updateLayout()}function wf(e){var t;const n=((t=e.resumeFrom)===null||t===void 0?void 0:t.snapshot)||e.snapshot;if(e.isLead()&&e.layout&&n&&e.hasListeners("didUpdate")){const{layoutBox:r,measuredBox:o}=e.layout,{animationType:s}=e.options,i=n.source!==e.layout.source;s==="size"?se(d=>{const p=i?n.measuredBox[d]:n.layoutBox[d],y=ne(p);p.min=r[d].min,p.max=p.min+y}):ic(s,n.layoutBox,r)&&se(d=>{const p=i?n.measuredBox[d]:n.layoutBox[d],y=ne(r[d]);p.max=p.min+y,e.relativeTarget&&!e.currentAnimation&&(e.isProjectionDirty=!0,e.relativeTarget[d].max=e.relativeTarget[d].min+y)});const a=Je();Pt(a,r,n.layoutBox);const c=Je();i?Pt(c,e.applyTransform(o,!0),n.measuredBox):Pt(c,r,n.layoutBox);const l=!nc(a);let u=!1;if(!e.resumeFrom){const d=e.getClosestProjectingParent();if(d&&!d.resumeFrom){const{snapshot:p,layout:y}=d;if(p&&y){const g=U();At(g,n.layoutBox,p.layoutBox);const m=U();At(m,r,y.layoutBox),rc(g,m)||(u=!0),d.options.layoutRoot&&(e.relativeTarget=m,e.relativeTargetOrigin=g,e.relativeParent=d)}}}e.notifyListeners("didUpdate",{layout:r,snapshot:n,delta:c,layoutDelta:a,hasLayoutChanged:l,hasRelativeTargetChanged:u})}else if(e.isLead()){const{onExitComplete:r}=e.options;r&&r()}e.options.transition=void 0}function bf(e){wt&&_e.totalNodes++,e.parent&&(e.isProjecting()||(e.isProjectionDirty=e.parent.isProjectionDirty),e.isSharedProjectionDirty||(e.isSharedProjectionDirty=!!(e.isProjectionDirty||e.parent.isProjectionDirty||e.parent.isSharedProjectionDirty)),e.isTransformDirty||(e.isTransformDirty=e.parent.isTransformDirty))}function Cf(e){e.isProjectionDirty=e.isSharedProjectionDirty=e.isTransformDirty=!1}function Sf(e){e.clearSnapshot()}function Ks(e){e.clearMeasurements()}function Pf(e){e.isLayoutDirty=!1}function Af(e){const{visualElement:t}=e.options;t&&t.getProps().onBeforeLayoutMeasure&&t.notify("BeforeLayoutMeasure"),e.resetTransform()}function Gs(e){e.finishAnimation(),e.targetDelta=e.relativeTarget=e.target=void 0,e.isProjectionDirty=!0}function Tf(e){e.resolveTargetDelta()}function Rf(e){e.calcProjection()}function Ef(e){e.resetSkewAndRotation()}function Df(e){e.removeLeadSnapshot()}function Zs(e,t,n){e.translate=H(t.translate,0,n),e.scale=H(t.scale,1,n),e.origin=t.origin,e.originPoint=t.originPoint}function Xs(e,t,n,r){e.min=H(t.min,n.min,r),e.max=H(t.max,n.max,r)}function Lf(e,t,n,r){Xs(e.x,t.x,n.x,r),Xs(e.y,t.y,n.y,r)}function Vf(e){return e.animationValues&&e.animationValues.opacityExit!==void 0}const Of={duration:.45,ease:[.4,0,.1,1]},Ys=e=>typeof navigator<"u"&&navigator.userAgent&&navigator.userAgent.toLowerCase().includes(e),Qs=Ys("applewebkit/")&&!Ys("chrome/")?Math.round:ee;function Js(e){e.min=Qs(e.min),e.max=Qs(e.max)}function If(e){Js(e.x),Js(e.y)}function ic(e,t,n){return e==="position"||e==="preserve-aspect"&&!Fh(Us(t),Us(n),.2)}function jf(e){var t;return e!==e.root&&((t=e.scroll)===null||t===void 0?void 0:t.wasRoot)}const Ff=sc({attachResizeListener:(e,t)=>Lt(e,"resize",t),measureScroll:()=>({x:document.documentElement.scrollLeft||document.body.scrollLeft,y:document.documentElement.scrollTop||document.body.scrollTop}),checkIsScrollRoot:()=>!0}),Qn={current:void 0},ac=sc({measureScroll:e=>({x:e.scrollLeft,y:e.scrollTop}),defaultParent:()=>{if(!Qn.current){const e=new Ff({});e.mount(window),e.setOptions({layoutScroll:!0}),Qn.current=e}return Qn.current},resetTransform:(e,t)=>{e.style.transform=t!==void 0?t:"none"},checkIsScrollRoot:e=>window.getComputedStyle(e).position==="fixed"}),Nf={pan:{Feature:Jh},drag:{Feature:Qh,ProjectionNode:ac,MeasureLayout:Ja}};function ei(e,t,n){const{props:r}=e;e.animationState&&r.whileHover&&e.animationState.setActive("whileHover",n==="Start");const o="onHover"+n,s=r[o];s&&z.postRender(()=>s(t,Bt(t)))}class _f extends Oe{mount(){const{current:t}=this.node;t&&(this.unmount=F1(t,n=>(ei(this.node,n,"Start"),r=>ei(this.node,r,"End"))))}unmount(){}}class Bf extends Oe{constructor(){super(...arguments),this.isActive=!1}onFocus(){let t=!1;try{t=this.node.current.matches(":focus-visible")}catch{t=!0}!t||!this.node.animationState||(this.node.animationState.setActive("whileFocus",!0),this.isActive=!0)}onBlur(){!this.isActive||!this.node.animationState||(this.node.animationState.setActive("whileFocus",!1),this.isActive=!1)}mount(){this.unmount=_t(Lt(this.node.current,"focus",()=>this.onFocus()),Lt(this.node.current,"blur",()=>this.onBlur()))}unmount(){}}function ti(e,t,n){const{props:r}=e;e.animationState&&r.whileTap&&e.animationState.setActive("whileTap",n==="Start");const o="onTap"+(n==="End"?"":n),s=r[o];s&&z.postRender(()=>s(t,Bt(t)))}class zf extends Oe{mount(){const{current:t}=this.node;t&&(this.unmount=z1(t,n=>(ti(this.node,n,"Start"),(r,{success:o})=>ti(this.node,r,o?"End":"Cancel")),{useGlobalTarget:this.node.props.globalTapTarget}))}unmount(){}}const Sr=new WeakMap,Jn=new WeakMap,Hf=e=>{const t=Sr.get(e.target);t&&t(e)},qf=e=>{e.forEach(Hf)};function Uf({root:e,...t}){const n=e||document;Jn.has(n)||Jn.set(n,{});const r=Jn.get(n),o=JSON.stringify(t);return r[o]||(r[o]=new IntersectionObserver(qf,{root:e,...t})),r[o]}function $f(e,t,n){const r=Uf(t);return Sr.set(e,n),r.observe(e),()=>{Sr.delete(e),r.unobserve(e)}}const Wf={some:0,all:1};class Kf extends Oe{constructor(){super(...arguments),this.hasEnteredView=!1,this.isInView=!1}startObserver(){this.unmount();const{viewport:t={}}=this.node.getProps(),{root:n,margin:r,amount:o="some",once:s}=t,i={root:n?n.current:void 0,rootMargin:r,threshold:typeof o=="number"?o:Wf[o]},a=c=>{const{isIntersecting:l}=c;if(this.isInView===l||(this.isInView=l,s&&!l&&this.hasEnteredView))return;l&&(this.hasEnteredView=!0),this.node.animationState&&this.node.animationState.setActive("whileInView",l);const{onViewportEnter:u,onViewportLeave:d}=this.node.getProps(),p=l?u:d;p&&p(c)};return $f(this.node.current,i,a)}mount(){this.startObserver()}update(){if(typeof IntersectionObserver>"u")return;const{props:t,prevProps:n}=this.node;["amount","margin","root"].some(Gf(t,n))&&this.startObserver()}unmount(){}}function Gf({viewport:e={}},{viewport:t={}}={}){return n=>e[n]!==t[n]}const Zf={inView:{Feature:Kf},tap:{Feature:zf},focus:{Feature:Bf},hover:{Feature:_f}},Xf={layout:{ProjectionNode:ac,MeasureLayout:Ja}},gn={current:null},yo={current:!1};function cc(){if(yo.current=!0,!!Fr)if(window.matchMedia){const e=window.matchMedia("(prefers-reduced-motion)"),t=()=>gn.current=e.matches;e.addListener(t),t()}else gn.current=!1}const Yf=[...Va,Z,Ee],Qf=e=>Yf.find(La(e)),ni=new WeakMap;function Jf(e,t,n){for(const r in t){const o=t[r],s=n[r];if(X(o))e.addValue(r,o);else if(X(s))e.addValue(r,Et(o,{owner:e}));else if(s!==o)if(e.hasValue(r)){const i=e.getValue(r);i.liveStyle===!0?i.jump(o):i.hasAnimated||i.set(o)}else{const i=e.getStaticValue(r);e.addValue(r,Et(i!==void 0?i:o,{owner:e}))}}for(const r in n)t[r]===void 0&&e.removeValue(r);return t}const ri=["AnimationStart","AnimationComplete","Update","BeforeLayoutMeasure","LayoutMeasure","LayoutAnimationStart","LayoutAnimationComplete"];class e2{scrapeMotionValuesFromProps(t,n,r){return{}}constructor({parent:t,props:n,presenceContext:r,reducedMotionConfig:o,blockInitialAnimation:s,visualState:i},a={}){this.current=null,this.children=new Set,this.isVariantNode=!1,this.isControllingVariants=!1,this.shouldReduceMotion=null,this.values=new Map,this.KeyframeResolver=uo,this.features={},this.valueSubscriptions=new Map,this.prevMotionValues={},this.events={},this.propEventSubscriptions={},this.notifyUpdate=()=>this.notify("Update",this.latestValues),this.render=()=>{this.current&&(this.triggerBuild(),this.renderInstance(this.current,this.renderState,this.props.style,this.projection))},this.renderScheduledAt=0,this.scheduleRender=()=>{const y=pe.now();this.renderScheduledAt<y&&(this.renderScheduledAt=y,z.render(this.render,!1,!0))};const{latestValues:c,renderState:l,onUpdate:u}=i;this.onUpdate=u,this.latestValues=c,this.baseTarget={...c},this.initialValues=n.initial?{...c}:{},this.renderState=l,this.parent=t,this.props=n,this.presenceContext=r,this.depth=t?t.depth+1:0,this.reducedMotionConfig=o,this.options=a,this.blockInitialAnimation=!!s,this.isControllingVariants=Rn(n),this.isVariantNode=zi(n),this.isVariantNode&&(this.variantChildren=new Set),this.manuallyAnimateOnMount=!!(t&&t.current);const{willChange:d,...p}=this.scrapeMotionValuesFromProps(n,{},this);for(const y in p){const g=p[y];c[y]!==void 0&&X(g)&&g.set(c[y],!1)}}mount(t){this.current=t,ni.set(t,this),this.projection&&!this.projection.instance&&this.projection.mount(t),this.parent&&this.isVariantNode&&!this.isControllingVariants&&(this.removeFromVariantTree=this.parent.addVariantChild(this)),this.values.forEach((n,r)=>this.bindToMotionValue(r,n)),yo.current||cc(),this.shouldReduceMotion=this.reducedMotionConfig==="never"?!1:this.reducedMotionConfig==="always"?!0:gn.current,this.parent&&this.parent.children.add(this),this.update(this.props,this.presenceContext)}unmount(){ni.delete(this.current),this.projection&&this.projection.unmount(),Re(this.notifyUpdate),Re(this.render),this.valueSubscriptions.forEach(t=>t()),this.valueSubscriptions.clear(),this.removeFromVariantTree&&this.removeFromVariantTree(),this.parent&&this.parent.children.delete(this);for(const t in this.events)this.events[t].clear();for(const t in this.features){const n=this.features[t];n&&(n.unmount(),n.isMounted=!1)}this.current=null}bindToMotionValue(t,n){this.valueSubscriptions.has(t)&&this.valueSubscriptions.get(t)();const r=$e.has(t),o=n.on("change",a=>{this.latestValues[t]=a,this.props.onUpdate&&z.preRender(this.notifyUpdate),r&&this.projection&&(this.projection.isTransformDirty=!0)}),s=n.on("renderRequest",this.scheduleRender);let i;window.MotionCheckAppearSync&&(i=window.MotionCheckAppearSync(this,t,n)),this.valueSubscriptions.set(t,()=>{o(),s(),i&&i(),n.owner&&n.stop()})}sortNodePosition(t){return!this.current||!this.sortInstanceNodePosition||this.type!==t.type?0:this.sortInstanceNodePosition(this.current,t.current)}updateFeatures(){let t="animation";for(t in it){const n=it[t];if(!n)continue;const{isEnabled:r,Feature:o}=n;if(!this.features[t]&&o&&r(this.props)&&(this.features[t]=new o(this)),this.features[t]){const s=this.features[t];s.isMounted?s.update():(s.mount(),s.isMounted=!0)}}}triggerBuild(){this.build(this.renderState,this.latestValues,this.props)}measureViewportBox(){return this.current?this.measureInstanceViewportBox(this.current,this.props):U()}getStaticValue(t){return this.latestValues[t]}setStaticValue(t,n){this.latestValues[t]=n}update(t,n){(t.transformTemplate||this.props.transformTemplate)&&this.scheduleRender(),this.prevProps=this.props,this.props=t,this.prevPresenceContext=this.presenceContext,this.presenceContext=n;for(let r=0;r<ri.length;r++){const o=ri[r];this.propEventSubscriptions[o]&&(this.propEventSubscriptions[o](),delete this.propEventSubscriptions[o]);const s="on"+o,i=t[s];i&&(this.propEventSubscriptions[o]=this.on(o,i))}this.prevMotionValues=Jf(this,this.scrapeMotionValuesFromProps(t,this.prevProps,this),this.prevMotionValues),this.handleChildMotionValue&&this.handleChildMotionValue(),this.onUpdate&&this.onUpdate(this)}getProps(){return this.props}getVariant(t){return this.props.variants?this.props.variants[t]:void 0}getDefaultTransition(){return this.props.transition}getTransformPagePoint(){return this.props.transformPagePoint}getClosestVariantNode(){return this.isVariantNode?this:this.parent?this.parent.getClosestVariantNode():void 0}addVariantChild(t){const n=this.getClosestVariantNode();if(n)return n.variantChildren&&n.variantChildren.add(t),()=>n.variantChildren.delete(t)}addValue(t,n){const r=this.values.get(t);n!==r&&(r&&this.removeValue(t),this.bindToMotionValue(t,n),this.values.set(t,n),this.latestValues[t]=n.get())}removeValue(t){this.values.delete(t);const n=this.valueSubscriptions.get(t);n&&(n(),this.valueSubscriptions.delete(t)),delete this.latestValues[t],this.removeValueFromRenderState(t,this.renderState)}hasValue(t){return this.values.has(t)}getValue(t,n){if(this.props.values&&this.props.values[t])return this.props.values[t];let r=this.values.get(t);return r===void 0&&n!==void 0&&(r=Et(n===null?void 0:n,{owner:this}),this.addValue(t,r)),r}readValue(t,n){var r;let o=this.latestValues[t]!==void 0||!this.current?this.latestValues[t]:(r=this.getBaseTargetFromProps(this.props,t))!==null&&r!==void 0?r:this.readValueFromInstance(this.current,t,this.options);return o!=null&&(typeof o=="string"&&(Ea(o)||Ma(o))?o=parseFloat(o):!Qf(o)&&Ee.test(n)&&(o=Aa(t,n)),this.setBaseTarget(t,X(o)?o.get():o)),X(o)?o.get():o}setBaseTarget(t,n){this.baseTarget[t]=n}getBaseTarget(t){var n;const{initial:r}=this.props;let o;if(typeof r=="string"||typeof r=="object"){const i=Ur(this.props,r,(n=this.presenceContext)===null||n===void 0?void 0:n.custom);i&&(o=i[t])}if(r&&o!==void 0)return o;const s=this.getBaseTargetFromProps(this.props,t);return s!==void 0&&!X(s)?s:this.initialValues[t]!==void 0&&o===void 0?void 0:this.baseTarget[t]}on(t,n){return this.events[t]||(this.events[t]=new oo),this.events[t].add(n)}notify(t,...n){this.events[t]&&this.events[t].notify(...n)}}class lc extends e2{constructor(){super(...arguments),this.KeyframeResolver=Oa}sortInstanceNodePosition(t,n){return t.compareDocumentPosition(n)&2?1:-1}getBaseTargetFromProps(t,n){return t.style?t.style[n]:void 0}removeValueFromRenderState(t,{vars:n,style:r}){delete n[t],delete r[t]}handleChildMotionValue(){this.childSubscription&&(this.childSubscription(),delete this.childSubscription);const{children:t}=this.props;X(t)&&(this.childSubscription=t.on("change",n=>{this.current&&(this.current.textContent=`${n}`)}))}}function t2(e){return window.getComputedStyle(e)}class n2 extends lc{constructor(){super(...arguments),this.type="html",this.renderInstance=Xi}readValueFromInstance(t,n){if($e.has(n)){const r=lo(n);return r&&r.default||0}else{const r=t2(t),o=(Ki(n)?r.getPropertyValue(n):r[n])||0;return typeof o=="string"?o.trim():o}}measureInstanceViewportBox(t,{transformPagePoint:n}){return Ya(t,n)}build(t,n,r){Kr(t,n,r.transformTemplate)}scrapeMotionValuesFromProps(t,n,r){return Yr(t,n,r)}}class r2 extends lc{constructor(){super(...arguments),this.type="svg",this.isSVGTag=!1,this.measureInstanceViewportBox=U}getBaseTargetFromProps(t,n){return t[n]}readValueFromInstance(t,n){if($e.has(n)){const r=lo(n);return r&&r.default||0}return n=Yi.has(n)?n:zr(n),t.getAttribute(n)}scrapeMotionValuesFromProps(t,n,r){return ea(t,n,r)}build(t,n,r){Gr(t,n,this.isSVGTag,r.transformTemplate)}renderInstance(t,n,r,o){Qi(t,n,r,o)}mount(t){this.isSVGTag=Xr(t.tagName),super.mount(t)}}const o2=(e,t)=>qr(e)?new r2(t):new n2(t,{allowProjection:e!==h.Fragment}),s2=E1({...Th,...Zf,...Nf,...Xf},o2),i5=$u(s2);function a5(){!yo.current&&cc();const[e]=h.useState(gn.current);return e}var i2=Ai[" useId ".trim().toString()]||(()=>{}),a2=0;function nt(e){const[t,n]=h.useState(i2());return Te(()=>{n(r=>r??String(a2++))},[e]),e||(t?`radix-${t}`:"")}const c2=["top","right","bottom","left"],De=Math.min,J=Math.max,vn=Math.round,Qt=Math.floor,ye=e=>({x:e,y:e}),l2={left:"right",right:"left",bottom:"top",top:"bottom"},u2={start:"end",end:"start"};function Pr(e,t,n){return J(e,De(t,n))}function be(e,t){return typeof e=="function"?e(t):e}function Ce(e){return e.split("-")[0]}function ht(e){return e.split("-")[1]}function mo(e){return e==="x"?"y":"x"}function go(e){return e==="y"?"height":"width"}const d2=new Set(["top","bottom"]);function he(e){return d2.has(Ce(e))?"y":"x"}function vo(e){return mo(he(e))}function h2(e,t,n){n===void 0&&(n=!1);const r=ht(e),o=vo(e),s=go(o);let i=o==="x"?r===(n?"end":"start")?"right":"left":r==="start"?"bottom":"top";return t.reference[s]>t.floating[s]&&(i=kn(i)),[i,kn(i)]}function f2(e){const t=kn(e);return[Ar(e),t,Ar(t)]}function Ar(e){return e.replace(/start|end/g,t=>u2[t])}const oi=["left","right"],si=["right","left"],p2=["top","bottom"],y2=["bottom","top"];function m2(e,t,n){switch(e){case"top":case"bottom":return n?t?si:oi:t?oi:si;case"left":case"right":return t?p2:y2;default:return[]}}function g2(e,t,n,r){const o=ht(e);let s=m2(Ce(e),n==="start",r);return o&&(s=s.map(i=>i+"-"+o),t&&(s=s.concat(s.map(Ar)))),s}function kn(e){return e.replace(/left|right|bottom|top/g,t=>l2[t])}function v2(e){return{top:0,right:0,bottom:0,left:0,...e}}function uc(e){return typeof e!="number"?v2(e):{top:e,right:e,bottom:e,left:e}}function xn(e){const{x:t,y:n,width:r,height:o}=e;return{width:r,height:o,top:n,left:t,right:t+r,bottom:n+o,x:t,y:n}}function ii(e,t,n){let{reference:r,floating:o}=e;const s=he(t),i=vo(t),a=go(i),c=Ce(t),l=s==="y",u=r.x+r.width/2-o.width/2,d=r.y+r.height/2-o.height/2,p=r[a]/2-o[a]/2;let y;switch(c){case"top":y={x:u,y:r.y-o.height};break;case"bottom":y={x:u,y:r.y+r.height};break;case"right":y={x:r.x+r.width,y:d};break;case"left":y={x:r.x-o.width,y:d};break;default:y={x:r.x,y:r.y}}switch(ht(t)){case"start":y[i]-=p*(n&&l?-1:1);break;case"end":y[i]+=p*(n&&l?-1:1);break}return y}const k2=async(e,t,n)=>{const{placement:r="bottom",strategy:o="absolute",middleware:s=[],platform:i}=n,a=s.filter(Boolean),c=await(i.isRTL==null?void 0:i.isRTL(t));let l=await i.getElementRects({reference:e,floating:t,strategy:o}),{x:u,y:d}=ii(l,r,c),p=r,y={},g=0;for(let m=0;m<a.length;m++){const{name:v,fn:k}=a[m],{x,y:M,data:C,reset:w}=await k({x:u,y:d,initialPlacement:r,placement:p,strategy:o,middlewareData:y,rects:l,platform:i,elements:{reference:e,floating:t}});u=x??u,d=M??d,y={...y,[v]:{...y[v],...C}},w&&g<=50&&(g++,typeof w=="object"&&(w.placement&&(p=w.placement),w.rects&&(l=w.rects===!0?await i.getElementRects({reference:e,floating:t,strategy:o}):w.rects),{x:u,y:d}=ii(l,p,c)),m=-1)}return{x:u,y:d,placement:p,strategy:o,middlewareData:y}};async function Vt(e,t){var n;t===void 0&&(t={});const{x:r,y:o,platform:s,rects:i,elements:a,strategy:c}=e,{boundary:l="clippingAncestors",rootBoundary:u="viewport",elementContext:d="floating",altBoundary:p=!1,padding:y=0}=be(t,e),g=uc(y),v=a[p?d==="floating"?"reference":"floating":d],k=xn(await s.getClippingRect({element:(n=await(s.isElement==null?void 0:s.isElement(v)))==null||n?v:v.contextElement||await(s.getDocumentElement==null?void 0:s.getDocumentElement(a.floating)),boundary:l,rootBoundary:u,strategy:c})),x=d==="floating"?{x:r,y:o,width:i.floating.width,height:i.floating.height}:i.reference,M=await(s.getOffsetParent==null?void 0:s.getOffsetParent(a.floating)),C=await(s.isElement==null?void 0:s.isElement(M))?await(s.getScale==null?void 0:s.getScale(M))||{x:1,y:1}:{x:1,y:1},w=xn(s.convertOffsetParentRelativeRectToViewportRelativeRect?await s.convertOffsetParentRelativeRectToViewportRelativeRect({elements:a,rect:x,offsetParent:M,strategy:c}):x);return{top:(k.top-w.top+g.top)/C.y,bottom:(w.bottom-k.bottom+g.bottom)/C.y,left:(k.left-w.left+g.left)/C.x,right:(w.right-k.right+g.right)/C.x}}const x2=e=>({name:"arrow",options:e,async fn(t){const{x:n,y:r,placement:o,rects:s,platform:i,elements:a,middlewareData:c}=t,{element:l,padding:u=0}=be(e,t)||{};if(l==null)return{};const d=uc(u),p={x:n,y:r},y=vo(o),g=go(y),m=await i.getDimensions(l),v=y==="y",k=v?"top":"left",x=v?"bottom":"right",M=v?"clientHeight":"clientWidth",C=s.reference[g]+s.reference[y]-p[y]-s.floating[g],w=p[y]-s.reference[y],S=await(i.getOffsetParent==null?void 0:i.getOffsetParent(l));let P=S?S[M]:0;(!P||!await(i.isElement==null?void 0:i.isElement(S)))&&(P=a.floating[M]||s.floating[g]);const A=C/2-w/2,D=P/2-m[g]/2-1,L=De(d[k],D),I=De(d[x],D),N=L,B=P-m[g]-I,F=P/2-m[g]/2+A,W=Pr(N,F,B),j=!c.arrow&&ht(o)!=null&&F!==W&&s.reference[g]/2-(F<N?L:I)-m[g]/2<0,O=j?F<N?F-N:F-B:0;return{[y]:p[y]+O,data:{[y]:W,centerOffset:F-W-O,...j&&{alignmentOffset:O}},reset:j}}}),M2=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var n,r;const{placement:o,middlewareData:s,rects:i,initialPlacement:a,platform:c,elements:l}=t,{mainAxis:u=!0,crossAxis:d=!0,fallbackPlacements:p,fallbackStrategy:y="bestFit",fallbackAxisSideDirection:g="none",flipAlignment:m=!0,...v}=be(e,t);if((n=s.arrow)!=null&&n.alignmentOffset)return{};const k=Ce(o),x=he(a),M=Ce(a)===a,C=await(c.isRTL==null?void 0:c.isRTL(l.floating)),w=p||(M||!m?[kn(a)]:f2(a)),S=g!=="none";!p&&S&&w.push(...g2(a,m,g,C));const P=[a,...w],A=await Vt(t,v),D=[];let L=((r=s.flip)==null?void 0:r.overflows)||[];if(u&&D.push(A[k]),d){const F=h2(o,i,C);D.push(A[F[0]],A[F[1]])}if(L=[...L,{placement:o,overflows:D}],!D.every(F=>F<=0)){var I,N;const F=(((I=s.flip)==null?void 0:I.index)||0)+1,W=P[F];if(W&&(!(d==="alignment"?x!==he(W):!1)||L.every(R=>he(R.placement)===x?R.overflows[0]>0:!0)))return{data:{index:F,overflows:L},reset:{placement:W}};let j=(N=L.filter(O=>O.overflows[0]<=0).sort((O,R)=>O.overflows[1]-R.overflows[1])[0])==null?void 0:N.placement;if(!j)switch(y){case"bestFit":{var B;const O=(B=L.filter(R=>{if(S){const T=he(R.placement);return T===x||T==="y"}return!0}).map(R=>[R.placement,R.overflows.filter(T=>T>0).reduce((T,_)=>T+_,0)]).sort((R,T)=>R[1]-T[1])[0])==null?void 0:B[0];O&&(j=O);break}case"initialPlacement":j=a;break}if(o!==j)return{reset:{placement:j}}}return{}}}};function ai(e,t){return{top:e.top-t.height,right:e.right-t.width,bottom:e.bottom-t.height,left:e.left-t.width}}function ci(e){return c2.some(t=>e[t]>=0)}const w2=function(e){return e===void 0&&(e={}),{name:"hide",options:e,async fn(t){const{rects:n}=t,{strategy:r="referenceHidden",...o}=be(e,t);switch(r){case"referenceHidden":{const s=await Vt(t,{...o,elementContext:"reference"}),i=ai(s,n.reference);return{data:{referenceHiddenOffsets:i,referenceHidden:ci(i)}}}case"escaped":{const s=await Vt(t,{...o,altBoundary:!0}),i=ai(s,n.floating);return{data:{escapedOffsets:i,escaped:ci(i)}}}default:return{}}}}},dc=new Set(["left","top"]);async function b2(e,t){const{placement:n,platform:r,elements:o}=e,s=await(r.isRTL==null?void 0:r.isRTL(o.floating)),i=Ce(n),a=ht(n),c=he(n)==="y",l=dc.has(i)?-1:1,u=s&&c?-1:1,d=be(t,e);let{mainAxis:p,crossAxis:y,alignmentAxis:g}=typeof d=="number"?{mainAxis:d,crossAxis:0,alignmentAxis:null}:{mainAxis:d.mainAxis||0,crossAxis:d.crossAxis||0,alignmentAxis:d.alignmentAxis};return a&&typeof g=="number"&&(y=a==="end"?g*-1:g),c?{x:y*u,y:p*l}:{x:p*l,y:y*u}}const C2=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var n,r;const{x:o,y:s,placement:i,middlewareData:a}=t,c=await b2(t,e);return i===((n=a.offset)==null?void 0:n.placement)&&(r=a.arrow)!=null&&r.alignmentOffset?{}:{x:o+c.x,y:s+c.y,data:{...c,placement:i}}}}},S2=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){const{x:n,y:r,placement:o}=t,{mainAxis:s=!0,crossAxis:i=!1,limiter:a={fn:v=>{let{x:k,y:x}=v;return{x:k,y:x}}},...c}=be(e,t),l={x:n,y:r},u=await Vt(t,c),d=he(Ce(o)),p=mo(d);let y=l[p],g=l[d];if(s){const v=p==="y"?"top":"left",k=p==="y"?"bottom":"right",x=y+u[v],M=y-u[k];y=Pr(x,y,M)}if(i){const v=d==="y"?"top":"left",k=d==="y"?"bottom":"right",x=g+u[v],M=g-u[k];g=Pr(x,g,M)}const m=a.fn({...t,[p]:y,[d]:g});return{...m,data:{x:m.x-n,y:m.y-r,enabled:{[p]:s,[d]:i}}}}}},P2=function(e){return e===void 0&&(e={}),{options:e,fn(t){const{x:n,y:r,placement:o,rects:s,middlewareData:i}=t,{offset:a=0,mainAxis:c=!0,crossAxis:l=!0}=be(e,t),u={x:n,y:r},d=he(o),p=mo(d);let y=u[p],g=u[d];const m=be(a,t),v=typeof m=="number"?{mainAxis:m,crossAxis:0}:{mainAxis:0,crossAxis:0,...m};if(c){const M=p==="y"?"height":"width",C=s.reference[p]-s.floating[M]+v.mainAxis,w=s.reference[p]+s.reference[M]-v.mainAxis;y<C?y=C:y>w&&(y=w)}if(l){var k,x;const M=p==="y"?"width":"height",C=dc.has(Ce(o)),w=s.reference[d]-s.floating[M]+(C&&((k=i.offset)==null?void 0:k[d])||0)+(C?0:v.crossAxis),S=s.reference[d]+s.reference[M]+(C?0:((x=i.offset)==null?void 0:x[d])||0)-(C?v.crossAxis:0);g<w?g=w:g>S&&(g=S)}return{[p]:y,[d]:g}}}},A2=function(e){return e===void 0&&(e={}),{name:"size",options:e,async fn(t){var n,r;const{placement:o,rects:s,platform:i,elements:a}=t,{apply:c=()=>{},...l}=be(e,t),u=await Vt(t,l),d=Ce(o),p=ht(o),y=he(o)==="y",{width:g,height:m}=s.floating;let v,k;d==="top"||d==="bottom"?(v=d,k=p===(await(i.isRTL==null?void 0:i.isRTL(a.floating))?"start":"end")?"left":"right"):(k=d,v=p==="end"?"top":"bottom");const x=m-u.top-u.bottom,M=g-u.left-u.right,C=De(m-u[v],x),w=De(g-u[k],M),S=!t.middlewareData.shift;let P=C,A=w;if((n=t.middlewareData.shift)!=null&&n.enabled.x&&(A=M),(r=t.middlewareData.shift)!=null&&r.enabled.y&&(P=x),S&&!p){const L=J(u.left,0),I=J(u.right,0),N=J(u.top,0),B=J(u.bottom,0);y?A=g-2*(L!==0||I!==0?L+I:J(u.left,u.right)):P=m-2*(N!==0||B!==0?N+B:J(u.top,u.bottom))}await c({...t,availableWidth:A,availableHeight:P});const D=await i.getDimensions(a.floating);return g!==D.width||m!==D.height?{reset:{rects:!0}}:{}}}};function Ln(){return typeof window<"u"}function ft(e){return hc(e)?(e.nodeName||"").toLowerCase():"#document"}function te(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function ge(e){var t;return(t=(hc(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function hc(e){return Ln()?e instanceof Node||e instanceof te(e).Node:!1}function ce(e){return Ln()?e instanceof Element||e instanceof te(e).Element:!1}function me(e){return Ln()?e instanceof HTMLElement||e instanceof te(e).HTMLElement:!1}function li(e){return!Ln()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof te(e).ShadowRoot}const T2=new Set(["inline","contents"]);function zt(e){const{overflow:t,overflowX:n,overflowY:r,display:o}=le(e);return/auto|scroll|overlay|hidden|clip/.test(t+r+n)&&!T2.has(o)}const R2=new Set(["table","td","th"]);function E2(e){return R2.has(ft(e))}const D2=[":popover-open",":modal"];function Vn(e){return D2.some(t=>{try{return e.matches(t)}catch{return!1}})}const L2=["transform","translate","scale","rotate","perspective"],V2=["transform","translate","scale","rotate","perspective","filter"],O2=["paint","layout","strict","content"];function ko(e){const t=xo(),n=ce(e)?le(e):e;return L2.some(r=>n[r]?n[r]!=="none":!1)||(n.containerType?n.containerType!=="normal":!1)||!t&&(n.backdropFilter?n.backdropFilter!=="none":!1)||!t&&(n.filter?n.filter!=="none":!1)||V2.some(r=>(n.willChange||"").includes(r))||O2.some(r=>(n.contain||"").includes(r))}function I2(e){let t=Le(e);for(;me(t)&&!ct(t);){if(ko(t))return t;if(Vn(t))return null;t=Le(t)}return null}function xo(){return typeof CSS>"u"||!CSS.supports?!1:CSS.supports("-webkit-backdrop-filter","none")}const j2=new Set(["html","body","#document"]);function ct(e){return j2.has(ft(e))}function le(e){return te(e).getComputedStyle(e)}function On(e){return ce(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function Le(e){if(ft(e)==="html")return e;const t=e.assignedSlot||e.parentNode||li(e)&&e.host||ge(e);return li(t)?t.host:t}function fc(e){const t=Le(e);return ct(t)?e.ownerDocument?e.ownerDocument.body:e.body:me(t)&&zt(t)?t:fc(t)}function Ot(e,t,n){var r;t===void 0&&(t=[]),n===void 0&&(n=!0);const o=fc(e),s=o===((r=e.ownerDocument)==null?void 0:r.body),i=te(o);if(s){const a=Tr(i);return t.concat(i,i.visualViewport||[],zt(o)?o:[],a&&n?Ot(a):[])}return t.concat(o,Ot(o,[],n))}function Tr(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function pc(e){const t=le(e);let n=parseFloat(t.width)||0,r=parseFloat(t.height)||0;const o=me(e),s=o?e.offsetWidth:n,i=o?e.offsetHeight:r,a=vn(n)!==s||vn(r)!==i;return a&&(n=s,r=i),{width:n,height:r,$:a}}function Mo(e){return ce(e)?e:e.contextElement}function rt(e){const t=Mo(e);if(!me(t))return ye(1);const n=t.getBoundingClientRect(),{width:r,height:o,$:s}=pc(t);let i=(s?vn(n.width):n.width)/r,a=(s?vn(n.height):n.height)/o;return(!i||!Number.isFinite(i))&&(i=1),(!a||!Number.isFinite(a))&&(a=1),{x:i,y:a}}const F2=ye(0);function yc(e){const t=te(e);return!xo()||!t.visualViewport?F2:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function N2(e,t,n){return t===void 0&&(t=!1),!n||t&&n!==te(e)?!1:t}function He(e,t,n,r){t===void 0&&(t=!1),n===void 0&&(n=!1);const o=e.getBoundingClientRect(),s=Mo(e);let i=ye(1);t&&(r?ce(r)&&(i=rt(r)):i=rt(e));const a=N2(s,n,r)?yc(s):ye(0);let c=(o.left+a.x)/i.x,l=(o.top+a.y)/i.y,u=o.width/i.x,d=o.height/i.y;if(s){const p=te(s),y=r&&ce(r)?te(r):r;let g=p,m=Tr(g);for(;m&&r&&y!==g;){const v=rt(m),k=m.getBoundingClientRect(),x=le(m),M=k.left+(m.clientLeft+parseFloat(x.paddingLeft))*v.x,C=k.top+(m.clientTop+parseFloat(x.paddingTop))*v.y;c*=v.x,l*=v.y,u*=v.x,d*=v.y,c+=M,l+=C,g=te(m),m=Tr(g)}}return xn({width:u,height:d,x:c,y:l})}function In(e,t){const n=On(e).scrollLeft;return t?t.left+n:He(ge(e)).left+n}function mc(e,t){const n=e.getBoundingClientRect(),r=n.left+t.scrollLeft-In(e,n),o=n.top+t.scrollTop;return{x:r,y:o}}function _2(e){let{elements:t,rect:n,offsetParent:r,strategy:o}=e;const s=o==="fixed",i=ge(r),a=t?Vn(t.floating):!1;if(r===i||a&&s)return n;let c={scrollLeft:0,scrollTop:0},l=ye(1);const u=ye(0),d=me(r);if((d||!d&&!s)&&((ft(r)!=="body"||zt(i))&&(c=On(r)),me(r))){const y=He(r);l=rt(r),u.x=y.x+r.clientLeft,u.y=y.y+r.clientTop}const p=i&&!d&&!s?mc(i,c):ye(0);return{width:n.width*l.x,height:n.height*l.y,x:n.x*l.x-c.scrollLeft*l.x+u.x+p.x,y:n.y*l.y-c.scrollTop*l.y+u.y+p.y}}function B2(e){return Array.from(e.getClientRects())}function z2(e){const t=ge(e),n=On(e),r=e.ownerDocument.body,o=J(t.scrollWidth,t.clientWidth,r.scrollWidth,r.clientWidth),s=J(t.scrollHeight,t.clientHeight,r.scrollHeight,r.clientHeight);let i=-n.scrollLeft+In(e);const a=-n.scrollTop;return le(r).direction==="rtl"&&(i+=J(t.clientWidth,r.clientWidth)-o),{width:o,height:s,x:i,y:a}}const ui=25;function H2(e,t){const n=te(e),r=ge(e),o=n.visualViewport;let s=r.clientWidth,i=r.clientHeight,a=0,c=0;if(o){s=o.width,i=o.height;const u=xo();(!u||u&&t==="fixed")&&(a=o.offsetLeft,c=o.offsetTop)}const l=In(r);if(l<=0){const u=r.ownerDocument,d=u.body,p=getComputedStyle(d),y=u.compatMode==="CSS1Compat"&&parseFloat(p.marginLeft)+parseFloat(p.marginRight)||0,g=Math.abs(r.clientWidth-d.clientWidth-y);g<=ui&&(s-=g)}else l<=ui&&(s+=l);return{width:s,height:i,x:a,y:c}}const q2=new Set(["absolute","fixed"]);function U2(e,t){const n=He(e,!0,t==="fixed"),r=n.top+e.clientTop,o=n.left+e.clientLeft,s=me(e)?rt(e):ye(1),i=e.clientWidth*s.x,a=e.clientHeight*s.y,c=o*s.x,l=r*s.y;return{width:i,height:a,x:c,y:l}}function di(e,t,n){let r;if(t==="viewport")r=H2(e,n);else if(t==="document")r=z2(ge(e));else if(ce(t))r=U2(t,n);else{const o=yc(e);r={x:t.x-o.x,y:t.y-o.y,width:t.width,height:t.height}}return xn(r)}function gc(e,t){const n=Le(e);return n===t||!ce(n)||ct(n)?!1:le(n).position==="fixed"||gc(n,t)}function $2(e,t){const n=t.get(e);if(n)return n;let r=Ot(e,[],!1).filter(a=>ce(a)&&ft(a)!=="body"),o=null;const s=le(e).position==="fixed";let i=s?Le(e):e;for(;ce(i)&&!ct(i);){const a=le(i),c=ko(i);!c&&a.position==="fixed"&&(o=null),(s?!c&&!o:!c&&a.position==="static"&&!!o&&q2.has(o.position)||zt(i)&&!c&&gc(e,i))?r=r.filter(u=>u!==i):o=a,i=Le(i)}return t.set(e,r),r}function W2(e){let{element:t,boundary:n,rootBoundary:r,strategy:o}=e;const i=[...n==="clippingAncestors"?Vn(t)?[]:$2(t,this._c):[].concat(n),r],a=i[0],c=i.reduce((l,u)=>{const d=di(t,u,o);return l.top=J(d.top,l.top),l.right=De(d.right,l.right),l.bottom=De(d.bottom,l.bottom),l.left=J(d.left,l.left),l},di(t,a,o));return{width:c.right-c.left,height:c.bottom-c.top,x:c.left,y:c.top}}function K2(e){const{width:t,height:n}=pc(e);return{width:t,height:n}}function G2(e,t,n){const r=me(t),o=ge(t),s=n==="fixed",i=He(e,!0,s,t);let a={scrollLeft:0,scrollTop:0};const c=ye(0);function l(){c.x=In(o)}if(r||!r&&!s)if((ft(t)!=="body"||zt(o))&&(a=On(t)),r){const y=He(t,!0,s,t);c.x=y.x+t.clientLeft,c.y=y.y+t.clientTop}else o&&l();s&&!r&&o&&l();const u=o&&!r&&!s?mc(o,a):ye(0),d=i.left+a.scrollLeft-c.x-u.x,p=i.top+a.scrollTop-c.y-u.y;return{x:d,y:p,width:i.width,height:i.height}}function er(e){return le(e).position==="static"}function hi(e,t){if(!me(e)||le(e).position==="fixed")return null;if(t)return t(e);let n=e.offsetParent;return ge(e)===n&&(n=n.ownerDocument.body),n}function vc(e,t){const n=te(e);if(Vn(e))return n;if(!me(e)){let o=Le(e);for(;o&&!ct(o);){if(ce(o)&&!er(o))return o;o=Le(o)}return n}let r=hi(e,t);for(;r&&E2(r)&&er(r);)r=hi(r,t);return r&&ct(r)&&er(r)&&!ko(r)?n:r||I2(e)||n}const Z2=async function(e){const t=this.getOffsetParent||vc,n=this.getDimensions,r=await n(e.floating);return{reference:G2(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:r.width,height:r.height}}};function X2(e){return le(e).direction==="rtl"}const Y2={convertOffsetParentRelativeRectToViewportRelativeRect:_2,getDocumentElement:ge,getClippingRect:W2,getOffsetParent:vc,getElementRects:Z2,getClientRects:B2,getDimensions:K2,getScale:rt,isElement:ce,isRTL:X2};function kc(e,t){return e.x===t.x&&e.y===t.y&&e.width===t.width&&e.height===t.height}function Q2(e,t){let n=null,r;const o=ge(e);function s(){var a;clearTimeout(r),(a=n)==null||a.disconnect(),n=null}function i(a,c){a===void 0&&(a=!1),c===void 0&&(c=1),s();const l=e.getBoundingClientRect(),{left:u,top:d,width:p,height:y}=l;if(a||t(),!p||!y)return;const g=Qt(d),m=Qt(o.clientWidth-(u+p)),v=Qt(o.clientHeight-(d+y)),k=Qt(u),M={rootMargin:-g+"px "+-m+"px "+-v+"px "+-k+"px",threshold:J(0,De(1,c))||1};let C=!0;function w(S){const P=S[0].intersectionRatio;if(P!==c){if(!C)return i();P?i(!1,P):r=setTimeout(()=>{i(!1,1e-7)},1e3)}P===1&&!kc(l,e.getBoundingClientRect())&&i(),C=!1}try{n=new IntersectionObserver(w,{...M,root:o.ownerDocument})}catch{n=new IntersectionObserver(w,M)}n.observe(e)}return i(!0),s}function J2(e,t,n,r){r===void 0&&(r={});const{ancestorScroll:o=!0,ancestorResize:s=!0,elementResize:i=typeof ResizeObserver=="function",layoutShift:a=typeof IntersectionObserver=="function",animationFrame:c=!1}=r,l=Mo(e),u=o||s?[...l?Ot(l):[],...Ot(t)]:[];u.forEach(k=>{o&&k.addEventListener("scroll",n,{passive:!0}),s&&k.addEventListener("resize",n)});const d=l&&a?Q2(l,n):null;let p=-1,y=null;i&&(y=new ResizeObserver(k=>{let[x]=k;x&&x.target===l&&y&&(y.unobserve(t),cancelAnimationFrame(p),p=requestAnimationFrame(()=>{var M;(M=y)==null||M.observe(t)})),n()}),l&&!c&&y.observe(l),y.observe(t));let g,m=c?He(e):null;c&&v();function v(){const k=He(e);m&&!kc(m,k)&&n(),m=k,g=requestAnimationFrame(v)}return n(),()=>{var k;u.forEach(x=>{o&&x.removeEventListener("scroll",n),s&&x.removeEventListener("resize",n)}),d==null||d(),(k=y)==null||k.disconnect(),y=null,c&&cancelAnimationFrame(g)}}const e0=C2,t0=S2,n0=M2,r0=A2,o0=w2,fi=x2,s0=P2,i0=(e,t,n)=>{const r=new Map,o={platform:Y2,...n},s={...o.platform,_c:r};return k2(e,t,{...o,platform:s})};var a0=typeof document<"u",c0=function(){},an=a0?h.useLayoutEffect:c0;function Mn(e,t){if(e===t)return!0;if(typeof e!=typeof t)return!1;if(typeof e=="function"&&e.toString()===t.toString())return!0;let n,r,o;if(e&&t&&typeof e=="object"){if(Array.isArray(e)){if(n=e.length,n!==t.length)return!1;for(r=n;r--!==0;)if(!Mn(e[r],t[r]))return!1;return!0}if(o=Object.keys(e),n=o.length,n!==Object.keys(t).length)return!1;for(r=n;r--!==0;)if(!{}.hasOwnProperty.call(t,o[r]))return!1;for(r=n;r--!==0;){const s=o[r];if(!(s==="_owner"&&e.$$typeof)&&!Mn(e[s],t[s]))return!1}return!0}return e!==e&&t!==t}function xc(e){return typeof window>"u"?1:(e.ownerDocument.defaultView||window).devicePixelRatio||1}function pi(e,t){const n=xc(e);return Math.round(t*n)/n}function tr(e){const t=h.useRef(e);return an(()=>{t.current=e}),t}function l0(e){e===void 0&&(e={});const{placement:t="bottom",strategy:n="absolute",middleware:r=[],platform:o,elements:{reference:s,floating:i}={},transform:a=!0,whileElementsMounted:c,open:l}=e,[u,d]=h.useState({x:0,y:0,strategy:n,placement:t,middlewareData:{},isPositioned:!1}),[p,y]=h.useState(r);Mn(p,r)||y(r);const[g,m]=h.useState(null),[v,k]=h.useState(null),x=h.useCallback(R=>{R!==S.current&&(S.current=R,m(R))},[]),M=h.useCallback(R=>{R!==P.current&&(P.current=R,k(R))},[]),C=s||g,w=i||v,S=h.useRef(null),P=h.useRef(null),A=h.useRef(u),D=c!=null,L=tr(c),I=tr(o),N=tr(l),B=h.useCallback(()=>{if(!S.current||!P.current)return;const R={placement:t,strategy:n,middleware:p};I.current&&(R.platform=I.current),i0(S.current,P.current,R).then(T=>{const _={...T,isPositioned:N.current!==!1};F.current&&!Mn(A.current,_)&&(A.current=_,Pi.flushSync(()=>{d(_)}))})},[p,t,n,I,N]);an(()=>{l===!1&&A.current.isPositioned&&(A.current.isPositioned=!1,d(R=>({...R,isPositioned:!1})))},[l]);const F=h.useRef(!1);an(()=>(F.current=!0,()=>{F.current=!1}),[]),an(()=>{if(C&&(S.current=C),w&&(P.current=w),C&&w){if(L.current)return L.current(C,w,B);B()}},[C,w,B,L,D]);const W=h.useMemo(()=>({reference:S,floating:P,setReference:x,setFloating:M}),[x,M]),j=h.useMemo(()=>({reference:C,floating:w}),[C,w]),O=h.useMemo(()=>{const R={position:n,left:0,top:0};if(!j.floating)return R;const T=pi(j.floating,u.x),_=pi(j.floating,u.y);return a?{...R,transform:"translate("+T+"px, "+_+"px)",...xc(j.floating)>=1.5&&{willChange:"transform"}}:{position:n,left:T,top:_}},[n,a,j.floating,u.x,u.y]);return h.useMemo(()=>({...u,update:B,refs:W,elements:j,floatingStyles:O}),[u,B,W,j,O])}const u0=e=>{function t(n){return{}.hasOwnProperty.call(n,"current")}return{name:"arrow",options:e,fn(n){const{element:r,padding:o}=typeof e=="function"?e(n):e;return r&&t(r)?r.current!=null?fi({element:r.current,padding:o}).fn(n):{}:r?fi({element:r,padding:o}).fn(n):{}}}},d0=(e,t)=>({...e0(e),options:[e,t]}),h0=(e,t)=>({...t0(e),options:[e,t]}),f0=(e,t)=>({...s0(e),options:[e,t]}),p0=(e,t)=>({...n0(e),options:[e,t]}),y0=(e,t)=>({...r0(e),options:[e,t]}),m0=(e,t)=>({...o0(e),options:[e,t]}),g0=(e,t)=>({...u0(e),options:[e,t]});var v0="Arrow",Mc=h.forwardRef((e,t)=>{const{children:n,width:r=10,height:o=5,...s}=e;return b.jsx($.svg,{...s,ref:t,width:r,height:o,viewBox:"0 0 30 10",preserveAspectRatio:"none",children:e.asChild?n:b.jsx("polygon",{points:"0,0 30,0 15,10"})})});Mc.displayName=v0;var k0=Mc;function x0(e){const[t,n]=h.useState(void 0);return Te(()=>{if(e){n({width:e.offsetWidth,height:e.offsetHeight});const r=new ResizeObserver(o=>{if(!Array.isArray(o)||!o.length)return;const s=o[0];let i,a;if("borderBoxSize"in s){const c=s.borderBoxSize,l=Array.isArray(c)?c[0]:c;i=l.inlineSize,a=l.blockSize}else i=e.offsetWidth,a=e.offsetHeight;n({width:i,height:a})});return r.observe(e,{box:"border-box"}),()=>r.unobserve(e)}else n(void 0)},[e]),t}var wo="Popper",[wc,bc]=lt(wo),[M0,Cc]=wc(wo),Sc=e=>{const{__scopePopper:t,children:n}=e,[r,o]=h.useState(null);return b.jsx(M0,{scope:t,anchor:r,onAnchorChange:o,children:n})};Sc.displayName=wo;var Pc="PopperAnchor",Ac=h.forwardRef((e,t)=>{const{__scopePopper:n,virtualRef:r,...o}=e,s=Cc(Pc,n),i=h.useRef(null),a=G(t,i),c=h.useRef(null);return h.useEffect(()=>{const l=c.current;c.current=(r==null?void 0:r.current)||i.current,l!==c.current&&s.onAnchorChange(c.current)}),r?null:b.jsx($.div,{...o,ref:a})});Ac.displayName=Pc;var bo="PopperContent",[w0,b0]=wc(bo),Tc=h.forwardRef((e,t)=>{var ve,mt,re,gt,jo,Fo;const{__scopePopper:n,side:r="bottom",sideOffset:o=0,align:s="center",alignOffset:i=0,arrowPadding:a=0,avoidCollisions:c=!0,collisionBoundary:l=[],collisionPadding:u=0,sticky:d="partial",hideWhenDetached:p=!1,updatePositionStrategy:y="optimized",onPlaced:g,...m}=e,v=Cc(bo,n),[k,x]=h.useState(null),M=G(t,vt=>x(vt)),[C,w]=h.useState(null),S=x0(C),P=(S==null?void 0:S.width)??0,A=(S==null?void 0:S.height)??0,D=r+(s!=="center"?"-"+s:""),L=typeof u=="number"?u:{top:0,right:0,bottom:0,left:0,...u},I=Array.isArray(l)?l:[l],N=I.length>0,B={padding:L,boundary:I.filter(S0),altBoundary:N},{refs:F,floatingStyles:W,placement:j,isPositioned:O,middlewareData:R}=l0({strategy:"fixed",placement:D,whileElementsMounted:(...vt)=>J2(...vt,{animationFrame:y==="always"}),elements:{reference:v.anchor},middleware:[d0({mainAxis:o+A,alignmentAxis:i}),c&&h0({mainAxis:!0,crossAxis:!1,limiter:d==="partial"?f0():void 0,...B}),c&&p0({...B}),y0({...B,apply:({elements:vt,rects:No,availableWidth:Yl,availableHeight:Ql})=>{const{width:Jl,height:eu}=No.reference,Wt=vt.floating.style;Wt.setProperty("--radix-popper-available-width",`${Yl}px`),Wt.setProperty("--radix-popper-available-height",`${Ql}px`),Wt.setProperty("--radix-popper-anchor-width",`${Jl}px`),Wt.setProperty("--radix-popper-anchor-height",`${eu}px`)}}),C&&g0({element:C,padding:a}),P0({arrowWidth:P,arrowHeight:A}),p&&m0({strategy:"referenceHidden",...B})]}),[T,_]=Dc(j),Y=Me(g);Te(()=>{O&&(Y==null||Y())},[O,Y]);const de=(ve=R.arrow)==null?void 0:ve.x,pt=(mt=R.arrow)==null?void 0:mt.y,yt=((re=R.arrow)==null?void 0:re.centerOffset)!==0,[$t,Ie]=h.useState();return Te(()=>{k&&Ie(window.getComputedStyle(k).zIndex)},[k]),b.jsx("div",{ref:F.setFloating,"data-radix-popper-content-wrapper":"",style:{...W,transform:O?W.transform:"translate(0, -200%)",minWidth:"max-content",zIndex:$t,"--radix-popper-transform-origin":[(gt=R.transformOrigin)==null?void 0:gt.x,(jo=R.transformOrigin)==null?void 0:jo.y].join(" "),...((Fo=R.hide)==null?void 0:Fo.referenceHidden)&&{visibility:"hidden",pointerEvents:"none"}},dir:e.dir,children:b.jsx(w0,{scope:n,placedSide:T,onArrowChange:w,arrowX:de,arrowY:pt,shouldHideArrow:yt,children:b.jsx($.div,{"data-side":T,"data-align":_,...m,ref:M,style:{...m.style,animation:O?void 0:"none"}})})})});Tc.displayName=bo;var Rc="PopperArrow",C0={top:"bottom",right:"left",bottom:"top",left:"right"},Ec=h.forwardRef(function(t,n){const{__scopePopper:r,...o}=t,s=b0(Rc,r),i=C0[s.placedSide];return b.jsx("span",{ref:s.onArrowChange,style:{position:"absolute",left:s.arrowX,top:s.arrowY,[i]:0,transformOrigin:{top:"",right:"0 0",bottom:"center 0",left:"100% 0"}[s.placedSide],transform:{top:"translateY(100%)",right:"translateY(50%) rotate(90deg) translateX(-50%)",bottom:"rotate(180deg)",left:"translateY(50%) rotate(-90deg) translateX(50%)"}[s.placedSide],visibility:s.shouldHideArrow?"hidden":void 0},children:b.jsx(k0,{...o,ref:n,style:{...o.style,display:"block"}})})});Ec.displayName=Rc;function S0(e){return e!==null}var P0=e=>({name:"transformOrigin",options:e,fn(t){var v,k,x;const{placement:n,rects:r,middlewareData:o}=t,i=((v=o.arrow)==null?void 0:v.centerOffset)!==0,a=i?0:e.arrowWidth,c=i?0:e.arrowHeight,[l,u]=Dc(n),d={start:"0%",center:"50%",end:"100%"}[u],p=(((k=o.arrow)==null?void 0:k.x)??0)+a/2,y=(((x=o.arrow)==null?void 0:x.y)??0)+c/2;let g="",m="";return l==="bottom"?(g=i?d:`${p}px`,m=`${-c}px`):l==="top"?(g=i?d:`${p}px`,m=`${r.floating.height+c}px`):l==="right"?(g=`${-c}px`,m=i?d:`${y}px`):l==="left"&&(g=`${r.floating.width+c}px`,m=i?d:`${y}px`),{data:{x:g,y:m}}}});function Dc(e){const[t,n="center"]=e.split("-");return[t,n]}var A0=Sc,T0=Ac,R0=Tc,E0=Ec,nr="focusScope.autoFocusOnMount",rr="focusScope.autoFocusOnUnmount",yi={bubbles:!1,cancelable:!0},D0="FocusScope",Co=h.forwardRef((e,t)=>{const{loop:n=!1,trapped:r=!1,onMountAutoFocus:o,onUnmountAutoFocus:s,...i}=e,[a,c]=h.useState(null),l=Me(o),u=Me(s),d=h.useRef(null),p=G(t,m=>c(m)),y=h.useRef({paused:!1,pause(){this.paused=!0},resume(){this.paused=!1}}).current;h.useEffect(()=>{if(r){let m=function(M){if(y.paused||!a)return;const C=M.target;a.contains(C)?d.current=C:Pe(d.current,{select:!0})},v=function(M){if(y.paused||!a)return;const C=M.relatedTarget;C!==null&&(a.contains(C)||Pe(d.current,{select:!0}))},k=function(M){if(document.activeElement===document.body)for(const w of M)w.removedNodes.length>0&&Pe(a)};document.addEventListener("focusin",m),document.addEventListener("focusout",v);const x=new MutationObserver(k);return a&&x.observe(a,{childList:!0,subtree:!0}),()=>{document.removeEventListener("focusin",m),document.removeEventListener("focusout",v),x.disconnect()}}},[r,a,y.paused]),h.useEffect(()=>{if(a){gi.add(y);const m=document.activeElement;if(!a.contains(m)){const k=new CustomEvent(nr,yi);a.addEventListener(nr,l),a.dispatchEvent(k),k.defaultPrevented||(L0(F0(Lc(a)),{select:!0}),document.activeElement===m&&Pe(a))}return()=>{a.removeEventListener(nr,l),setTimeout(()=>{const k=new CustomEvent(rr,yi);a.addEventListener(rr,u),a.dispatchEvent(k),k.defaultPrevented||Pe(m??document.body,{select:!0}),a.removeEventListener(rr,u),gi.remove(y)},0)}}},[a,l,u,y]);const g=h.useCallback(m=>{if(!n&&!r||y.paused)return;const v=m.key==="Tab"&&!m.altKey&&!m.ctrlKey&&!m.metaKey,k=document.activeElement;if(v&&k){const x=m.currentTarget,[M,C]=V0(x);M&&C?!m.shiftKey&&k===C?(m.preventDefault(),n&&Pe(M,{select:!0})):m.shiftKey&&k===M&&(m.preventDefault(),n&&Pe(C,{select:!0})):k===x&&m.preventDefault()}},[n,r,y.paused]);return b.jsx($.div,{tabIndex:-1,...i,ref:p,onKeyDown:g})});Co.displayName=D0;function L0(e,{select:t=!1}={}){const n=document.activeElement;for(const r of e)if(Pe(r,{select:t}),document.activeElement!==n)return}function V0(e){const t=Lc(e),n=mi(t,e),r=mi(t.reverse(),e);return[n,r]}function Lc(e){const t=[],n=document.createTreeWalker(e,NodeFilter.SHOW_ELEMENT,{acceptNode:r=>{const o=r.tagName==="INPUT"&&r.type==="hidden";return r.disabled||r.hidden||o?NodeFilter.FILTER_SKIP:r.tabIndex>=0?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP}});for(;n.nextNode();)t.push(n.currentNode);return t}function mi(e,t){for(const n of e)if(!O0(n,{upTo:t}))return n}function O0(e,{upTo:t}){if(getComputedStyle(e).visibility==="hidden")return!0;for(;e;){if(t!==void 0&&e===t)return!1;if(getComputedStyle(e).display==="none")return!0;e=e.parentElement}return!1}function I0(e){return e instanceof HTMLInputElement&&"select"in e}function Pe(e,{select:t=!1}={}){if(e&&e.focus){const n=document.activeElement;e.focus({preventScroll:!0}),e!==n&&I0(e)&&t&&e.select()}}var gi=j0();function j0(){let e=[];return{add(t){const n=e[0];t!==n&&(n==null||n.pause()),e=vi(e,t),e.unshift(t)},remove(t){var n;e=vi(e,t),(n=e[0])==null||n.resume()}}}function vi(e,t){const n=[...e],r=n.indexOf(t);return r!==-1&&n.splice(r,1),n}function F0(e){return e.filter(t=>t.tagName!=="A")}var or=0;function Vc(){h.useEffect(()=>{const e=document.querySelectorAll("[data-radix-focus-guard]");return document.body.insertAdjacentElement("afterbegin",e[0]??ki()),document.body.insertAdjacentElement("beforeend",e[1]??ki()),or++,()=>{or===1&&document.querySelectorAll("[data-radix-focus-guard]").forEach(t=>t.remove()),or--}},[])}function ki(){const e=document.createElement("span");return e.setAttribute("data-radix-focus-guard",""),e.tabIndex=0,e.style.outline="none",e.style.opacity="0",e.style.position="fixed",e.style.pointerEvents="none",e}var cn="right-scroll-bar-position",ln="width-before-scroll-bar",N0="with-scroll-bars-hidden",_0="--removed-body-scroll-bar-size";function sr(e,t){return typeof e=="function"?e(t):e&&(e.current=t),e}function B0(e,t){var n=h.useState(function(){return{value:e,callback:t,facade:{get current(){return n.value},set current(r){var o=n.value;o!==r&&(n.value=r,n.callback(r,o))}}}})[0];return n.callback=t,n.facade}var z0=typeof window<"u"?h.useLayoutEffect:h.useEffect,xi=new WeakMap;function H0(e,t){var n=B0(null,function(r){return e.forEach(function(o){return sr(o,r)})});return z0(function(){var r=xi.get(n);if(r){var o=new Set(r),s=new Set(e),i=n.current;o.forEach(function(a){s.has(a)||sr(a,null)}),s.forEach(function(a){o.has(a)||sr(a,i)})}xi.set(n,e)},[e]),n}function q0(e){return e}function U0(e,t){t===void 0&&(t=q0);var n=[],r=!1,o={read:function(){if(r)throw new Error("Sidecar: could not `read` from an `assigned` medium. `read` could be used only with `useMedium`.");return n.length?n[n.length-1]:e},useMedium:function(s){var i=t(s,r);return n.push(i),function(){n=n.filter(function(a){return a!==i})}},assignSyncMedium:function(s){for(r=!0;n.length;){var i=n;n=[],i.forEach(s)}n={push:function(a){return s(a)},filter:function(){return n}}},assignMedium:function(s){r=!0;var i=[];if(n.length){var a=n;n=[],a.forEach(s),i=n}var c=function(){var u=i;i=[],u.forEach(s)},l=function(){return Promise.resolve().then(c)};l(),n={push:function(u){i.push(u),l()},filter:function(u){return i=i.filter(u),n}}}};return o}function $0(e){e===void 0&&(e={});var t=U0(null);return t.options=Ae({async:!0,ssr:!1},e),t}var Oc=function(e){var t=e.sideCar,n=Ti(e,["sideCar"]);if(!t)throw new Error("Sidecar: please provide `sideCar` property to import the right car");var r=t.read();if(!r)throw new Error("Sidecar medium not found");return h.createElement(r,Ae({},n))};Oc.isSideCarExport=!0;function W0(e,t){return e.useMedium(t),Oc}var Ic=$0(),ir=function(){},jn=h.forwardRef(function(e,t){var n=h.useRef(null),r=h.useState({onScrollCapture:ir,onWheelCapture:ir,onTouchMoveCapture:ir}),o=r[0],s=r[1],i=e.forwardProps,a=e.children,c=e.className,l=e.removeScrollBar,u=e.enabled,d=e.shards,p=e.sideCar,y=e.noRelative,g=e.noIsolation,m=e.inert,v=e.allowPinchZoom,k=e.as,x=k===void 0?"div":k,M=e.gapMode,C=Ti(e,["forwardProps","children","className","removeScrollBar","enabled","shards","sideCar","noRelative","noIsolation","inert","allowPinchZoom","as","gapMode"]),w=p,S=H0([n,t]),P=Ae(Ae({},C),o);return h.createElement(h.Fragment,null,u&&h.createElement(w,{sideCar:Ic,removeScrollBar:l,shards:d,noRelative:y,noIsolation:g,inert:m,setCallbacks:s,allowPinchZoom:!!v,lockRef:n,gapMode:M}),i?h.cloneElement(h.Children.only(a),Ae(Ae({},P),{ref:S})):h.createElement(x,Ae({},P,{className:c,ref:S}),a))});jn.defaultProps={enabled:!0,removeScrollBar:!0,inert:!1};jn.classNames={fullWidth:ln,zeroRight:cn};var K0=function(){if(typeof __webpack_nonce__<"u")return __webpack_nonce__};function G0(){if(!document)return null;var e=document.createElement("style");e.type="text/css";var t=K0();return t&&e.setAttribute("nonce",t),e}function Z0(e,t){e.styleSheet?e.styleSheet.cssText=t:e.appendChild(document.createTextNode(t))}function X0(e){var t=document.head||document.getElementsByTagName("head")[0];t.appendChild(e)}var Y0=function(){var e=0,t=null;return{add:function(n){e==0&&(t=G0())&&(Z0(t,n),X0(t)),e++},remove:function(){e--,!e&&t&&(t.parentNode&&t.parentNode.removeChild(t),t=null)}}},Q0=function(){var e=Y0();return function(t,n){h.useEffect(function(){return e.add(t),function(){e.remove()}},[t&&n])}},jc=function(){var e=Q0(),t=function(n){var r=n.styles,o=n.dynamic;return e(r,o),null};return t},J0={left:0,top:0,right:0,gap:0},ar=function(e){return parseInt(e||"",10)||0},ep=function(e){var t=window.getComputedStyle(document.body),n=t[e==="padding"?"paddingLeft":"marginLeft"],r=t[e==="padding"?"paddingTop":"marginTop"],o=t[e==="padding"?"paddingRight":"marginRight"];return[ar(n),ar(r),ar(o)]},tp=function(e){if(e===void 0&&(e="margin"),typeof window>"u")return J0;var t=ep(e),n=document.documentElement.clientWidth,r=window.innerWidth;return{left:t[0],top:t[1],right:t[2],gap:Math.max(0,r-n+t[2]-t[0])}},np=jc(),ot="data-scroll-locked",rp=function(e,t,n,r){var o=e.left,s=e.top,i=e.right,a=e.gap;return n===void 0&&(n="margin"),`
  .`.concat(N0,` {
   overflow: hidden `).concat(r,`;
   padding-right: `).concat(a,"px ").concat(r,`;
  }
  body[`).concat(ot,`] {
    overflow: hidden `).concat(r,`;
    overscroll-behavior: contain;
    `).concat([t&&"position: relative ".concat(r,";"),n==="margin"&&`
    padding-left: `.concat(o,`px;
    padding-top: `).concat(s,`px;
    padding-right: `).concat(i,`px;
    margin-left:0;
    margin-top:0;
    margin-right: `).concat(a,"px ").concat(r,`;
    `),n==="padding"&&"padding-right: ".concat(a,"px ").concat(r,";")].filter(Boolean).join(""),`
  }
  
  .`).concat(cn,` {
    right: `).concat(a,"px ").concat(r,`;
  }
  
  .`).concat(ln,` {
    margin-right: `).concat(a,"px ").concat(r,`;
  }
  
  .`).concat(cn," .").concat(cn,` {
    right: 0 `).concat(r,`;
  }
  
  .`).concat(ln," .").concat(ln,` {
    margin-right: 0 `).concat(r,`;
  }
  
  body[`).concat(ot,`] {
    `).concat(_0,": ").concat(a,`px;
  }
`)},Mi=function(){var e=parseInt(document.body.getAttribute(ot)||"0",10);return isFinite(e)?e:0},op=function(){h.useEffect(function(){return document.body.setAttribute(ot,(Mi()+1).toString()),function(){var e=Mi()-1;e<=0?document.body.removeAttribute(ot):document.body.setAttribute(ot,e.toString())}},[])},sp=function(e){var t=e.noRelative,n=e.noImportant,r=e.gapMode,o=r===void 0?"margin":r;op();var s=h.useMemo(function(){return tp(o)},[o]);return h.createElement(np,{styles:rp(s,!t,o,n?"":"!important")})},Rr=!1;if(typeof window<"u")try{var Jt=Object.defineProperty({},"passive",{get:function(){return Rr=!0,!0}});window.addEventListener("test",Jt,Jt),window.removeEventListener("test",Jt,Jt)}catch{Rr=!1}var Ge=Rr?{passive:!1}:!1,ip=function(e){return e.tagName==="TEXTAREA"},Fc=function(e,t){if(!(e instanceof Element))return!1;var n=window.getComputedStyle(e);return n[t]!=="hidden"&&!(n.overflowY===n.overflowX&&!ip(e)&&n[t]==="visible")},ap=function(e){return Fc(e,"overflowY")},cp=function(e){return Fc(e,"overflowX")},wi=function(e,t){var n=t.ownerDocument,r=t;do{typeof ShadowRoot<"u"&&r instanceof ShadowRoot&&(r=r.host);var o=Nc(e,r);if(o){var s=_c(e,r),i=s[1],a=s[2];if(i>a)return!0}r=r.parentNode}while(r&&r!==n.body);return!1},lp=function(e){var t=e.scrollTop,n=e.scrollHeight,r=e.clientHeight;return[t,n,r]},up=function(e){var t=e.scrollLeft,n=e.scrollWidth,r=e.clientWidth;return[t,n,r]},Nc=function(e,t){return e==="v"?ap(t):cp(t)},_c=function(e,t){return e==="v"?lp(t):up(t)},dp=function(e,t){return e==="h"&&t==="rtl"?-1:1},hp=function(e,t,n,r,o){var s=dp(e,window.getComputedStyle(t).direction),i=s*r,a=n.target,c=t.contains(a),l=!1,u=i>0,d=0,p=0;do{if(!a)break;var y=_c(e,a),g=y[0],m=y[1],v=y[2],k=m-v-s*g;(g||k)&&Nc(e,a)&&(d+=k,p+=g);var x=a.parentNode;a=x&&x.nodeType===Node.DOCUMENT_FRAGMENT_NODE?x.host:x}while(!c&&a!==document.body||c&&(t.contains(a)||t===a));return(u&&Math.abs(d)<1||!u&&Math.abs(p)<1)&&(l=!0),l},en=function(e){return"changedTouches"in e?[e.changedTouches[0].clientX,e.changedTouches[0].clientY]:[0,0]},bi=function(e){return[e.deltaX,e.deltaY]},Ci=function(e){return e&&"current"in e?e.current:e},fp=function(e,t){return e[0]===t[0]&&e[1]===t[1]},pp=function(e){return`
  .block-interactivity-`.concat(e,` {pointer-events: none;}
  .allow-interactivity-`).concat(e,` {pointer-events: all;}
`)},yp=0,Ze=[];function mp(e){var t=h.useRef([]),n=h.useRef([0,0]),r=h.useRef(),o=h.useState(yp++)[0],s=h.useState(jc)[0],i=h.useRef(e);h.useEffect(function(){i.current=e},[e]),h.useEffect(function(){if(e.inert){document.body.classList.add("block-interactivity-".concat(o));var m=nu([e.lockRef.current],(e.shards||[]).map(Ci),!0).filter(Boolean);return m.forEach(function(v){return v.classList.add("allow-interactivity-".concat(o))}),function(){document.body.classList.remove("block-interactivity-".concat(o)),m.forEach(function(v){return v.classList.remove("allow-interactivity-".concat(o))})}}},[e.inert,e.lockRef.current,e.shards]);var a=h.useCallback(function(m,v){if("touches"in m&&m.touches.length===2||m.type==="wheel"&&m.ctrlKey)return!i.current.allowPinchZoom;var k=en(m),x=n.current,M="deltaX"in m?m.deltaX:x[0]-k[0],C="deltaY"in m?m.deltaY:x[1]-k[1],w,S=m.target,P=Math.abs(M)>Math.abs(C)?"h":"v";if("touches"in m&&P==="h"&&S.type==="range")return!1;var A=window.getSelection(),D=A&&A.anchorNode,L=D?D===S||D.contains(S):!1;if(L)return!1;var I=wi(P,S);if(!I)return!0;if(I?w=P:(w=P==="v"?"h":"v",I=wi(P,S)),!I)return!1;if(!r.current&&"changedTouches"in m&&(M||C)&&(r.current=w),!w)return!0;var N=r.current||w;return hp(N,v,m,N==="h"?M:C)},[]),c=h.useCallback(function(m){var v=m;if(!(!Ze.length||Ze[Ze.length-1]!==s)){var k="deltaY"in v?bi(v):en(v),x=t.current.filter(function(w){return w.name===v.type&&(w.target===v.target||v.target===w.shadowParent)&&fp(w.delta,k)})[0];if(x&&x.should){v.cancelable&&v.preventDefault();return}if(!x){var M=(i.current.shards||[]).map(Ci).filter(Boolean).filter(function(w){return w.contains(v.target)}),C=M.length>0?a(v,M[0]):!i.current.noIsolation;C&&v.cancelable&&v.preventDefault()}}},[]),l=h.useCallback(function(m,v,k,x){var M={name:m,delta:v,target:k,should:x,shadowParent:gp(k)};t.current.push(M),setTimeout(function(){t.current=t.current.filter(function(C){return C!==M})},1)},[]),u=h.useCallback(function(m){n.current=en(m),r.current=void 0},[]),d=h.useCallback(function(m){l(m.type,bi(m),m.target,a(m,e.lockRef.current))},[]),p=h.useCallback(function(m){l(m.type,en(m),m.target,a(m,e.lockRef.current))},[]);h.useEffect(function(){return Ze.push(s),e.setCallbacks({onScrollCapture:d,onWheelCapture:d,onTouchMoveCapture:p}),document.addEventListener("wheel",c,Ge),document.addEventListener("touchmove",c,Ge),document.addEventListener("touchstart",u,Ge),function(){Ze=Ze.filter(function(m){return m!==s}),document.removeEventListener("wheel",c,Ge),document.removeEventListener("touchmove",c,Ge),document.removeEventListener("touchstart",u,Ge)}},[]);var y=e.removeScrollBar,g=e.inert;return h.createElement(h.Fragment,null,g?h.createElement(s,{styles:pp(o)}):null,y?h.createElement(sp,{noRelative:e.noRelative,gapMode:e.gapMode}):null)}function gp(e){for(var t=null;e!==null;)e instanceof ShadowRoot&&(t=e.host,e=e.host),e=e.parentNode;return t}const vp=W0(Ic,mp);var So=h.forwardRef(function(e,t){return h.createElement(jn,Ae({},e,{ref:t,sideCar:vp}))});So.classNames=jn.classNames;var kp=function(e){if(typeof document>"u")return null;var t=Array.isArray(e)?e[0]:e;return t.ownerDocument.body},Xe=new WeakMap,tn=new WeakMap,nn={},cr=0,Bc=function(e){return e&&(e.host||Bc(e.parentNode))},xp=function(e,t){return t.map(function(n){if(e.contains(n))return n;var r=Bc(n);return r&&e.contains(r)?r:(console.error("aria-hidden",n,"in not contained inside",e,". Doing nothing"),null)}).filter(function(n){return!!n})},Mp=function(e,t,n,r){var o=xp(t,Array.isArray(e)?e:[e]);nn[n]||(nn[n]=new WeakMap);var s=nn[n],i=[],a=new Set,c=new Set(o),l=function(d){!d||a.has(d)||(a.add(d),l(d.parentNode))};o.forEach(l);var u=function(d){!d||c.has(d)||Array.prototype.forEach.call(d.children,function(p){if(a.has(p))u(p);else try{var y=p.getAttribute(r),g=y!==null&&y!=="false",m=(Xe.get(p)||0)+1,v=(s.get(p)||0)+1;Xe.set(p,m),s.set(p,v),i.push(p),m===1&&g&&tn.set(p,!0),v===1&&p.setAttribute(n,"true"),g||p.setAttribute(r,"true")}catch(k){console.error("aria-hidden: cannot operate on ",p,k)}})};return u(t),a.clear(),cr++,function(){i.forEach(function(d){var p=Xe.get(d)-1,y=s.get(d)-1;Xe.set(d,p),s.set(d,y),p||(tn.has(d)||d.removeAttribute(r),tn.delete(d)),y||d.removeAttribute(n)}),cr--,cr||(Xe=new WeakMap,Xe=new WeakMap,tn=new WeakMap,nn={})}},zc=function(e,t,n){n===void 0&&(n="data-aria-hidden");var r=Array.from(Array.isArray(e)?e:[e]),o=kp(e);return o?(r.push.apply(r,Array.from(o.querySelectorAll("[aria-live], script"))),Mp(r,o,n,"aria-hidden")):function(){return null}};function wp(e){const t=bp(e),n=h.forwardRef((r,o)=>{const{children:s,...i}=r,a=h.Children.toArray(s),c=a.find(Sp);if(c){const l=c.props.children,u=a.map(d=>d===c?h.Children.count(l)>1?h.Children.only(null):h.isValidElement(l)?l.props.children:null:d);return b.jsx(t,{...i,ref:o,children:h.isValidElement(l)?h.cloneElement(l,void 0,u):null})}return b.jsx(t,{...i,ref:o,children:s})});return n.displayName=`${e}.Slot`,n}function bp(e){const t=h.forwardRef((n,r)=>{const{children:o,...s}=n;if(h.isValidElement(o)){const i=Ap(o),a=Pp(s,o.props);return o.type!==h.Fragment&&(a.ref=r?Ue(r,i):i),h.cloneElement(o,a)}return h.Children.count(o)>1?h.Children.only(null):null});return t.displayName=`${e}.SlotClone`,t}var Cp=Symbol("radix.slottable");function Sp(e){return h.isValidElement(e)&&typeof e.type=="function"&&"__radixId"in e.type&&e.type.__radixId===Cp}function Pp(e,t){const n={...t};for(const r in t){const o=e[r],s=t[r];/^on[A-Z]/.test(r)?o&&s?n[r]=(...a)=>{const c=s(...a);return o(...a),c}:o&&(n[r]=o):r==="style"?n[r]={...o,...s}:r==="className"&&(n[r]=[o,s].filter(Boolean).join(" "))}return{...e,...n}}function Ap(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}var Fn="Dialog",[Hc,c5]=lt(Fn),[Tp,ue]=Hc(Fn),qc=e=>{const{__scopeDialog:t,children:n,open:r,defaultOpen:o,onOpenChange:s,modal:i=!0}=e,a=h.useRef(null),c=h.useRef(null),[l,u]=Vr({prop:r,defaultProp:o??!1,onChange:s,caller:Fn});return b.jsx(Tp,{scope:t,triggerRef:a,contentRef:c,contentId:nt(),titleId:nt(),descriptionId:nt(),open:l,onOpenChange:u,onOpenToggle:h.useCallback(()=>u(d=>!d),[u]),modal:i,children:n})};qc.displayName=Fn;var Uc="DialogTrigger",$c=h.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(Uc,n),s=G(t,o.triggerRef);return b.jsx($.button,{type:"button","aria-haspopup":"dialog","aria-expanded":o.open,"aria-controls":o.contentId,"data-state":To(o.open),...r,ref:s,onClick:V(e.onClick,o.onOpenToggle)})});$c.displayName=Uc;var Po="DialogPortal",[Rp,Wc]=Hc(Po,{forceMount:void 0}),Kc=e=>{const{__scopeDialog:t,forceMount:n,children:r,container:o}=e,s=ue(Po,t);return b.jsx(Rp,{scope:t,forceMount:n,children:h.Children.map(r,i=>b.jsx(Ve,{present:n||s.open,children:b.jsx(Lr,{asChild:!0,container:o,children:i})}))})};Kc.displayName=Po;var wn="DialogOverlay",Gc=h.forwardRef((e,t)=>{const n=Wc(wn,e.__scopeDialog),{forceMount:r=n.forceMount,...o}=e,s=ue(wn,e.__scopeDialog);return s.modal?b.jsx(Ve,{present:r||s.open,children:b.jsx(Dp,{...o,ref:t})}):null});Gc.displayName=wn;var Ep=wp("DialogOverlay.RemoveScroll"),Dp=h.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(wn,n);return b.jsx(So,{as:Ep,allowPinchZoom:!0,shards:[o.contentRef],children:b.jsx($.div,{"data-state":To(o.open),...r,ref:t,style:{pointerEvents:"auto",...r.style}})})}),qe="DialogContent",Zc=h.forwardRef((e,t)=>{const n=Wc(qe,e.__scopeDialog),{forceMount:r=n.forceMount,...o}=e,s=ue(qe,e.__scopeDialog);return b.jsx(Ve,{present:r||s.open,children:s.modal?b.jsx(Lp,{...o,ref:t}):b.jsx(Vp,{...o,ref:t})})});Zc.displayName=qe;var Lp=h.forwardRef((e,t)=>{const n=ue(qe,e.__scopeDialog),r=h.useRef(null),o=G(t,n.contentRef,r);return h.useEffect(()=>{const s=r.current;if(s)return zc(s)},[]),b.jsx(Xc,{...e,ref:o,trapFocus:n.open,disableOutsidePointerEvents:!0,onCloseAutoFocus:V(e.onCloseAutoFocus,s=>{var i;s.preventDefault(),(i=n.triggerRef.current)==null||i.focus()}),onPointerDownOutside:V(e.onPointerDownOutside,s=>{const i=s.detail.originalEvent,a=i.button===0&&i.ctrlKey===!0;(i.button===2||a)&&s.preventDefault()}),onFocusOutside:V(e.onFocusOutside,s=>s.preventDefault())})}),Vp=h.forwardRef((e,t)=>{const n=ue(qe,e.__scopeDialog),r=h.useRef(!1),o=h.useRef(!1);return b.jsx(Xc,{...e,ref:t,trapFocus:!1,disableOutsidePointerEvents:!1,onCloseAutoFocus:s=>{var i,a;(i=e.onCloseAutoFocus)==null||i.call(e,s),s.defaultPrevented||(r.current||(a=n.triggerRef.current)==null||a.focus(),s.preventDefault()),r.current=!1,o.current=!1},onInteractOutside:s=>{var c,l;(c=e.onInteractOutside)==null||c.call(e,s),s.defaultPrevented||(r.current=!0,s.detail.originalEvent.type==="pointerdown"&&(o.current=!0));const i=s.target;((l=n.triggerRef.current)==null?void 0:l.contains(i))&&s.preventDefault(),s.detail.originalEvent.type==="focusin"&&o.current&&s.preventDefault()}})}),Xc=h.forwardRef((e,t)=>{const{__scopeDialog:n,trapFocus:r,onOpenAutoFocus:o,onCloseAutoFocus:s,...i}=e,a=ue(qe,n),c=h.useRef(null),l=G(t,c);return Vc(),b.jsxs(b.Fragment,{children:[b.jsx(Co,{asChild:!0,loop:!0,trapped:r,onMountAutoFocus:o,onUnmountAutoFocus:s,children:b.jsx(Sn,{role:"dialog",id:a.contentId,"aria-describedby":a.descriptionId,"aria-labelledby":a.titleId,"data-state":To(a.open),...i,ref:l,onDismiss:()=>a.onOpenChange(!1)})}),b.jsxs(b.Fragment,{children:[b.jsx(Op,{titleId:a.titleId}),b.jsx(jp,{contentRef:c,descriptionId:a.descriptionId})]})]})}),Ao="DialogTitle",Yc=h.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(Ao,n);return b.jsx($.h2,{id:o.titleId,...r,ref:t})});Yc.displayName=Ao;var Qc="DialogDescription",Jc=h.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(Qc,n);return b.jsx($.p,{id:o.descriptionId,...r,ref:t})});Jc.displayName=Qc;var el="DialogClose",tl=h.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(el,n);return b.jsx($.button,{type:"button",...r,ref:t,onClick:V(e.onClick,()=>o.onOpenChange(!1))})});tl.displayName=el;function To(e){return e?"open":"closed"}var nl="DialogTitleWarning",[l5,rl]=ru(nl,{contentName:qe,titleName:Ao,docsSlug:"dialog"}),Op=({titleId:e})=>{const t=rl(nl),n=`\`${t.contentName}\` requires a \`${t.titleName}\` for the component to be accessible for screen reader users.

If you want to hide the \`${t.titleName}\`, you can wrap it with our VisuallyHidden component.

For more information, see https://radix-ui.com/primitives/docs/components/${t.docsSlug}`;return h.useEffect(()=>{e&&(document.getElementById(e)||console.error(n))},[n,e]),null},Ip="DialogDescriptionWarning",jp=({contentRef:e,descriptionId:t})=>{const r=`Warning: Missing \`Description\` or \`aria-describedby={undefined}\` for {${rl(Ip).contentName}}.`;return h.useEffect(()=>{var s;const o=(s=e.current)==null?void 0:s.getAttribute("aria-describedby");t&&o&&(document.getElementById(t)||console.warn(r))},[r,e,t]),null},u5=qc,d5=$c,h5=Kc,f5=Gc,p5=Zc,y5=Yc,m5=Jc,g5=tl,Fp=h.createContext(void 0);function ol(e){const t=h.useContext(Fp);return e||t||"ltr"}var lr="rovingFocusGroup.onEntryFocus",Np={bubbles:!1,cancelable:!0},Ht="RovingFocusGroup",[Er,sl,_p]=Ri(Ht),[Bp,il]=lt(Ht,[_p]),[zp,Hp]=Bp(Ht),al=h.forwardRef((e,t)=>b.jsx(Er.Provider,{scope:e.__scopeRovingFocusGroup,children:b.jsx(Er.Slot,{scope:e.__scopeRovingFocusGroup,children:b.jsx(qp,{...e,ref:t})})}));al.displayName=Ht;var qp=h.forwardRef((e,t)=>{const{__scopeRovingFocusGroup:n,orientation:r,loop:o=!1,dir:s,currentTabStopId:i,defaultCurrentTabStopId:a,onCurrentTabStopIdChange:c,onEntryFocus:l,preventScrollOnEntryFocus:u=!1,...d}=e,p=h.useRef(null),y=G(t,p),g=ol(s),[m,v]=Vr({prop:i,defaultProp:a??null,onChange:c,caller:Ht}),[k,x]=h.useState(!1),M=Me(l),C=sl(n),w=h.useRef(!1),[S,P]=h.useState(0);return h.useEffect(()=>{const A=p.current;if(A)return A.addEventListener(lr,M),()=>A.removeEventListener(lr,M)},[M]),b.jsx(zp,{scope:n,orientation:r,dir:g,loop:o,currentTabStopId:m,onItemFocus:h.useCallback(A=>v(A),[v]),onItemShiftTab:h.useCallback(()=>x(!0),[]),onFocusableItemAdd:h.useCallback(()=>P(A=>A+1),[]),onFocusableItemRemove:h.useCallback(()=>P(A=>A-1),[]),children:b.jsx($.div,{tabIndex:k||S===0?-1:0,"data-orientation":r,...d,ref:y,style:{outline:"none",...e.style},onMouseDown:V(e.onMouseDown,()=>{w.current=!0}),onFocus:V(e.onFocus,A=>{const D=!w.current;if(A.target===A.currentTarget&&D&&!k){const L=new CustomEvent(lr,Np);if(A.currentTarget.dispatchEvent(L),!L.defaultPrevented){const I=C().filter(j=>j.focusable),N=I.find(j=>j.active),B=I.find(j=>j.id===m),W=[N,B,...I].filter(Boolean).map(j=>j.ref.current);ul(W,u)}}w.current=!1}),onBlur:V(e.onBlur,()=>x(!1))})})}),cl="RovingFocusGroupItem",ll=h.forwardRef((e,t)=>{const{__scopeRovingFocusGroup:n,focusable:r=!0,active:o=!1,tabStopId:s,children:i,...a}=e,c=nt(),l=s||c,u=Hp(cl,n),d=u.currentTabStopId===l,p=sl(n),{onFocusableItemAdd:y,onFocusableItemRemove:g,currentTabStopId:m}=u;return h.useEffect(()=>{if(r)return y(),()=>g()},[r,y,g]),b.jsx(Er.ItemSlot,{scope:n,id:l,focusable:r,active:o,children:b.jsx($.span,{tabIndex:d?0:-1,"data-orientation":u.orientation,...a,ref:t,onMouseDown:V(e.onMouseDown,v=>{r?u.onItemFocus(l):v.preventDefault()}),onFocus:V(e.onFocus,()=>u.onItemFocus(l)),onKeyDown:V(e.onKeyDown,v=>{if(v.key==="Tab"&&v.shiftKey){u.onItemShiftTab();return}if(v.target!==v.currentTarget)return;const k=Wp(v,u.orientation,u.dir);if(k!==void 0){if(v.metaKey||v.ctrlKey||v.altKey||v.shiftKey)return;v.preventDefault();let M=p().filter(C=>C.focusable).map(C=>C.ref.current);if(k==="last")M.reverse();else if(k==="prev"||k==="next"){k==="prev"&&M.reverse();const C=M.indexOf(v.currentTarget);M=u.loop?Kp(M,C+1):M.slice(C+1)}setTimeout(()=>ul(M))}}),children:typeof i=="function"?i({isCurrentTabStop:d,hasTabStop:m!=null}):i})})});ll.displayName=cl;var Up={ArrowLeft:"prev",ArrowUp:"prev",ArrowRight:"next",ArrowDown:"next",PageUp:"first",Home:"first",PageDown:"last",End:"last"};function $p(e,t){return t!=="rtl"?e:e==="ArrowLeft"?"ArrowRight":e==="ArrowRight"?"ArrowLeft":e}function Wp(e,t,n){const r=$p(e.key,n);if(!(t==="vertical"&&["ArrowLeft","ArrowRight"].includes(r))&&!(t==="horizontal"&&["ArrowUp","ArrowDown"].includes(r)))return Up[r]}function ul(e,t=!1){const n=document.activeElement;for(const r of e)if(r===n||(r.focus({preventScroll:t}),document.activeElement!==n))return}function Kp(e,t){return e.map((n,r)=>e[(t+r)%e.length])}var Gp=al,Zp=ll;function Xp(e){const t=Yp(e),n=h.forwardRef((r,o)=>{const{children:s,...i}=r,a=h.Children.toArray(s),c=a.find(Jp);if(c){const l=c.props.children,u=a.map(d=>d===c?h.Children.count(l)>1?h.Children.only(null):h.isValidElement(l)?l.props.children:null:d);return b.jsx(t,{...i,ref:o,children:h.isValidElement(l)?h.cloneElement(l,void 0,u):null})}return b.jsx(t,{...i,ref:o,children:s})});return n.displayName=`${e}.Slot`,n}function Yp(e){const t=h.forwardRef((n,r)=>{const{children:o,...s}=n;if(h.isValidElement(o)){const i=ty(o),a=ey(s,o.props);return o.type!==h.Fragment&&(a.ref=r?Ue(r,i):i),h.cloneElement(o,a)}return h.Children.count(o)>1?h.Children.only(null):null});return t.displayName=`${e}.SlotClone`,t}var Qp=Symbol("radix.slottable");function Jp(e){return h.isValidElement(e)&&typeof e.type=="function"&&"__radixId"in e.type&&e.type.__radixId===Qp}function ey(e,t){const n={...t};for(const r in t){const o=e[r],s=t[r];/^on[A-Z]/.test(r)?o&&s?n[r]=(...a)=>{const c=s(...a);return o(...a),c}:o&&(n[r]=o):r==="style"?n[r]={...o,...s}:r==="className"&&(n[r]=[o,s].filter(Boolean).join(" "))}return{...e,...n}}function ty(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}var Dr=["Enter"," "],ny=["ArrowDown","PageUp","Home"],dl=["ArrowUp","PageDown","End"],ry=[...ny,...dl],oy={ltr:[...Dr,"ArrowRight"],rtl:[...Dr,"ArrowLeft"]},sy={ltr:["ArrowLeft"],rtl:["ArrowRight"]},qt="Menu",[It,iy,ay]=Ri(qt),[We,hl]=lt(qt,[ay,bc,il]),Nn=bc(),fl=il(),[cy,Ke]=We(qt),[ly,Ut]=We(qt),pl=e=>{const{__scopeMenu:t,open:n=!1,children:r,dir:o,onOpenChange:s,modal:i=!0}=e,a=Nn(t),[c,l]=h.useState(null),u=h.useRef(!1),d=Me(s),p=ol(o);return h.useEffect(()=>{const y=()=>{u.current=!0,document.addEventListener("pointerdown",g,{capture:!0,once:!0}),document.addEventListener("pointermove",g,{capture:!0,once:!0})},g=()=>u.current=!1;return document.addEventListener("keydown",y,{capture:!0}),()=>{document.removeEventListener("keydown",y,{capture:!0}),document.removeEventListener("pointerdown",g,{capture:!0}),document.removeEventListener("pointermove",g,{capture:!0})}},[]),b.jsx(A0,{...a,children:b.jsx(cy,{scope:t,open:n,onOpenChange:d,content:c,onContentChange:l,children:b.jsx(ly,{scope:t,onClose:h.useCallback(()=>d(!1),[d]),isUsingKeyboardRef:u,dir:p,modal:i,children:r})})})};pl.displayName=qt;var uy="MenuAnchor",Ro=h.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e,o=Nn(n);return b.jsx(T0,{...o,...r,ref:t})});Ro.displayName=uy;var Eo="MenuPortal",[dy,yl]=We(Eo,{forceMount:void 0}),ml=e=>{const{__scopeMenu:t,forceMount:n,children:r,container:o}=e,s=Ke(Eo,t);return b.jsx(dy,{scope:t,forceMount:n,children:b.jsx(Ve,{present:n||s.open,children:b.jsx(Lr,{asChild:!0,container:o,children:r})})})};ml.displayName=Eo;var ie="MenuContent",[hy,Do]=We(ie),gl=h.forwardRef((e,t)=>{const n=yl(ie,e.__scopeMenu),{forceMount:r=n.forceMount,...o}=e,s=Ke(ie,e.__scopeMenu),i=Ut(ie,e.__scopeMenu);return b.jsx(It.Provider,{scope:e.__scopeMenu,children:b.jsx(Ve,{present:r||s.open,children:b.jsx(It.Slot,{scope:e.__scopeMenu,children:i.modal?b.jsx(fy,{...o,ref:t}):b.jsx(py,{...o,ref:t})})})})}),fy=h.forwardRef((e,t)=>{const n=Ke(ie,e.__scopeMenu),r=h.useRef(null),o=G(t,r);return h.useEffect(()=>{const s=r.current;if(s)return zc(s)},[]),b.jsx(Lo,{...e,ref:o,trapFocus:n.open,disableOutsidePointerEvents:n.open,disableOutsideScroll:!0,onFocusOutside:V(e.onFocusOutside,s=>s.preventDefault(),{checkForDefaultPrevented:!1}),onDismiss:()=>n.onOpenChange(!1)})}),py=h.forwardRef((e,t)=>{const n=Ke(ie,e.__scopeMenu);return b.jsx(Lo,{...e,ref:t,trapFocus:!1,disableOutsidePointerEvents:!1,disableOutsideScroll:!1,onDismiss:()=>n.onOpenChange(!1)})}),yy=Xp("MenuContent.ScrollLock"),Lo=h.forwardRef((e,t)=>{const{__scopeMenu:n,loop:r=!1,trapFocus:o,onOpenAutoFocus:s,onCloseAutoFocus:i,disableOutsidePointerEvents:a,onEntryFocus:c,onEscapeKeyDown:l,onPointerDownOutside:u,onFocusOutside:d,onInteractOutside:p,onDismiss:y,disableOutsideScroll:g,...m}=e,v=Ke(ie,n),k=Ut(ie,n),x=Nn(n),M=fl(n),C=iy(n),[w,S]=h.useState(null),P=h.useRef(null),A=G(t,P,v.onContentChange),D=h.useRef(0),L=h.useRef(""),I=h.useRef(0),N=h.useRef(null),B=h.useRef("right"),F=h.useRef(0),W=g?So:h.Fragment,j=g?{as:yy,allowPinchZoom:!0}:void 0,O=T=>{var ve,mt;const _=L.current+T,Y=C().filter(re=>!re.disabled),de=document.activeElement,pt=(ve=Y.find(re=>re.ref.current===de))==null?void 0:ve.textValue,yt=Y.map(re=>re.textValue),$t=Ay(yt,_,pt),Ie=(mt=Y.find(re=>re.textValue===$t))==null?void 0:mt.ref.current;(function re(gt){L.current=gt,window.clearTimeout(D.current),gt!==""&&(D.current=window.setTimeout(()=>re(""),1e3))})(_),Ie&&setTimeout(()=>Ie.focus())};h.useEffect(()=>()=>window.clearTimeout(D.current),[]),Vc();const R=h.useCallback(T=>{var Y,de;return B.current===((Y=N.current)==null?void 0:Y.side)&&Ry(T,(de=N.current)==null?void 0:de.area)},[]);return b.jsx(hy,{scope:n,searchRef:L,onItemEnter:h.useCallback(T=>{R(T)&&T.preventDefault()},[R]),onItemLeave:h.useCallback(T=>{var _;R(T)||((_=P.current)==null||_.focus(),S(null))},[R]),onTriggerLeave:h.useCallback(T=>{R(T)&&T.preventDefault()},[R]),pointerGraceTimerRef:I,onPointerGraceIntentChange:h.useCallback(T=>{N.current=T},[]),children:b.jsx(W,{...j,children:b.jsx(Co,{asChild:!0,trapped:o,onMountAutoFocus:V(s,T=>{var _;T.preventDefault(),(_=P.current)==null||_.focus({preventScroll:!0})}),onUnmountAutoFocus:i,children:b.jsx(Sn,{asChild:!0,disableOutsidePointerEvents:a,onEscapeKeyDown:l,onPointerDownOutside:u,onFocusOutside:d,onInteractOutside:p,onDismiss:y,children:b.jsx(Gp,{asChild:!0,...M,dir:k.dir,orientation:"vertical",loop:r,currentTabStopId:w,onCurrentTabStopIdChange:S,onEntryFocus:V(c,T=>{k.isUsingKeyboardRef.current||T.preventDefault()}),preventScrollOnEntryFocus:!0,children:b.jsx(R0,{role:"menu","aria-orientation":"vertical","data-state":Vl(v.open),"data-radix-menu-content":"",dir:k.dir,...x,...m,ref:A,style:{outline:"none",...m.style},onKeyDown:V(m.onKeyDown,T=>{const Y=T.target.closest("[data-radix-menu-content]")===T.currentTarget,de=T.ctrlKey||T.altKey||T.metaKey,pt=T.key.length===1;Y&&(T.key==="Tab"&&T.preventDefault(),!de&&pt&&O(T.key));const yt=P.current;if(T.target!==yt||!ry.includes(T.key))return;T.preventDefault();const Ie=C().filter(ve=>!ve.disabled).map(ve=>ve.ref.current);dl.includes(T.key)&&Ie.reverse(),Sy(Ie)}),onBlur:V(e.onBlur,T=>{T.currentTarget.contains(T.target)||(window.clearTimeout(D.current),L.current="")}),onPointerMove:V(e.onPointerMove,jt(T=>{const _=T.target,Y=F.current!==T.clientX;if(T.currentTarget.contains(_)&&Y){const de=T.clientX>F.current?"right":"left";B.current=de,F.current=T.clientX}}))})})})})})})});gl.displayName=ie;var my="MenuGroup",Vo=h.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e;return b.jsx($.div,{role:"group",...r,ref:t})});Vo.displayName=my;var gy="MenuLabel",vl=h.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e;return b.jsx($.div,{...r,ref:t})});vl.displayName=gy;var bn="MenuItem",Si="menu.itemSelect",_n=h.forwardRef((e,t)=>{const{disabled:n=!1,onSelect:r,...o}=e,s=h.useRef(null),i=Ut(bn,e.__scopeMenu),a=Do(bn,e.__scopeMenu),c=G(t,s),l=h.useRef(!1),u=()=>{const d=s.current;if(!n&&d){const p=new CustomEvent(Si,{bubbles:!0,cancelable:!0});d.addEventListener(Si,y=>r==null?void 0:r(y),{once:!0}),Ei(d,p),p.defaultPrevented?l.current=!1:i.onClose()}};return b.jsx(kl,{...o,ref:c,disabled:n,onClick:V(e.onClick,u),onPointerDown:d=>{var p;(p=e.onPointerDown)==null||p.call(e,d),l.current=!0},onPointerUp:V(e.onPointerUp,d=>{var p;l.current||(p=d.currentTarget)==null||p.click()}),onKeyDown:V(e.onKeyDown,d=>{const p=a.searchRef.current!=="";n||p&&d.key===" "||Dr.includes(d.key)&&(d.currentTarget.click(),d.preventDefault())})})});_n.displayName=bn;var kl=h.forwardRef((e,t)=>{const{__scopeMenu:n,disabled:r=!1,textValue:o,...s}=e,i=Do(bn,n),a=fl(n),c=h.useRef(null),l=G(t,c),[u,d]=h.useState(!1),[p,y]=h.useState("");return h.useEffect(()=>{const g=c.current;g&&y((g.textContent??"").trim())},[s.children]),b.jsx(It.ItemSlot,{scope:n,disabled:r,textValue:o??p,children:b.jsx(Zp,{asChild:!0,...a,focusable:!r,children:b.jsx($.div,{role:"menuitem","data-highlighted":u?"":void 0,"aria-disabled":r||void 0,"data-disabled":r?"":void 0,...s,ref:l,onPointerMove:V(e.onPointerMove,jt(g=>{r?i.onItemLeave(g):(i.onItemEnter(g),g.defaultPrevented||g.currentTarget.focus({preventScroll:!0}))})),onPointerLeave:V(e.onPointerLeave,jt(g=>i.onItemLeave(g))),onFocus:V(e.onFocus,()=>d(!0)),onBlur:V(e.onBlur,()=>d(!1))})})})}),vy="MenuCheckboxItem",xl=h.forwardRef((e,t)=>{const{checked:n=!1,onCheckedChange:r,...o}=e;return b.jsx(Sl,{scope:e.__scopeMenu,checked:n,children:b.jsx(_n,{role:"menuitemcheckbox","aria-checked":Cn(n)?"mixed":n,...o,ref:t,"data-state":Io(n),onSelect:V(o.onSelect,()=>r==null?void 0:r(Cn(n)?!0:!n),{checkForDefaultPrevented:!1})})})});xl.displayName=vy;var Ml="MenuRadioGroup",[ky,xy]=We(Ml,{value:void 0,onValueChange:()=>{}}),wl=h.forwardRef((e,t)=>{const{value:n,onValueChange:r,...o}=e,s=Me(r);return b.jsx(ky,{scope:e.__scopeMenu,value:n,onValueChange:s,children:b.jsx(Vo,{...o,ref:t})})});wl.displayName=Ml;var bl="MenuRadioItem",Cl=h.forwardRef((e,t)=>{const{value:n,...r}=e,o=xy(bl,e.__scopeMenu),s=n===o.value;return b.jsx(Sl,{scope:e.__scopeMenu,checked:s,children:b.jsx(_n,{role:"menuitemradio","aria-checked":s,...r,ref:t,"data-state":Io(s),onSelect:V(r.onSelect,()=>{var i;return(i=o.onValueChange)==null?void 0:i.call(o,n)},{checkForDefaultPrevented:!1})})})});Cl.displayName=bl;var Oo="MenuItemIndicator",[Sl,My]=We(Oo,{checked:!1}),Pl=h.forwardRef((e,t)=>{const{__scopeMenu:n,forceMount:r,...o}=e,s=My(Oo,n);return b.jsx(Ve,{present:r||Cn(s.checked)||s.checked===!0,children:b.jsx($.span,{...o,ref:t,"data-state":Io(s.checked)})})});Pl.displayName=Oo;var wy="MenuSeparator",Al=h.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e;return b.jsx($.div,{role:"separator","aria-orientation":"horizontal",...r,ref:t})});Al.displayName=wy;var by="MenuArrow",Tl=h.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e,o=Nn(n);return b.jsx(E0,{...o,...r,ref:t})});Tl.displayName=by;var Cy="MenuSub",[v5,Rl]=We(Cy),bt="MenuSubTrigger",El=h.forwardRef((e,t)=>{const n=Ke(bt,e.__scopeMenu),r=Ut(bt,e.__scopeMenu),o=Rl(bt,e.__scopeMenu),s=Do(bt,e.__scopeMenu),i=h.useRef(null),{pointerGraceTimerRef:a,onPointerGraceIntentChange:c}=s,l={__scopeMenu:e.__scopeMenu},u=h.useCallback(()=>{i.current&&window.clearTimeout(i.current),i.current=null},[]);return h.useEffect(()=>u,[u]),h.useEffect(()=>{const d=a.current;return()=>{window.clearTimeout(d),c(null)}},[a,c]),b.jsx(Ro,{asChild:!0,...l,children:b.jsx(kl,{id:o.triggerId,"aria-haspopup":"menu","aria-expanded":n.open,"aria-controls":o.contentId,"data-state":Vl(n.open),...e,ref:Ue(t,o.onTriggerChange),onClick:d=>{var p;(p=e.onClick)==null||p.call(e,d),!(e.disabled||d.defaultPrevented)&&(d.currentTarget.focus(),n.open||n.onOpenChange(!0))},onPointerMove:V(e.onPointerMove,jt(d=>{s.onItemEnter(d),!d.defaultPrevented&&!e.disabled&&!n.open&&!i.current&&(s.onPointerGraceIntentChange(null),i.current=window.setTimeout(()=>{n.onOpenChange(!0),u()},100))})),onPointerLeave:V(e.onPointerLeave,jt(d=>{var y,g;u();const p=(y=n.content)==null?void 0:y.getBoundingClientRect();if(p){const m=(g=n.content)==null?void 0:g.dataset.side,v=m==="right",k=v?-5:5,x=p[v?"left":"right"],M=p[v?"right":"left"];s.onPointerGraceIntentChange({area:[{x:d.clientX+k,y:d.clientY},{x,y:p.top},{x:M,y:p.top},{x:M,y:p.bottom},{x,y:p.bottom}],side:m}),window.clearTimeout(a.current),a.current=window.setTimeout(()=>s.onPointerGraceIntentChange(null),300)}else{if(s.onTriggerLeave(d),d.defaultPrevented)return;s.onPointerGraceIntentChange(null)}})),onKeyDown:V(e.onKeyDown,d=>{var y;const p=s.searchRef.current!=="";e.disabled||p&&d.key===" "||oy[r.dir].includes(d.key)&&(n.onOpenChange(!0),(y=n.content)==null||y.focus(),d.preventDefault())})})})});El.displayName=bt;var Dl="MenuSubContent",Ll=h.forwardRef((e,t)=>{const n=yl(ie,e.__scopeMenu),{forceMount:r=n.forceMount,...o}=e,s=Ke(ie,e.__scopeMenu),i=Ut(ie,e.__scopeMenu),a=Rl(Dl,e.__scopeMenu),c=h.useRef(null),l=G(t,c);return b.jsx(It.Provider,{scope:e.__scopeMenu,children:b.jsx(Ve,{present:r||s.open,children:b.jsx(It.Slot,{scope:e.__scopeMenu,children:b.jsx(Lo,{id:a.contentId,"aria-labelledby":a.triggerId,...o,ref:l,align:"start",side:i.dir==="rtl"?"left":"right",disableOutsidePointerEvents:!1,disableOutsideScroll:!1,trapFocus:!1,onOpenAutoFocus:u=>{var d;i.isUsingKeyboardRef.current&&((d=c.current)==null||d.focus()),u.preventDefault()},onCloseAutoFocus:u=>u.preventDefault(),onFocusOutside:V(e.onFocusOutside,u=>{u.target!==a.trigger&&s.onOpenChange(!1)}),onEscapeKeyDown:V(e.onEscapeKeyDown,u=>{i.onClose(),u.preventDefault()}),onKeyDown:V(e.onKeyDown,u=>{var y;const d=u.currentTarget.contains(u.target),p=sy[i.dir].includes(u.key);d&&p&&(s.onOpenChange(!1),(y=a.trigger)==null||y.focus(),u.preventDefault())})})})})})});Ll.displayName=Dl;function Vl(e){return e?"open":"closed"}function Cn(e){return e==="indeterminate"}function Io(e){return Cn(e)?"indeterminate":e?"checked":"unchecked"}function Sy(e){const t=document.activeElement;for(const n of e)if(n===t||(n.focus(),document.activeElement!==t))return}function Py(e,t){return e.map((n,r)=>e[(t+r)%e.length])}function Ay(e,t,n){const o=t.length>1&&Array.from(t).every(l=>l===t[0])?t[0]:t,s=n?e.indexOf(n):-1;let i=Py(e,Math.max(s,0));o.length===1&&(i=i.filter(l=>l!==n));const c=i.find(l=>l.toLowerCase().startsWith(o.toLowerCase()));return c!==n?c:void 0}function Ty(e,t){const{x:n,y:r}=e;let o=!1;for(let s=0,i=t.length-1;s<t.length;i=s++){const a=t[s],c=t[i],l=a.x,u=a.y,d=c.x,p=c.y;u>r!=p>r&&n<(d-l)*(r-u)/(p-u)+l&&(o=!o)}return o}function Ry(e,t){if(!t)return!1;const n={x:e.clientX,y:e.clientY};return Ty(n,t)}function jt(e){return t=>t.pointerType==="mouse"?e(t):void 0}var Ey=pl,Dy=Ro,Ly=ml,Vy=gl,Oy=Vo,Iy=vl,jy=_n,Fy=xl,Ny=wl,_y=Cl,By=Pl,zy=Al,Hy=Tl,qy=El,Uy=Ll,Bn="DropdownMenu",[$y]=lt(Bn,[hl]),Q=hl(),[Wy,Ol]=$y(Bn),Il=e=>{const{__scopeDropdownMenu:t,children:n,dir:r,open:o,defaultOpen:s,onOpenChange:i,modal:a=!0}=e,c=Q(t),l=h.useRef(null),[u,d]=Vr({prop:o,defaultProp:s??!1,onChange:i,caller:Bn});return b.jsx(Wy,{scope:t,triggerId:nt(),triggerRef:l,contentId:nt(),open:u,onOpenChange:d,onOpenToggle:h.useCallback(()=>d(p=>!p),[d]),modal:a,children:b.jsx(Ey,{...c,open:u,onOpenChange:d,dir:r,modal:a,children:n})})};Il.displayName=Bn;var jl="DropdownMenuTrigger",Fl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,disabled:r=!1,...o}=e,s=Ol(jl,n),i=Q(n);return b.jsx(Dy,{asChild:!0,...i,children:b.jsx($.button,{type:"button",id:s.triggerId,"aria-haspopup":"menu","aria-expanded":s.open,"aria-controls":s.open?s.contentId:void 0,"data-state":s.open?"open":"closed","data-disabled":r?"":void 0,disabled:r,...o,ref:Ue(t,s.triggerRef),onPointerDown:V(e.onPointerDown,a=>{!r&&a.button===0&&a.ctrlKey===!1&&(s.onOpenToggle(),s.open||a.preventDefault())}),onKeyDown:V(e.onKeyDown,a=>{r||(["Enter"," "].includes(a.key)&&s.onOpenToggle(),a.key==="ArrowDown"&&s.onOpenChange(!0),["Enter"," ","ArrowDown"].includes(a.key)&&a.preventDefault())})})})});Fl.displayName=jl;var Ky="DropdownMenuPortal",Nl=e=>{const{__scopeDropdownMenu:t,...n}=e,r=Q(t);return b.jsx(Ly,{...r,...n})};Nl.displayName=Ky;var _l="DropdownMenuContent",Bl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Ol(_l,n),s=Q(n),i=h.useRef(!1);return b.jsx(Vy,{id:o.contentId,"aria-labelledby":o.triggerId,...s,...r,ref:t,onCloseAutoFocus:V(e.onCloseAutoFocus,a=>{var c;i.current||(c=o.triggerRef.current)==null||c.focus(),i.current=!1,a.preventDefault()}),onInteractOutside:V(e.onInteractOutside,a=>{const c=a.detail.originalEvent,l=c.button===0&&c.ctrlKey===!0,u=c.button===2||l;(!o.modal||u)&&(i.current=!0)}),style:{...e.style,"--radix-dropdown-menu-content-transform-origin":"var(--radix-popper-transform-origin)","--radix-dropdown-menu-content-available-width":"var(--radix-popper-available-width)","--radix-dropdown-menu-content-available-height":"var(--radix-popper-available-height)","--radix-dropdown-menu-trigger-width":"var(--radix-popper-anchor-width)","--radix-dropdown-menu-trigger-height":"var(--radix-popper-anchor-height)"}})});Bl.displayName=_l;var Gy="DropdownMenuGroup",zl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Oy,{...o,...r,ref:t})});zl.displayName=Gy;var Zy="DropdownMenuLabel",Hl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Iy,{...o,...r,ref:t})});Hl.displayName=Zy;var Xy="DropdownMenuItem",ql=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(jy,{...o,...r,ref:t})});ql.displayName=Xy;var Yy="DropdownMenuCheckboxItem",Ul=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Fy,{...o,...r,ref:t})});Ul.displayName=Yy;var Qy="DropdownMenuRadioGroup",$l=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Ny,{...o,...r,ref:t})});$l.displayName=Qy;var Jy="DropdownMenuRadioItem",Wl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(_y,{...o,...r,ref:t})});Wl.displayName=Jy;var em="DropdownMenuItemIndicator",Kl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(By,{...o,...r,ref:t})});Kl.displayName=em;var tm="DropdownMenuSeparator",Gl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(zy,{...o,...r,ref:t})});Gl.displayName=tm;var nm="DropdownMenuArrow",rm=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Hy,{...o,...r,ref:t})});rm.displayName=nm;var om="DropdownMenuSubTrigger",Zl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(qy,{...o,...r,ref:t})});Zl.displayName=om;var sm="DropdownMenuSubContent",Xl=h.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Uy,{...o,...r,ref:t,style:{...e.style,"--radix-dropdown-menu-content-transform-origin":"var(--radix-popper-transform-origin)","--radix-dropdown-menu-content-available-width":"var(--radix-popper-available-width)","--radix-dropdown-menu-content-available-height":"var(--radix-popper-available-height)","--radix-dropdown-menu-trigger-width":"var(--radix-popper-anchor-width)","--radix-dropdown-menu-trigger-height":"var(--radix-popper-anchor-height)"}})});Xl.displayName=sm;var k5=Il,x5=Fl,M5=Nl,w5=Bl,b5=zl,C5=Hl,S5=ql,P5=Ul,A5=$l,T5=Wl,R5=Kl,E5=Gl,D5=Zl,L5=Xl;export{Yx as $,T0 as A,lm as B,R0 as C,Sn as D,Y4 as E,gg as F,Ax as G,P4 as H,cg as I,zv as J,Yg as K,zc as L,So as M,Vc as N,f5 as O,$ as P,Co as Q,cm as R,Yv as S,y5 as T,E4 as U,wg as V,Q4 as W,e5 as X,kv as Y,Ig as Z,Qx as _,Vr as a,qg as a$,Zx as a0,Fm as a1,Nm as a2,r4 as a3,ag as a4,jm as a5,qk as a6,D5 as a7,dg as a8,L5 as a9,Kg as aA,jx as aB,Lx as aC,dx as aD,u4 as aE,Xm as aF,wm as aG,iv as aH,Gk as aI,$v as aJ,Im as aK,vk as aL,R4 as aM,yx as aN,_4 as aO,wx as aP,D4 as aQ,zm as aR,Dx as aS,Ov as aT,J4 as aU,l5 as aV,g5 as aW,c5 as aX,hg as aY,lg as aZ,xx as a_,M5 as aa,w5 as ab,S5 as ac,P5 as ad,R5 as ae,T5 as af,Lg as ag,C5 as ah,E5 as ai,k5 as aj,x5 as ak,b5 as al,A5 as am,Nx as an,Qm as ao,Um as ap,jv as aq,ek as ar,f4 as as,Vk as at,sk as au,z4 as av,F4 as aw,Km as ax,Iv as ay,qx as az,Ve as b,eg as b$,Ux as b0,e4 as b1,vx as b2,x0 as b3,yk as b4,sv as b5,a4 as b6,ex as b7,nk as b8,_x as b9,pv as bA,Xg as bB,Vm as bC,Wg as bD,Cv as bE,Bm as bF,W4 as bG,B4 as bH,mg as bI,og as bJ,Hv as bK,mm as bL,Pm as bM,um as bN,Sg as bO,Qk as bP,Em as bQ,px as bR,T4 as bS,bm as bT,tv as bU,dm as bV,km as bW,xm as bX,Ym as bY,Rg as bZ,_g as b_,Mg as ba,Kx as bb,_k as bc,mk as bd,Ex as be,s4 as bf,ev as bg,Dg as bh,vv as bi,Gp as bj,Zp as bk,il as bl,wk as bm,Ev as bn,Dv as bo,hm as bp,G4 as bq,gm as br,Vx as bs,ak as bt,ok as bu,Rx as bv,Zg as bw,Gv as bx,pk as by,Xk as bz,V as c,Lv as c$,Qg as c0,h4 as c1,Dk as c2,g4 as c3,Uv as c4,Fx as c5,Jk as c6,lv as c7,ug as c8,Hg as c9,Pv as cA,Mv as cB,kk as cC,zx as cD,tx as cE,v4 as cF,lx as cG,Dm as cH,Rk as cI,Kk as cJ,Ek as cK,x4 as cL,Hx as cM,Ng as cN,Wk as cO,$x as cP,l4 as cQ,qm as cR,tk as cS,Jm as cT,Pg as cU,ux as cV,$k as cW,Sv as cX,Ox as cY,Gm as cZ,Wv as c_,$m as ca,j4 as cb,d4 as cc,rv as cd,rx as ce,Wx as cf,Ug as cg,ik as ch,hk as ci,o4 as cj,i4 as ck,t5 as cl,kg as cm,Gx as cn,A4 as co,bg as cp,Ak as cq,Mm as cr,Jx as cs,Px as ct,Qv as cu,Wm as cv,$g as cw,Mk as cx,ov as cy,Rm as cz,Me as d,n4 as d$,hx as d0,fx as d1,I4 as d2,fg as d3,N4 as d4,Bv as d5,wv as d6,cv as d7,Lm as d8,bx as d9,mv as dA,a5 as dB,cx as dC,sx as dD,fm as dE,ax as dF,Pk as dG,ox as dH,Xv as dI,sg as dJ,Jv as dK,nx as dL,Rv as dM,M4 as dN,w4 as dO,Tm as dP,Fv as dQ,lk as dR,xk as dS,yv as dT,Tg as dU,C4 as dV,K4 as dW,Sk as dX,Kv as dY,Zm as dZ,Vv as d_,Av as da,gv as db,Cm as dc,Tx as dd,Bg as de,_v as df,Ok as dg,Nv as dh,Ck as di,Jg as dj,bk as dk,Uk as dl,zg as dm,Am as dn,jk as dp,zk as dq,ig as dr,Og as ds,vm as dt,Zv as du,Sm as dv,dv as dw,Vg as dx,Ix as dy,Sx as dz,Ri as e,V4 as e$,nv as e0,Tk as e1,Zk as e2,Nk as e3,dk as e4,L4 as e5,Eg as e6,Lk as e7,xg as e8,ng as e9,gx as eA,mx as eB,q4 as eC,vg as eD,k4 as eE,y4 as eF,Bx as eG,ck as eH,H4 as eI,uv as eJ,$4 as eK,qv as eL,S4 as eM,Fk as eN,Hm as eO,_m as eP,X4 as eQ,Bk as eR,Hk as eS,Om as eT,t4 as eU,Tv as eV,Xx as eW,pm as eX,U4 as eY,c4 as eZ,Mx as e_,Z4 as ea,p4 as eb,fv as ec,bv as ed,hv as ee,xv as ef,Ag as eg,b4 as eh,gk as ei,uk as ej,kx as ek,yg as el,pg as em,fk as en,rg as eo,tg as ep,Cg as eq,ym as er,av as es,O4 as et,Yk as eu,r5 as ev,n5 as ew,Ik as ex,ix as ey,Gg as ez,lt as f,m4 as f0,rk as f1,Lr as g,Te as h,Ei as i,Ue as j,bc as k,nt as l,A0 as m,E0 as n,u5 as o,h5 as p,p5 as q,m5 as r,d5 as s,ol as t,G as u,Cx as v,Fg as w,jg as x,o5 as y,i5 as z};
