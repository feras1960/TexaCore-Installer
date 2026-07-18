import{r as f,R as Ie,a as Ai,b as t1,c as Pi}from"./vendor-react-CtdH4caE.js";import{j as b,_ as Pe,a as Ti,b as n1}from"./vendor-data-BWRv08bE.js";function V(e,t,{checkForDefaultPrevented:n=!0}={}){return function(o){if(e==null||e(o),n===!1||!o.defaultPrevented)return t==null?void 0:t(o)}}function _o(e,t){if(typeof e=="function")return e(t);e!=null&&(e.current=t)}function Ue(...e){return t=>{let n=!1;const r=e.map(o=>{const s=_o(o,t);return!n&&typeof s=="function"&&(n=!0),s});if(n)return()=>{for(let o=0;o<r.length;o++){const s=r[o];typeof s=="function"?s():_o(e[o],null)}}}}function K(...e){return f.useCallback(Ue(...e),e)}function r1(e,t){const n=f.createContext(t),r=s=>{const{children:i,...a}=s,c=f.useMemo(()=>a,Object.values(a));return b.jsx(n.Provider,{value:c,children:i})};r.displayName=e+"Provider";function o(s){const i=f.useContext(n);if(i)return i;if(t!==void 0)return t;throw new Error(`\`${s}\` must be used within \`${e}\``)}return[r,o]}function lt(e,t=[]){let n=[];function r(s,i){const a=f.createContext(i),c=n.length;n=[...n,i];const l=d=>{var k;const{scope:p,children:y,...g}=d,m=((k=p==null?void 0:p[e])==null?void 0:k[c])||a,v=f.useMemo(()=>g,Object.values(g));return b.jsx(m.Provider,{value:v,children:y})};l.displayName=s+"Provider";function u(d,p){var m;const y=((m=p==null?void 0:p[e])==null?void 0:m[c])||a,g=f.useContext(y);if(g)return g;if(i!==void 0)return i;throw new Error(`\`${d}\` must be used within \`${s}\``)}return[l,u]}const o=()=>{const s=n.map(i=>f.createContext(i));return function(a){const c=(a==null?void 0:a[e])||s;return f.useMemo(()=>({[`__scope${e}`]:{...a,[e]:c}}),[a,c])}};return o.scopeName=e,[r,o1(o,...t)]}function o1(...e){const t=e[0];if(e.length===1)return t;const n=()=>{const r=e.map(o=>({useScope:o(),scopeName:o.scopeName}));return function(s){const i=r.reduce((a,{useScope:c,scopeName:l})=>{const d=c(s)[`__scope${l}`];return{...a,...d}},{});return f.useMemo(()=>({[`__scope${t.scopeName}`]:i}),[i])}};return n.scopeName=t.scopeName,n}function Bo(e){const t=s1(e),n=f.forwardRef((r,o)=>{const{children:s,...i}=r,a=f.Children.toArray(s),c=a.find(a1);if(c){const l=c.props.children,u=a.map(d=>d===c?f.Children.count(l)>1?f.Children.only(null):f.isValidElement(l)?l.props.children:null:d);return b.jsx(t,{...i,ref:o,children:f.isValidElement(l)?f.cloneElement(l,void 0,u):null})}return b.jsx(t,{...i,ref:o,children:s})});return n.displayName=`${e}.Slot`,n}function s1(e){const t=f.forwardRef((n,r)=>{const{children:o,...s}=n;if(f.isValidElement(o)){const i=l1(o),a=c1(s,o.props);return o.type!==f.Fragment&&(a.ref=r?Ue(r,i):i),f.cloneElement(o,a)}return f.Children.count(o)>1?f.Children.only(null):null});return t.displayName=`${e}.SlotClone`,t}var i1=Symbol("radix.slottable");function a1(e){return f.isValidElement(e)&&typeof e.type=="function"&&"__radixId"in e.type&&e.type.__radixId===i1}function c1(e,t){const n={...t};for(const r in t){const o=e[r],s=t[r];/^on[A-Z]/.test(r)?o&&s?n[r]=(...a)=>{const c=s(...a);return o(...a),c}:o&&(n[r]=o):r==="style"?n[r]={...o,...s}:r==="className"&&(n[r]=[o,s].filter(Boolean).join(" "))}return{...e,...n}}function l1(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}function Ri(e){const t=e+"CollectionProvider",[n,r]=lt(t),[o,s]=n(t,{collectionRef:{current:null},itemMap:new Map}),i=m=>{const{scope:v,children:k}=m,x=Ie.useRef(null),M=Ie.useRef(new Map).current;return b.jsx(o,{scope:v,itemMap:M,collectionRef:x,children:k})};i.displayName=t;const a=e+"CollectionSlot",c=Bo(a),l=Ie.forwardRef((m,v)=>{const{scope:k,children:x}=m,M=s(a,k),C=K(v,M.collectionRef);return b.jsx(c,{ref:C,children:x})});l.displayName=a;const u=e+"CollectionItemSlot",d="data-radix-collection-item",p=Bo(u),y=Ie.forwardRef((m,v)=>{const{scope:k,children:x,...M}=m,C=Ie.useRef(null),w=K(v,C),S=s(u,k);return Ie.useEffect(()=>(S.itemMap.set(C,{ref:C,...M}),()=>void S.itemMap.delete(C))),b.jsx(p,{[d]:"",ref:w,children:x})});y.displayName=u;function g(m){const v=s(e+"CollectionConsumer",m);return Ie.useCallback(()=>{const x=v.collectionRef.current;if(!x)return[];const M=Array.from(x.querySelectorAll(`[${d}]`));return Array.from(v.itemMap.values()).sort((S,A)=>M.indexOf(S.ref.current)-M.indexOf(A.ref.current))},[v.collectionRef,v.itemMap])}return[{Provider:i,Slot:l,ItemSlot:y},g,r]}function u1(e){const t=d1(e),n=f.forwardRef((r,o)=>{const{children:s,...i}=r,a=f.Children.toArray(s),c=a.find(f1);if(c){const l=c.props.children,u=a.map(d=>d===c?f.Children.count(l)>1?f.Children.only(null):f.isValidElement(l)?l.props.children:null:d);return b.jsx(t,{...i,ref:o,children:f.isValidElement(l)?f.cloneElement(l,void 0,u):null})}return b.jsx(t,{...i,ref:o,children:s})});return n.displayName=`${e}.Slot`,n}function d1(e){const t=f.forwardRef((n,r)=>{const{children:o,...s}=n;if(f.isValidElement(o)){const i=y1(o),a=p1(s,o.props);return o.type!==f.Fragment&&(a.ref=r?Ue(r,i):i),f.cloneElement(o,a)}return f.Children.count(o)>1?f.Children.only(null):null});return t.displayName=`${e}.SlotClone`,t}var h1=Symbol("radix.slottable");function f1(e){return f.isValidElement(e)&&typeof e.type=="function"&&"__radixId"in e.type&&e.type.__radixId===h1}function p1(e,t){const n={...t};for(const r in t){const o=e[r],s=t[r];/^on[A-Z]/.test(r)?o&&s?n[r]=(...a)=>{const c=s(...a);return o(...a),c}:o&&(n[r]=o):r==="style"?n[r]={...o,...s}:r==="className"&&(n[r]=[o,s].filter(Boolean).join(" "))}return{...e,...n}}function y1(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}var m1=["a","button","div","form","h2","h3","img","input","label","li","nav","ol","p","select","span","svg","ul"],$=m1.reduce((e,t)=>{const n=u1(`Primitive.${t}`),r=f.forwardRef((o,s)=>{const{asChild:i,...a}=o,c=i?n:t;return typeof window<"u"&&(window[Symbol.for("radix-ui")]=!0),b.jsx(c,{...a,ref:s})});return r.displayName=`Primitive.${t}`,{...e,[t]:r}},{});function Ei(e,t){e&&Ai.flushSync(()=>e.dispatchEvent(t))}function Me(e){const t=f.useRef(e);return f.useEffect(()=>{t.current=e}),f.useMemo(()=>(...n)=>{var r;return(r=t.current)==null?void 0:r.call(t,...n)},[])}function g1(e,t=globalThis==null?void 0:globalThis.document){const n=Me(e);f.useEffect(()=>{const r=o=>{o.key==="Escape"&&n(o)};return t.addEventListener("keydown",r,{capture:!0}),()=>t.removeEventListener("keydown",r,{capture:!0})},[n,t])}var v1="DismissableLayer",ur="dismissableLayer.update",k1="dismissableLayer.pointerDownOutside",x1="dismissableLayer.focusOutside",zo,Di=f.createContext({layers:new Set,layersWithOutsidePointerEventsDisabled:new Set,branches:new Set}),Sn=f.forwardRef((e,t)=>{const{disableOutsidePointerEvents:n=!1,onEscapeKeyDown:r,onPointerDownOutside:o,onFocusOutside:s,onInteractOutside:i,onDismiss:a,...c}=e,l=f.useContext(Di),[u,d]=f.useState(null),p=(u==null?void 0:u.ownerDocument)??(globalThis==null?void 0:globalThis.document),[,y]=f.useState({}),g=K(t,A=>d(A)),m=Array.from(l.layers),[v]=[...l.layersWithOutsidePointerEventsDisabled].slice(-1),k=m.indexOf(v),x=u?m.indexOf(u):-1,M=l.layersWithOutsidePointerEventsDisabled.size>0,C=x>=k,w=w1(A=>{const P=A.target,D=[...l.branches].some(L=>L.contains(P));!C||D||(o==null||o(A),i==null||i(A),A.defaultPrevented||a==null||a())},p),S=b1(A=>{const P=A.target;[...l.branches].some(L=>L.contains(P))||(s==null||s(A),i==null||i(A),A.defaultPrevented||a==null||a())},p);return g1(A=>{x===l.layers.size-1&&(r==null||r(A),!A.defaultPrevented&&a&&(A.preventDefault(),a()))},p),f.useEffect(()=>{if(u)return n&&(l.layersWithOutsidePointerEventsDisabled.size===0&&(zo=p.body.style.pointerEvents,p.body.style.pointerEvents="none"),l.layersWithOutsidePointerEventsDisabled.add(u)),l.layers.add(u),Ho(),()=>{n&&l.layersWithOutsidePointerEventsDisabled.size===1&&(p.body.style.pointerEvents=zo)}},[u,p,n,l]),f.useEffect(()=>()=>{u&&(l.layers.delete(u),l.layersWithOutsidePointerEventsDisabled.delete(u),Ho())},[u,l]),f.useEffect(()=>{const A=()=>y({});return document.addEventListener(ur,A),()=>document.removeEventListener(ur,A)},[]),b.jsx($.div,{...c,ref:g,style:{pointerEvents:M?C?"auto":"none":void 0,...e.style},onFocusCapture:V(e.onFocusCapture,S.onFocusCapture),onBlurCapture:V(e.onBlurCapture,S.onBlurCapture),onPointerDownCapture:V(e.onPointerDownCapture,w.onPointerDownCapture)})});Sn.displayName=v1;var M1="DismissableLayerBranch",Li=f.forwardRef((e,t)=>{const n=f.useContext(Di),r=f.useRef(null),o=K(t,r);return f.useEffect(()=>{const s=r.current;if(s)return n.branches.add(s),()=>{n.branches.delete(s)}},[n.branches]),b.jsx($.div,{...e,ref:o})});Li.displayName=M1;function w1(e,t=globalThis==null?void 0:globalThis.document){const n=Me(e),r=f.useRef(!1),o=f.useRef(()=>{});return f.useEffect(()=>{const s=a=>{if(a.target&&!r.current){let c=function(){Vi(k1,n,l,{discrete:!0})};const l={originalEvent:a};a.pointerType==="touch"?(t.removeEventListener("click",o.current),o.current=c,t.addEventListener("click",o.current,{once:!0})):c()}else t.removeEventListener("click",o.current);r.current=!1},i=window.setTimeout(()=>{t.addEventListener("pointerdown",s)},0);return()=>{window.clearTimeout(i),t.removeEventListener("pointerdown",s),t.removeEventListener("click",o.current)}},[t,n]),{onPointerDownCapture:()=>r.current=!0}}function b1(e,t=globalThis==null?void 0:globalThis.document){const n=Me(e),r=f.useRef(!1);return f.useEffect(()=>{const o=s=>{s.target&&!r.current&&Vi(x1,n,{originalEvent:s},{discrete:!1})};return t.addEventListener("focusin",o),()=>t.removeEventListener("focusin",o)},[t,n]),{onFocusCapture:()=>r.current=!0,onBlurCapture:()=>r.current=!1}}function Ho(){const e=new CustomEvent(ur);document.dispatchEvent(e)}function Vi(e,t,n,{discrete:r}){const o=n.originalEvent.target,s=new CustomEvent(e,{bubbles:!1,cancelable:!0,detail:n});t&&o.addEventListener(e,t,{once:!0}),r?Ei(o,s):o.dispatchEvent(s)}var cm=Sn,lm=Li,Te=globalThis!=null&&globalThis.document?f.useLayoutEffect:()=>{},C1="Portal",Lr=f.forwardRef((e,t)=>{var a;const{container:n,...r}=e,[o,s]=f.useState(!1);Te(()=>s(!0),[]);const i=n||o&&((a=globalThis==null?void 0:globalThis.document)==null?void 0:a.body);return i?t1.createPortal(b.jsx($.div,{...r,ref:t}),i):null});Lr.displayName=C1;function S1(e,t){return f.useReducer((n,r)=>t[n][r]??n,e)}var Ve=e=>{const{present:t,children:n}=e,r=A1(t),o=typeof n=="function"?n({present:r.isPresent}):f.Children.only(n),s=K(r.ref,P1(o));return typeof n=="function"||r.isPresent?f.cloneElement(o,{ref:s}):null};Ve.displayName="Presence";function A1(e){const[t,n]=f.useState(),r=f.useRef(null),o=f.useRef(e),s=f.useRef("none"),i=e?"mounted":"unmounted",[a,c]=S1(i,{mounted:{UNMOUNT:"unmounted",ANIMATION_OUT:"unmountSuspended"},unmountSuspended:{MOUNT:"mounted",ANIMATION_END:"unmounted"},unmounted:{MOUNT:"mounted"}});return f.useEffect(()=>{const l=Gt(r.current);s.current=a==="mounted"?l:"none"},[a]),Te(()=>{const l=r.current,u=o.current;if(u!==e){const p=s.current,y=Gt(l);e?c("MOUNT"):y==="none"||(l==null?void 0:l.display)==="none"?c("UNMOUNT"):c(u&&p!==y?"ANIMATION_OUT":"UNMOUNT"),o.current=e}},[e,c]),Te(()=>{if(t){let l;const u=t.ownerDocument.defaultView??window,d=y=>{const m=Gt(r.current).includes(CSS.escape(y.animationName));if(y.target===t&&m&&(c("ANIMATION_END"),!o.current)){const v=t.style.animationFillMode;t.style.animationFillMode="forwards",l=u.setTimeout(()=>{t.style.animationFillMode==="forwards"&&(t.style.animationFillMode=v)})}},p=y=>{y.target===t&&(s.current=Gt(r.current))};return t.addEventListener("animationstart",p),t.addEventListener("animationcancel",d),t.addEventListener("animationend",d),()=>{u.clearTimeout(l),t.removeEventListener("animationstart",p),t.removeEventListener("animationcancel",d),t.removeEventListener("animationend",d)}}else c("ANIMATION_END")},[t,c]),{isPresent:["mounted","unmountSuspended"].includes(a),ref:f.useCallback(l=>{r.current=l?getComputedStyle(l):null,n(l)},[])}}function Gt(e){return(e==null?void 0:e.animationName)||"none"}function P1(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}var T1=Pi[" useInsertionEffect ".trim().toString()]||Te;function Vr({prop:e,defaultProp:t,onChange:n=()=>{},caller:r}){const[o,s,i]=R1({defaultProp:t,onChange:n}),a=e!==void 0,c=a?e:o;{const u=f.useRef(e!==void 0);f.useEffect(()=>{const d=u.current;d!==a&&console.warn(`${r} is changing from ${d?"controlled":"uncontrolled"} to ${a?"controlled":"uncontrolled"}. Components should not switch from controlled to uncontrolled (or vice versa). Decide between using a controlled or uncontrolled value for the lifetime of the component.`),u.current=a},[a,r])}const l=f.useCallback(u=>{var d;if(a){const p=E1(u)?u(e):u;p!==e&&((d=i.current)==null||d.call(i,p))}else s(u)},[a,e,s,i]);return[c,l]}function R1({defaultProp:e,onChange:t}){const[n,r]=f.useState(e),o=f.useRef(n),s=f.useRef(t);return T1(()=>{s.current=t},[t]),f.useEffect(()=>{var i;o.current!==n&&((i=s.current)==null||i.call(s,n),o.current=n)},[n,o]),[n,r,s]}function E1(e){return typeof e=="function"}/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const D1=e=>e.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),Oi=(...e)=>e.filter((t,n,r)=>!!t&&r.indexOf(t)===n).join(" ");/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */var L1={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const V1=f.forwardRef(({color:e="currentColor",size:t=24,strokeWidth:n=2,absoluteStrokeWidth:r,className:o="",children:s,iconNode:i,...a},c)=>f.createElement("svg",{ref:c,...L1,width:t,height:t,stroke:e,strokeWidth:r?Number(n)*24/Number(t):n,className:Oi("lucide",o),...a},[...i.map(([l,u])=>f.createElement(l,u)),...Array.isArray(s)?s:[s]]));/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=(e,t)=>{const n=f.forwardRef(({className:r,...o},s)=>f.createElement(V1,{ref:s,iconNode:t,className:Oi(`lucide-${D1(e)}`,r),...o}));return n.displayName=`${e}`,n};/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const um=h("ALargeSmall",[["path",{d:"M21 14h-5",key:"1vh23k"}],["path",{d:"M16 16v-3.5a2.5 2.5 0 0 1 5 0V16",key:"1wh10o"}],["path",{d:"M4.5 13h6",key:"dfilno"}],["path",{d:"m3 16 4.5-9 4.5 9",key:"2dxa0e"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dm=h("Activity",[["path",{d:"M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",key:"169zse"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hm=h("AlignLeft",[["line",{x1:"21",x2:"3",y1:"6",y2:"6",key:"1fp77t"}],["line",{x1:"15",x2:"3",y1:"12",y2:"12",key:"v6grx8"}],["line",{x1:"17",x2:"3",y1:"18",y2:"18",key:"1awlsn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fm=h("Anchor",[["path",{d:"M12 22V8",key:"qkxhtm"}],["path",{d:"M5 12H2a10 10 0 0 0 20 0h-3",key:"1hv3nh"}],["circle",{cx:"12",cy:"5",r:"3",key:"rqqgnr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pm=h("Archive",[["rect",{width:"20",height:"5",x:"2",y:"3",rx:"1",key:"1wp1u1"}],["path",{d:"M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8",key:"1s80jp"}],["path",{d:"M10 12h4",key:"a56b0p"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ym=h("Armchair",[["path",{d:"M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3",key:"irtipd"}],["path",{d:"M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H7v-2a2 2 0 0 0-4 0Z",key:"1e01m0"}],["path",{d:"M5 18v2",key:"ppbyun"}],["path",{d:"M19 18v2",key:"gy7782"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mm=h("ArrowDownLeft",[["path",{d:"M17 7 7 17",key:"15tmo1"}],["path",{d:"M17 17H7V7",key:"1org7z"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gm=h("ArrowDownRight",[["path",{d:"m7 7 10 10",key:"1fmybs"}],["path",{d:"M17 7v10H7",key:"6fjiku"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vm=h("ArrowDownToLine",[["path",{d:"M12 17V3",key:"1cwfxf"}],["path",{d:"m6 11 6 6 6-6",key:"12ii2o"}],["path",{d:"M19 21H5",key:"150jfl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const km=h("ArrowDownUp",[["path",{d:"m3 16 4 4 4-4",key:"1co6wj"}],["path",{d:"M7 20V4",key:"1yoxec"}],["path",{d:"m21 8-4-4-4 4",key:"1c9v7m"}],["path",{d:"M17 4v16",key:"7dpous"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("ArrowDownWideNarrow",[["path",{d:"m3 16 4 4 4-4",key:"1co6wj"}],["path",{d:"M7 20V4",key:"1yoxec"}],["path",{d:"M11 4h10",key:"1w87gc"}],["path",{d:"M11 8h7",key:"djye34"}],["path",{d:"M11 12h4",key:"q8tih4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xm=h("ArrowDown",[["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"m19 12-7 7-7-7",key:"1idqje"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mm=h("ArrowLeftRight",[["path",{d:"M8 3 4 7l4 4",key:"9rb6wj"}],["path",{d:"M4 7h16",key:"6tx8e3"}],["path",{d:"m16 21 4-4-4-4",key:"siv7j2"}],["path",{d:"M20 17H4",key:"h6l3hr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wm=h("ArrowLeft",[["path",{d:"m12 19-7-7 7-7",key:"1l729n"}],["path",{d:"M19 12H5",key:"x3x0zl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bm=h("ArrowRightLeft",[["path",{d:"m16 3 4 4-4 4",key:"1x1c3m"}],["path",{d:"M20 7H4",key:"zbl0bi"}],["path",{d:"m8 21-4-4 4-4",key:"h9nckh"}],["path",{d:"M4 17h16",key:"g4d7ey"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Cm=h("ArrowRight",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"m12 5 7 7-7 7",key:"xquz4c"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sm=h("ArrowUpDown",[["path",{d:"m21 16-4 4-4-4",key:"f6ql7i"}],["path",{d:"M17 20V4",key:"1ejh1v"}],["path",{d:"m3 8 4-4 4 4",key:"11wl7u"}],["path",{d:"M7 4v16",key:"1glfcx"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Am=h("ArrowUpFromLine",[["path",{d:"m18 9-6-6-6 6",key:"kcunyi"}],["path",{d:"M12 3v14",key:"7cf3v8"}],["path",{d:"M5 21h14",key:"11awu3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("ArrowUpNarrowWide",[["path",{d:"m3 8 4-4 4 4",key:"11wl7u"}],["path",{d:"M7 4v16",key:"1glfcx"}],["path",{d:"M11 12h4",key:"q8tih4"}],["path",{d:"M11 16h7",key:"uosisv"}],["path",{d:"M11 20h10",key:"jvxblo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pm=h("ArrowUpRight",[["path",{d:"M7 7h10v10",key:"1tivn9"}],["path",{d:"M7 17 17 7",key:"1vkiza"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tm=h("ArrowUp",[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("AtSign",[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8",key:"7n84p3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rm=h("Award",[["path",{d:"m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526",key:"1yiouv"}],["circle",{cx:"12",cy:"8",r:"6",key:"1vp47v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Em=h("BadgeCheck",[["path",{d:"M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z",key:"3c2336"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dm=h("Ban",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m4.9 4.9 14.2 14.2",key:"1m5liu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lm=h("Banknote",[["rect",{width:"20",height:"12",x:"2",y:"6",rx:"2",key:"9lu3g6"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}],["path",{d:"M6 12h.01M18 12h.01",key:"113zkx"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vm=h("BarChart2",[["line",{x1:"18",x2:"18",y1:"20",y2:"10",key:"1xfpm4"}],["line",{x1:"12",x2:"12",y1:"20",y2:"4",key:"be30l9"}],["line",{x1:"6",x2:"6",y1:"20",y2:"14",key:"1r4le6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Om=h("BarChart3",[["path",{d:"M3 3v18h18",key:"1s2lah"}],["path",{d:"M18 17V9",key:"2bz60n"}],["path",{d:"M13 17V5",key:"1frdt8"}],["path",{d:"M8 17v-3",key:"17ska0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("BarChart",[["line",{x1:"12",x2:"12",y1:"20",y2:"10",key:"1vz5eb"}],["line",{x1:"18",x2:"18",y1:"20",y2:"4",key:"cun8e5"}],["line",{x1:"6",x2:"6",y1:"20",y2:"16",key:"hq0ia6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jm=h("Barcode",[["path",{d:"M3 5v14",key:"1nt18q"}],["path",{d:"M8 5v14",key:"1ybrkv"}],["path",{d:"M12 5v14",key:"s699le"}],["path",{d:"M17 5v14",key:"ycjyhj"}],["path",{d:"M21 5v14",key:"nzette"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Im=h("Beaker",[["path",{d:"M4.5 3h15",key:"c7n0jr"}],["path",{d:"M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3",key:"m1uhx7"}],["path",{d:"M6 14h12",key:"4cwo0f"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fm=h("BellOff",[["path",{d:"M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5",key:"o7mx20"}],["path",{d:"M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7",key:"16f1lm"}],["path",{d:"M10.3 21a1.94 1.94 0 0 0 3.4 0",key:"qgo35s"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nm=h("BellRing",[["path",{d:"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9",key:"1qo2s2"}],["path",{d:"M10.3 21a1.94 1.94 0 0 0 3.4 0",key:"qgo35s"}],["path",{d:"M4 2C2.8 3.7 2 5.7 2 8",key:"tap9e0"}],["path",{d:"M22 8c0-2.3-.8-4.3-2-6",key:"5bb3ad"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _m=h("Bell",[["path",{d:"M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9",key:"1qo2s2"}],["path",{d:"M10.3 21a1.94 1.94 0 0 0 3.4 0",key:"qgo35s"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Bike",[["circle",{cx:"18.5",cy:"17.5",r:"3.5",key:"15x4ox"}],["circle",{cx:"5.5",cy:"17.5",r:"3.5",key:"1noe27"}],["circle",{cx:"15",cy:"5",r:"1",key:"19l28e"}],["path",{d:"M12 17.5V14l-3-3 4-3 2 3h2",key:"1npguv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bm=h("Blend",[["circle",{cx:"9",cy:"9",r:"7",key:"p2h5vp"}],["circle",{cx:"15",cy:"15",r:"7",key:"19ennj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zm=h("BookCheck",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["path",{d:"m9 9.5 2 2 4-4",key:"1dth82"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hm=h("BookMarked",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["polyline",{points:"10 2 10 10 13 7 16 10 16 2",key:"13o6vz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qm=h("BookOpen",[["path",{d:"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z",key:"vv98re"}],["path",{d:"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",key:"1cyq3y"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Um=h("BookX",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}],["path",{d:"m14.5 7-5 5",key:"dy991v"}],["path",{d:"m9.5 7 5 5",key:"s45iea"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $m=h("Book",[["path",{d:"M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",key:"t4utmx"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Bookmark",[["path",{d:"m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z",key:"1fy3hk"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wm=h("Bot",[["path",{d:"M12 8V4H8",key:"hb8ula"}],["rect",{width:"16",height:"12",x:"4",y:"8",rx:"2",key:"enze0r"}],["path",{d:"M2 14h2",key:"vft8re"}],["path",{d:"M20 14h2",key:"4cs60a"}],["path",{d:"M15 13v2",key:"1xurst"}],["path",{d:"M9 13v2",key:"rq6x2g"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gm=h("Box",[["path",{d:"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",key:"hh9hay"}],["path",{d:"m3.3 7 8.7 5 8.7-5",key:"g66t2b"}],["path",{d:"M12 22V12",key:"d0xqtd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Km=h("Boxes",[["path",{d:"M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z",key:"lc1i9w"}],["path",{d:"m7 16.5-4.74-2.85",key:"1o9zyk"}],["path",{d:"m7 16.5 5-3",key:"va8pkn"}],["path",{d:"M7 16.5v5.17",key:"jnp8gn"}],["path",{d:"M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z",key:"8zsnat"}],["path",{d:"m17 16.5-5-3",key:"8arw3v"}],["path",{d:"m17 16.5 4.74-2.85",key:"8rfmw"}],["path",{d:"M17 16.5v5.17",key:"k6z78m"}],["path",{d:"M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z",key:"1xygjf"}],["path",{d:"M12 8 7.26 5.15",key:"1vbdud"}],["path",{d:"m12 8 4.74-2.85",key:"3rx089"}],["path",{d:"M12 13.5V8",key:"1io7kd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zm=h("Brain",[["path",{d:"M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z",key:"l5xja"}],["path",{d:"M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z",key:"ep3f8r"}],["path",{d:"M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4",key:"1p4c4q"}],["path",{d:"M17.599 6.5a3 3 0 0 0 .399-1.375",key:"tmeiqw"}],["path",{d:"M6.003 5.125A3 3 0 0 0 6.401 6.5",key:"105sqy"}],["path",{d:"M3.477 10.896a4 4 0 0 1 .585-.396",key:"ql3yin"}],["path",{d:"M19.938 10.5a4 4 0 0 1 .585.396",key:"1qfode"}],["path",{d:"M6 18a4 4 0 0 1-1.967-.516",key:"2e4loj"}],["path",{d:"M19.967 17.484A4 4 0 0 1 18 18",key:"159ez6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xm=h("Briefcase",[["path",{d:"M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",key:"jecpp"}],["rect",{width:"20",height:"14",x:"2",y:"6",rx:"2",key:"i6l2r4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ym=h("Brush",[["path",{d:"m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08",key:"1styjt"}],["path",{d:"M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z",key:"z0l1mu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qm=h("Building2",[["path",{d:"M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z",key:"1b4qmf"}],["path",{d:"M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2",key:"i71pzd"}],["path",{d:"M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2",key:"10jefs"}],["path",{d:"M10 6h4",key:"1itunk"}],["path",{d:"M10 10h4",key:"tcdvrf"}],["path",{d:"M10 14h4",key:"kelpxr"}],["path",{d:"M10 18h4",key:"1ulq68"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jm=h("Building",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["path",{d:"M9 22v-4h6v4",key:"r93iot"}],["path",{d:"M8 6h.01",key:"1dz90k"}],["path",{d:"M16 6h.01",key:"1x0f13"}],["path",{d:"M12 6h.01",key:"1vi96p"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M8 14h.01",key:"6423bh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const eg=h("Calculator",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",key:"1nb95v"}],["line",{x1:"8",x2:"16",y1:"6",y2:"6",key:"x4nwl0"}],["line",{x1:"16",x2:"16",y1:"14",y2:"18",key:"wjye3r"}],["path",{d:"M16 10h.01",key:"1m94wz"}],["path",{d:"M12 10h.01",key:"1nrarc"}],["path",{d:"M8 10h.01",key:"19clt8"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M8 14h.01",key:"6423bh"}],["path",{d:"M12 18h.01",key:"mhygvu"}],["path",{d:"M8 18h.01",key:"lrp35t"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tg=h("CalendarCheck",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"m9 16 2 2 4-4",key:"19s6y9"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ng=h("CalendarClock",[["path",{d:"M21 7.5V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3.5",key:"1osxxc"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M3 10h5",key:"r794hk"}],["path",{d:"M17.5 17.5 16 16.3V14",key:"akvzfd"}],["circle",{cx:"16",cy:"16",r:"6",key:"qoo3c4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rg=h("CalendarDays",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"M8 14h.01",key:"6423bh"}],["path",{d:"M12 14h.01",key:"1etili"}],["path",{d:"M16 14h.01",key:"1gbofw"}],["path",{d:"M8 18h.01",key:"lrp35t"}],["path",{d:"M12 18h.01",key:"mhygvu"}],["path",{d:"M16 18h.01",key:"kzsmim"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const og=h("CalendarPlus",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M21 13V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8",key:"3spt84"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"M16 19h6",key:"xwg31i"}],["path",{d:"M19 16v6",key:"tddt3s"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const sg=h("CalendarRange",[["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M16 2v4",key:"4m81vk"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M17 14h-6",key:"bkmgh3"}],["path",{d:"M13 18H7",key:"bb0bb7"}],["path",{d:"M7 14h.01",key:"1qa3f1"}],["path",{d:"M17 18h.01",key:"1bdyru"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("CalendarX",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}],["path",{d:"m14 14-4 4",key:"rymu2i"}],["path",{d:"m10 14 4 4",key:"3sz06r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ig=h("Calendar",[["path",{d:"M8 2v4",key:"1cmpym"}],["path",{d:"M16 2v4",key:"4m81vk"}],["rect",{width:"18",height:"18",x:"3",y:"4",rx:"2",key:"1hopcy"}],["path",{d:"M3 10h18",key:"8toen8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ag=h("Camera",[["path",{d:"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z",key:"1tc9qg"}],["circle",{cx:"12",cy:"13",r:"3",key:"1vg3eu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const cg=h("Car",[["path",{d:"M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2",key:"5owen"}],["circle",{cx:"7",cy:"17",r:"2",key:"u2ysq9"}],["path",{d:"M9 17h6",key:"r8uit2"}],["circle",{cx:"17",cy:"17",r:"2",key:"axvx0g"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lg=h("CheckCheck",[["path",{d:"M18 6 7 17l-5-5",key:"116fxf"}],["path",{d:"m22 10-7.5 7.5L13 16",key:"ke71qq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ug=h("Check",[["path",{d:"M20 6 9 17l-5-5",key:"1gmf2c"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dg=h("ChevronDown",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hg=h("ChevronLeft",[["path",{d:"m15 18-6-6 6-6",key:"1wnfg3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fg=h("ChevronRight",[["path",{d:"m9 18 6-6-6-6",key:"mthhwq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pg=h("ChevronUp",[["path",{d:"m18 15-6-6-6 6",key:"153udz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yg=h("ChevronsDownUp",[["path",{d:"m7 20 5-5 5 5",key:"13a0gw"}],["path",{d:"m7 4 5 5 5-5",key:"1kwcof"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("ChevronsDown",[["path",{d:"m7 6 5 5 5-5",key:"1lc07p"}],["path",{d:"m7 13 5 5 5-5",key:"1d48rs"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mg=h("ChevronsLeft",[["path",{d:"m11 17-5-5 5-5",key:"13zhaf"}],["path",{d:"m18 17-5-5 5-5",key:"h8a8et"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gg=h("ChevronsRight",[["path",{d:"m6 17 5-5-5-5",key:"xnjwq"}],["path",{d:"m13 17 5-5-5-5",key:"17xmmf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vg=h("ChevronsUpDown",[["path",{d:"m7 15 5 5 5-5",key:"1hf1tw"}],["path",{d:"m7 9 5-5 5 5",key:"sgt6xg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("ChevronsUp",[["path",{d:"m17 11-5-5-5 5",key:"e8nh98"}],["path",{d:"m17 18-5-5-5 5",key:"2avn1x"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kg=h("CircleAlert",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xg=h("CircleArrowDown",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 8v8",key:"napkw2"}],["path",{d:"m8 12 4 4 4-4",key:"k98ssh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mg=h("CircleArrowRight",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M8 12h8",key:"1wcyev"}],["path",{d:"m12 16 4-4-4-4",key:"1i9zcv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wg=h("CircleArrowUp",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m16 12-4-4-4 4",key:"177agl"}],["path",{d:"M12 16V8",key:"1sbj14"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bg=h("CircleCheckBig",[["path",{d:"M22 11.08V12a10 10 0 1 1-5.93-9.14",key:"g774vq"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Cg=h("CircleCheck",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sg=h("CircleDollarSign",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",key:"1h4pet"}],["path",{d:"M12 18V6",key:"zqpxq5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ag=h("CircleDot",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pg=h("CircleHelp",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3",key:"1u773s"}],["path",{d:"M12 17h.01",key:"p32p05"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tg=h("CircleMinus",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M8 12h8",key:"1wcyev"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rg=h("CirclePause",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"10",x2:"10",y1:"15",y2:"9",key:"c1nkhi"}],["line",{x1:"14",x2:"14",y1:"15",y2:"9",key:"h65svq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Eg=h("CirclePlay",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polygon",{points:"10 8 16 12 10 16 10 8",key:"1cimsy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dg=h("CirclePlus",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M8 12h8",key:"1wcyev"}],["path",{d:"M12 8v8",key:"napkw2"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lg=h("CircleStop",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["rect",{width:"6",height:"6",x:"9",y:"9",key:"1wrtvo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vg=h("CircleUserRound",[["path",{d:"M18 20a6 6 0 0 0-12 0",key:"1qehca"}],["circle",{cx:"12",cy:"10",r:"4",key:"1h16sb"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Og=h("CircleUser",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"10",r:"3",key:"ilqhr7"}],["path",{d:"M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662",key:"154egf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jg=h("CircleX",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m15 9-6 6",key:"1uzhvr"}],["path",{d:"m9 9 6 6",key:"z0biqf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ig=h("Circle",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fg=h("ClipboardCheck",[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}],["path",{d:"m9 14 2 2 4-4",key:"df797q"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ng=h("ClipboardList",[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}],["path",{d:"M12 11h4",key:"1jrz19"}],["path",{d:"M12 16h4",key:"n85exb"}],["path",{d:"M8 11h.01",key:"1dfujw"}],["path",{d:"M8 16h.01",key:"18s6g9"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Clipboard",[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _g=h("Clock",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["polyline",{points:"12 6 12 12 16 14",key:"68esgv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("CloudDownload",[["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",key:"1pljnt"}],["path",{d:"M12 12v9",key:"192myk"}],["path",{d:"m8 17 4 4 4-4",key:"1ul180"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bg=h("CloudOff",[["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M5.782 5.782A7 7 0 0 0 9 19h8.5a4.5 4.5 0 0 0 1.307-.193",key:"yfwify"}],["path",{d:"M21.532 16.5A4.5 4.5 0 0 0 17.5 10h-1.79A7.008 7.008 0 0 0 10 5.07",key:"jlfiyv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zg=h("CloudUpload",[["path",{d:"M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242",key:"1pljnt"}],["path",{d:"M12 12v9",key:"192myk"}],["path",{d:"m16 16-4-4-4 4",key:"119tzi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hg=h("Cloud",[["path",{d:"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",key:"p7xjir"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("CodeXml",[["path",{d:"m18 16 4-4-4-4",key:"1inbqp"}],["path",{d:"m6 8-4 4 4 4",key:"15zrgr"}],["path",{d:"m14.5 4-5 16",key:"e7oirm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qg=h("Code",[["polyline",{points:"16 18 22 12 16 6",key:"z7tu5w"}],["polyline",{points:"8 6 2 12 8 18",key:"1eg1df"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ug=h("Cog",[["path",{d:"M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z",key:"sobvz5"}],["path",{d:"M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",key:"11i496"}],["path",{d:"M12 2v2",key:"tus03m"}],["path",{d:"M12 22v-2",key:"1osdcq"}],["path",{d:"m17 20.66-1-1.73",key:"eq3orb"}],["path",{d:"M11 10.27 7 3.34",key:"16pf9h"}],["path",{d:"m20.66 17-1.73-1",key:"sg0v6f"}],["path",{d:"m3.34 7 1.73 1",key:"1ulond"}],["path",{d:"M14 12h8",key:"4f43i9"}],["path",{d:"M2 12h2",key:"1t8f8n"}],["path",{d:"m20.66 7-1.73 1",key:"1ow05n"}],["path",{d:"m3.34 17 1.73-1",key:"nuk764"}],["path",{d:"m17 3.34-1 1.73",key:"2wel8s"}],["path",{d:"m11 13.73-4 6.93",key:"794ttg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $g=h("Coins",[["circle",{cx:"8",cy:"8",r:"6",key:"3yglwk"}],["path",{d:"M18.09 10.37A6 6 0 1 1 10.34 18",key:"t5s6rm"}],["path",{d:"M7 6h1v4",key:"1obek4"}],["path",{d:"m16.71 13.88.7.71-2.82 2.82",key:"1rbuyh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wg=h("Columns2",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M12 3v18",key:"108xh3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gg=h("Columns3",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Compass",[["path",{d:"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z",key:"9ktpf1"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Kg=h("Container",[["path",{d:"M22 7.7c0-.6-.4-1.2-.8-1.5l-6.3-3.9a1.72 1.72 0 0 0-1.7 0l-10.3 6c-.5.2-.9.8-.9 1.4v6.6c0 .5.4 1.2.8 1.5l6.3 3.9a1.72 1.72 0 0 0 1.7 0l10.3-6c.5-.3.9-1 .9-1.5Z",key:"1t2lqe"}],["path",{d:"M10 21.9V14L2.1 9.1",key:"o7czzq"}],["path",{d:"m10 14 11.9-6.9",key:"zm5e20"}],["path",{d:"M14 19.8v-8.1",key:"159ecu"}],["path",{d:"M18 17.5V9.4",key:"11uown"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zg=h("Copy",[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xg=h("CornerDownLeft",[["polyline",{points:"9 10 4 15 9 20",key:"r3jprv"}],["path",{d:"M20 4v7a4 4 0 0 1-4 4H4",key:"6o5b7l"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yg=h("Cpu",[["rect",{width:"16",height:"16",x:"4",y:"4",rx:"2",key:"14l7u7"}],["rect",{width:"6",height:"6",x:"9",y:"9",rx:"1",key:"5aljv4"}],["path",{d:"M15 2v2",key:"13l42r"}],["path",{d:"M15 20v2",key:"15mkzm"}],["path",{d:"M2 15h2",key:"1gxd5l"}],["path",{d:"M2 9h2",key:"1bbxkp"}],["path",{d:"M20 15h2",key:"19e6y8"}],["path",{d:"M20 9h2",key:"19tzq7"}],["path",{d:"M9 2v2",key:"165o2o"}],["path",{d:"M9 20v2",key:"i2bqo8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qg=h("CreditCard",[["rect",{width:"20",height:"14",x:"2",y:"5",rx:"2",key:"ynyp8z"}],["line",{x1:"2",x2:"22",y1:"10",y2:"10",key:"1b3vmo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jg=h("Crown",[["path",{d:"M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z",key:"1vdc57"}],["path",{d:"M5 21h14",key:"11awu3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ev=h("Cylinder",[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3",key:"msslwz"}],["path",{d:"M3 5v14a9 3 0 0 0 18 0V5",key:"aqi0yr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tv=h("Database",[["ellipse",{cx:"12",cy:"5",rx:"9",ry:"3",key:"msslwz"}],["path",{d:"M3 5V19A9 3 0 0 0 21 19V5",key:"1wlel7"}],["path",{d:"M3 12A9 3 0 0 0 21 12",key:"mv7ke4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const nv=h("Delete",[["path",{d:"M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z",key:"1oy587"}],["line",{x1:"18",x2:"12",y1:"9",y2:"15",key:"1olkx5"}],["line",{x1:"12",x2:"18",y1:"9",y2:"15",key:"1n50pc"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rv=h("DollarSign",[["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}],["path",{d:"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",key:"1b0p4s"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ov=h("Download",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"7 10 12 15 17 10",key:"2ggqvy"}],["line",{x1:"12",x2:"12",y1:"15",y2:"3",key:"1vk2je"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const sv=h("Droplets",[["path",{d:"M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05z",key:"1ptgy4"}],["path",{d:"M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97",key:"1sl1rz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const iv=h("Earth",[["path",{d:"M21.54 15H17a2 2 0 0 0-2 2v4.54",key:"1djwo0"}],["path",{d:"M7 3.34V5a3 3 0 0 0 3 3a2 2 0 0 1 2 2c0 1.1.9 2 2 2a2 2 0 0 0 2-2c0-1.1.9-2 2-2h3.17",key:"1tzkfa"}],["path",{d:"M11 21.95V18a2 2 0 0 0-2-2a2 2 0 0 1-2-2v-1a2 2 0 0 0-2-2H2.05",key:"14pb5j"}],["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const av=h("EllipsisVertical",[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"12",cy:"5",r:"1",key:"gxeob9"}],["circle",{cx:"12",cy:"19",r:"1",key:"lyex9k"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const cv=h("Ellipsis",[["circle",{cx:"12",cy:"12",r:"1",key:"41hilf"}],["circle",{cx:"19",cy:"12",r:"1",key:"1wjl8i"}],["circle",{cx:"5",cy:"12",r:"1",key:"1pcz8c"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lv=h("Equal",[["line",{x1:"5",x2:"19",y1:"9",y2:"9",key:"1nwqeh"}],["line",{x1:"5",x2:"19",y1:"15",y2:"15",key:"g8yjpy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const uv=h("Euro",[["path",{d:"M4 10h12",key:"1y6xl8"}],["path",{d:"M4 14h9",key:"1loblj"}],["path",{d:"M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2",key:"1j6lzo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dv=h("ExternalLink",[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hv=h("EyeOff",[["path",{d:"M9.88 9.88a3 3 0 1 0 4.24 4.24",key:"1jxqfv"}],["path",{d:"M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68",key:"9wicm4"}],["path",{d:"M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61",key:"1jreej"}],["line",{x1:"2",x2:"22",y1:"2",y2:"22",key:"a6p6uj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fv=h("Eye",[["path",{d:"M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z",key:"rwhkz3"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pv=h("Facebook",[["path",{d:"M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z",key:"1jg4f8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yv=h("Factory",[["path",{d:"M2 20a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8l-7 5V8l-7 5V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",key:"159hny"}],["path",{d:"M17 18h1",key:"uldtlt"}],["path",{d:"M12 18h1",key:"s9uhes"}],["path",{d:"M7 18h1",key:"1neino"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mv=h("FastForward",[["polygon",{points:"13 19 22 12 13 5 13 19",key:"587y9g"}],["polygon",{points:"2 19 11 12 2 5 2 19",key:"3pweh0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gv=h("FileArchive",[["path",{d:"M10 12v-1",key:"v7bkov"}],["path",{d:"M10 18v-2",key:"1cjy8d"}],["path",{d:"M10 7V6",key:"dljcrl"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M15.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v16a2 2 0 0 0 .274 1.01",key:"gkbcor"}],["circle",{cx:"10",cy:"20",r:"2",key:"1xzdoj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vv=h("FileBarChart",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M8 18v-2",key:"qcmpov"}],["path",{d:"M12 18v-4",key:"q1q25u"}],["path",{d:"M16 18v-6",key:"15y0np"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kv=h("FileCheck2",[["path",{d:"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4",key:"1pf5j1"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"m3 15 2 2 4-4",key:"1lhrkk"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xv=h("FileCheck",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"m9 15 2 2 4-4",key:"1grp1n"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mv=h("FileCode",[["path",{d:"M10 12.5 8 15l2 2.5",key:"1tg20x"}],["path",{d:"m14 12.5 2 2.5-2 2.5",key:"yinavb"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",key:"1mlx9k"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wv=h("FileDown",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M12 18v-6",key:"17g6i2"}],["path",{d:"m9 15 3 3 3-3",key:"1npd3o"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bv=h("FileImage",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["circle",{cx:"10",cy:"12",r:"2",key:"737tya"}],["path",{d:"m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22",key:"wt3hpn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("FileMinus",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M9 15h6",key:"cctwl0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Cv=h("FilePenLine",[["path",{d:"m18 5-2.414-2.414A2 2 0 0 0 14.172 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2",key:"142zxg"}],["path",{d:"M21.378 12.626a1 1 0 0 0-3.004-3.004l-4.01 4.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z",key:"2t3380"}],["path",{d:"M8 18h1",key:"13wk12"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sv=h("FilePen",[["path",{d:"M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5",key:"1couwa"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z",key:"1y4qbx"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Av=h("FilePlus",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M9 15h6",key:"cctwl0"}],["path",{d:"M12 18v-6",key:"17g6i2"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pv=h("FileQuestion",[["path",{d:"M12 17h.01",key:"p32p05"}],["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",key:"1mlx9k"}],["path",{d:"M9.1 9a3 3 0 0 1 5.82 1c0 2-3 3-3 3",key:"mhlwft"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tv=h("FileSearch",[["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M4.268 21a2 2 0 0 0 1.727 1H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v3",key:"ms7g94"}],["path",{d:"m9 18-1.5-1.5",key:"1j6qii"}],["circle",{cx:"5",cy:"14",r:"3",key:"ufru5t"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rv=h("FileSpreadsheet",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M8 13h2",key:"yr2amv"}],["path",{d:"M14 13h2",key:"un5t4a"}],["path",{d:"M8 17h2",key:"2yhykz"}],["path",{d:"M14 17h2",key:"10kma7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ev=h("FileText",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M10 9H8",key:"b1mrlr"}],["path",{d:"M16 13H8",key:"t4e002"}],["path",{d:"M16 17H8",key:"z1uh3a"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dv=h("FileType2",[["path",{d:"M4 22h14a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v4",key:"1pf5j1"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M2 13v-1h6v1",key:"1dh9dg"}],["path",{d:"M5 12v6",key:"150t9c"}],["path",{d:"M4 18h2",key:"1xrofg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lv=h("FileUp",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"M12 12v6",key:"3ahymv"}],["path",{d:"m15 15-3-3-3 3",key:"15xj92"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vv=h("FileX",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}],["path",{d:"m14.5 12.5-5 5",key:"b62r18"}],["path",{d:"m9.5 12.5 5 5",key:"1rk7el"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ov=h("File",[["path",{d:"M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z",key:"1rqfz7"}],["path",{d:"M14 2v4a2 2 0 0 0 2 2h4",key:"tnqrlb"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jv=h("Files",[["path",{d:"M20 7h-3a2 2 0 0 1-2-2V2",key:"x099mo"}],["path",{d:"M9 18a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h7l4 4v10a2 2 0 0 1-2 2Z",key:"18t6ie"}],["path",{d:"M3 7.6v12.8A1.6 1.6 0 0 0 4.6 22h9.8",key:"1nja0z"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Iv=h("Filter",[["polygon",{points:"22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3",key:"1yg77f"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fv=h("Fingerprint",[["path",{d:"M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4",key:"1nerag"}],["path",{d:"M14 13.12c0 2.38 0 6.38-1 8.88",key:"o46ks0"}],["path",{d:"M17.29 21.02c.12-.6.43-2.3.5-3.02",key:"ptglia"}],["path",{d:"M2 12a10 10 0 0 1 18-6",key:"ydlgp0"}],["path",{d:"M2 16h.01",key:"1gqxmh"}],["path",{d:"M21.8 16c.2-2 .131-5.354 0-6",key:"drycrb"}],["path",{d:"M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2",key:"1tidbn"}],["path",{d:"M8.65 22c.21-.66.45-1.32.57-2",key:"13wd9y"}],["path",{d:"M9 6.8a6 6 0 0 1 9 5.2v2",key:"1fr1j5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nv=h("Flag",[["path",{d:"M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z",key:"i9b6wo"}],["line",{x1:"4",x2:"4",y1:"22",y2:"15",key:"1cm3nv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _v=h("Flame",[["path",{d:"M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z",key:"96xj49"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bv=h("FlaskConical",[["path",{d:"M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2",key:"pzvekw"}],["path",{d:"M8.5 2h7",key:"csnxdl"}],["path",{d:"M7 16h10",key:"wp8him"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zv=h("FolderMinus",[["path",{d:"M9 13h6",key:"1uhe8q"}],["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hv=h("FolderOpen",[["path",{d:"m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2",key:"usdka0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qv=h("FolderPlus",[["path",{d:"M12 10v6",key:"1bos4e"}],["path",{d:"M9 13h6",key:"1uhe8q"}],["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Uv=h("FolderTree",[["path",{d:"M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z",key:"hod4my"}],["path",{d:"M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z",key:"w4yl2u"}],["path",{d:"M3 5a2 2 0 0 0 2 2h3",key:"f2jnh7"}],["path",{d:"M3 3v13a2 2 0 0 0 2 2h3",key:"k8epm1"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $v=h("Folder",[["path",{d:"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z",key:"1kt360"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wv=h("Footprints",[["path",{d:"M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",key:"1dudjm"}],["path",{d:"M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",key:"l2t8xc"}],["path",{d:"M16 17h4",key:"1dejxt"}],["path",{d:"M4 13h4",key:"1bwh8b"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gv=h("GalleryHorizontalEnd",[["path",{d:"M2 7v10",key:"a2pl2d"}],["path",{d:"M6 5v14",key:"1kq3d7"}],["rect",{width:"12",height:"18",x:"10",y:"3",rx:"2",key:"13i7bc"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Kv=h("Gauge",[["path",{d:"m12 14 4-4",key:"9kzdfg"}],["path",{d:"M3.34 19a10 10 0 1 1 17.32 0",key:"19p75a"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zv=h("Gem",[["path",{d:"M6 3h12l4 6-10 13L2 9Z",key:"1pcd5k"}],["path",{d:"M11 3 8 9l4 13 4-13-3-6",key:"1fcu3u"}],["path",{d:"M2 9h20",key:"16fsjt"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xv=h("Gift",[["rect",{x:"3",y:"8",width:"18",height:"4",rx:"1",key:"bkv52"}],["path",{d:"M12 8v13",key:"1c76mn"}],["path",{d:"M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7",key:"6wjy6b"}],["path",{d:"M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5",key:"1ihvrl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yv=h("GitBranch",[["line",{x1:"6",x2:"6",y1:"3",y2:"15",key:"17qcm7"}],["circle",{cx:"18",cy:"6",r:"3",key:"1h7g24"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}],["path",{d:"M18 9a9 9 0 0 1-9 9",key:"n2h4wq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qv=h("GitCompare",[["circle",{cx:"18",cy:"18",r:"3",key:"1xkwt0"}],["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M13 6h3a2 2 0 0 1 2 2v7",key:"1yeb86"}],["path",{d:"M11 18H8a2 2 0 0 1-2-2V9",key:"19pyzm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Github",[["path",{d:"M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",key:"tonef"}],["path",{d:"M9 18c-4.51 2-5-2-7-2",key:"9comsn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jv=h("Globe",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20",key:"13o1zl"}],["path",{d:"M2 12h20",key:"9i4pu4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ek=h("GraduationCap",[["path",{d:"M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z",key:"j76jl0"}],["path",{d:"M22 10v6",key:"1lu8f3"}],["path",{d:"M6 12.5V16a6 3 0 0 0 12 0v-3.5",key:"1r8lef"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tk=h("Grid3x3",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}],["path",{d:"M3 15h18",key:"5xshup"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"M15 3v18",key:"14nvp0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const nk=h("GripVertical",[["circle",{cx:"9",cy:"12",r:"1",key:"1vctgf"}],["circle",{cx:"9",cy:"5",r:"1",key:"hp0tcf"}],["circle",{cx:"9",cy:"19",r:"1",key:"fkjjf6"}],["circle",{cx:"15",cy:"12",r:"1",key:"1tmaij"}],["circle",{cx:"15",cy:"5",r:"1",key:"19l28e"}],["circle",{cx:"15",cy:"19",r:"1",key:"f4zoj3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rk=h("Hammer",[["path",{d:"m15 12-8.373 8.373a1 1 0 1 1-3-3L12 9",key:"eefl8a"}],["path",{d:"m18 15 4-4",key:"16gjal"}],["path",{d:"m21.5 11.5-1.914-1.914A2 2 0 0 1 19 8.172V7l-2.26-2.26a6 6 0 0 0-4.202-1.756L9 2.96l.92.82A6.18 6.18 0 0 1 12 8.4V10l2 2h1.172a2 2 0 0 1 1.414.586L18.5 14.5",key:"b7pghm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ok=h("Handshake",[["path",{d:"m11 17 2 2a1 1 0 1 0 3-3",key:"efffak"}],["path",{d:"m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4",key:"9pr0kb"}],["path",{d:"m21 3 1 11h-2",key:"1tisrp"}],["path",{d:"M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3",key:"1uvwmv"}],["path",{d:"M3 4h8",key:"1ep09j"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const sk=h("HardDrive",[["line",{x1:"22",x2:"2",y1:"12",y2:"12",key:"1y58io"}],["path",{d:"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",key:"oot6mr"}],["line",{x1:"6",x2:"6.01",y1:"16",y2:"16",key:"sgf278"}],["line",{x1:"10",x2:"10.01",y1:"16",y2:"16",key:"1l4acy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ik=h("HardHat",[["path",{d:"M2 18a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v2z",key:"1dej2m"}],["path",{d:"M10 10V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5",key:"1p9q5i"}],["path",{d:"M4 15v-3a6 6 0 0 1 6-6",key:"9ciidu"}],["path",{d:"M14 6a6 6 0 0 1 6 6v3",key:"1hnv84"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ak=h("Hash",[["line",{x1:"4",x2:"20",y1:"9",y2:"9",key:"4lhtct"}],["line",{x1:"4",x2:"20",y1:"15",y2:"15",key:"vyu0kd"}],["line",{x1:"10",x2:"8",y1:"3",y2:"21",key:"1ggp8o"}],["line",{x1:"16",x2:"14",y1:"3",y2:"21",key:"weycgp"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ck=h("Headphones",[["path",{d:"M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3",key:"1xhozi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lk=h("Heart",[["path",{d:"M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",key:"c3ymky"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const uk=h("History",[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M12 7v5l4 2",key:"1fdv2h"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dk=h("Home",[["path",{d:"m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",key:"y5dka4"}],["polyline",{points:"9 22 9 12 15 12 15 22",key:"e2us08"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Hourglass",[["path",{d:"M5 22h14",key:"ehvnwv"}],["path",{d:"M5 2h14",key:"pdyrp9"}],["path",{d:"M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22",key:"1d314k"}],["path",{d:"M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2",key:"1vvvr6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hk=h("ImagePlus",[["path",{d:"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7",key:"31hg93"}],["line",{x1:"16",x2:"22",y1:"5",y2:"5",key:"ez7e4s"}],["line",{x1:"19",x2:"19",y1:"2",y2:"8",key:"1gkr8c"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fk=h("Image",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",ry:"2",key:"1m3agn"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const pk=h("Import",[["path",{d:"M12 3v12",key:"1x0j5s"}],["path",{d:"m8 11 4 4 4-4",key:"1dohi6"}],["path",{d:"M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4",key:"1ywtjm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yk=h("Inbox",[["polyline",{points:"22 12 16 12 14 15 10 15 8 12 2 12",key:"o97t9d"}],["path",{d:"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",key:"oot6mr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mk=h("Info",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M12 16v-4",key:"1dtifu"}],["path",{d:"M12 8h.01",key:"e9boi3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gk=h("Instagram",[["rect",{width:"20",height:"20",x:"2",y:"2",rx:"5",ry:"5",key:"2e1cvw"}],["path",{d:"M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z",key:"9exkf1"}],["line",{x1:"17.5",x2:"17.51",y1:"6.5",y2:"6.5",key:"r4j83e"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vk=h("KeyRound",[["path",{d:"M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z",key:"167ctg"}],["circle",{cx:"16.5",cy:"7.5",r:".5",fill:"currentColor",key:"w0ekpg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kk=h("Key",[["path",{d:"m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4",key:"g0fldk"}],["path",{d:"m21 2-9.6 9.6",key:"1j0ho8"}],["circle",{cx:"7.5",cy:"15.5",r:"5.5",key:"yqb3hr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xk=h("Landmark",[["line",{x1:"3",x2:"21",y1:"22",y2:"22",key:"j8o0r"}],["line",{x1:"6",x2:"6",y1:"18",y2:"11",key:"10tf0k"}],["line",{x1:"10",x2:"10",y1:"18",y2:"11",key:"54lgf6"}],["line",{x1:"14",x2:"14",y1:"18",y2:"11",key:"380y"}],["line",{x1:"18",x2:"18",y1:"18",y2:"11",key:"1kevvc"}],["polygon",{points:"12 2 20 7 4 7",key:"jkujk7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mk=h("Languages",[["path",{d:"m5 8 6 6",key:"1wu5hv"}],["path",{d:"m4 14 6-6 2-3",key:"1k1g8d"}],["path",{d:"M2 5h12",key:"or177f"}],["path",{d:"M7 2h1",key:"1t2jsx"}],["path",{d:"m22 22-5-10-5 10",key:"don7ne"}],["path",{d:"M14 18h6",key:"1m8k6r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wk=h("Laptop",[["path",{d:"M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16",key:"tarvll"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bk=h("Layers3",[["path",{d:"m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",key:"8b97xw"}],["path",{d:"m6.08 9.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59",key:"1e5n1m"}],["path",{d:"m6.08 14.5-3.5 1.6a1 1 0 0 0 0 1.81l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9a1 1 0 0 0 0-1.83l-3.5-1.59",key:"1iwflc"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ck=h("Layers",[["path",{d:"m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z",key:"8b97xw"}],["path",{d:"m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65",key:"dd6zsq"}],["path",{d:"m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65",key:"ep9fru"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sk=h("LayoutDashboard",[["rect",{width:"7",height:"9",x:"3",y:"3",rx:"1",key:"10lvy0"}],["rect",{width:"7",height:"5",x:"14",y:"3",rx:"1",key:"16une8"}],["rect",{width:"7",height:"9",x:"14",y:"12",rx:"1",key:"1hutg5"}],["rect",{width:"7",height:"5",x:"3",y:"16",rx:"1",key:"ldoo1y"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ak=h("LayoutGrid",[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"14",y:"3",rx:"1",key:"6d4xhi"}],["rect",{width:"7",height:"7",x:"14",y:"14",rx:"1",key:"nxv5o0"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Pk=h("LayoutList",[["rect",{width:"7",height:"7",x:"3",y:"3",rx:"1",key:"1g98yp"}],["rect",{width:"7",height:"7",x:"3",y:"14",rx:"1",key:"1bb6yr"}],["path",{d:"M14 4h7",key:"3xa0d5"}],["path",{d:"M14 9h7",key:"1icrd9"}],["path",{d:"M14 15h7",key:"1mj8o2"}],["path",{d:"M14 20h7",key:"11slyb"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tk=h("LayoutTemplate",[["rect",{width:"18",height:"7",x:"3",y:"3",rx:"1",key:"f1a2em"}],["rect",{width:"9",height:"7",x:"3",y:"14",rx:"1",key:"jqznyg"}],["rect",{width:"5",height:"7",x:"16",y:"14",rx:"1",key:"q5h2i8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rk=h("Lightbulb",[["path",{d:"M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5",key:"1gvzjb"}],["path",{d:"M9 18h6",key:"x1upvd"}],["path",{d:"M10 22h4",key:"ceow96"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ek=h("LineChart",[["path",{d:"M3 3v18h18",key:"1s2lah"}],["path",{d:"m19 9-5 5-4-4-3 3",key:"2osh9i"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dk=h("Link2Off",[["path",{d:"M9 17H7A5 5 0 0 1 7 7",key:"10o201"}],["path",{d:"M15 7h2a5 5 0 0 1 4 8",key:"1d3206"}],["line",{x1:"8",x2:"12",y1:"12",y2:"12",key:"rvw6j4"}],["line",{x1:"2",x2:"22",y1:"2",y2:"22",key:"a6p6uj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lk=h("Link2",[["path",{d:"M9 17H7A5 5 0 0 1 7 7h2",key:"8i5ue5"}],["path",{d:"M15 7h2a5 5 0 1 1 0 10h-2",key:"1b9ql8"}],["line",{x1:"8",x2:"16",y1:"12",y2:"12",key:"1jonct"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vk=h("Link",[["path",{d:"M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71",key:"1cjeqo"}],["path",{d:"M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",key:"19qd67"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ok=h("ListChecks",[["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"m3 7 2 2 4-4",key:"1obspn"}],["path",{d:"M13 6h8",key:"15sg57"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 18h8",key:"oe0vm4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jk=h("ListOrdered",[["line",{x1:"10",x2:"21",y1:"6",y2:"6",key:"76qw6h"}],["line",{x1:"10",x2:"21",y1:"12",y2:"12",key:"16nom4"}],["line",{x1:"10",x2:"21",y1:"18",y2:"18",key:"u3jurt"}],["path",{d:"M4 6h1v4",key:"cnovpq"}],["path",{d:"M4 10h2",key:"16xx2s"}],["path",{d:"M6 18H4c0-1 2-2 2-3s-1-1.5-2-1",key:"m9a95d"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ik=h("ListTodo",[["rect",{x:"3",y:"5",width:"6",height:"6",rx:"1",key:"1defrl"}],["path",{d:"m3 17 2 2 4-4",key:"1jhpwq"}],["path",{d:"M13 6h8",key:"15sg57"}],["path",{d:"M13 12h8",key:"h98zly"}],["path",{d:"M13 18h8",key:"oe0vm4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fk=h("ListTree",[["path",{d:"M21 12h-8",key:"1bmf0i"}],["path",{d:"M21 6H8",key:"1pqkrb"}],["path",{d:"M21 18h-8",key:"1tm79t"}],["path",{d:"M3 6v4c0 1.1.9 2 2 2h3",key:"1ywdgy"}],["path",{d:"M3 10v6c0 1.1.9 2 2 2h3",key:"2wc746"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nk=h("List",[["line",{x1:"8",x2:"21",y1:"6",y2:"6",key:"7ey8pc"}],["line",{x1:"8",x2:"21",y1:"12",y2:"12",key:"rjfblc"}],["line",{x1:"8",x2:"21",y1:"18",y2:"18",key:"c3b1m8"}],["line",{x1:"3",x2:"3.01",y1:"6",y2:"6",key:"1g7gq3"}],["line",{x1:"3",x2:"3.01",y1:"12",y2:"12",key:"1pjlvk"}],["line",{x1:"3",x2:"3.01",y1:"18",y2:"18",key:"28t2mc"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _k=h("LoaderCircle",[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bk=h("LockKeyhole",[["circle",{cx:"12",cy:"16",r:"1",key:"1au0dj"}],["rect",{x:"3",y:"10",width:"18",height:"12",rx:"2",key:"6s8ecr"}],["path",{d:"M7 10V7a5 5 0 0 1 10 0v3",key:"1pqi11"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zk=h("LockOpen",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 9.9-1",key:"1mm8w8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hk=h("Lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qk=h("LogIn",[["path",{d:"M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4",key:"u53s6r"}],["polyline",{points:"10 17 15 12 10 7",key:"1ail0h"}],["line",{x1:"15",x2:"3",y1:"12",y2:"12",key:"v6grx8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Uk=h("LogOut",[["path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",key:"1uf3rs"}],["polyline",{points:"16 17 21 12 16 7",key:"1gabdz"}],["line",{x1:"21",x2:"9",y1:"12",y2:"12",key:"1uyos4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("MailOpen",[["path",{d:"M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z",key:"1jhwl8"}],["path",{d:"m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10",key:"1qfld7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $k=h("Mail",[["rect",{width:"20",height:"16",x:"2",y:"4",rx:"2",key:"18n3k1"}],["path",{d:"m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7",key:"1ocrg3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wk=h("MapPin",[["path",{d:"M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z",key:"2oe9fu"}],["circle",{cx:"12",cy:"10",r:"3",key:"ilqhr7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gk=h("MapPinned",[["path",{d:"M18 8c0 4.5-6 9-6 9s-6-4.5-6-9a6 6 0 0 1 12 0",key:"yrbn30"}],["circle",{cx:"12",cy:"8",r:"2",key:"1822b1"}],["path",{d:"M8.835 14H5a1 1 0 0 0-.9.7l-2 6c-.1.1-.1.2-.1.3 0 .6.4 1 1 1h18c.6 0 1-.4 1-1 0-.1 0-.2-.1-.3l-2-6a1 1 0 0 0-.9-.7h-3.835",key:"112zkj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Kk=h("Map",[["path",{d:"M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z",key:"169xi5"}],["path",{d:"M15 5.764v15",key:"1pn4in"}],["path",{d:"M9 3.236v15",key:"1uimfh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zk=h("Maximize2",[["polyline",{points:"15 3 21 3 21 9",key:"mznyad"}],["polyline",{points:"9 21 3 21 3 15",key:"1avn1i"}],["line",{x1:"21",x2:"14",y1:"3",y2:"10",key:"ota7mn"}],["line",{x1:"3",x2:"10",y1:"21",y2:"14",key:"1atl0r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Medal",[["path",{d:"M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15",key:"143lza"}],["path",{d:"M11 12 5.12 2.2",key:"qhuxz6"}],["path",{d:"m13 12 5.88-9.8",key:"hbye0f"}],["path",{d:"M8 7h8",key:"i86dvs"}],["circle",{cx:"12",cy:"17",r:"5",key:"qbz8iq"}],["path",{d:"M12 18v-2h-.5",key:"fawc4q"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xk=h("Megaphone",[["path",{d:"m3 11 18-5v12L3 14v-3z",key:"n962bs"}],["path",{d:"M11.6 16.8a3 3 0 1 1-5.8-1.6",key:"1yl0tm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yk=h("MemoryStick",[["path",{d:"M6 19v-3",key:"1nvgqn"}],["path",{d:"M10 19v-3",key:"iu8nkm"}],["path",{d:"M14 19v-3",key:"kcehxu"}],["path",{d:"M18 19v-3",key:"1vh91z"}],["path",{d:"M8 11V9",key:"63erz4"}],["path",{d:"M16 11V9",key:"fru6f3"}],["path",{d:"M12 11V9",key:"ha00sb"}],["path",{d:"M2 15h20",key:"16ne18"}],["path",{d:"M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v1.1a2 2 0 0 0 0 3.837V17a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5.1a2 2 0 0 0 0-3.837Z",key:"lhddv3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qk=h("Menu",[["line",{x1:"4",x2:"20",y1:"12",y2:"12",key:"1e0a9i"}],["line",{x1:"4",x2:"20",y1:"6",y2:"6",key:"1owob3"}],["line",{x1:"4",x2:"20",y1:"18",y2:"18",key:"yk5zj1"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Merge",[["path",{d:"m8 6 4-4 4 4",key:"ybng9g"}],["path",{d:"M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22",key:"1hyw0i"}],["path",{d:"m20 22-5-5",key:"1m27yz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Jk=h("MessageCircle",[["path",{d:"M7.9 20A9 9 0 1 0 4 16.1L2 22Z",key:"vv11sd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const e4=h("MessageSquareQuote",[["path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",key:"1lielz"}],["path",{d:"M8 12a2 2 0 0 0 2-2V8H8",key:"1jfesj"}],["path",{d:"M14 12a2 2 0 0 0 2-2V8h-2",key:"1dq9mh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const t4=h("MessageSquare",[["path",{d:"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",key:"1lielz"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const n4=h("MicOff",[["line",{x1:"2",x2:"22",y1:"2",y2:"22",key:"a6p6uj"}],["path",{d:"M18.89 13.23A7.12 7.12 0 0 0 19 12v-2",key:"80xlxr"}],["path",{d:"M5 10v2a7 7 0 0 0 12 5",key:"p2k8kg"}],["path",{d:"M15 9.34V5a3 3 0 0 0-5.68-1.33",key:"1gzdoj"}],["path",{d:"M9 9v3a3 3 0 0 0 5.12 2.12",key:"r2i35w"}],["line",{x1:"12",x2:"12",y1:"19",y2:"22",key:"x3vr5v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const r4=h("Mic",[["path",{d:"M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z",key:"131961"}],["path",{d:"M19 10v2a7 7 0 0 1-14 0v-2",key:"1vc78b"}],["line",{x1:"12",x2:"12",y1:"19",y2:"22",key:"x3vr5v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const o4=h("Minimize2",[["polyline",{points:"4 14 10 14 10 20",key:"11kfnr"}],["polyline",{points:"20 10 14 10 14 4",key:"rlmsce"}],["line",{x1:"14",x2:"21",y1:"10",y2:"3",key:"o5lafz"}],["line",{x1:"3",x2:"10",y1:"21",y2:"14",key:"1atl0r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const s4=h("Minus",[["path",{d:"M5 12h14",key:"1ays0h"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i4=h("MonitorSmartphone",[["path",{d:"M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8",key:"10dyio"}],["path",{d:"M10 19v-3.96 3.15",key:"1irgej"}],["path",{d:"M7 19h5",key:"qswx4l"}],["rect",{width:"6",height:"10",x:"16",y:"12",rx:"2",key:"1egngj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const a4=h("Monitor",[["rect",{width:"20",height:"14",x:"2",y:"3",rx:"2",key:"48i651"}],["line",{x1:"8",x2:"16",y1:"21",y2:"21",key:"1svkeh"}],["line",{x1:"12",x2:"12",y1:"17",y2:"21",key:"vw1qmm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c4=h("Moon",[["path",{d:"M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z",key:"a7tn18"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const l4=h("MousePointerClick",[["path",{d:"m9 9 5 12 1.8-5.2L21 14Z",key:"1b76lo"}],["path",{d:"M7.2 2.2 8 5.1",key:"1cfko1"}],["path",{d:"m5.1 8-2.9-.8",key:"1go3kf"}],["path",{d:"M14 4.1 12 6",key:"ita8i4"}],["path",{d:"m6 12-1.9 2",key:"mnht97"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u4=h("MoveRight",[["path",{d:"M18 8L22 12L18 16",key:"1r0oui"}],["path",{d:"M2 12H22",key:"1m8cig"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d4=h("Move",[["polyline",{points:"5 9 2 12 5 15",key:"1r5uj5"}],["polyline",{points:"9 5 12 2 15 5",key:"5v383o"}],["polyline",{points:"15 19 12 22 9 19",key:"g7qi8m"}],["polyline",{points:"19 9 22 12 19 15",key:"tpp73q"}],["line",{x1:"2",x2:"22",y1:"12",y2:"12",key:"1dnqot"}],["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h4=h("Music",[["path",{d:"M9 18V5l12-2v13",key:"1jmyc2"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}],["circle",{cx:"18",cy:"16",r:"3",key:"1hluhg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f4=h("Navigation",[["polygon",{points:"3 11 22 2 13 21 11 13 3 11",key:"1ltx0t"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p4=h("Network",[["rect",{x:"16",y:"16",width:"6",height:"6",rx:"1",key:"4q2zg0"}],["rect",{x:"2",y:"16",width:"6",height:"6",rx:"1",key:"8cvhb9"}],["rect",{x:"9",y:"2",width:"6",height:"6",rx:"1",key:"1egb70"}],["path",{d:"M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3",key:"1jsf9p"}],["path",{d:"M12 12V8",key:"2874zd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y4=h("Newspaper",[["path",{d:"M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2",key:"7pis2x"}],["path",{d:"M18 14h-8",key:"sponae"}],["path",{d:"M15 18h-5",key:"95g1m2"}],["path",{d:"M10 6h8v4h-8V6Z",key:"smlsk5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m4=h("PackageCheck",[["path",{d:"m16 16 2 2 4-4",key:"gfu2re"}],["path",{d:"M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14",key:"e7tb2h"}],["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["polyline",{points:"3.29 7 12 12 20.71 7",key:"ousv84"}],["line",{x1:"12",x2:"12",y1:"22",y2:"12",key:"a4e8g8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g4=h("PackageMinus",[["path",{d:"M16 16h6",key:"100bgy"}],["path",{d:"M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14",key:"e7tb2h"}],["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["polyline",{points:"3.29 7 12 12 20.71 7",key:"ousv84"}],["line",{x1:"12",x2:"12",y1:"22",y2:"12",key:"a4e8g8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v4=h("PackageOpen",[["path",{d:"M12 22v-9",key:"x3hkom"}],["path",{d:"M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z",key:"2ntwy6"}],["path",{d:"M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13",key:"1pmm1c"}],["path",{d:"M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z",key:"12ttoo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k4=h("PackagePlus",[["path",{d:"M16 16h6",key:"100bgy"}],["path",{d:"M19 13v6",key:"85cyf1"}],["path",{d:"M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14",key:"e7tb2h"}],["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["polyline",{points:"3.29 7 12 12 20.71 7",key:"ousv84"}],["line",{x1:"12",x2:"12",y1:"22",y2:"12",key:"a4e8g8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x4=h("PackageX",[["path",{d:"M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14",key:"e7tb2h"}],["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["polyline",{points:"3.29 7 12 12 20.71 7",key:"ousv84"}],["line",{x1:"12",x2:"12",y1:"22",y2:"12",key:"a4e8g8"}],["path",{d:"m17 13 5 5m-5 0 5-5",key:"im3w4b"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M4=h("Package",[["path",{d:"m7.5 4.27 9 5.15",key:"1c824w"}],["path",{d:"M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z",key:"hh9hay"}],["path",{d:"m3.3 7 8.7 5 8.7-5",key:"g66t2b"}],["path",{d:"M12 22V12",key:"d0xqtd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const w4=h("Paintbrush",[["path",{d:"m14.622 17.897-10.68-2.913",key:"vj2p1u"}],["path",{d:"M18.376 2.622a1 1 0 1 1 3.002 3.002L17.36 9.643a.5.5 0 0 0 0 .707l.944.944a2.41 2.41 0 0 1 0 3.408l-.944.944a.5.5 0 0 1-.707 0L8.354 7.348a.5.5 0 0 1 0-.707l.944-.944a2.41 2.41 0 0 1 3.408 0l.944.944a.5.5 0 0 0 .707 0z",key:"18tc5c"}],["path",{d:"M9 8c-1.804 2.71-3.97 3.46-6.583 3.948a.507.507 0 0 0-.302.819l7.32 8.883a1 1 0 0 0 1.185.204C12.735 20.405 16 16.792 16 15",key:"ytzfxy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b4=h("Palette",[["circle",{cx:"13.5",cy:"6.5",r:".5",fill:"currentColor",key:"1okk4w"}],["circle",{cx:"17.5",cy:"10.5",r:".5",fill:"currentColor",key:"f64h9f"}],["circle",{cx:"8.5",cy:"7.5",r:".5",fill:"currentColor",key:"fotxhn"}],["circle",{cx:"6.5",cy:"12.5",r:".5",fill:"currentColor",key:"qy21gx"}],["path",{d:"M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z",key:"12rzf8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C4=h("PanelLeftClose",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}],["path",{d:"m16 15-3-3 3-3",key:"14y99z"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const S4=h("PanelLeft",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M9 3v18",key:"fh3hqa"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const A4=h("PanelTop",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const P4=h("PanelsTopLeft",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}],["path",{d:"M9 21V9",key:"1oto5p"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const T4=h("Paperclip",[["path",{d:"m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48",key:"1u3ebp"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const R4=h("PartyPopper",[["path",{d:"M5.8 11.3 2 22l10.7-3.79",key:"gwxi1d"}],["path",{d:"M4 3h.01",key:"1vcuye"}],["path",{d:"M22 8h.01",key:"1mrtc2"}],["path",{d:"M15 2h.01",key:"1cjtqr"}],["path",{d:"M22 20h.01",key:"1mrys2"}],["path",{d:"m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10",key:"hbicv8"}],["path",{d:"m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17",key:"1i94pl"}],["path",{d:"m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7",key:"1cofks"}],["path",{d:"M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z",key:"4kbmks"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const E4=h("Pause",[["rect",{x:"14",y:"4",width:"4",height:"16",rx:"1",key:"zuxfzm"}],["rect",{x:"6",y:"4",width:"4",height:"16",rx:"1",key:"1okwgv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const D4=h("PenLine",[["path",{d:"M12 20h9",key:"t2du7b"}],["path",{d:"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z",key:"1ykcvy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const L4=h("PenTool",[["path",{d:"M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z",key:"nt11vn"}],["path",{d:"m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18",key:"15qc1e"}],["path",{d:"m2.3 2.3 7.286 7.286",key:"1wuzzi"}],["circle",{cx:"11",cy:"11",r:"2",key:"xmgehs"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const V4=h("Pen",[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const O4=h("Pencil",[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j4=h("Percent",[["line",{x1:"19",x2:"5",y1:"5",y2:"19",key:"1x9vlm"}],["circle",{cx:"6.5",cy:"6.5",r:"2.5",key:"4mh3h7"}],["circle",{cx:"17.5",cy:"17.5",r:"2.5",key:"1mdrzq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I4=h("PhoneCall",[["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}],["path",{d:"M14.05 2a9 9 0 0 1 8 7.94",key:"vmijpz"}],["path",{d:"M14.05 6A5 5 0 0 1 18 10",key:"13nbpp"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const F4=h("PhoneForwarded",[["polyline",{points:"18 2 22 6 18 10",key:"6vjanh"}],["line",{x1:"14",x2:"22",y1:"6",y2:"6",key:"1jsywh"}],["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const N4=h("PhoneIncoming",[["polyline",{points:"16 2 16 8 22 8",key:"1ygljm"}],["line",{x1:"22",x2:"16",y1:"2",y2:"8",key:"1xzwqn"}],["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _4=h("PhoneMissed",[["line",{x1:"22",x2:"16",y1:"2",y2:"8",key:"1xzwqn"}],["line",{x1:"16",x2:"22",y1:"2",y2:"8",key:"13zxdn"}],["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B4=h("PhoneOff",[["path",{d:"M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91",key:"z86iuo"}],["line",{x1:"22",x2:"2",y1:"2",y2:"22",key:"11kh81"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const z4=h("PhoneOutgoing",[["polyline",{points:"22 8 22 2 16 2",key:"1g204g"}],["line",{x1:"16",x2:"22",y1:"8",y2:"2",key:"1ggias"}],["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const H4=h("Phone",[["path",{d:"M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",key:"foiqr5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const q4=h("PieChart",[["path",{d:"M21.21 15.89A10 10 0 1 1 8 2.83",key:"k2fpak"}],["path",{d:"M22 12A10 10 0 0 0 12 2v10z",key:"1rfc4y"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("PiggyBank",[["path",{d:"M19 5c-1.5 0-2.8 1.4-3 2-3.5-1.5-11-.3-11 5 0 1.8 0 3 2 4.5V20h4v-2h3v2h4v-4c1-.5 1.7-1 2-2h2v-4h-2c0-1-.5-1.5-1-2V5z",key:"1ivx2i"}],["path",{d:"M2 9v1c0 1.1.9 2 2 2h1",key:"nm575m"}],["path",{d:"M16 11h.01",key:"xkw8gn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const U4=h("Pill",[["path",{d:"m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z",key:"wa1lgi"}],["path",{d:"m8.5 8.5 7 7",key:"rvfmvr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $4=h("PinOff",[["line",{x1:"2",x2:"22",y1:"2",y2:"22",key:"a6p6uj"}],["line",{x1:"12",x2:"12",y1:"17",y2:"22",key:"1jrz49"}],["path",{d:"M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V17h12",key:"13x2n8"}],["path",{d:"M15 9.34V6h1a2 2 0 0 0 0-4H7.89",key:"reo3ki"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const W4=h("Pin",[["line",{x1:"12",x2:"12",y1:"17",y2:"22",key:"1jrz49"}],["path",{d:"M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z",key:"13yl11"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Plane",[["path",{d:"M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",key:"1v9wt8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const G4=h("Play",[["polygon",{points:"6 3 20 12 6 21 6 3",key:"1oa8hb"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const K4=h("Plus",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Z4=h("PowerOff",[["path",{d:"M18.36 6.64A9 9 0 0 1 20.77 15",key:"dxknvb"}],["path",{d:"M6.16 6.16a9 9 0 1 0 12.68 12.68",key:"1x7qb5"}],["path",{d:"M12 2v4",key:"3427ic"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const X4=h("Power",[["path",{d:"M12 2v10",key:"mnfbl"}],["path",{d:"M18.4 6.6a9 9 0 1 1-12.77.04",key:"obofu9"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Y4=h("Printer",[["path",{d:"M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2",key:"143wyd"}],["path",{d:"M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6",key:"1itne7"}],["rect",{x:"6",y:"14",width:"12",height:"8",rx:"1",key:"1ue0tg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Q4=h("Puzzle",[["path",{d:"M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z",key:"i0oyt7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const J4=h("QrCode",[["rect",{width:"5",height:"5",x:"3",y:"3",rx:"1",key:"1tu5fj"}],["rect",{width:"5",height:"5",x:"16",y:"3",rx:"1",key:"1v8r4q"}],["rect",{width:"5",height:"5",x:"3",y:"16",rx:"1",key:"1x03jg"}],["path",{d:"M21 16h-3a2 2 0 0 0-2 2v3",key:"177gqh"}],["path",{d:"M21 21v.01",key:"ents32"}],["path",{d:"M12 7v3a2 2 0 0 1-2 2H7",key:"8crl2c"}],["path",{d:"M3 12h.01",key:"nlz23k"}],["path",{d:"M12 3h.01",key:"n36tog"}],["path",{d:"M12 16v.01",key:"133mhm"}],["path",{d:"M16 12h1",key:"1slzba"}],["path",{d:"M21 12v.01",key:"1lwtk9"}],["path",{d:"M12 21v-1",key:"1880an"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const e5=h("Radar",[["path",{d:"M19.07 4.93A10 10 0 0 0 6.99 3.34",key:"z3du51"}],["path",{d:"M4 6h.01",key:"oypzma"}],["path",{d:"M2.29 9.62A10 10 0 1 0 21.31 8.35",key:"qzzz0"}],["path",{d:"M16.24 7.76A6 6 0 1 0 8.23 16.67",key:"1yjesh"}],["path",{d:"M12 18h.01",key:"mhygvu"}],["path",{d:"M17.99 11.66A6 6 0 0 1 15.77 16.67",key:"1u2y91"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}],["path",{d:"m13.41 10.59 5.66-5.66",key:"mhq4k0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const t5=h("Radio",[["path",{d:"M4.9 19.1C1 15.2 1 8.8 4.9 4.9",key:"1vaf9d"}],["path",{d:"M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5",key:"u1ii0m"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}],["path",{d:"M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5",key:"1j5fej"}],["path",{d:"M19.1 4.9C23 8.8 23 15.1 19.1 19",key:"10b0cb"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const n5=h("Receipt",[["path",{d:"M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z",key:"q3az6g"}],["path",{d:"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",key:"1h4pet"}],["path",{d:"M12 17.5v-11",key:"1jc1ny"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const r5=h("RefreshCcw",[["path",{d:"M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"14sxne"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}],["path",{d:"M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16",key:"1hlbsb"}],["path",{d:"M16 16h5v5",key:"ccwih5"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const o5=h("RefreshCw",[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const s5=h("Repeat",[["path",{d:"m17 2 4 4-4 4",key:"nntrym"}],["path",{d:"M3 11v-1a4 4 0 0 1 4-4h14",key:"84bu3i"}],["path",{d:"m7 22-4-4 4-4",key:"1wqhfi"}],["path",{d:"M21 13v1a4 4 0 0 1-4 4H3",key:"1rx37r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const i5=h("Rocket",[["path",{d:"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z",key:"m3kijz"}],["path",{d:"m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z",key:"1fmvmk"}],["path",{d:"M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0",key:"1f8sc4"}],["path",{d:"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5",key:"qeys4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const a5=h("RotateCcw",[["path",{d:"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",key:"1357e3"}],["path",{d:"M3 3v5h5",key:"1xhq8a"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const c5=h("RotateCw",[["path",{d:"M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8",key:"1p45f6"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const l5=h("Route",[["circle",{cx:"6",cy:"19",r:"3",key:"1kj8tv"}],["path",{d:"M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15",key:"1d8sl"}],["circle",{cx:"18",cy:"5",r:"3",key:"gq8acd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u5=h("Rows2",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 12h18",key:"1i2n21"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const d5=h("Ruler",[["path",{d:"M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z",key:"icamh8"}],["path",{d:"m14.5 12.5 2-2",key:"inckbg"}],["path",{d:"m11.5 9.5 2-2",key:"fmmyf7"}],["path",{d:"m8.5 6.5 2-2",key:"vc6u1g"}],["path",{d:"m17.5 15.5 2-2",key:"wo5hmg"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h5=h("Save",[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const f5=h("Scale",[["path",{d:"m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",key:"7g6ntu"}],["path",{d:"m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z",key:"ijws7r"}],["path",{d:"M7 21h10",key:"1b0cd5"}],["path",{d:"M12 3v18",key:"108xh3"}],["path",{d:"M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2",key:"3gwbw2"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const p5=h("ScanBarcode",[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["path",{d:"M8 7v10",key:"23sfjj"}],["path",{d:"M12 7v10",key:"jspqdw"}],["path",{d:"M17 7v10",key:"578dap"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y5=h("ScanLine",[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}],["path",{d:"M7 12h10",key:"b7w52i"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const m5=h("Scan",[["path",{d:"M3 7V5a2 2 0 0 1 2-2h2",key:"aa7l1z"}],["path",{d:"M17 3h2a2 2 0 0 1 2 2v2",key:"4qcy5o"}],["path",{d:"M21 17v2a2 2 0 0 1-2 2h-2",key:"6vwrx8"}],["path",{d:"M7 21H5a2 2 0 0 1-2-2v-2",key:"ioqczr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const g5=h("Scissors",[["circle",{cx:"6",cy:"6",r:"3",key:"1lh9wr"}],["path",{d:"M8.12 8.12 12 12",key:"1alkpv"}],["path",{d:"M20 4 8.12 15.88",key:"xgtan2"}],["circle",{cx:"6",cy:"18",r:"3",key:"fqmcym"}],["path",{d:"M14.8 14.8 20 20",key:"ptml3r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v5=h("ScrollText",[["path",{d:"M15 12h-5",key:"r7krc0"}],["path",{d:"M15 8h-5",key:"1khuty"}],["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",key:"1ph1d7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const k5=h("Scroll",[["path",{d:"M19 17V5a2 2 0 0 0-2-2H4",key:"zz82l3"}],["path",{d:"M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3",key:"1ph1d7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const x5=h("Search",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["path",{d:"m21 21-4.3-4.3",key:"1qie3q"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const M5=h("Send",[["path",{d:"m22 2-7 20-4-9-9-4Z",key:"1q3vgg"}],["path",{d:"M22 2 11 13",key:"nzbqef"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const w5=h("SeparatorHorizontal",[["line",{x1:"3",x2:"21",y1:"12",y2:"12",key:"10d38w"}],["polyline",{points:"8 8 12 4 16 8",key:"zo8t4w"}],["polyline",{points:"16 16 12 20 8 16",key:"1oyrid"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const b5=h("Server",[["rect",{width:"20",height:"8",x:"2",y:"2",rx:"2",ry:"2",key:"ngkwjq"}],["rect",{width:"20",height:"8",x:"2",y:"14",rx:"2",ry:"2",key:"iecqi9"}],["line",{x1:"6",x2:"6.01",y1:"6",y2:"6",key:"16zg32"}],["line",{x1:"6",x2:"6.01",y1:"18",y2:"18",key:"nzw8ys"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C5=h("Settings2",[["path",{d:"M20 7h-9",key:"3s1dr2"}],["path",{d:"M14 17H5",key:"gfn3mx"}],["circle",{cx:"17",cy:"17",r:"3",key:"18b49y"}],["circle",{cx:"7",cy:"7",r:"3",key:"dfmy0x"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const S5=h("Settings",[["path",{d:"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",key:"1qme2f"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const A5=h("Share2",[["circle",{cx:"18",cy:"5",r:"3",key:"gq8acd"}],["circle",{cx:"6",cy:"12",r:"3",key:"w7nqdw"}],["circle",{cx:"18",cy:"19",r:"3",key:"1xt0gg"}],["line",{x1:"8.59",x2:"15.42",y1:"13.51",y2:"17.49",key:"47mynk"}],["line",{x1:"15.41",x2:"8.59",y1:"6.51",y2:"10.49",key:"1n3mei"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const P5=h("Sheet",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",ry:"2",key:"1m3agn"}],["line",{x1:"3",x2:"21",y1:"9",y2:"9",key:"1vqk6q"}],["line",{x1:"3",x2:"21",y1:"15",y2:"15",key:"o2sbyz"}],["line",{x1:"9",x2:"9",y1:"9",y2:"21",key:"1ib60c"}],["line",{x1:"15",x2:"15",y1:"9",y2:"21",key:"1n26ft"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const T5=h("ShieldAlert",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"M12 8v4",key:"1got3b"}],["path",{d:"M12 16h.01",key:"1drbdi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const R5=h("ShieldCheck",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}],["path",{d:"m9 12 2 2 4-4",key:"dzmm74"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const E5=h("ShieldOff",[["path",{d:"m2 2 20 20",key:"1ooewy"}],["path",{d:"M5 5a1 1 0 0 0-1 1v7c0 5 3.5 7.5 7.67 8.94a1 1 0 0 0 .67.01c2.35-.82 4.48-1.97 5.9-3.71",key:"1jlk70"}],["path",{d:"M9.309 3.652A12.252 12.252 0 0 0 11.24 2.28a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1v7a9.784 9.784 0 0 1-.08 1.264",key:"18rp1v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const D5=h("Shield",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const L5=h("Ship",[["path",{d:"M2 21c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1 .6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",key:"iegodh"}],["path",{d:"M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76",key:"fp8vka"}],["path",{d:"M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6",key:"qpkstq"}],["path",{d:"M12 10v4",key:"1kjpxc"}],["path",{d:"M12 2v3",key:"qbqxhf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const V5=h("Shirt",[["path",{d:"M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z",key:"1wgbhj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const O5=h("ShoppingBag",[["path",{d:"M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z",key:"hou9p0"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M16 10a4 4 0 0 1-8 0",key:"1ltviw"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j5=h("ShoppingCart",[["circle",{cx:"8",cy:"21",r:"1",key:"jimo8o"}],["circle",{cx:"19",cy:"21",r:"1",key:"13723u"}],["path",{d:"M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12",key:"9zh506"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const I5=h("Shuffle",[["path",{d:"M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22",key:"1wmou1"}],["path",{d:"m18 2 4 4-4 4",key:"pucp1d"}],["path",{d:"M2 6h1.9c1.5 0 2.9.9 3.6 2.2",key:"10bdb2"}],["path",{d:"M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8",key:"vgxac0"}],["path",{d:"m18 14 4 4-4 4",key:"10pe0f"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const F5=h("SkipForward",[["polygon",{points:"5 4 15 12 5 20 5 4",key:"16p6eg"}],["line",{x1:"19",x2:"19",y1:"5",y2:"19",key:"futhcm"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const N5=h("SlidersHorizontal",[["line",{x1:"21",x2:"14",y1:"4",y2:"4",key:"obuewd"}],["line",{x1:"10",x2:"3",y1:"4",y2:"4",key:"1q6298"}],["line",{x1:"21",x2:"12",y1:"12",y2:"12",key:"1iu8h1"}],["line",{x1:"8",x2:"3",y1:"12",y2:"12",key:"ntss68"}],["line",{x1:"21",x2:"16",y1:"20",y2:"20",key:"14d8ph"}],["line",{x1:"12",x2:"3",y1:"20",y2:"20",key:"m0wm8r"}],["line",{x1:"14",x2:"14",y1:"2",y2:"6",key:"14e1ph"}],["line",{x1:"8",x2:"8",y1:"10",y2:"14",key:"1i6ji0"}],["line",{x1:"16",x2:"16",y1:"18",y2:"22",key:"1lctlv"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _5=h("Smartphone",[["rect",{width:"14",height:"20",x:"5",y:"2",rx:"2",ry:"2",key:"1yt0o3"}],["path",{d:"M12 18h.01",key:"mhygvu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const B5=h("Smile",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"M8 14s1.5 2 4 2 4-2 4-2",key:"1y1vjs"}],["line",{x1:"9",x2:"9.01",y1:"9",y2:"9",key:"yxxnd0"}],["line",{x1:"15",x2:"15.01",y1:"9",y2:"9",key:"1p4y9e"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const z5=h("Snowflake",[["line",{x1:"2",x2:"22",y1:"12",y2:"12",key:"1dnqot"}],["line",{x1:"12",x2:"12",y1:"2",y2:"22",key:"7eqyqh"}],["path",{d:"m20 16-4-4 4-4",key:"rquw4f"}],["path",{d:"m4 8 4 4-4 4",key:"12s3z9"}],["path",{d:"m16 4-4 4-4-4",key:"1tumq1"}],["path",{d:"m8 20 4-4 4 4",key:"9p200w"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const H5=h("Sparkles",[["path",{d:"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z",key:"4pj2yx"}],["path",{d:"M20 3v4",key:"1olli1"}],["path",{d:"M22 5h-4",key:"1gvqau"}],["path",{d:"M4 17v2",key:"vumght"}],["path",{d:"M5 18H3",key:"zchphs"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Split",[["path",{d:"M16 3h5v5",key:"1806ms"}],["path",{d:"M8 3H3v5",key:"15dfkv"}],["path",{d:"M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3",key:"1qrqzj"}],["path",{d:"m15 9 6-6",key:"ko1vev"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const q5=h("SquareCheckBig",[["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}],["path",{d:"M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",key:"1jnkn4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const U5=h("SquarePen",[["path",{d:"M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7",key:"1m0v6g"}],["path",{d:"M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z",key:"ohrbg2"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $5=h("Square",[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const W5=h("Stamp",[["path",{d:"M5 22h14",key:"ehvnwv"}],["path",{d:"M19.27 13.73A2.5 2.5 0 0 0 17.5 13h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.66-.26-1.3-.73-1.77Z",key:"1sy9ra"}],["path",{d:"M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-3-3c-1.66 0-3 1-3 3s1 2 1 3.5V13",key:"cnxgux"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const G5=h("StarOff",[["path",{d:"M8.34 8.34 2 9.27l5 4.87L5.82 21 12 17.77 18.18 21l-.59-3.43",key:"16m0ql"}],["path",{d:"M18.42 12.76 22 9.27l-6.91-1L12 2l-1.44 2.91",key:"1vt8nq"}],["line",{x1:"2",x2:"22",y1:"2",y2:"22",key:"a6p6uj"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const K5=h("Star",[["polygon",{points:"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2",key:"8f66p6"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Z5=h("Stethoscope",[["path",{d:"M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6a6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3",key:"10lez9"}],["path",{d:"M8 15v1a6 6 0 0 0 6 6a6 6 0 0 0 6-6v-4",key:"ce9bce"}],["circle",{cx:"20",cy:"10",r:"2",key:"ts1r5v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const X5=h("StickyNote",[["path",{d:"M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8Z",key:"qazsjp"}],["path",{d:"M15 3v4a2 2 0 0 0 2 2h4",key:"40519r"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Y5=h("Store",[["path",{d:"m2 7 4.41-4.41A2 2 0 0 1 7.83 2h8.34a2 2 0 0 1 1.42.59L22 7",key:"ztvudi"}],["path",{d:"M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8",key:"1b2hhj"}],["path",{d:"M15 22v-4a2 2 0 0 0-2-2h-2a2 2 0 0 0-2 2v4",key:"2ebpfo"}],["path",{d:"M2 7h20",key:"1fcdvo"}],["path",{d:"M22 7v3a2 2 0 0 1-2 2a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 16 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 12 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 8 12a2.7 2.7 0 0 1-1.59-.63.7.7 0 0 0-.82 0A2.7 2.7 0 0 1 4 12a2 2 0 0 1-2-2V7",key:"6c3vgh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Q5=h("Sun",[["circle",{cx:"12",cy:"12",r:"4",key:"4exip2"}],["path",{d:"M12 2v2",key:"tus03m"}],["path",{d:"M12 20v2",key:"1lh1kg"}],["path",{d:"m4.93 4.93 1.41 1.41",key:"149t6j"}],["path",{d:"m17.66 17.66 1.41 1.41",key:"ptbguv"}],["path",{d:"M2 12h2",key:"1t8f8n"}],["path",{d:"M20 12h2",key:"1q8mjw"}],["path",{d:"m6.34 17.66-1.41 1.41",key:"1m8zz5"}],["path",{d:"m19.07 4.93-1.41 1.41",key:"1shlcs"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const J5=h("Table2",[["path",{d:"M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18",key:"gugj83"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ex=h("Table",[["path",{d:"M12 3v18",key:"108xh3"}],["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}],["path",{d:"M3 15h18",key:"5xshup"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const tx=h("Tablet",[["rect",{width:"16",height:"20",x:"4",y:"2",rx:"2",ry:"2",key:"76otgf"}],["line",{x1:"12",x2:"12.01",y1:"18",y2:"18",key:"1dp563"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const nx=h("Tag",[["path",{d:"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",key:"vktsd0"}],["circle",{cx:"7.5",cy:"7.5",r:".5",fill:"currentColor",key:"kqv944"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("Tags",[["path",{d:"m15 5 6.3 6.3a2.4 2.4 0 0 1 0 3.4L17 19",key:"1cbfv1"}],["path",{d:"M9.586 5.586A2 2 0 0 0 8.172 5H3a1 1 0 0 0-1 1v5.172a2 2 0 0 0 .586 1.414L8.29 18.29a2.426 2.426 0 0 0 3.42 0l3.58-3.58a2.426 2.426 0 0 0 0-3.42z",key:"135mg7"}],["circle",{cx:"6.5",cy:"9.5",r:".5",fill:"currentColor",key:"5pm5xn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const rx=h("Target",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["circle",{cx:"12",cy:"12",r:"6",key:"1vlfrh"}],["circle",{cx:"12",cy:"12",r:"2",key:"1c9p78"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ox=h("Terminal",[["polyline",{points:"4 17 10 11 4 5",key:"akl6gq"}],["line",{x1:"12",x2:"20",y1:"19",y2:"19",key:"q2wloq"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const sx=h("TestTubeDiagonal",[["path",{d:"M21 7 6.82 21.18a2.83 2.83 0 0 1-3.99-.01a2.83 2.83 0 0 1 0-4L17 3",key:"1ub6xw"}],["path",{d:"m16 2 6 6",key:"1gw87d"}],["path",{d:"M12 16H4",key:"1cjfip"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ix=h("TestTube",[["path",{d:"M14.5 2v17.5c0 1.4-1.1 2.5-2.5 2.5c-1.4 0-2.5-1.1-2.5-2.5V2",key:"125lnx"}],["path",{d:"M8.5 2h7",key:"csnxdl"}],["path",{d:"M14.5 16h-5",key:"1ox875"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ax=h("Thermometer",[["path",{d:"M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z",key:"17jzev"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const cx=h("ThumbsDown",[["path",{d:"M17 14V2",key:"8ymqnk"}],["path",{d:"M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88Z",key:"m61m77"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const lx=h("ThumbsUp",[["path",{d:"M7 10v12",key:"1qc93n"}],["path",{d:"M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z",key:"emmmcr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const ux=h("Ticket",[["path",{d:"M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z",key:"qn84l0"}],["path",{d:"M13 5v2",key:"dyzc3o"}],["path",{d:"M13 17v2",key:"1ont0d"}],["path",{d:"M13 11v2",key:"1wjjxi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const dx=h("Timer",[["line",{x1:"10",x2:"14",y1:"2",y2:"2",key:"14vaq8"}],["line",{x1:"12",x2:"15",y1:"14",y2:"11",key:"17fdiu"}],["circle",{cx:"12",cy:"14",r:"8",key:"1e1u0o"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const hx=h("ToggleLeft",[["rect",{width:"20",height:"12",x:"2",y:"6",rx:"6",ry:"6",key:"f2vt7d"}],["circle",{cx:"8",cy:"12",r:"2",key:"1nvbw3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const fx=h("ToggleRight",[["rect",{width:"20",height:"12",x:"2",y:"6",rx:"6",ry:"6",key:"f2vt7d"}],["circle",{cx:"16",cy:"12",r:"2",key:"4ma0v8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("TramFront",[["rect",{width:"16",height:"16",x:"4",y:"3",rx:"2",key:"1wxw4b"}],["path",{d:"M4 11h16",key:"mpoxn0"}],["path",{d:"M12 3v8",key:"1h2ygw"}],["path",{d:"m8 19-2 3",key:"13i0xs"}],["path",{d:"m18 22-2-3",key:"1p0ohu"}],["path",{d:"M8 15h.01",key:"a7atzg"}],["path",{d:"M16 15h.01",key:"rnfrdf"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const px=h("Trash2",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}],["line",{x1:"10",x2:"10",y1:"11",y2:"17",key:"1uufr5"}],["line",{x1:"14",x2:"14",y1:"11",y2:"17",key:"xtxkd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const yx=h("Trash",[["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",key:"4alrt4"}],["path",{d:"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",key:"v07s0e"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const mx=h("TreePine",[["path",{d:"m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7H17Z",key:"cpyugq"}],["path",{d:"M12 22v-3",key:"kmzjlo"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const gx=h("TrendingDown",[["polyline",{points:"22 17 13.5 8.5 8.5 13.5 2 7",key:"1r2t7k"}],["polyline",{points:"16 17 22 17 22 11",key:"11uiuu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const vx=h("TrendingUp",[["polyline",{points:"22 7 13.5 15.5 8.5 10.5 2 17",key:"126l90"}],["polyline",{points:"16 7 22 7 22 13",key:"kwv8wd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const kx=h("TriangleAlert",[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const xx=h("Trophy",[["path",{d:"M6 9H4.5a2.5 2.5 0 0 1 0-5H6",key:"17hqa7"}],["path",{d:"M18 9h1.5a2.5 2.5 0 0 0 0-5H18",key:"lmptdp"}],["path",{d:"M4 22h16",key:"57wxv0"}],["path",{d:"M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22",key:"1nw9bq"}],["path",{d:"M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22",key:"1np0yb"}],["path",{d:"M18 2H6v7a6 6 0 0 0 12 0V2Z",key:"u46fv3"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Mx=h("Truck",[["path",{d:"M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2",key:"wrbu53"}],["path",{d:"M15 18H9",key:"1lyqi6"}],["path",{d:"M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14",key:"lysw3i"}],["circle",{cx:"17",cy:"18",r:"2",key:"332jqn"}],["circle",{cx:"7",cy:"18",r:"2",key:"19iecd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const wx=h("Type",[["polyline",{points:"4 7 4 4 20 4 20 7",key:"1nosan"}],["line",{x1:"9",x2:"15",y1:"20",y2:"20",key:"swin9y"}],["line",{x1:"12",x2:"12",y1:"4",y2:"20",key:"1tx1rr"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const bx=h("Undo2",[["path",{d:"M9 14 4 9l5-5",key:"102s5s"}],["path",{d:"M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11",key:"f3b9sd"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Cx=h("Unlink",[["path",{d:"m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71",key:"yqzxt4"}],["path",{d:"m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71",key:"4qinb0"}],["line",{x1:"8",x2:"8",y1:"2",y2:"5",key:"1041cp"}],["line",{x1:"2",x2:"5",y1:"8",y2:"8",key:"14m1p5"}],["line",{x1:"16",x2:"16",y1:"19",y2:"22",key:"rzdirn"}],["line",{x1:"19",x2:"22",y1:"16",y2:"16",key:"ox905f"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Sx=h("Upload",[["path",{d:"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4",key:"ih7n3h"}],["polyline",{points:"17 8 12 3 7 8",key:"t8dd8p"}],["line",{x1:"12",x2:"12",y1:"3",y2:"15",key:"widbto"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ax=h("UserCheck",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["polyline",{points:"16 11 18 13 22 9",key:"1pwet4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Px=h("UserCog",[["circle",{cx:"18",cy:"15",r:"3",key:"gjjjvw"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M10 15H6a4 4 0 0 0-4 4v2",key:"1nfge6"}],["path",{d:"m21.7 16.4-.9-.3",key:"12j9ji"}],["path",{d:"m15.2 13.9-.9-.3",key:"1fdjdi"}],["path",{d:"m16.6 18.7.3-.9",key:"heedtr"}],["path",{d:"m19.1 12.2.3-.9",key:"1af3ki"}],["path",{d:"m19.6 18.7-.4-1",key:"1x9vze"}],["path",{d:"m16.8 12.3-.4-1",key:"vqeiwj"}],["path",{d:"m14.3 16.6 1-.4",key:"1qlj63"}],["path",{d:"m20.7 13.8 1-.4",key:"1v5t8k"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Tx=h("UserMinus",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Rx=h("UserPlus",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"19",x2:"19",y1:"8",y2:"14",key:"1bvyxn"}],["line",{x1:"22",x2:"16",y1:"11",y2:"11",key:"1shjgl"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ex=h("UserRound",[["circle",{cx:"12",cy:"8",r:"5",key:"1hypcn"}],["path",{d:"M20 21a8 8 0 0 0-16 0",key:"rfgkzh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Dx=h("UserX",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["line",{x1:"17",x2:"22",y1:"8",y2:"13",key:"3nzzx3"}],["line",{x1:"22",x2:"17",y1:"8",y2:"13",key:"1swrse"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Lx=h("User",[["path",{d:"M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2",key:"975kel"}],["circle",{cx:"12",cy:"7",r:"4",key:"17ys0d"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */h("UsersRound",[["path",{d:"M18 21a8 8 0 0 0-16 0",key:"3ypg7q"}],["circle",{cx:"10",cy:"8",r:"5",key:"o932ke"}],["path",{d:"M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3",key:"10s06x"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Vx=h("Users",[["path",{d:"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2",key:"1yyitq"}],["circle",{cx:"9",cy:"7",r:"4",key:"nufk8"}],["path",{d:"M22 21v-2a4 4 0 0 0-3-3.87",key:"kshegd"}],["path",{d:"M16 3.13a4 4 0 0 1 0 7.75",key:"1da9ce"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ox=h("Variable",[["path",{d:"M8 21s-4-3-4-9 4-9 4-9",key:"uto9ud"}],["path",{d:"M16 3s4 3 4 9-4 9-4 9",key:"4w2vsq"}],["line",{x1:"15",x2:"9",y1:"9",y2:"15",key:"f7djnv"}],["line",{x1:"9",x2:"15",y1:"9",y2:"15",key:"1shsy8"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const jx=h("Video",[["path",{d:"m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5",key:"ftymec"}],["rect",{x:"2",y:"6",width:"14",height:"12",rx:"2",key:"158x01"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ix=h("Voicemail",[["circle",{cx:"6",cy:"12",r:"4",key:"1ehtga"}],["circle",{cx:"18",cy:"12",r:"4",key:"4vafl8"}],["line",{x1:"6",x2:"18",y1:"16",y2:"16",key:"pmt8us"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Fx=h("Volume2",[["polygon",{points:"11 5 6 9 2 9 2 15 6 15 11 19 11 5",key:"16drj5"}],["path",{d:"M15.54 8.46a5 5 0 0 1 0 7.07",key:"ltjumu"}],["path",{d:"M19.07 4.93a10 10 0 0 1 0 14.14",key:"1kegas"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Nx=h("VolumeX",[["polygon",{points:"11 5 6 9 2 9 2 15 6 15 11 19 11 5",key:"16drj5"}],["line",{x1:"22",x2:"16",y1:"9",y2:"15",key:"1ewh16"}],["line",{x1:"16",x2:"22",y1:"9",y2:"15",key:"5ykzw1"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const _x=h("Wallet",[["path",{d:"M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1",key:"18etb6"}],["path",{d:"M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4",key:"xoc0q4"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Bx=h("WandSparkles",[["path",{d:"m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72",key:"ul74o6"}],["path",{d:"m14 7 3 3",key:"1r5n42"}],["path",{d:"M5 6v4",key:"ilb8ba"}],["path",{d:"M19 14v4",key:"blhpug"}],["path",{d:"M10 2v2",key:"7u0qdc"}],["path",{d:"M7 8H3",key:"zfb6yr"}],["path",{d:"M21 16h-4",key:"1cnmox"}],["path",{d:"M11 3H9",key:"1obp7u"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const zx=h("Warehouse",[["path",{d:"M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z",key:"gksnxg"}],["path",{d:"M6 18h12",key:"9pbo8z"}],["path",{d:"M6 14h12",key:"4cwo0f"}],["rect",{width:"12",height:"12",x:"6",y:"10",key:"apd30q"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Hx=h("Waypoints",[["circle",{cx:"12",cy:"4.5",r:"2.5",key:"r5ysbb"}],["path",{d:"m10.2 6.3-3.9 3.9",key:"1nzqf6"}],["circle",{cx:"4.5",cy:"12",r:"2.5",key:"jydg6v"}],["path",{d:"M7 12h10",key:"b7w52i"}],["circle",{cx:"19.5",cy:"12",r:"2.5",key:"1piiel"}],["path",{d:"m13.8 17.7 3.9-3.9",key:"1wyg1y"}],["circle",{cx:"12",cy:"19.5",r:"2.5",key:"13o1pw"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const qx=h("Webhook",[["path",{d:"M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2",key:"q3hayz"}],["path",{d:"m6 17 3.13-5.78c.53-.97.1-2.18-.5-3.1a4 4 0 1 1 6.89-4.06",key:"1go1hn"}],["path",{d:"m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 0 8",key:"qlwsc0"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Ux=h("Weight",[["circle",{cx:"12",cy:"5",r:"3",key:"rqqgnr"}],["path",{d:"M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.5A2 2 0 0 0 17.48 8Z",key:"56o5sh"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const $x=h("WifiOff",[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}],["path",{d:"M5 12.859a10 10 0 0 1 5.17-2.69",key:"1dl1wf"}],["path",{d:"M19 12.859a10 10 0 0 0-2.007-1.523",key:"4k23kn"}],["path",{d:"M2 8.82a15 15 0 0 1 4.177-2.643",key:"1grhjp"}],["path",{d:"M22 8.82a15 15 0 0 0-11.288-3.764",key:"z3jwby"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Wx=h("Wifi",[["path",{d:"M12 20h.01",key:"zekei9"}],["path",{d:"M2 8.82a15 15 0 0 1 20 0",key:"dnpr2z"}],["path",{d:"M5 12.859a10 10 0 0 1 14 0",key:"1x1e6c"}],["path",{d:"M8.5 16.429a5 5 0 0 1 7 0",key:"1bycff"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Gx=h("Workflow",[["rect",{width:"8",height:"8",x:"3",y:"3",rx:"2",key:"by2w9f"}],["path",{d:"M7 11v4a2 2 0 0 0 2 2h4",key:"xkn7yn"}],["rect",{width:"8",height:"8",x:"13",y:"13",rx:"2",key:"1cgmvn"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Kx=h("Wrench",[["path",{d:"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",key:"cbrjhi"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Zx=h("X",[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Xx=h("Zap",[["path",{d:"M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",key:"1xq2db"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Yx=h("ZoomIn",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["line",{x1:"21",x2:"16.65",y1:"21",y2:"16.65",key:"13gj7c"}],["line",{x1:"11",x2:"11",y1:"8",y2:"14",key:"1vmskp"}],["line",{x1:"8",x2:"14",y1:"11",y2:"11",key:"durymu"}]]);/**
 * @license lucide-react v0.394.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const Qx=h("ZoomOut",[["circle",{cx:"11",cy:"11",r:"8",key:"4ej97u"}],["line",{x1:"21",x2:"16.65",y1:"21",y2:"16.65",key:"13gj7c"}],["line",{x1:"8",x2:"14",y1:"11",y2:"11",key:"durymu"}]]),Or=f.createContext({});function jr(e){const t=f.useRef(null);return t.current===null&&(t.current=e()),t.current}const An=f.createContext(null),Ir=f.createContext({transformPagePoint:e=>e,isStatic:!1,reducedMotion:"never"});class O1 extends f.Component{getSnapshotBeforeUpdate(t){const n=this.props.childRef.current;if(n&&t.isPresent&&!this.props.isPresent){const r=this.props.sizeRef.current;r.height=n.offsetHeight||0,r.width=n.offsetWidth||0,r.top=n.offsetTop,r.left=n.offsetLeft}return null}componentDidUpdate(){}render(){return this.props.children}}function j1({children:e,isPresent:t}){const n=f.useId(),r=f.useRef(null),o=f.useRef({width:0,height:0,top:0,left:0}),{nonce:s}=f.useContext(Ir);return f.useInsertionEffect(()=>{const{width:i,height:a,top:c,left:l}=o.current;if(t||!r.current||!i||!a)return;r.current.dataset.motionPopId=n;const u=document.createElement("style");return s&&(u.nonce=s),document.head.appendChild(u),u.sheet&&u.sheet.insertRule(`
          [data-motion-pop-id="${n}"] {
            position: absolute !important;
            width: ${i}px !important;
            height: ${a}px !important;
            top: ${c}px !important;
            left: ${l}px !important;
          }
        `),()=>{document.head.removeChild(u)}},[t]),b.jsx(O1,{isPresent:t,childRef:r,sizeRef:o,children:f.cloneElement(e,{ref:r})})}const I1=({children:e,initial:t,isPresent:n,onExitComplete:r,custom:o,presenceAffectsLayout:s,mode:i})=>{const a=jr(F1),c=f.useId(),l=f.useCallback(d=>{a.set(d,!0);for(const p of a.values())if(!p)return;r&&r()},[a,r]),u=f.useMemo(()=>({id:c,initial:t,isPresent:n,custom:o,onExitComplete:l,register:d=>(a.set(d,!1),()=>a.delete(d))}),s?[Math.random(),l]:[n,l]);return f.useMemo(()=>{a.forEach((d,p)=>a.set(p,!1))},[n]),f.useEffect(()=>{!n&&!a.size&&r&&r()},[n]),i==="popLayout"&&(e=b.jsx(j1,{isPresent:n,children:e})),b.jsx(An.Provider,{value:u,children:e})};function F1(){return new Map}function ji(e=!0){const t=f.useContext(An);if(t===null)return[!0,null];const{isPresent:n,onExitComplete:r,register:o}=t,s=f.useId();f.useEffect(()=>{e&&o(s)},[e]);const i=f.useCallback(()=>e&&r&&r(s),[s,r,e]);return!n&&r?[!1,i]:[!0]}const Kt=e=>e.key||"";function qo(e){const t=[];return f.Children.forEach(e,n=>{f.isValidElement(n)&&t.push(n)}),t}const Fr=typeof window<"u",Ii=Fr?f.useLayoutEffect:f.useEffect,Jx=({children:e,custom:t,initial:n=!0,onExitComplete:r,presenceAffectsLayout:o=!0,mode:s="sync",propagate:i=!1})=>{const[a,c]=ji(i),l=f.useMemo(()=>qo(e),[e]),u=i&&!a?[]:l.map(Kt),d=f.useRef(!0),p=f.useRef(l),y=jr(()=>new Map),[g,m]=f.useState(l),[v,k]=f.useState(l);Ii(()=>{d.current=!1,p.current=l;for(let C=0;C<v.length;C++){const w=Kt(v[C]);u.includes(w)?y.delete(w):y.get(w)!==!0&&y.set(w,!1)}},[v,u.length,u.join("-")]);const x=[];if(l!==g){let C=[...l];for(let w=0;w<v.length;w++){const S=v[w],A=Kt(S);u.includes(A)||(C.splice(w,0,S),x.push(S))}s==="wait"&&x.length&&(C=x),k(qo(C)),m(l);return}const{forceRender:M}=f.useContext(Or);return b.jsx(b.Fragment,{children:v.map(C=>{const w=Kt(C),S=i&&!a?!1:l===v||u.includes(w),A=()=>{if(y.has(w))y.set(w,!0);else return;let P=!0;y.forEach(D=>{D||(P=!1)}),P&&(M==null||M(),k(p.current),i&&(c==null||c()),r&&r())};return b.jsx(I1,{isPresent:S,initial:!d.current||n?void 0:!1,custom:S?void 0:t,presenceAffectsLayout:o,mode:s,onExitComplete:S?void 0:A,children:C},w)})})},ee=e=>e;let Fi=ee;function Nr(e){let t;return()=>(t===void 0&&(t=e()),t)}const st=(e,t,n)=>{const r=t-e;return r===0?1:(n-e)/r},ke=e=>e*1e3,xe=e=>e/1e3,N1={useManualTiming:!1};function _1(e){let t=new Set,n=new Set,r=!1,o=!1;const s=new WeakSet;let i={delta:0,timestamp:0,isProcessing:!1};function a(l){s.has(l)&&(c.schedule(l),e()),l(i)}const c={schedule:(l,u=!1,d=!1)=>{const y=d&&r?t:n;return u&&s.add(l),y.has(l)||y.add(l),l},cancel:l=>{n.delete(l),s.delete(l)},process:l=>{if(i=l,r){o=!0;return}r=!0,[t,n]=[n,t],t.forEach(a),t.clear(),r=!1,o&&(o=!1,c.process(l))}};return c}const Zt=["read","resolveKeyframes","update","preRender","render","postRender"],B1=40;function Ni(e,t){let n=!1,r=!0;const o={delta:0,timestamp:0,isProcessing:!1},s=()=>n=!0,i=Zt.reduce((k,x)=>(k[x]=_1(s),k),{}),{read:a,resolveKeyframes:c,update:l,preRender:u,render:d,postRender:p}=i,y=()=>{const k=performance.now();n=!1,o.delta=r?1e3/60:Math.max(Math.min(k-o.timestamp,B1),1),o.timestamp=k,o.isProcessing=!0,a.process(o),c.process(o),l.process(o),u.process(o),d.process(o),p.process(o),o.isProcessing=!1,n&&t&&(r=!1,e(y))},g=()=>{n=!0,r=!0,o.isProcessing||e(y)};return{schedule:Zt.reduce((k,x)=>{const M=i[x];return k[x]=(C,w=!1,S=!1)=>(n||g(),M.schedule(C,w,S)),k},{}),cancel:k=>{for(let x=0;x<Zt.length;x++)i[Zt[x]].cancel(k)},state:o,steps:i}}const{schedule:z,cancel:Re,state:G,steps:zn}=Ni(typeof requestAnimationFrame<"u"?requestAnimationFrame:ee,!0),_i=f.createContext({strict:!1}),Uo={animation:["animate","variants","whileHover","whileTap","exit","whileInView","whileFocus","whileDrag"],exit:["exit"],drag:["drag","dragControls"],focus:["whileFocus"],hover:["whileHover","onHoverStart","onHoverEnd"],tap:["whileTap","onTap","onTapStart","onTapCancel"],pan:["onPan","onPanStart","onPanSessionStart","onPanEnd"],inView:["whileInView","onViewportEnter","onViewportLeave"],layout:["layout","layoutId"]},it={};for(const e in Uo)it[e]={isEnabled:t=>Uo[e].some(n=>!!t[n])};function z1(e){for(const t in e)it[t]={...it[t],...e[t]}}const H1=new Set(["animate","exit","variants","initial","style","values","variants","transition","transformTemplate","custom","inherit","onBeforeLayoutMeasure","onAnimationStart","onAnimationComplete","onUpdate","onDragStart","onDrag","onDragEnd","onMeasureDragConstraints","onDirectionLock","onDragTransitionEnd","_dragX","_dragY","onHoverStart","onHoverEnd","onViewportEnter","onViewportLeave","globalTapTarget","ignoreStrict","viewport"]);function un(e){return e.startsWith("while")||e.startsWith("drag")&&e!=="draggable"||e.startsWith("layout")||e.startsWith("onTap")||e.startsWith("onPan")||e.startsWith("onLayout")||H1.has(e)}let Bi=e=>!un(e);function q1(e){e&&(Bi=t=>t.startsWith("on")?!un(t):e(t))}try{q1(require("@emotion/is-prop-valid").default)}catch{}function U1(e,t,n){const r={};for(const o in e)o==="values"&&typeof e.values=="object"||(Bi(o)||n===!0&&un(o)||!t&&!un(o)||e.draggable&&o.startsWith("onDrag"))&&(r[o]=e[o]);return r}function $1(e){if(typeof Proxy>"u")return e;const t=new Map,n=(...r)=>e(...r);return new Proxy(n,{get:(r,o)=>o==="create"?e:(t.has(o)||t.set(o,e(o)),t.get(o))})}const Pn=f.createContext({});function Tt(e){return typeof e=="string"||Array.isArray(e)}function Tn(e){return e!==null&&typeof e=="object"&&typeof e.start=="function"}const _r=["animate","whileInView","whileFocus","whileHover","whileTap","whileDrag","exit"],Br=["initial",..._r];function Rn(e){return Tn(e.animate)||Br.some(t=>Tt(e[t]))}function zi(e){return!!(Rn(e)||e.variants)}function W1(e,t){if(Rn(e)){const{initial:n,animate:r}=e;return{initial:n===!1||Tt(n)?n:void 0,animate:Tt(r)?r:void 0}}return e.inherit!==!1?t:{}}function G1(e){const{initial:t,animate:n}=W1(e,f.useContext(Pn));return f.useMemo(()=>({initial:t,animate:n}),[$o(t),$o(n)])}function $o(e){return Array.isArray(e)?e.join(" "):e}const K1=Symbol.for("motionComponentSymbol");function Ye(e){return e&&typeof e=="object"&&Object.prototype.hasOwnProperty.call(e,"current")}function Z1(e,t,n){return f.useCallback(r=>{r&&e.onMount&&e.onMount(r),t&&(r?t.mount(r):t.unmount()),n&&(typeof n=="function"?n(r):Ye(n)&&(n.current=r))},[t])}const zr=e=>e.replace(/([a-z])([A-Z])/gu,"$1-$2").toLowerCase(),X1="framerAppearId",Hi="data-"+zr(X1),{schedule:Hr}=Ni(queueMicrotask,!1),qi=f.createContext({});function Y1(e,t,n,r,o){var s,i;const{visualElement:a}=f.useContext(Pn),c=f.useContext(_i),l=f.useContext(An),u=f.useContext(Ir).reducedMotion,d=f.useRef(null);r=r||c.renderer,!d.current&&r&&(d.current=r(e,{visualState:t,parent:a,props:n,presenceContext:l,blockInitialAnimation:l?l.initial===!1:!1,reducedMotionConfig:u}));const p=d.current,y=f.useContext(qi);p&&!p.projection&&o&&(p.type==="html"||p.type==="svg")&&Q1(d.current,n,o,y);const g=f.useRef(!1);f.useInsertionEffect(()=>{p&&g.current&&p.update(n,l)});const m=n[Hi],v=f.useRef(!!m&&!(!((s=window.MotionHandoffIsComplete)===null||s===void 0)&&s.call(window,m))&&((i=window.MotionHasOptimisedAnimation)===null||i===void 0?void 0:i.call(window,m)));return Ii(()=>{p&&(g.current=!0,window.MotionIsMounted=!0,p.updateFeatures(),Hr.render(p.render),v.current&&p.animationState&&p.animationState.animateChanges())}),f.useEffect(()=>{p&&(!v.current&&p.animationState&&p.animationState.animateChanges(),v.current&&(queueMicrotask(()=>{var k;(k=window.MotionHandoffMarkAsComplete)===null||k===void 0||k.call(window,m)}),v.current=!1))}),p}function Q1(e,t,n,r){const{layoutId:o,layout:s,drag:i,dragConstraints:a,layoutScroll:c,layoutRoot:l}=t;e.projection=new n(e.latestValues,t["data-framer-portal-id"]?void 0:Ui(e.parent)),e.projection.setOptions({layoutId:o,layout:s,alwaysMeasureLayout:!!i||a&&Ye(a),visualElement:e,animationType:typeof s=="string"?s:"both",initialPromotionConfig:r,layoutScroll:c,layoutRoot:l})}function Ui(e){if(e)return e.options.allowProjection!==!1?e.projection:Ui(e.parent)}function J1({preloadedFeatures:e,createVisualElement:t,useRender:n,useVisualState:r,Component:o}){var s,i;e&&z1(e);function a(l,u){let d;const p={...f.useContext(Ir),...l,layoutId:eu(l)},{isStatic:y}=p,g=G1(l),m=r(l,y);if(!y&&Fr){tu();const v=nu(p);d=v.MeasureLayout,g.visualElement=Y1(o,m,p,t,v.ProjectionNode)}return b.jsxs(Pn.Provider,{value:g,children:[d&&g.visualElement?b.jsx(d,{visualElement:g.visualElement,...p}):null,n(o,l,Z1(m,g.visualElement,u),m,y,g.visualElement)]})}a.displayName=`motion.${typeof o=="string"?o:`create(${(i=(s=o.displayName)!==null&&s!==void 0?s:o.name)!==null&&i!==void 0?i:""})`}`;const c=f.forwardRef(a);return c[K1]=o,c}function eu({layoutId:e}){const t=f.useContext(Or).id;return t&&e!==void 0?t+"-"+e:e}function tu(e,t){f.useContext(_i).strict}function nu(e){const{drag:t,layout:n}=it;if(!t&&!n)return{};const r={...t,...n};return{MeasureLayout:t!=null&&t.isEnabled(e)||n!=null&&n.isEnabled(e)?r.MeasureLayout:void 0,ProjectionNode:r.ProjectionNode}}const ru=["animate","circle","defs","desc","ellipse","g","image","line","filter","marker","mask","metadata","path","pattern","polygon","polyline","rect","stop","switch","symbol","svg","text","tspan","use","view"];function qr(e){return typeof e!="string"||e.includes("-")?!1:!!(ru.indexOf(e)>-1||/[A-Z]/u.test(e))}function Wo(e){const t=[{},{}];return e==null||e.values.forEach((n,r)=>{t[0][r]=n.get(),t[1][r]=n.getVelocity()}),t}function Ur(e,t,n,r){if(typeof t=="function"){const[o,s]=Wo(r);t=t(n!==void 0?n:e.custom,o,s)}if(typeof t=="string"&&(t=e.variants&&e.variants[t]),typeof t=="function"){const[o,s]=Wo(r);t=t(n!==void 0?n:e.custom,o,s)}return t}const dr=e=>Array.isArray(e),ou=e=>!!(e&&typeof e=="object"&&e.mix&&e.toValue),su=e=>dr(e)?e[e.length-1]||0:e,X=e=>!!(e&&e.getVelocity);function rn(e){const t=X(e)?e.get():e;return ou(t)?t.toValue():t}function iu({scrapeMotionValuesFromProps:e,createRenderState:t,onUpdate:n},r,o,s){const i={latestValues:au(r,o,s,e),renderState:t()};return n&&(i.onMount=a=>n({props:r,current:a,...i}),i.onUpdate=a=>n(a)),i}const $i=e=>(t,n)=>{const r=f.useContext(Pn),o=f.useContext(An),s=()=>iu(e,t,r,o);return n?s():jr(s)};function au(e,t,n,r){const o={},s=r(e,{});for(const p in s)o[p]=rn(s[p]);let{initial:i,animate:a}=e;const c=Rn(e),l=zi(e);t&&l&&!c&&e.inherit!==!1&&(i===void 0&&(i=t.initial),a===void 0&&(a=t.animate));let u=n?n.initial===!1:!1;u=u||i===!1;const d=u?a:i;if(d&&typeof d!="boolean"&&!Tn(d)){const p=Array.isArray(d)?d:[d];for(let y=0;y<p.length;y++){const g=Ur(e,p[y]);if(g){const{transitionEnd:m,transition:v,...k}=g;for(const x in k){let M=k[x];if(Array.isArray(M)){const C=u?M.length-1:0;M=M[C]}M!==null&&(o[x]=M)}for(const x in m)o[x]=m[x]}}}return o}const ut=["transformPerspective","x","y","z","translateX","translateY","translateZ","scale","scaleX","scaleY","rotate","rotateX","rotateY","rotateZ","skew","skewX","skewY"],$e=new Set(ut),Wi=e=>t=>typeof t=="string"&&t.startsWith(e),Gi=Wi("--"),cu=Wi("var(--"),$r=e=>cu(e)?lu.test(e.split("/*")[0].trim()):!1,lu=/var\(--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)$/iu,Ki=(e,t)=>t&&typeof e=="number"?t.transform(e):e,we=(e,t,n)=>n>t?t:n<e?e:n,dt={test:e=>typeof e=="number",parse:parseFloat,transform:e=>e},Rt={...dt,transform:e=>we(0,1,e)},Xt={...dt,default:1},Ft=e=>({test:t=>typeof t=="string"&&t.endsWith(e)&&t.split(" ").length===1,parse:parseFloat,transform:t=>`${t}${e}`}),Se=Ft("deg"),fe=Ft("%"),E=Ft("px"),uu=Ft("vh"),du=Ft("vw"),Go={...fe,parse:e=>fe.parse(e)/100,transform:e=>fe.transform(e*100)},hu={borderWidth:E,borderTopWidth:E,borderRightWidth:E,borderBottomWidth:E,borderLeftWidth:E,borderRadius:E,radius:E,borderTopLeftRadius:E,borderTopRightRadius:E,borderBottomRightRadius:E,borderBottomLeftRadius:E,width:E,maxWidth:E,height:E,maxHeight:E,top:E,right:E,bottom:E,left:E,padding:E,paddingTop:E,paddingRight:E,paddingBottom:E,paddingLeft:E,margin:E,marginTop:E,marginRight:E,marginBottom:E,marginLeft:E,backgroundPositionX:E,backgroundPositionY:E},fu={rotate:Se,rotateX:Se,rotateY:Se,rotateZ:Se,scale:Xt,scaleX:Xt,scaleY:Xt,scaleZ:Xt,skew:Se,skewX:Se,skewY:Se,distance:E,translateX:E,translateY:E,translateZ:E,x:E,y:E,z:E,perspective:E,transformPerspective:E,opacity:Rt,originX:Go,originY:Go,originZ:E},Ko={...dt,transform:Math.round},Wr={...hu,...fu,zIndex:Ko,size:E,fillOpacity:Rt,strokeOpacity:Rt,numOctaves:Ko},pu={x:"translateX",y:"translateY",z:"translateZ",transformPerspective:"perspective"},yu=ut.length;function mu(e,t,n){let r="",o=!0;for(let s=0;s<yu;s++){const i=ut[s],a=e[i];if(a===void 0)continue;let c=!0;if(typeof a=="number"?c=a===(i.startsWith("scale")?1:0):c=parseFloat(a)===0,!c||n){const l=Ki(a,Wr[i]);if(!c){o=!1;const u=pu[i]||i;r+=`${u}(${l}) `}n&&(t[i]=l)}}return r=r.trim(),n?r=n(t,o?"":r):o&&(r="none"),r}function Gr(e,t,n){const{style:r,vars:o,transformOrigin:s}=e;let i=!1,a=!1;for(const c in t){const l=t[c];if($e.has(c)){i=!0;continue}else if(Gi(c)){o[c]=l;continue}else{const u=Ki(l,Wr[c]);c.startsWith("origin")?(a=!0,s[c]=u):r[c]=u}}if(t.transform||(i||n?r.transform=mu(t,e.transform,n):r.transform&&(r.transform="none")),a){const{originX:c="50%",originY:l="50%",originZ:u=0}=s;r.transformOrigin=`${c} ${l} ${u}`}}const gu={offset:"stroke-dashoffset",array:"stroke-dasharray"},vu={offset:"strokeDashoffset",array:"strokeDasharray"};function ku(e,t,n=1,r=0,o=!0){e.pathLength=1;const s=o?gu:vu;e[s.offset]=E.transform(-r);const i=E.transform(t),a=E.transform(n);e[s.array]=`${i} ${a}`}function Zo(e,t,n){return typeof e=="string"?e:E.transform(t+n*e)}function xu(e,t,n){const r=Zo(t,e.x,e.width),o=Zo(n,e.y,e.height);return`${r} ${o}`}function Kr(e,{attrX:t,attrY:n,attrScale:r,originX:o,originY:s,pathLength:i,pathSpacing:a=1,pathOffset:c=0,...l},u,d){if(Gr(e,l,d),u){e.style.viewBox&&(e.attrs.viewBox=e.style.viewBox);return}e.attrs=e.style,e.style={};const{attrs:p,style:y,dimensions:g}=e;p.transform&&(g&&(y.transform=p.transform),delete p.transform),g&&(o!==void 0||s!==void 0||y.transform)&&(y.transformOrigin=xu(g,o!==void 0?o:.5,s!==void 0?s:.5)),t!==void 0&&(p.x=t),n!==void 0&&(p.y=n),r!==void 0&&(p.scale=r),i!==void 0&&ku(p,i,a,c,!1)}const Zr=()=>({style:{},transform:{},transformOrigin:{},vars:{}}),Zi=()=>({...Zr(),attrs:{}}),Xr=e=>typeof e=="string"&&e.toLowerCase()==="svg";function Xi(e,{style:t,vars:n},r,o){Object.assign(e.style,t,o&&o.getProjectionStyles(r));for(const s in n)e.style.setProperty(s,n[s])}const Yi=new Set(["baseFrequency","diffuseConstant","kernelMatrix","kernelUnitLength","keySplines","keyTimes","limitingConeAngle","markerHeight","markerWidth","numOctaves","targetX","targetY","surfaceScale","specularConstant","specularExponent","stdDeviation","tableValues","viewBox","gradientTransform","pathLength","startOffset","textLength","lengthAdjust"]);function Qi(e,t,n,r){Xi(e,t,void 0,r);for(const o in t.attrs)e.setAttribute(Yi.has(o)?o:zr(o),t.attrs[o])}const dn={};function Mu(e){Object.assign(dn,e)}function Ji(e,{layout:t,layoutId:n}){return $e.has(e)||e.startsWith("origin")||(t||n!==void 0)&&(!!dn[e]||e==="opacity")}function Yr(e,t,n){var r;const{style:o}=e,s={};for(const i in o)(X(o[i])||t.style&&X(t.style[i])||Ji(i,e)||((r=n==null?void 0:n.getValue(i))===null||r===void 0?void 0:r.liveStyle)!==void 0)&&(s[i]=o[i]);return s}function ea(e,t,n){const r=Yr(e,t,n);for(const o in e)if(X(e[o])||X(t[o])){const s=ut.indexOf(o)!==-1?"attr"+o.charAt(0).toUpperCase()+o.substring(1):o;r[s]=e[o]}return r}function wu(e,t){try{t.dimensions=typeof e.getBBox=="function"?e.getBBox():e.getBoundingClientRect()}catch{t.dimensions={x:0,y:0,width:0,height:0}}}const Xo=["x","y","width","height","cx","cy","r"],bu={useVisualState:$i({scrapeMotionValuesFromProps:ea,createRenderState:Zi,onUpdate:({props:e,prevProps:t,current:n,renderState:r,latestValues:o})=>{if(!n)return;let s=!!e.drag;if(!s){for(const a in o)if($e.has(a)){s=!0;break}}if(!s)return;let i=!t;if(t)for(let a=0;a<Xo.length;a++){const c=Xo[a];e[c]!==t[c]&&(i=!0)}i&&z.read(()=>{wu(n,r),z.render(()=>{Kr(r,o,Xr(n.tagName),e.transformTemplate),Qi(n,r)})})}})},Cu={useVisualState:$i({scrapeMotionValuesFromProps:Yr,createRenderState:Zr})};function ta(e,t,n){for(const r in t)!X(t[r])&&!Ji(r,n)&&(e[r]=t[r])}function Su({transformTemplate:e},t){return f.useMemo(()=>{const n=Zr();return Gr(n,t,e),Object.assign({},n.vars,n.style)},[t])}function Au(e,t){const n=e.style||{},r={};return ta(r,n,e),Object.assign(r,Su(e,t)),r}function Pu(e,t){const n={},r=Au(e,t);return e.drag&&e.dragListener!==!1&&(n.draggable=!1,r.userSelect=r.WebkitUserSelect=r.WebkitTouchCallout="none",r.touchAction=e.drag===!0?"none":`pan-${e.drag==="x"?"y":"x"}`),e.tabIndex===void 0&&(e.onTap||e.onTapStart||e.whileTap)&&(n.tabIndex=0),n.style=r,n}function Tu(e,t,n,r){const o=f.useMemo(()=>{const s=Zi();return Kr(s,t,Xr(r),e.transformTemplate),{...s.attrs,style:{...s.style}}},[t]);if(e.style){const s={};ta(s,e.style,e),o.style={...s,...o.style}}return o}function Ru(e=!1){return(n,r,o,{latestValues:s},i)=>{const c=(qr(n)?Tu:Pu)(r,s,i,n),l=U1(r,typeof n=="string",e),u=n!==f.Fragment?{...l,...c,ref:o}:{},{children:d}=r,p=f.useMemo(()=>X(d)?d.get():d,[d]);return f.createElement(n,{...u,children:p})}}function Eu(e,t){return function(r,{forwardMotionProps:o}={forwardMotionProps:!1}){const i={...qr(r)?bu:Cu,preloadedFeatures:e,useRender:Ru(o),createVisualElement:t,Component:r};return J1(i)}}function na(e,t){if(!Array.isArray(t))return!1;const n=t.length;if(n!==e.length)return!1;for(let r=0;r<n;r++)if(t[r]!==e[r])return!1;return!0}function En(e,t,n){const r=e.getProps();return Ur(r,t,n!==void 0?n:r.custom,e)}const Du=Nr(()=>window.ScrollTimeline!==void 0);class Lu{constructor(t){this.stop=()=>this.runAll("stop"),this.animations=t.filter(Boolean)}get finished(){return Promise.all(this.animations.map(t=>"finished"in t?t.finished:t))}getAll(t){return this.animations[0][t]}setAll(t,n){for(let r=0;r<this.animations.length;r++)this.animations[r][t]=n}attachTimeline(t,n){const r=this.animations.map(o=>{if(Du()&&o.attachTimeline)return o.attachTimeline(t);if(typeof n=="function")return n(o)});return()=>{r.forEach((o,s)=>{o&&o(),this.animations[s].stop()})}}get time(){return this.getAll("time")}set time(t){this.setAll("time",t)}get speed(){return this.getAll("speed")}set speed(t){this.setAll("speed",t)}get startTime(){return this.getAll("startTime")}get duration(){let t=0;for(let n=0;n<this.animations.length;n++)t=Math.max(t,this.animations[n].duration);return t}runAll(t){this.animations.forEach(n=>n[t]())}flatten(){this.runAll("flatten")}play(){this.runAll("play")}pause(){this.runAll("pause")}cancel(){this.runAll("cancel")}complete(){this.runAll("complete")}}class Vu extends Lu{then(t,n){return Promise.all(this.animations).then(t).catch(n)}}function Qr(e,t){return e?e[t]||e.default||e:void 0}const hr=2e4;function ra(e){let t=0;const n=50;let r=e.next(t);for(;!r.done&&t<hr;)t+=n,r=e.next(t);return t>=hr?1/0:t}function Jr(e){return typeof e=="function"}function Yo(e,t){e.timeline=t,e.onfinish=null}const eo=e=>Array.isArray(e)&&typeof e[0]=="number",Ou={linearEasing:void 0};function ju(e,t){const n=Nr(e);return()=>{var r;return(r=Ou[t])!==null&&r!==void 0?r:n()}}const hn=ju(()=>{try{document.createElement("div").animate({opacity:0},{easing:"linear(0, 1)"})}catch{return!1}return!0},"linearEasing"),oa=(e,t,n=10)=>{let r="";const o=Math.max(Math.round(t/n),2);for(let s=0;s<o;s++)r+=e(st(0,o-1,s))+", ";return`linear(${r.substring(0,r.length-2)})`};function sa(e){return!!(typeof e=="function"&&hn()||!e||typeof e=="string"&&(e in fr||hn())||eo(e)||Array.isArray(e)&&e.every(sa))}const xt=([e,t,n,r])=>`cubic-bezier(${e}, ${t}, ${n}, ${r})`,fr={linear:"linear",ease:"ease",easeIn:"ease-in",easeOut:"ease-out",easeInOut:"ease-in-out",circIn:xt([0,.65,.55,1]),circOut:xt([.55,0,1,.45]),backIn:xt([.31,.01,.66,-.59]),backOut:xt([.33,1.53,.69,.99])};function ia(e,t){if(e)return typeof e=="function"&&hn()?oa(e,t):eo(e)?xt(e):Array.isArray(e)?e.map(n=>ia(n,t)||fr.easeOut):fr[e]}const ae={x:!1,y:!1};function aa(){return ae.x||ae.y}function Iu(e,t,n){var r;if(e instanceof Element)return[e];if(typeof e=="string"){let o=document;const s=(r=void 0)!==null&&r!==void 0?r:o.querySelectorAll(e);return s?Array.from(s):[]}return Array.from(e)}function ca(e,t){const n=Iu(e),r=new AbortController,o={passive:!0,...t,signal:r.signal};return[n,o,()=>r.abort()]}function Qo(e){return t=>{t.pointerType==="touch"||aa()||e(t)}}function Fu(e,t,n={}){const[r,o,s]=ca(e,n),i=Qo(a=>{const{target:c}=a,l=t(a);if(typeof l!="function"||!c)return;const u=Qo(d=>{l(d),c.removeEventListener("pointerleave",u)});c.addEventListener("pointerleave",u,o)});return r.forEach(a=>{a.addEventListener("pointerenter",i,o)}),s}const la=(e,t)=>t?e===t?!0:la(e,t.parentElement):!1,to=e=>e.pointerType==="mouse"?typeof e.button!="number"||e.button<=0:e.isPrimary!==!1,Nu=new Set(["BUTTON","INPUT","SELECT","TEXTAREA","A"]);function _u(e){return Nu.has(e.tagName)||e.tabIndex!==-1}const Mt=new WeakSet;function Jo(e){return t=>{t.key==="Enter"&&e(t)}}function Hn(e,t){e.dispatchEvent(new PointerEvent("pointer"+t,{isPrimary:!0,bubbles:!0}))}const Bu=(e,t)=>{const n=e.currentTarget;if(!n)return;const r=Jo(()=>{if(Mt.has(n))return;Hn(n,"down");const o=Jo(()=>{Hn(n,"up")}),s=()=>Hn(n,"cancel");n.addEventListener("keyup",o,t),n.addEventListener("blur",s,t)});n.addEventListener("keydown",r,t),n.addEventListener("blur",()=>n.removeEventListener("keydown",r),t)};function es(e){return to(e)&&!aa()}function zu(e,t,n={}){const[r,o,s]=ca(e,n),i=a=>{const c=a.currentTarget;if(!es(a)||Mt.has(c))return;Mt.add(c);const l=t(a),u=(y,g)=>{window.removeEventListener("pointerup",d),window.removeEventListener("pointercancel",p),!(!es(y)||!Mt.has(c))&&(Mt.delete(c),typeof l=="function"&&l(y,{success:g}))},d=y=>{u(y,n.useGlobalTarget||la(c,y.target))},p=y=>{u(y,!1)};window.addEventListener("pointerup",d,o),window.addEventListener("pointercancel",p,o)};return r.forEach(a=>{!_u(a)&&a.getAttribute("tabindex")===null&&(a.tabIndex=0),(n.useGlobalTarget?window:a).addEventListener("pointerdown",i,o),a.addEventListener("focus",l=>Bu(l,o),o)}),s}function Hu(e){return e==="x"||e==="y"?ae[e]?null:(ae[e]=!0,()=>{ae[e]=!1}):ae.x||ae.y?null:(ae.x=ae.y=!0,()=>{ae.x=ae.y=!1})}const ua=new Set(["width","height","top","left","right","bottom",...ut]);let on;function qu(){on=void 0}const pe={now:()=>(on===void 0&&pe.set(G.isProcessing||N1.useManualTiming?G.timestamp:performance.now()),on),set:e=>{on=e,queueMicrotask(qu)}};function no(e,t){e.indexOf(t)===-1&&e.push(t)}function ro(e,t){const n=e.indexOf(t);n>-1&&e.splice(n,1)}class oo{constructor(){this.subscriptions=[]}add(t){return no(this.subscriptions,t),()=>ro(this.subscriptions,t)}notify(t,n,r){const o=this.subscriptions.length;if(o)if(o===1)this.subscriptions[0](t,n,r);else for(let s=0;s<o;s++){const i=this.subscriptions[s];i&&i(t,n,r)}}getSize(){return this.subscriptions.length}clear(){this.subscriptions.length=0}}function da(e,t){return t?e*(1e3/t):0}const ts=30,Uu=e=>!isNaN(parseFloat(e));class $u{constructor(t,n={}){this.version="11.18.2",this.canTrackVelocity=null,this.events={},this.updateAndNotify=(r,o=!0)=>{const s=pe.now();this.updatedAt!==s&&this.setPrevFrameValue(),this.prev=this.current,this.setCurrent(r),this.current!==this.prev&&this.events.change&&this.events.change.notify(this.current),o&&this.events.renderRequest&&this.events.renderRequest.notify(this.current)},this.hasAnimated=!1,this.setCurrent(t),this.owner=n.owner}setCurrent(t){this.current=t,this.updatedAt=pe.now(),this.canTrackVelocity===null&&t!==void 0&&(this.canTrackVelocity=Uu(this.current))}setPrevFrameValue(t=this.current){this.prevFrameValue=t,this.prevUpdatedAt=this.updatedAt}onChange(t){return this.on("change",t)}on(t,n){this.events[t]||(this.events[t]=new oo);const r=this.events[t].add(n);return t==="change"?()=>{r(),z.read(()=>{this.events.change.getSize()||this.stop()})}:r}clearListeners(){for(const t in this.events)this.events[t].clear()}attach(t,n){this.passiveEffect=t,this.stopPassiveEffect=n}set(t,n=!0){!n||!this.passiveEffect?this.updateAndNotify(t,n):this.passiveEffect(t,this.updateAndNotify)}setWithVelocity(t,n,r){this.set(n),this.prev=void 0,this.prevFrameValue=t,this.prevUpdatedAt=this.updatedAt-r}jump(t,n=!0){this.updateAndNotify(t),this.prev=t,this.prevUpdatedAt=this.prevFrameValue=void 0,n&&this.stop(),this.stopPassiveEffect&&this.stopPassiveEffect()}get(){return this.current}getPrevious(){return this.prev}getVelocity(){const t=pe.now();if(!this.canTrackVelocity||this.prevFrameValue===void 0||t-this.updatedAt>ts)return 0;const n=Math.min(this.updatedAt-this.prevUpdatedAt,ts);return da(parseFloat(this.current)-parseFloat(this.prevFrameValue),n)}start(t){return this.stop(),new Promise(n=>{this.hasAnimated=!0,this.animation=t(n),this.events.animationStart&&this.events.animationStart.notify()}).then(()=>{this.events.animationComplete&&this.events.animationComplete.notify(),this.clearAnimation()})}stop(){this.animation&&(this.animation.stop(),this.events.animationCancel&&this.events.animationCancel.notify()),this.clearAnimation()}isAnimating(){return!!this.animation}clearAnimation(){delete this.animation}destroy(){this.clearListeners(),this.stop(),this.stopPassiveEffect&&this.stopPassiveEffect()}}function Et(e,t){return new $u(e,t)}function Wu(e,t,n){e.hasValue(t)?e.getValue(t).set(n):e.addValue(t,Et(n))}function Gu(e,t){const n=En(e,t);let{transitionEnd:r={},transition:o={},...s}=n||{};s={...s,...r};for(const i in s){const a=su(s[i]);Wu(e,i,a)}}function Ku(e){return!!(X(e)&&e.add)}function pr(e,t){const n=e.getValue("willChange");if(Ku(n))return n.add(t)}function ha(e){return e.props[Hi]}const fa=(e,t,n)=>(((1-3*n+3*t)*e+(3*n-6*t))*e+3*t)*e,Zu=1e-7,Xu=12;function Yu(e,t,n,r,o){let s,i,a=0;do i=t+(n-t)/2,s=fa(i,r,o)-e,s>0?n=i:t=i;while(Math.abs(s)>Zu&&++a<Xu);return i}function Nt(e,t,n,r){if(e===t&&n===r)return ee;const o=s=>Yu(s,0,1,e,n);return s=>s===0||s===1?s:fa(o(s),t,r)}const pa=e=>t=>t<=.5?e(2*t)/2:(2-e(2*(1-t)))/2,ya=e=>t=>1-e(1-t),ma=Nt(.33,1.53,.69,.99),so=ya(ma),ga=pa(so),va=e=>(e*=2)<1?.5*so(e):.5*(2-Math.pow(2,-10*(e-1))),io=e=>1-Math.sin(Math.acos(e)),ka=ya(io),xa=pa(io),Ma=e=>/^0[^.\s]+$/u.test(e);function Qu(e){return typeof e=="number"?e===0:e!==null?e==="none"||e==="0"||Ma(e):!0}const Ct=e=>Math.round(e*1e5)/1e5,ao=/-?(?:\d+(?:\.\d+)?|\.\d+)/gu;function Ju(e){return e==null}const ed=/^(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))$/iu,co=(e,t)=>n=>!!(typeof n=="string"&&ed.test(n)&&n.startsWith(e)||t&&!Ju(n)&&Object.prototype.hasOwnProperty.call(n,t)),wa=(e,t,n)=>r=>{if(typeof r!="string")return r;const[o,s,i,a]=r.match(ao);return{[e]:parseFloat(o),[t]:parseFloat(s),[n]:parseFloat(i),alpha:a!==void 0?parseFloat(a):1}},td=e=>we(0,255,e),qn={...dt,transform:e=>Math.round(td(e))},Be={test:co("rgb","red"),parse:wa("red","green","blue"),transform:({red:e,green:t,blue:n,alpha:r=1})=>"rgba("+qn.transform(e)+", "+qn.transform(t)+", "+qn.transform(n)+", "+Ct(Rt.transform(r))+")"};function nd(e){let t="",n="",r="",o="";return e.length>5?(t=e.substring(1,3),n=e.substring(3,5),r=e.substring(5,7),o=e.substring(7,9)):(t=e.substring(1,2),n=e.substring(2,3),r=e.substring(3,4),o=e.substring(4,5),t+=t,n+=n,r+=r,o+=o),{red:parseInt(t,16),green:parseInt(n,16),blue:parseInt(r,16),alpha:o?parseInt(o,16)/255:1}}const yr={test:co("#"),parse:nd,transform:Be.transform},Qe={test:co("hsl","hue"),parse:wa("hue","saturation","lightness"),transform:({hue:e,saturation:t,lightness:n,alpha:r=1})=>"hsla("+Math.round(e)+", "+fe.transform(Ct(t))+", "+fe.transform(Ct(n))+", "+Ct(Rt.transform(r))+")"},Z={test:e=>Be.test(e)||yr.test(e)||Qe.test(e),parse:e=>Be.test(e)?Be.parse(e):Qe.test(e)?Qe.parse(e):yr.parse(e),transform:e=>typeof e=="string"?e:e.hasOwnProperty("red")?Be.transform(e):Qe.transform(e)},rd=/(?:#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\))/giu;function od(e){var t,n;return isNaN(e)&&typeof e=="string"&&(((t=e.match(ao))===null||t===void 0?void 0:t.length)||0)+(((n=e.match(rd))===null||n===void 0?void 0:n.length)||0)>0}const ba="number",Ca="color",sd="var",id="var(",ns="${}",ad=/var\s*\(\s*--(?:[\w-]+\s*|[\w-]+\s*,(?:\s*[^)(\s]|\s*\((?:[^)(]|\([^)(]*\))*\))+\s*)\)|#[\da-f]{3,8}|(?:rgb|hsl)a?\((?:-?[\d.]+%?[,\s]+){2}-?[\d.]+%?\s*(?:[,/]\s*)?(?:\b\d+(?:\.\d+)?|\.\d+)?%?\)|-?(?:\d+(?:\.\d+)?|\.\d+)/giu;function Dt(e){const t=e.toString(),n=[],r={color:[],number:[],var:[]},o=[];let s=0;const a=t.replace(ad,c=>(Z.test(c)?(r.color.push(s),o.push(Ca),n.push(Z.parse(c))):c.startsWith(id)?(r.var.push(s),o.push(sd),n.push(c)):(r.number.push(s),o.push(ba),n.push(parseFloat(c))),++s,ns)).split(ns);return{values:n,split:a,indexes:r,types:o}}function Sa(e){return Dt(e).values}function Aa(e){const{split:t,types:n}=Dt(e),r=t.length;return o=>{let s="";for(let i=0;i<r;i++)if(s+=t[i],o[i]!==void 0){const a=n[i];a===ba?s+=Ct(o[i]):a===Ca?s+=Z.transform(o[i]):s+=o[i]}return s}}const cd=e=>typeof e=="number"?0:e;function ld(e){const t=Sa(e);return Aa(e)(t.map(cd))}const Ee={test:od,parse:Sa,createTransformer:Aa,getAnimatableNone:ld},ud=new Set(["brightness","contrast","saturate","opacity"]);function dd(e){const[t,n]=e.slice(0,-1).split("(");if(t==="drop-shadow")return e;const[r]=n.match(ao)||[];if(!r)return e;const o=n.replace(r,"");let s=ud.has(t)?1:0;return r!==n&&(s*=100),t+"("+s+o+")"}const hd=/\b([a-z-]*)\(.*?\)/gu,mr={...Ee,getAnimatableNone:e=>{const t=e.match(hd);return t?t.map(dd).join(" "):e}},fd={...Wr,color:Z,backgroundColor:Z,outlineColor:Z,fill:Z,stroke:Z,borderColor:Z,borderTopColor:Z,borderRightColor:Z,borderBottomColor:Z,borderLeftColor:Z,filter:mr,WebkitFilter:mr},lo=e=>fd[e];function Pa(e,t){let n=lo(e);return n!==mr&&(n=Ee),n.getAnimatableNone?n.getAnimatableNone(t):void 0}const pd=new Set(["auto","none","0"]);function yd(e,t,n){let r=0,o;for(;r<e.length&&!o;){const s=e[r];typeof s=="string"&&!pd.has(s)&&Dt(s).values.length&&(o=e[r]),r++}if(o&&n)for(const s of t)e[s]=Pa(n,o)}const rs=e=>e===dt||e===E,os=(e,t)=>parseFloat(e.split(", ")[t]),ss=(e,t)=>(n,{transform:r})=>{if(r==="none"||!r)return 0;const o=r.match(/^matrix3d\((.+)\)$/u);if(o)return os(o[1],t);{const s=r.match(/^matrix\((.+)\)$/u);return s?os(s[1],e):0}},md=new Set(["x","y","z"]),gd=ut.filter(e=>!md.has(e));function vd(e){const t=[];return gd.forEach(n=>{const r=e.getValue(n);r!==void 0&&(t.push([n,r.get()]),r.set(n.startsWith("scale")?1:0))}),t}const at={width:({x:e},{paddingLeft:t="0",paddingRight:n="0"})=>e.max-e.min-parseFloat(t)-parseFloat(n),height:({y:e},{paddingTop:t="0",paddingBottom:n="0"})=>e.max-e.min-parseFloat(t)-parseFloat(n),top:(e,{top:t})=>parseFloat(t),left:(e,{left:t})=>parseFloat(t),bottom:({y:e},{top:t})=>parseFloat(t)+(e.max-e.min),right:({x:e},{left:t})=>parseFloat(t)+(e.max-e.min),x:ss(4,13),y:ss(5,14)};at.translateX=at.x;at.translateY=at.y;const ze=new Set;let gr=!1,vr=!1;function Ta(){if(vr){const e=Array.from(ze).filter(r=>r.needsMeasurement),t=new Set(e.map(r=>r.element)),n=new Map;t.forEach(r=>{const o=vd(r);o.length&&(n.set(r,o),r.render())}),e.forEach(r=>r.measureInitialState()),t.forEach(r=>{r.render();const o=n.get(r);o&&o.forEach(([s,i])=>{var a;(a=r.getValue(s))===null||a===void 0||a.set(i)})}),e.forEach(r=>r.measureEndState()),e.forEach(r=>{r.suspendedScrollY!==void 0&&window.scrollTo(0,r.suspendedScrollY)})}vr=!1,gr=!1,ze.forEach(e=>e.complete()),ze.clear()}function Ra(){ze.forEach(e=>{e.readKeyframes(),e.needsMeasurement&&(vr=!0)})}function kd(){Ra(),Ta()}class uo{constructor(t,n,r,o,s,i=!1){this.isComplete=!1,this.isAsync=!1,this.needsMeasurement=!1,this.isScheduled=!1,this.unresolvedKeyframes=[...t],this.onComplete=n,this.name=r,this.motionValue=o,this.element=s,this.isAsync=i}scheduleResolve(){this.isScheduled=!0,this.isAsync?(ze.add(this),gr||(gr=!0,z.read(Ra),z.resolveKeyframes(Ta))):(this.readKeyframes(),this.complete())}readKeyframes(){const{unresolvedKeyframes:t,name:n,element:r,motionValue:o}=this;for(let s=0;s<t.length;s++)if(t[s]===null)if(s===0){const i=o==null?void 0:o.get(),a=t[t.length-1];if(i!==void 0)t[0]=i;else if(r&&n){const c=r.readValue(n,a);c!=null&&(t[0]=c)}t[0]===void 0&&(t[0]=a),o&&i===void 0&&o.set(t[0])}else t[s]=t[s-1]}setFinalKeyframe(){}measureInitialState(){}renderEndStyles(){}measureEndState(){}complete(){this.isComplete=!0,this.onComplete(this.unresolvedKeyframes,this.finalKeyframe),ze.delete(this)}cancel(){this.isComplete||(this.isScheduled=!1,ze.delete(this))}resume(){this.isComplete||this.scheduleResolve()}}const Ea=e=>/^-?(?:\d+(?:\.\d+)?|\.\d+)$/u.test(e),xd=/^var\(--(?:([\w-]+)|([\w-]+), ?([a-zA-Z\d ()%#.,-]+))\)/u;function Md(e){const t=xd.exec(e);if(!t)return[,];const[,n,r,o]=t;return[`--${n??r}`,o]}function Da(e,t,n=1){const[r,o]=Md(e);if(!r)return;const s=window.getComputedStyle(t).getPropertyValue(r);if(s){const i=s.trim();return Ea(i)?parseFloat(i):i}return $r(o)?Da(o,t,n+1):o}const La=e=>t=>t.test(e),wd={test:e=>e==="auto",parse:e=>e},Va=[dt,E,fe,Se,du,uu,wd],is=e=>Va.find(La(e));class Oa extends uo{constructor(t,n,r,o,s){super(t,n,r,o,s,!0)}readKeyframes(){const{unresolvedKeyframes:t,element:n,name:r}=this;if(!n||!n.current)return;super.readKeyframes();for(let c=0;c<t.length;c++){let l=t[c];if(typeof l=="string"&&(l=l.trim(),$r(l))){const u=Da(l,n.current);u!==void 0&&(t[c]=u),c===t.length-1&&(this.finalKeyframe=l)}}if(this.resolveNoneKeyframes(),!ua.has(r)||t.length!==2)return;const[o,s]=t,i=is(o),a=is(s);if(i!==a)if(rs(i)&&rs(a))for(let c=0;c<t.length;c++){const l=t[c];typeof l=="string"&&(t[c]=parseFloat(l))}else this.needsMeasurement=!0}resolveNoneKeyframes(){const{unresolvedKeyframes:t,name:n}=this,r=[];for(let o=0;o<t.length;o++)Qu(t[o])&&r.push(o);r.length&&yd(t,r,n)}measureInitialState(){const{element:t,unresolvedKeyframes:n,name:r}=this;if(!t||!t.current)return;r==="height"&&(this.suspendedScrollY=window.pageYOffset),this.measuredOrigin=at[r](t.measureViewportBox(),window.getComputedStyle(t.current)),n[0]=this.measuredOrigin;const o=n[n.length-1];o!==void 0&&t.getValue(r,o).jump(o,!1)}measureEndState(){var t;const{element:n,name:r,unresolvedKeyframes:o}=this;if(!n||!n.current)return;const s=n.getValue(r);s&&s.jump(this.measuredOrigin,!1);const i=o.length-1,a=o[i];o[i]=at[r](n.measureViewportBox(),window.getComputedStyle(n.current)),a!==null&&this.finalKeyframe===void 0&&(this.finalKeyframe=a),!((t=this.removedTransforms)===null||t===void 0)&&t.length&&this.removedTransforms.forEach(([c,l])=>{n.getValue(c).set(l)}),this.resolveNoneKeyframes()}}const as=(e,t)=>t==="zIndex"?!1:!!(typeof e=="number"||Array.isArray(e)||typeof e=="string"&&(Ee.test(e)||e==="0")&&!e.startsWith("url("));function bd(e){const t=e[0];if(e.length===1)return!0;for(let n=0;n<e.length;n++)if(e[n]!==t)return!0}function Cd(e,t,n,r){const o=e[0];if(o===null)return!1;if(t==="display"||t==="visibility")return!0;const s=e[e.length-1],i=as(o,t),a=as(s,t);return!i||!a?!1:bd(e)||(n==="spring"||Jr(n))&&r}const Sd=e=>e!==null;function Dn(e,{repeat:t,repeatType:n="loop"},r){const o=e.filter(Sd),s=t&&n!=="loop"&&t%2===1?0:o.length-1;return!s||r===void 0?o[s]:r}const Ad=40;class ja{constructor({autoplay:t=!0,delay:n=0,type:r="keyframes",repeat:o=0,repeatDelay:s=0,repeatType:i="loop",...a}){this.isStopped=!1,this.hasAttemptedResolve=!1,this.createdAt=pe.now(),this.options={autoplay:t,delay:n,type:r,repeat:o,repeatDelay:s,repeatType:i,...a},this.updateFinishedPromise()}calcStartTime(){return this.resolvedAt?this.resolvedAt-this.createdAt>Ad?this.resolvedAt:this.createdAt:this.createdAt}get resolved(){return!this._resolved&&!this.hasAttemptedResolve&&kd(),this._resolved}onKeyframesResolved(t,n){this.resolvedAt=pe.now(),this.hasAttemptedResolve=!0;const{name:r,type:o,velocity:s,delay:i,onComplete:a,onUpdate:c,isGenerator:l}=this.options;if(!l&&!Cd(t,r,o,s))if(i)this.options.duration=0;else{c&&c(Dn(t,this.options,n)),a&&a(),this.resolveFinishedPromise();return}const u=this.initPlayback(t,n);u!==!1&&(this._resolved={keyframes:t,finalKeyframe:n,...u},this.onPostResolved())}onPostResolved(){}then(t,n){return this.currentFinishedPromise.then(t,n)}flatten(){this.options.type="keyframes",this.options.ease="linear"}updateFinishedPromise(){this.currentFinishedPromise=new Promise(t=>{this.resolveFinishedPromise=t})}}const H=(e,t,n)=>e+(t-e)*n;function Un(e,t,n){return n<0&&(n+=1),n>1&&(n-=1),n<1/6?e+(t-e)*6*n:n<1/2?t:n<2/3?e+(t-e)*(2/3-n)*6:e}function Pd({hue:e,saturation:t,lightness:n,alpha:r}){e/=360,t/=100,n/=100;let o=0,s=0,i=0;if(!t)o=s=i=n;else{const a=n<.5?n*(1+t):n+t-n*t,c=2*n-a;o=Un(c,a,e+1/3),s=Un(c,a,e),i=Un(c,a,e-1/3)}return{red:Math.round(o*255),green:Math.round(s*255),blue:Math.round(i*255),alpha:r}}function fn(e,t){return n=>n>0?t:e}const $n=(e,t,n)=>{const r=e*e,o=n*(t*t-r)+r;return o<0?0:Math.sqrt(o)},Td=[yr,Be,Qe],Rd=e=>Td.find(t=>t.test(e));function cs(e){const t=Rd(e);if(!t)return!1;let n=t.parse(e);return t===Qe&&(n=Pd(n)),n}const ls=(e,t)=>{const n=cs(e),r=cs(t);if(!n||!r)return fn(e,t);const o={...n};return s=>(o.red=$n(n.red,r.red,s),o.green=$n(n.green,r.green,s),o.blue=$n(n.blue,r.blue,s),o.alpha=H(n.alpha,r.alpha,s),Be.transform(o))},Ed=(e,t)=>n=>t(e(n)),_t=(...e)=>e.reduce(Ed),kr=new Set(["none","hidden"]);function Dd(e,t){return kr.has(e)?n=>n<=0?e:t:n=>n>=1?t:e}function Ld(e,t){return n=>H(e,t,n)}function ho(e){return typeof e=="number"?Ld:typeof e=="string"?$r(e)?fn:Z.test(e)?ls:jd:Array.isArray(e)?Ia:typeof e=="object"?Z.test(e)?ls:Vd:fn}function Ia(e,t){const n=[...e],r=n.length,o=e.map((s,i)=>ho(s)(s,t[i]));return s=>{for(let i=0;i<r;i++)n[i]=o[i](s);return n}}function Vd(e,t){const n={...e,...t},r={};for(const o in n)e[o]!==void 0&&t[o]!==void 0&&(r[o]=ho(e[o])(e[o],t[o]));return o=>{for(const s in r)n[s]=r[s](o);return n}}function Od(e,t){var n;const r=[],o={color:0,var:0,number:0};for(let s=0;s<t.values.length;s++){const i=t.types[s],a=e.indexes[i][o[i]],c=(n=e.values[a])!==null&&n!==void 0?n:0;r[s]=c,o[i]++}return r}const jd=(e,t)=>{const n=Ee.createTransformer(t),r=Dt(e),o=Dt(t);return r.indexes.var.length===o.indexes.var.length&&r.indexes.color.length===o.indexes.color.length&&r.indexes.number.length>=o.indexes.number.length?kr.has(e)&&!o.values.length||kr.has(t)&&!r.values.length?Dd(e,t):_t(Ia(Od(r,o),o.values),n):fn(e,t)};function Fa(e,t,n){return typeof e=="number"&&typeof t=="number"&&typeof n=="number"?H(e,t,n):ho(e)(e,t)}const Id=5;function Na(e,t,n){const r=Math.max(t-Id,0);return da(n-e(r),t-r)}const q={stiffness:100,damping:10,mass:1,velocity:0,duration:800,bounce:.3,visualDuration:.3,restSpeed:{granular:.01,default:2},restDelta:{granular:.005,default:.5},minDuration:.01,maxDuration:10,minDamping:.05,maxDamping:1},Wn=.001;function Fd({duration:e=q.duration,bounce:t=q.bounce,velocity:n=q.velocity,mass:r=q.mass}){let o,s,i=1-t;i=we(q.minDamping,q.maxDamping,i),e=we(q.minDuration,q.maxDuration,xe(e)),i<1?(o=l=>{const u=l*i,d=u*e,p=u-n,y=xr(l,i),g=Math.exp(-d);return Wn-p/y*g},s=l=>{const d=l*i*e,p=d*n+n,y=Math.pow(i,2)*Math.pow(l,2)*e,g=Math.exp(-d),m=xr(Math.pow(l,2),i);return(-o(l)+Wn>0?-1:1)*((p-y)*g)/m}):(o=l=>{const u=Math.exp(-l*e),d=(l-n)*e+1;return-Wn+u*d},s=l=>{const u=Math.exp(-l*e),d=(n-l)*(e*e);return u*d});const a=5/e,c=_d(o,s,a);if(e=ke(e),isNaN(c))return{stiffness:q.stiffness,damping:q.damping,duration:e};{const l=Math.pow(c,2)*r;return{stiffness:l,damping:i*2*Math.sqrt(r*l),duration:e}}}const Nd=12;function _d(e,t,n){let r=n;for(let o=1;o<Nd;o++)r=r-e(r)/t(r);return r}function xr(e,t){return e*Math.sqrt(1-t*t)}const Bd=["duration","bounce"],zd=["stiffness","damping","mass"];function us(e,t){return t.some(n=>e[n]!==void 0)}function Hd(e){let t={velocity:q.velocity,stiffness:q.stiffness,damping:q.damping,mass:q.mass,isResolvedFromDuration:!1,...e};if(!us(e,zd)&&us(e,Bd))if(e.visualDuration){const n=e.visualDuration,r=2*Math.PI/(n*1.2),o=r*r,s=2*we(.05,1,1-(e.bounce||0))*Math.sqrt(o);t={...t,mass:q.mass,stiffness:o,damping:s}}else{const n=Fd(e);t={...t,...n,mass:q.mass},t.isResolvedFromDuration=!0}return t}function _a(e=q.visualDuration,t=q.bounce){const n=typeof e!="object"?{visualDuration:e,keyframes:[0,1],bounce:t}:e;let{restSpeed:r,restDelta:o}=n;const s=n.keyframes[0],i=n.keyframes[n.keyframes.length-1],a={done:!1,value:s},{stiffness:c,damping:l,mass:u,duration:d,velocity:p,isResolvedFromDuration:y}=Hd({...n,velocity:-xe(n.velocity||0)}),g=p||0,m=l/(2*Math.sqrt(c*u)),v=i-s,k=xe(Math.sqrt(c/u)),x=Math.abs(v)<5;r||(r=x?q.restSpeed.granular:q.restSpeed.default),o||(o=x?q.restDelta.granular:q.restDelta.default);let M;if(m<1){const w=xr(k,m);M=S=>{const A=Math.exp(-m*k*S);return i-A*((g+m*k*v)/w*Math.sin(w*S)+v*Math.cos(w*S))}}else if(m===1)M=w=>i-Math.exp(-k*w)*(v+(g+k*v)*w);else{const w=k*Math.sqrt(m*m-1);M=S=>{const A=Math.exp(-m*k*S),P=Math.min(w*S,300);return i-A*((g+m*k*v)*Math.sinh(P)+w*v*Math.cosh(P))/w}}const C={calculatedDuration:y&&d||null,next:w=>{const S=M(w);if(y)a.done=w>=d;else{let A=0;m<1&&(A=w===0?ke(g):Na(M,w,S));const P=Math.abs(A)<=r,D=Math.abs(i-S)<=o;a.done=P&&D}return a.value=a.done?i:S,a},toString:()=>{const w=Math.min(ra(C),hr),S=oa(A=>C.next(w*A).value,w,30);return w+"ms "+S}};return C}function ds({keyframes:e,velocity:t=0,power:n=.8,timeConstant:r=325,bounceDamping:o=10,bounceStiffness:s=500,modifyTarget:i,min:a,max:c,restDelta:l=.5,restSpeed:u}){const d=e[0],p={done:!1,value:d},y=P=>a!==void 0&&P<a||c!==void 0&&P>c,g=P=>a===void 0?c:c===void 0||Math.abs(a-P)<Math.abs(c-P)?a:c;let m=n*t;const v=d+m,k=i===void 0?v:i(v);k!==v&&(m=k-d);const x=P=>-m*Math.exp(-P/r),M=P=>k+x(P),C=P=>{const D=x(P),L=M(P);p.done=Math.abs(D)<=l,p.value=p.done?k:L};let w,S;const A=P=>{y(p.value)&&(w=P,S=_a({keyframes:[p.value,g(p.value)],velocity:Na(M,P,p.value),damping:o,stiffness:s,restDelta:l,restSpeed:u}))};return A(0),{calculatedDuration:null,next:P=>{let D=!1;return!S&&w===void 0&&(D=!0,C(P),A(P)),w!==void 0&&P>=w?S.next(P-w):(!D&&C(P),p)}}}const qd=Nt(.42,0,1,1),Ud=Nt(0,0,.58,1),Ba=Nt(.42,0,.58,1),$d=e=>Array.isArray(e)&&typeof e[0]!="number",Wd={linear:ee,easeIn:qd,easeInOut:Ba,easeOut:Ud,circIn:io,circInOut:xa,circOut:ka,backIn:so,backInOut:ga,backOut:ma,anticipate:va},hs=e=>{if(eo(e)){Fi(e.length===4);const[t,n,r,o]=e;return Nt(t,n,r,o)}else if(typeof e=="string")return Wd[e];return e};function Gd(e,t,n){const r=[],o=n||Fa,s=e.length-1;for(let i=0;i<s;i++){let a=o(e[i],e[i+1]);if(t){const c=Array.isArray(t)?t[i]||ee:t;a=_t(c,a)}r.push(a)}return r}function Kd(e,t,{clamp:n=!0,ease:r,mixer:o}={}){const s=e.length;if(Fi(s===t.length),s===1)return()=>t[0];if(s===2&&t[0]===t[1])return()=>t[1];const i=e[0]===e[1];e[0]>e[s-1]&&(e=[...e].reverse(),t=[...t].reverse());const a=Gd(t,r,o),c=a.length,l=u=>{if(i&&u<e[0])return t[0];let d=0;if(c>1)for(;d<e.length-2&&!(u<e[d+1]);d++);const p=st(e[d],e[d+1],u);return a[d](p)};return n?u=>l(we(e[0],e[s-1],u)):l}function Zd(e,t){const n=e[e.length-1];for(let r=1;r<=t;r++){const o=st(0,t,r);e.push(H(n,1,o))}}function Xd(e){const t=[0];return Zd(t,e.length-1),t}function Yd(e,t){return e.map(n=>n*t)}function Qd(e,t){return e.map(()=>t||Ba).splice(0,e.length-1)}function pn({duration:e=300,keyframes:t,times:n,ease:r="easeInOut"}){const o=$d(r)?r.map(hs):hs(r),s={done:!1,value:t[0]},i=Yd(n&&n.length===t.length?n:Xd(t),e),a=Kd(i,t,{ease:Array.isArray(o)?o:Qd(t,o)});return{calculatedDuration:e,next:c=>(s.value=a(c),s.done=c>=e,s)}}const Jd=e=>{const t=({timestamp:n})=>e(n);return{start:()=>z.update(t,!0),stop:()=>Re(t),now:()=>G.isProcessing?G.timestamp:pe.now()}},eh={decay:ds,inertia:ds,tween:pn,keyframes:pn,spring:_a},th=e=>e/100;class fo extends ja{constructor(t){super(t),this.holdTime=null,this.cancelTime=null,this.currentTime=0,this.playbackSpeed=1,this.pendingPlayState="running",this.startTime=null,this.state="idle",this.stop=()=>{if(this.resolver.cancel(),this.isStopped=!0,this.state==="idle")return;this.teardown();const{onStop:c}=this.options;c&&c()};const{name:n,motionValue:r,element:o,keyframes:s}=this.options,i=(o==null?void 0:o.KeyframeResolver)||uo,a=(c,l)=>this.onKeyframesResolved(c,l);this.resolver=new i(s,a,n,r,o),this.resolver.scheduleResolve()}flatten(){super.flatten(),this._resolved&&Object.assign(this._resolved,this.initPlayback(this._resolved.keyframes))}initPlayback(t){const{type:n="keyframes",repeat:r=0,repeatDelay:o=0,repeatType:s,velocity:i=0}=this.options,a=Jr(n)?n:eh[n]||pn;let c,l;a!==pn&&typeof t[0]!="number"&&(c=_t(th,Fa(t[0],t[1])),t=[0,100]);const u=a({...this.options,keyframes:t});s==="mirror"&&(l=a({...this.options,keyframes:[...t].reverse(),velocity:-i})),u.calculatedDuration===null&&(u.calculatedDuration=ra(u));const{calculatedDuration:d}=u,p=d+o,y=p*(r+1)-o;return{generator:u,mirroredGenerator:l,mapPercentToKeyframes:c,calculatedDuration:d,resolvedDuration:p,totalDuration:y}}onPostResolved(){const{autoplay:t=!0}=this.options;this.play(),this.pendingPlayState==="paused"||!t?this.pause():this.state=this.pendingPlayState}tick(t,n=!1){const{resolved:r}=this;if(!r){const{keyframes:P}=this.options;return{done:!0,value:P[P.length-1]}}const{finalKeyframe:o,generator:s,mirroredGenerator:i,mapPercentToKeyframes:a,keyframes:c,calculatedDuration:l,totalDuration:u,resolvedDuration:d}=r;if(this.startTime===null)return s.next(0);const{delay:p,repeat:y,repeatType:g,repeatDelay:m,onUpdate:v}=this.options;this.speed>0?this.startTime=Math.min(this.startTime,t):this.speed<0&&(this.startTime=Math.min(t-u/this.speed,this.startTime)),n?this.currentTime=t:this.holdTime!==null?this.currentTime=this.holdTime:this.currentTime=Math.round(t-this.startTime)*this.speed;const k=this.currentTime-p*(this.speed>=0?1:-1),x=this.speed>=0?k<0:k>u;this.currentTime=Math.max(k,0),this.state==="finished"&&this.holdTime===null&&(this.currentTime=u);let M=this.currentTime,C=s;if(y){const P=Math.min(this.currentTime,u)/d;let D=Math.floor(P),L=P%1;!L&&P>=1&&(L=1),L===1&&D--,D=Math.min(D,y+1),!!(D%2)&&(g==="reverse"?(L=1-L,m&&(L-=m/d)):g==="mirror"&&(C=i)),M=we(0,1,L)*d}const w=x?{done:!1,value:c[0]}:C.next(M);a&&(w.value=a(w.value));let{done:S}=w;!x&&l!==null&&(S=this.speed>=0?this.currentTime>=u:this.currentTime<=0);const A=this.holdTime===null&&(this.state==="finished"||this.state==="running"&&S);return A&&o!==void 0&&(w.value=Dn(c,this.options,o)),v&&v(w.value),A&&this.finish(),w}get duration(){const{resolved:t}=this;return t?xe(t.calculatedDuration):0}get time(){return xe(this.currentTime)}set time(t){t=ke(t),this.currentTime=t,this.holdTime!==null||this.speed===0?this.holdTime=t:this.driver&&(this.startTime=this.driver.now()-t/this.speed)}get speed(){return this.playbackSpeed}set speed(t){const n=this.playbackSpeed!==t;this.playbackSpeed=t,n&&(this.time=xe(this.currentTime))}play(){if(this.resolver.isScheduled||this.resolver.resume(),!this._resolved){this.pendingPlayState="running";return}if(this.isStopped)return;const{driver:t=Jd,onPlay:n,startTime:r}=this.options;this.driver||(this.driver=t(s=>this.tick(s))),n&&n();const o=this.driver.now();this.holdTime!==null?this.startTime=o-this.holdTime:this.startTime?this.state==="finished"&&(this.startTime=o):this.startTime=r??this.calcStartTime(),this.state==="finished"&&this.updateFinishedPromise(),this.cancelTime=this.startTime,this.holdTime=null,this.state="running",this.driver.start()}pause(){var t;if(!this._resolved){this.pendingPlayState="paused";return}this.state="paused",this.holdTime=(t=this.currentTime)!==null&&t!==void 0?t:0}complete(){this.state!=="running"&&this.play(),this.pendingPlayState=this.state="finished",this.holdTime=null}finish(){this.teardown(),this.state="finished";const{onComplete:t}=this.options;t&&t()}cancel(){this.cancelTime!==null&&this.tick(this.cancelTime),this.teardown(),this.updateFinishedPromise()}teardown(){this.state="idle",this.stopDriver(),this.resolveFinishedPromise(),this.updateFinishedPromise(),this.startTime=this.cancelTime=null,this.resolver.cancel()}stopDriver(){this.driver&&(this.driver.stop(),this.driver=void 0)}sample(t){return this.startTime=0,this.tick(t,!0)}}const nh=new Set(["opacity","clipPath","filter","transform"]);function rh(e,t,n,{delay:r=0,duration:o=300,repeat:s=0,repeatType:i="loop",ease:a="easeInOut",times:c}={}){const l={[t]:n};c&&(l.offset=c);const u=ia(a,o);return Array.isArray(u)&&(l.easing=u),e.animate(l,{delay:r,duration:o,easing:Array.isArray(u)?"linear":u,fill:"both",iterations:s+1,direction:i==="reverse"?"alternate":"normal"})}const oh=Nr(()=>Object.hasOwnProperty.call(Element.prototype,"animate")),yn=10,sh=2e4;function ih(e){return Jr(e.type)||e.type==="spring"||!sa(e.ease)}function ah(e,t){const n=new fo({...t,keyframes:e,repeat:0,delay:0,isGenerator:!0});let r={done:!1,value:e[0]};const o=[];let s=0;for(;!r.done&&s<sh;)r=n.sample(s),o.push(r.value),s+=yn;return{times:void 0,keyframes:o,duration:s-yn,ease:"linear"}}const za={anticipate:va,backInOut:ga,circInOut:xa};function ch(e){return e in za}class fs extends ja{constructor(t){super(t);const{name:n,motionValue:r,element:o,keyframes:s}=this.options;this.resolver=new Oa(s,(i,a)=>this.onKeyframesResolved(i,a),n,r,o),this.resolver.scheduleResolve()}initPlayback(t,n){let{duration:r=300,times:o,ease:s,type:i,motionValue:a,name:c,startTime:l}=this.options;if(!a.owner||!a.owner.current)return!1;if(typeof s=="string"&&hn()&&ch(s)&&(s=za[s]),ih(this.options)){const{onComplete:d,onUpdate:p,motionValue:y,element:g,...m}=this.options,v=ah(t,m);t=v.keyframes,t.length===1&&(t[1]=t[0]),r=v.duration,o=v.times,s=v.ease,i="keyframes"}const u=rh(a.owner.current,c,t,{...this.options,duration:r,times:o,ease:s});return u.startTime=l??this.calcStartTime(),this.pendingTimeline?(Yo(u,this.pendingTimeline),this.pendingTimeline=void 0):u.onfinish=()=>{const{onComplete:d}=this.options;a.set(Dn(t,this.options,n)),d&&d(),this.cancel(),this.resolveFinishedPromise()},{animation:u,duration:r,times:o,type:i,ease:s,keyframes:t}}get duration(){const{resolved:t}=this;if(!t)return 0;const{duration:n}=t;return xe(n)}get time(){const{resolved:t}=this;if(!t)return 0;const{animation:n}=t;return xe(n.currentTime||0)}set time(t){const{resolved:n}=this;if(!n)return;const{animation:r}=n;r.currentTime=ke(t)}get speed(){const{resolved:t}=this;if(!t)return 1;const{animation:n}=t;return n.playbackRate}set speed(t){const{resolved:n}=this;if(!n)return;const{animation:r}=n;r.playbackRate=t}get state(){const{resolved:t}=this;if(!t)return"idle";const{animation:n}=t;return n.playState}get startTime(){const{resolved:t}=this;if(!t)return null;const{animation:n}=t;return n.startTime}attachTimeline(t){if(!this._resolved)this.pendingTimeline=t;else{const{resolved:n}=this;if(!n)return ee;const{animation:r}=n;Yo(r,t)}return ee}play(){if(this.isStopped)return;const{resolved:t}=this;if(!t)return;const{animation:n}=t;n.playState==="finished"&&this.updateFinishedPromise(),n.play()}pause(){const{resolved:t}=this;if(!t)return;const{animation:n}=t;n.pause()}stop(){if(this.resolver.cancel(),this.isStopped=!0,this.state==="idle")return;this.resolveFinishedPromise(),this.updateFinishedPromise();const{resolved:t}=this;if(!t)return;const{animation:n,keyframes:r,duration:o,type:s,ease:i,times:a}=t;if(n.playState==="idle"||n.playState==="finished")return;if(this.time){const{motionValue:l,onUpdate:u,onComplete:d,element:p,...y}=this.options,g=new fo({...y,keyframes:r,duration:o,type:s,ease:i,times:a,isGenerator:!0}),m=ke(this.time);l.setWithVelocity(g.sample(m-yn).value,g.sample(m).value,yn)}const{onStop:c}=this.options;c&&c(),this.cancel()}complete(){const{resolved:t}=this;t&&t.animation.finish()}cancel(){const{resolved:t}=this;t&&t.animation.cancel()}static supports(t){const{motionValue:n,name:r,repeatDelay:o,repeatType:s,damping:i,type:a}=t;if(!n||!n.owner||!(n.owner.current instanceof HTMLElement))return!1;const{onUpdate:c,transformTemplate:l}=n.owner.getProps();return oh()&&r&&nh.has(r)&&!c&&!l&&!o&&s!=="mirror"&&i!==0&&a!=="inertia"}}const lh={type:"spring",stiffness:500,damping:25,restSpeed:10},uh=e=>({type:"spring",stiffness:550,damping:e===0?2*Math.sqrt(550):30,restSpeed:10}),dh={type:"keyframes",duration:.8},hh={type:"keyframes",ease:[.25,.1,.35,1],duration:.3},fh=(e,{keyframes:t})=>t.length>2?dh:$e.has(e)?e.startsWith("scale")?uh(t[1]):lh:hh;function ph({when:e,delay:t,delayChildren:n,staggerChildren:r,staggerDirection:o,repeat:s,repeatType:i,repeatDelay:a,from:c,elapsed:l,...u}){return!!Object.keys(u).length}const po=(e,t,n,r={},o,s)=>i=>{const a=Qr(r,e)||{},c=a.delay||r.delay||0;let{elapsed:l=0}=r;l=l-ke(c);let u={keyframes:Array.isArray(n)?n:[null,n],ease:"easeOut",velocity:t.getVelocity(),...a,delay:-l,onUpdate:p=>{t.set(p),a.onUpdate&&a.onUpdate(p)},onComplete:()=>{i(),a.onComplete&&a.onComplete()},name:e,motionValue:t,element:s?void 0:o};ph(a)||(u={...u,...fh(e,u)}),u.duration&&(u.duration=ke(u.duration)),u.repeatDelay&&(u.repeatDelay=ke(u.repeatDelay)),u.from!==void 0&&(u.keyframes[0]=u.from);let d=!1;if((u.type===!1||u.duration===0&&!u.repeatDelay)&&(u.duration=0,u.delay===0&&(d=!0)),d&&!s&&t.get()!==void 0){const p=Dn(u.keyframes,a);if(p!==void 0)return z.update(()=>{u.onUpdate(p),u.onComplete()}),new Vu([])}return!s&&fs.supports(u)?new fs(u):new fo(u)};function yh({protectedKeys:e,needsAnimating:t},n){const r=e.hasOwnProperty(n)&&t[n]!==!0;return t[n]=!1,r}function Ha(e,t,{delay:n=0,transitionOverride:r,type:o}={}){var s;let{transition:i=e.getDefaultTransition(),transitionEnd:a,...c}=t;r&&(i=r);const l=[],u=o&&e.animationState&&e.animationState.getState()[o];for(const d in c){const p=e.getValue(d,(s=e.latestValues[d])!==null&&s!==void 0?s:null),y=c[d];if(y===void 0||u&&yh(u,d))continue;const g={delay:n,...Qr(i||{},d)};let m=!1;if(window.MotionHandoffAnimation){const k=ha(e);if(k){const x=window.MotionHandoffAnimation(k,d,z);x!==null&&(g.startTime=x,m=!0)}}pr(e,d),p.start(po(d,p,y,e.shouldReduceMotion&&ua.has(d)?{type:!1}:g,e,m));const v=p.animation;v&&l.push(v)}return a&&Promise.all(l).then(()=>{z.update(()=>{a&&Gu(e,a)})}),l}function Mr(e,t,n={}){var r;const o=En(e,t,n.type==="exit"?(r=e.presenceContext)===null||r===void 0?void 0:r.custom:void 0);let{transition:s=e.getDefaultTransition()||{}}=o||{};n.transitionOverride&&(s=n.transitionOverride);const i=o?()=>Promise.all(Ha(e,o,n)):()=>Promise.resolve(),a=e.variantChildren&&e.variantChildren.size?(l=0)=>{const{delayChildren:u=0,staggerChildren:d,staggerDirection:p}=s;return mh(e,t,u+l,d,p,n)}:()=>Promise.resolve(),{when:c}=s;if(c){const[l,u]=c==="beforeChildren"?[i,a]:[a,i];return l().then(()=>u())}else return Promise.all([i(),a(n.delay)])}function mh(e,t,n=0,r=0,o=1,s){const i=[],a=(e.variantChildren.size-1)*r,c=o===1?(l=0)=>l*r:(l=0)=>a-l*r;return Array.from(e.variantChildren).sort(gh).forEach((l,u)=>{l.notify("AnimationStart",t),i.push(Mr(l,t,{...s,delay:n+c(u)}).then(()=>l.notify("AnimationComplete",t)))}),Promise.all(i)}function gh(e,t){return e.sortNodePosition(t)}function vh(e,t,n={}){e.notify("AnimationStart",t);let r;if(Array.isArray(t)){const o=t.map(s=>Mr(e,s,n));r=Promise.all(o)}else if(typeof t=="string")r=Mr(e,t,n);else{const o=typeof t=="function"?En(e,t,n.custom):t;r=Promise.all(Ha(e,o,n))}return r.then(()=>{e.notify("AnimationComplete",t)})}const kh=Br.length;function qa(e){if(!e)return;if(!e.isControllingVariants){const n=e.parent?qa(e.parent)||{}:{};return e.props.initial!==void 0&&(n.initial=e.props.initial),n}const t={};for(let n=0;n<kh;n++){const r=Br[n],o=e.props[r];(Tt(o)||o===!1)&&(t[r]=o)}return t}const xh=[..._r].reverse(),Mh=_r.length;function wh(e){return t=>Promise.all(t.map(({animation:n,options:r})=>vh(e,n,r)))}function bh(e){let t=wh(e),n=ps(),r=!0;const o=c=>(l,u)=>{var d;const p=En(e,u,c==="exit"?(d=e.presenceContext)===null||d===void 0?void 0:d.custom:void 0);if(p){const{transition:y,transitionEnd:g,...m}=p;l={...l,...m,...g}}return l};function s(c){t=c(e)}function i(c){const{props:l}=e,u=qa(e.parent)||{},d=[],p=new Set;let y={},g=1/0;for(let v=0;v<Mh;v++){const k=xh[v],x=n[k],M=l[k]!==void 0?l[k]:u[k],C=Tt(M),w=k===c?x.isActive:null;w===!1&&(g=v);let S=M===u[k]&&M!==l[k]&&C;if(S&&r&&e.manuallyAnimateOnMount&&(S=!1),x.protectedKeys={...y},!x.isActive&&w===null||!M&&!x.prevProp||Tn(M)||typeof M=="boolean")continue;const A=Ch(x.prevProp,M);let P=A||k===c&&x.isActive&&!S&&C||v>g&&C,D=!1;const L=Array.isArray(M)?M:[M];let j=L.reduce(o(k),{});w===!1&&(j={});const{prevResolvedValues:N={}}=x,B={...N,...j},F=O=>{P=!0,p.has(O)&&(D=!0,p.delete(O)),x.needsAnimating[O]=!0;const R=e.getValue(O);R&&(R.liveStyle=!1)};for(const O in B){const R=j[O],T=N[O];if(y.hasOwnProperty(O))continue;let _=!1;dr(R)&&dr(T)?_=!na(R,T):_=R!==T,_?R!=null?F(O):p.add(O):R!==void 0&&p.has(O)?F(O):x.protectedKeys[O]=!0}x.prevProp=M,x.prevResolvedValues=j,x.isActive&&(y={...y,...j}),r&&e.blockInitialAnimation&&(P=!1),P&&(!(S&&A)||D)&&d.push(...L.map(O=>({animation:O,options:{type:k}})))}if(p.size){const v={};p.forEach(k=>{const x=e.getBaseTarget(k),M=e.getValue(k);M&&(M.liveStyle=!0),v[k]=x??null}),d.push({animation:v})}let m=!!d.length;return r&&(l.initial===!1||l.initial===l.animate)&&!e.manuallyAnimateOnMount&&(m=!1),r=!1,m?t(d):Promise.resolve()}function a(c,l){var u;if(n[c].isActive===l)return Promise.resolve();(u=e.variantChildren)===null||u===void 0||u.forEach(p=>{var y;return(y=p.animationState)===null||y===void 0?void 0:y.setActive(c,l)}),n[c].isActive=l;const d=i(c);for(const p in n)n[p].protectedKeys={};return d}return{animateChanges:i,setActive:a,setAnimateFunction:s,getState:()=>n,reset:()=>{n=ps(),r=!0}}}function Ch(e,t){return typeof t=="string"?t!==e:Array.isArray(t)?!na(t,e):!1}function Fe(e=!1){return{isActive:e,protectedKeys:{},needsAnimating:{},prevResolvedValues:{}}}function ps(){return{animate:Fe(!0),whileInView:Fe(),whileHover:Fe(),whileTap:Fe(),whileDrag:Fe(),whileFocus:Fe(),exit:Fe()}}class Oe{constructor(t){this.isMounted=!1,this.node=t}update(){}}class Sh extends Oe{constructor(t){super(t),t.animationState||(t.animationState=bh(t))}updateAnimationControlsSubscription(){const{animate:t}=this.node.getProps();Tn(t)&&(this.unmountControls=t.subscribe(this.node))}mount(){this.updateAnimationControlsSubscription()}update(){const{animate:t}=this.node.getProps(),{animate:n}=this.node.prevProps||{};t!==n&&this.updateAnimationControlsSubscription()}unmount(){var t;this.node.animationState.reset(),(t=this.unmountControls)===null||t===void 0||t.call(this)}}let Ah=0;class Ph extends Oe{constructor(){super(...arguments),this.id=Ah++}update(){if(!this.node.presenceContext)return;const{isPresent:t,onExitComplete:n}=this.node.presenceContext,{isPresent:r}=this.node.prevPresenceContext||{};if(!this.node.animationState||t===r)return;const o=this.node.animationState.setActive("exit",!t);n&&!t&&o.then(()=>n(this.id))}mount(){const{register:t}=this.node.presenceContext||{};t&&(this.unmount=t(this.id))}unmount(){}}const Th={animation:{Feature:Sh},exit:{Feature:Ph}};function Lt(e,t,n,r={passive:!0}){return e.addEventListener(t,n,r),()=>e.removeEventListener(t,n)}function Bt(e){return{point:{x:e.pageX,y:e.pageY}}}const Rh=e=>t=>to(t)&&e(t,Bt(t));function St(e,t,n,r){return Lt(e,t,Rh(n),r)}const ys=(e,t)=>Math.abs(e-t);function Eh(e,t){const n=ys(e.x,t.x),r=ys(e.y,t.y);return Math.sqrt(n**2+r**2)}class Ua{constructor(t,n,{transformPagePoint:r,contextWindow:o,dragSnapToOrigin:s=!1}={}){if(this.startEvent=null,this.lastMoveEvent=null,this.lastMoveEventInfo=null,this.handlers={},this.contextWindow=window,this.updatePoint=()=>{if(!(this.lastMoveEvent&&this.lastMoveEventInfo))return;const d=Kn(this.lastMoveEventInfo,this.history),p=this.startEvent!==null,y=Eh(d.offset,{x:0,y:0})>=3;if(!p&&!y)return;const{point:g}=d,{timestamp:m}=G;this.history.push({...g,timestamp:m});const{onStart:v,onMove:k}=this.handlers;p||(v&&v(this.lastMoveEvent,d),this.startEvent=this.lastMoveEvent),k&&k(this.lastMoveEvent,d)},this.handlePointerMove=(d,p)=>{this.lastMoveEvent=d,this.lastMoveEventInfo=Gn(p,this.transformPagePoint),z.update(this.updatePoint,!0)},this.handlePointerUp=(d,p)=>{this.end();const{onEnd:y,onSessionEnd:g,resumeAnimation:m}=this.handlers;if(this.dragSnapToOrigin&&m&&m(),!(this.lastMoveEvent&&this.lastMoveEventInfo))return;const v=Kn(d.type==="pointercancel"?this.lastMoveEventInfo:Gn(p,this.transformPagePoint),this.history);this.startEvent&&y&&y(d,v),g&&g(d,v)},!to(t))return;this.dragSnapToOrigin=s,this.handlers=n,this.transformPagePoint=r,this.contextWindow=o||window;const i=Bt(t),a=Gn(i,this.transformPagePoint),{point:c}=a,{timestamp:l}=G;this.history=[{...c,timestamp:l}];const{onSessionStart:u}=n;u&&u(t,Kn(a,this.history)),this.removeListeners=_t(St(this.contextWindow,"pointermove",this.handlePointerMove),St(this.contextWindow,"pointerup",this.handlePointerUp),St(this.contextWindow,"pointercancel",this.handlePointerUp))}updateHandlers(t){this.handlers=t}end(){this.removeListeners&&this.removeListeners(),Re(this.updatePoint)}}function Gn(e,t){return t?{point:t(e.point)}:e}function ms(e,t){return{x:e.x-t.x,y:e.y-t.y}}function Kn({point:e},t){return{point:e,delta:ms(e,$a(t)),offset:ms(e,Dh(t)),velocity:Lh(t,.1)}}function Dh(e){return e[0]}function $a(e){return e[e.length-1]}function Lh(e,t){if(e.length<2)return{x:0,y:0};let n=e.length-1,r=null;const o=$a(e);for(;n>=0&&(r=e[n],!(o.timestamp-r.timestamp>ke(t)));)n--;if(!r)return{x:0,y:0};const s=xe(o.timestamp-r.timestamp);if(s===0)return{x:0,y:0};const i={x:(o.x-r.x)/s,y:(o.y-r.y)/s};return i.x===1/0&&(i.x=0),i.y===1/0&&(i.y=0),i}const Wa=1e-4,Vh=1-Wa,Oh=1+Wa,Ga=.01,jh=0-Ga,Ih=0+Ga;function ne(e){return e.max-e.min}function Fh(e,t,n){return Math.abs(e-t)<=n}function gs(e,t,n,r=.5){e.origin=r,e.originPoint=H(t.min,t.max,e.origin),e.scale=ne(n)/ne(t),e.translate=H(n.min,n.max,e.origin)-e.originPoint,(e.scale>=Vh&&e.scale<=Oh||isNaN(e.scale))&&(e.scale=1),(e.translate>=jh&&e.translate<=Ih||isNaN(e.translate))&&(e.translate=0)}function At(e,t,n,r){gs(e.x,t.x,n.x,r?r.originX:void 0),gs(e.y,t.y,n.y,r?r.originY:void 0)}function vs(e,t,n){e.min=n.min+t.min,e.max=e.min+ne(t)}function Nh(e,t,n){vs(e.x,t.x,n.x),vs(e.y,t.y,n.y)}function ks(e,t,n){e.min=t.min-n.min,e.max=e.min+ne(t)}function Pt(e,t,n){ks(e.x,t.x,n.x),ks(e.y,t.y,n.y)}function _h(e,{min:t,max:n},r){return t!==void 0&&e<t?e=r?H(t,e,r.min):Math.max(e,t):n!==void 0&&e>n&&(e=r?H(n,e,r.max):Math.min(e,n)),e}function xs(e,t,n){return{min:t!==void 0?e.min+t:void 0,max:n!==void 0?e.max+n-(e.max-e.min):void 0}}function Bh(e,{top:t,left:n,bottom:r,right:o}){return{x:xs(e.x,n,o),y:xs(e.y,t,r)}}function Ms(e,t){let n=t.min-e.min,r=t.max-e.max;return t.max-t.min<e.max-e.min&&([n,r]=[r,n]),{min:n,max:r}}function zh(e,t){return{x:Ms(e.x,t.x),y:Ms(e.y,t.y)}}function Hh(e,t){let n=.5;const r=ne(e),o=ne(t);return o>r?n=st(t.min,t.max-r,e.min):r>o&&(n=st(e.min,e.max-o,t.min)),we(0,1,n)}function qh(e,t){const n={};return t.min!==void 0&&(n.min=t.min-e.min),t.max!==void 0&&(n.max=t.max-e.min),n}const wr=.35;function Uh(e=wr){return e===!1?e=0:e===!0&&(e=wr),{x:ws(e,"left","right"),y:ws(e,"top","bottom")}}function ws(e,t,n){return{min:bs(e,t),max:bs(e,n)}}function bs(e,t){return typeof e=="number"?e:e[t]||0}const Cs=()=>({translate:0,scale:1,origin:0,originPoint:0}),Je=()=>({x:Cs(),y:Cs()}),Ss=()=>({min:0,max:0}),U=()=>({x:Ss(),y:Ss()});function se(e){return[e("x"),e("y")]}function Ka({top:e,left:t,right:n,bottom:r}){return{x:{min:t,max:n},y:{min:e,max:r}}}function $h({x:e,y:t}){return{top:t.min,right:e.max,bottom:t.max,left:e.min}}function Wh(e,t){if(!t)return e;const n=t({x:e.left,y:e.top}),r=t({x:e.right,y:e.bottom});return{top:n.y,left:n.x,bottom:r.y,right:r.x}}function Zn(e){return e===void 0||e===1}function br({scale:e,scaleX:t,scaleY:n}){return!Zn(e)||!Zn(t)||!Zn(n)}function Ne(e){return br(e)||Za(e)||e.z||e.rotate||e.rotateX||e.rotateY||e.skewX||e.skewY}function Za(e){return As(e.x)||As(e.y)}function As(e){return e&&e!=="0%"}function mn(e,t,n){const r=e-n,o=t*r;return n+o}function Ps(e,t,n,r,o){return o!==void 0&&(e=mn(e,o,r)),mn(e,n,r)+t}function Cr(e,t=0,n=1,r,o){e.min=Ps(e.min,t,n,r,o),e.max=Ps(e.max,t,n,r,o)}function Xa(e,{x:t,y:n}){Cr(e.x,t.translate,t.scale,t.originPoint),Cr(e.y,n.translate,n.scale,n.originPoint)}const Ts=.999999999999,Rs=1.0000000000001;function Gh(e,t,n,r=!1){const o=n.length;if(!o)return;t.x=t.y=1;let s,i;for(let a=0;a<o;a++){s=n[a],i=s.projectionDelta;const{visualElement:c}=s.options;c&&c.props.style&&c.props.style.display==="contents"||(r&&s.options.layoutScroll&&s.scroll&&s!==s.root&&tt(e,{x:-s.scroll.offset.x,y:-s.scroll.offset.y}),i&&(t.x*=i.x.scale,t.y*=i.y.scale,Xa(e,i)),r&&Ne(s.latestValues)&&tt(e,s.latestValues))}t.x<Rs&&t.x>Ts&&(t.x=1),t.y<Rs&&t.y>Ts&&(t.y=1)}function et(e,t){e.min=e.min+t,e.max=e.max+t}function Es(e,t,n,r,o=.5){const s=H(e.min,e.max,o);Cr(e,t,n,s,r)}function tt(e,t){Es(e.x,t.x,t.scaleX,t.scale,t.originX),Es(e.y,t.y,t.scaleY,t.scale,t.originY)}function Ya(e,t){return Ka(Wh(e.getBoundingClientRect(),t))}function Kh(e,t,n){const r=Ya(e,n),{scroll:o}=t;return o&&(et(r.x,o.offset.x),et(r.y,o.offset.y)),r}const Qa=({current:e})=>e?e.ownerDocument.defaultView:null,Zh=new WeakMap;class Xh{constructor(t){this.openDragLock=null,this.isDragging=!1,this.currentDirection=null,this.originPoint={x:0,y:0},this.constraints=!1,this.hasMutatedConstraints=!1,this.elastic=U(),this.visualElement=t}start(t,{snapToCursor:n=!1}={}){const{presenceContext:r}=this.visualElement;if(r&&r.isPresent===!1)return;const o=u=>{const{dragSnapToOrigin:d}=this.getProps();d?this.pauseAnimation():this.stopAnimation(),n&&this.snapToCursor(Bt(u).point)},s=(u,d)=>{const{drag:p,dragPropagation:y,onDragStart:g}=this.getProps();if(p&&!y&&(this.openDragLock&&this.openDragLock(),this.openDragLock=Hu(p),!this.openDragLock))return;this.isDragging=!0,this.currentDirection=null,this.resolveConstraints(),this.visualElement.projection&&(this.visualElement.projection.isAnimationBlocked=!0,this.visualElement.projection.target=void 0),se(v=>{let k=this.getAxisMotionValue(v).get()||0;if(fe.test(k)){const{projection:x}=this.visualElement;if(x&&x.layout){const M=x.layout.layoutBox[v];M&&(k=ne(M)*(parseFloat(k)/100))}}this.originPoint[v]=k}),g&&z.postRender(()=>g(u,d)),pr(this.visualElement,"transform");const{animationState:m}=this.visualElement;m&&m.setActive("whileDrag",!0)},i=(u,d)=>{const{dragPropagation:p,dragDirectionLock:y,onDirectionLock:g,onDrag:m}=this.getProps();if(!p&&!this.openDragLock)return;const{offset:v}=d;if(y&&this.currentDirection===null){this.currentDirection=Yh(v),this.currentDirection!==null&&g&&g(this.currentDirection);return}this.updateAxis("x",d.point,v),this.updateAxis("y",d.point,v),this.visualElement.render(),m&&m(u,d)},a=(u,d)=>this.stop(u,d),c=()=>se(u=>{var d;return this.getAnimationState(u)==="paused"&&((d=this.getAxisMotionValue(u).animation)===null||d===void 0?void 0:d.play())}),{dragSnapToOrigin:l}=this.getProps();this.panSession=new Ua(t,{onSessionStart:o,onStart:s,onMove:i,onSessionEnd:a,resumeAnimation:c},{transformPagePoint:this.visualElement.getTransformPagePoint(),dragSnapToOrigin:l,contextWindow:Qa(this.visualElement)})}stop(t,n){const r=this.isDragging;if(this.cancel(),!r)return;const{velocity:o}=n;this.startAnimation(o);const{onDragEnd:s}=this.getProps();s&&z.postRender(()=>s(t,n))}cancel(){this.isDragging=!1;const{projection:t,animationState:n}=this.visualElement;t&&(t.isAnimationBlocked=!1),this.panSession&&this.panSession.end(),this.panSession=void 0;const{dragPropagation:r}=this.getProps();!r&&this.openDragLock&&(this.openDragLock(),this.openDragLock=null),n&&n.setActive("whileDrag",!1)}updateAxis(t,n,r){const{drag:o}=this.getProps();if(!r||!Yt(t,o,this.currentDirection))return;const s=this.getAxisMotionValue(t);let i=this.originPoint[t]+r[t];this.constraints&&this.constraints[t]&&(i=_h(i,this.constraints[t],this.elastic[t])),s.set(i)}resolveConstraints(){var t;const{dragConstraints:n,dragElastic:r}=this.getProps(),o=this.visualElement.projection&&!this.visualElement.projection.layout?this.visualElement.projection.measure(!1):(t=this.visualElement.projection)===null||t===void 0?void 0:t.layout,s=this.constraints;n&&Ye(n)?this.constraints||(this.constraints=this.resolveRefConstraints()):n&&o?this.constraints=Bh(o.layoutBox,n):this.constraints=!1,this.elastic=Uh(r),s!==this.constraints&&o&&this.constraints&&!this.hasMutatedConstraints&&se(i=>{this.constraints!==!1&&this.getAxisMotionValue(i)&&(this.constraints[i]=qh(o.layoutBox[i],this.constraints[i]))})}resolveRefConstraints(){const{dragConstraints:t,onMeasureDragConstraints:n}=this.getProps();if(!t||!Ye(t))return!1;const r=t.current,{projection:o}=this.visualElement;if(!o||!o.layout)return!1;const s=Kh(r,o.root,this.visualElement.getTransformPagePoint());let i=zh(o.layout.layoutBox,s);if(n){const a=n($h(i));this.hasMutatedConstraints=!!a,a&&(i=Ka(a))}return i}startAnimation(t){const{drag:n,dragMomentum:r,dragElastic:o,dragTransition:s,dragSnapToOrigin:i,onDragTransitionEnd:a}=this.getProps(),c=this.constraints||{},l=se(u=>{if(!Yt(u,n,this.currentDirection))return;let d=c&&c[u]||{};i&&(d={min:0,max:0});const p=o?200:1e6,y=o?40:1e7,g={type:"inertia",velocity:r?t[u]:0,bounceStiffness:p,bounceDamping:y,timeConstant:750,restDelta:1,restSpeed:10,...s,...d};return this.startAxisValueAnimation(u,g)});return Promise.all(l).then(a)}startAxisValueAnimation(t,n){const r=this.getAxisMotionValue(t);return pr(this.visualElement,t),r.start(po(t,r,0,n,this.visualElement,!1))}stopAnimation(){se(t=>this.getAxisMotionValue(t).stop())}pauseAnimation(){se(t=>{var n;return(n=this.getAxisMotionValue(t).animation)===null||n===void 0?void 0:n.pause()})}getAnimationState(t){var n;return(n=this.getAxisMotionValue(t).animation)===null||n===void 0?void 0:n.state}getAxisMotionValue(t){const n=`_drag${t.toUpperCase()}`,r=this.visualElement.getProps(),o=r[n];return o||this.visualElement.getValue(t,(r.initial?r.initial[t]:void 0)||0)}snapToCursor(t){se(n=>{const{drag:r}=this.getProps();if(!Yt(n,r,this.currentDirection))return;const{projection:o}=this.visualElement,s=this.getAxisMotionValue(n);if(o&&o.layout){const{min:i,max:a}=o.layout.layoutBox[n];s.set(t[n]-H(i,a,.5))}})}scalePositionWithinConstraints(){if(!this.visualElement.current)return;const{drag:t,dragConstraints:n}=this.getProps(),{projection:r}=this.visualElement;if(!Ye(n)||!r||!this.constraints)return;this.stopAnimation();const o={x:0,y:0};se(i=>{const a=this.getAxisMotionValue(i);if(a&&this.constraints!==!1){const c=a.get();o[i]=Hh({min:c,max:c},this.constraints[i])}});const{transformTemplate:s}=this.visualElement.getProps();this.visualElement.current.style.transform=s?s({},""):"none",r.root&&r.root.updateScroll(),r.updateLayout(),this.resolveConstraints(),se(i=>{if(!Yt(i,t,null))return;const a=this.getAxisMotionValue(i),{min:c,max:l}=this.constraints[i];a.set(H(c,l,o[i]))})}addListeners(){if(!this.visualElement.current)return;Zh.set(this.visualElement,this);const t=this.visualElement.current,n=St(t,"pointerdown",c=>{const{drag:l,dragListener:u=!0}=this.getProps();l&&u&&this.start(c)}),r=()=>{const{dragConstraints:c}=this.getProps();Ye(c)&&c.current&&(this.constraints=this.resolveRefConstraints())},{projection:o}=this.visualElement,s=o.addEventListener("measure",r);o&&!o.layout&&(o.root&&o.root.updateScroll(),o.updateLayout()),z.read(r);const i=Lt(window,"resize",()=>this.scalePositionWithinConstraints()),a=o.addEventListener("didUpdate",({delta:c,hasLayoutChanged:l})=>{this.isDragging&&l&&(se(u=>{const d=this.getAxisMotionValue(u);d&&(this.originPoint[u]+=c[u].translate,d.set(d.get()+c[u].translate))}),this.visualElement.render())});return()=>{i(),n(),s(),a&&a()}}getProps(){const t=this.visualElement.getProps(),{drag:n=!1,dragDirectionLock:r=!1,dragPropagation:o=!1,dragConstraints:s=!1,dragElastic:i=wr,dragMomentum:a=!0}=t;return{...t,drag:n,dragDirectionLock:r,dragPropagation:o,dragConstraints:s,dragElastic:i,dragMomentum:a}}}function Yt(e,t,n){return(t===!0||t===e)&&(n===null||n===e)}function Yh(e,t=10){let n=null;return Math.abs(e.y)>t?n="y":Math.abs(e.x)>t&&(n="x"),n}class Qh extends Oe{constructor(t){super(t),this.removeGroupControls=ee,this.removeListeners=ee,this.controls=new Xh(t)}mount(){const{dragControls:t}=this.node.getProps();t&&(this.removeGroupControls=t.subscribe(this.controls)),this.removeListeners=this.controls.addListeners()||ee}unmount(){this.removeGroupControls(),this.removeListeners()}}const Ds=e=>(t,n)=>{e&&z.postRender(()=>e(t,n))};class Jh extends Oe{constructor(){super(...arguments),this.removePointerDownListener=ee}onPointerDown(t){this.session=new Ua(t,this.createPanHandlers(),{transformPagePoint:this.node.getTransformPagePoint(),contextWindow:Qa(this.node)})}createPanHandlers(){const{onPanSessionStart:t,onPanStart:n,onPan:r,onPanEnd:o}=this.node.getProps();return{onSessionStart:Ds(t),onStart:Ds(n),onMove:r,onEnd:(s,i)=>{delete this.session,o&&z.postRender(()=>o(s,i))}}}mount(){this.removePointerDownListener=St(this.node.current,"pointerdown",t=>this.onPointerDown(t))}update(){this.session&&this.session.updateHandlers(this.createPanHandlers())}unmount(){this.removePointerDownListener(),this.session&&this.session.end()}}const sn={hasAnimatedSinceResize:!0,hasEverUpdated:!1};function Ls(e,t){return t.max===t.min?0:e/(t.max-t.min)*100}const kt={correct:(e,t)=>{if(!t.target)return e;if(typeof e=="string")if(E.test(e))e=parseFloat(e);else return e;const n=Ls(e,t.target.x),r=Ls(e,t.target.y);return`${n}% ${r}%`}},e2={correct:(e,{treeScale:t,projectionDelta:n})=>{const r=e,o=Ee.parse(e);if(o.length>5)return r;const s=Ee.createTransformer(e),i=typeof o[0]!="number"?1:0,a=n.x.scale*t.x,c=n.y.scale*t.y;o[0+i]/=a,o[1+i]/=c;const l=H(a,c,.5);return typeof o[2+i]=="number"&&(o[2+i]/=l),typeof o[3+i]=="number"&&(o[3+i]/=l),s(o)}};class t2 extends f.Component{componentDidMount(){const{visualElement:t,layoutGroup:n,switchLayoutGroup:r,layoutId:o}=this.props,{projection:s}=t;Mu(n2),s&&(n.group&&n.group.add(s),r&&r.register&&o&&r.register(s),s.root.didUpdate(),s.addEventListener("animationComplete",()=>{this.safeToRemove()}),s.setOptions({...s.options,onExitComplete:()=>this.safeToRemove()})),sn.hasEverUpdated=!0}getSnapshotBeforeUpdate(t){const{layoutDependency:n,visualElement:r,drag:o,isPresent:s}=this.props,i=r.projection;return i&&(i.isPresent=s,o||t.layoutDependency!==n||n===void 0?i.willUpdate():this.safeToRemove(),t.isPresent!==s&&(s?i.promote():i.relegate()||z.postRender(()=>{const a=i.getStack();(!a||!a.members.length)&&this.safeToRemove()}))),null}componentDidUpdate(){const{projection:t}=this.props.visualElement;t&&(t.root.didUpdate(),Hr.postRender(()=>{!t.currentAnimation&&t.isLead()&&this.safeToRemove()}))}componentWillUnmount(){const{visualElement:t,layoutGroup:n,switchLayoutGroup:r}=this.props,{projection:o}=t;o&&(o.scheduleCheckAfterUnmount(),n&&n.group&&n.group.remove(o),r&&r.deregister&&r.deregister(o))}safeToRemove(){const{safeToRemove:t}=this.props;t&&t()}render(){return null}}function Ja(e){const[t,n]=ji(),r=f.useContext(Or);return b.jsx(t2,{...e,layoutGroup:r,switchLayoutGroup:f.useContext(qi),isPresent:t,safeToRemove:n})}const n2={borderRadius:{...kt,applyTo:["borderTopLeftRadius","borderTopRightRadius","borderBottomLeftRadius","borderBottomRightRadius"]},borderTopLeftRadius:kt,borderTopRightRadius:kt,borderBottomLeftRadius:kt,borderBottomRightRadius:kt,boxShadow:e2};function r2(e,t,n){const r=X(e)?e:Et(e);return r.start(po("",r,t,n)),r.animation}function o2(e){return e instanceof SVGElement&&e.tagName!=="svg"}const s2=(e,t)=>e.depth-t.depth;class i2{constructor(){this.children=[],this.isDirty=!1}add(t){no(this.children,t),this.isDirty=!0}remove(t){ro(this.children,t),this.isDirty=!0}forEach(t){this.isDirty&&this.children.sort(s2),this.isDirty=!1,this.children.forEach(t)}}function a2(e,t){const n=pe.now(),r=({timestamp:o})=>{const s=o-n;s>=t&&(Re(r),e(s-t))};return z.read(r,!0),()=>Re(r)}const ec=["TopLeft","TopRight","BottomLeft","BottomRight"],c2=ec.length,Vs=e=>typeof e=="string"?parseFloat(e):e,Os=e=>typeof e=="number"||E.test(e);function l2(e,t,n,r,o,s){o?(e.opacity=H(0,n.opacity!==void 0?n.opacity:1,u2(r)),e.opacityExit=H(t.opacity!==void 0?t.opacity:1,0,d2(r))):s&&(e.opacity=H(t.opacity!==void 0?t.opacity:1,n.opacity!==void 0?n.opacity:1,r));for(let i=0;i<c2;i++){const a=`border${ec[i]}Radius`;let c=js(t,a),l=js(n,a);if(c===void 0&&l===void 0)continue;c||(c=0),l||(l=0),c===0||l===0||Os(c)===Os(l)?(e[a]=Math.max(H(Vs(c),Vs(l),r),0),(fe.test(l)||fe.test(c))&&(e[a]+="%")):e[a]=l}(t.rotate||n.rotate)&&(e.rotate=H(t.rotate||0,n.rotate||0,r))}function js(e,t){return e[t]!==void 0?e[t]:e.borderRadius}const u2=tc(0,.5,ka),d2=tc(.5,.95,ee);function tc(e,t,n){return r=>r<e?0:r>t?1:n(st(e,t,r))}function Is(e,t){e.min=t.min,e.max=t.max}function oe(e,t){Is(e.x,t.x),Is(e.y,t.y)}function Fs(e,t){e.translate=t.translate,e.scale=t.scale,e.originPoint=t.originPoint,e.origin=t.origin}function Ns(e,t,n,r,o){return e-=t,e=mn(e,1/n,r),o!==void 0&&(e=mn(e,1/o,r)),e}function h2(e,t=0,n=1,r=.5,o,s=e,i=e){if(fe.test(t)&&(t=parseFloat(t),t=H(i.min,i.max,t/100)-i.min),typeof t!="number")return;let a=H(s.min,s.max,r);e===s&&(a-=t),e.min=Ns(e.min,t,n,a,o),e.max=Ns(e.max,t,n,a,o)}function _s(e,t,[n,r,o],s,i){h2(e,t[n],t[r],t[o],t.scale,s,i)}const f2=["x","scaleX","originX"],p2=["y","scaleY","originY"];function Bs(e,t,n,r){_s(e.x,t,f2,n?n.x:void 0,r?r.x:void 0),_s(e.y,t,p2,n?n.y:void 0,r?r.y:void 0)}function zs(e){return e.translate===0&&e.scale===1}function nc(e){return zs(e.x)&&zs(e.y)}function Hs(e,t){return e.min===t.min&&e.max===t.max}function y2(e,t){return Hs(e.x,t.x)&&Hs(e.y,t.y)}function qs(e,t){return Math.round(e.min)===Math.round(t.min)&&Math.round(e.max)===Math.round(t.max)}function rc(e,t){return qs(e.x,t.x)&&qs(e.y,t.y)}function Us(e){return ne(e.x)/ne(e.y)}function $s(e,t){return e.translate===t.translate&&e.scale===t.scale&&e.originPoint===t.originPoint}class m2{constructor(){this.members=[]}add(t){no(this.members,t),t.scheduleRender()}remove(t){if(ro(this.members,t),t===this.prevLead&&(this.prevLead=void 0),t===this.lead){const n=this.members[this.members.length-1];n&&this.promote(n)}}relegate(t){const n=this.members.findIndex(o=>t===o);if(n===0)return!1;let r;for(let o=n;o>=0;o--){const s=this.members[o];if(s.isPresent!==!1){r=s;break}}return r?(this.promote(r),!0):!1}promote(t,n){const r=this.lead;if(t!==r&&(this.prevLead=r,this.lead=t,t.show(),r)){r.instance&&r.scheduleRender(),t.scheduleRender(),t.resumeFrom=r,n&&(t.resumeFrom.preserveOpacity=!0),r.snapshot&&(t.snapshot=r.snapshot,t.snapshot.latestValues=r.animationValues||r.latestValues),t.root&&t.root.isUpdating&&(t.isLayoutDirty=!0);const{crossfade:o}=t.options;o===!1&&r.hide()}}exitAnimationComplete(){this.members.forEach(t=>{const{options:n,resumingFrom:r}=t;n.onExitComplete&&n.onExitComplete(),r&&r.options.onExitComplete&&r.options.onExitComplete()})}scheduleRender(){this.members.forEach(t=>{t.instance&&t.scheduleRender(!1)})}removeLeadSnapshot(){this.lead&&this.lead.snapshot&&(this.lead.snapshot=void 0)}}function g2(e,t,n){let r="";const o=e.x.translate/t.x,s=e.y.translate/t.y,i=(n==null?void 0:n.z)||0;if((o||s||i)&&(r=`translate3d(${o}px, ${s}px, ${i}px) `),(t.x!==1||t.y!==1)&&(r+=`scale(${1/t.x}, ${1/t.y}) `),n){const{transformPerspective:l,rotate:u,rotateX:d,rotateY:p,skewX:y,skewY:g}=n;l&&(r=`perspective(${l}px) ${r}`),u&&(r+=`rotate(${u}deg) `),d&&(r+=`rotateX(${d}deg) `),p&&(r+=`rotateY(${p}deg) `),y&&(r+=`skewX(${y}deg) `),g&&(r+=`skewY(${g}deg) `)}const a=e.x.scale*t.x,c=e.y.scale*t.y;return(a!==1||c!==1)&&(r+=`scale(${a}, ${c})`),r||"none"}const _e={type:"projectionFrame",totalNodes:0,resolvedTargetDeltas:0,recalculatedProjection:0},wt=typeof window<"u"&&window.MotionDebug!==void 0,Xn=["","X","Y","Z"],v2={visibility:"hidden"},Ws=1e3;let k2=0;function Yn(e,t,n,r){const{latestValues:o}=t;o[e]&&(n[e]=o[e],t.setStaticValue(e,0),r&&(r[e]=0))}function oc(e){if(e.hasCheckedOptimisedAppear=!0,e.root===e)return;const{visualElement:t}=e.options;if(!t)return;const n=ha(t);if(window.MotionHasOptimisedAnimation(n,"transform")){const{layout:o,layoutId:s}=e.options;window.MotionCancelOptimisedAnimation(n,"transform",z,!(o||s))}const{parent:r}=e;r&&!r.hasCheckedOptimisedAppear&&oc(r)}function sc({attachResizeListener:e,defaultParent:t,measureScroll:n,checkIsScrollRoot:r,resetTransform:o}){return class{constructor(i={},a=t==null?void 0:t()){this.id=k2++,this.animationId=0,this.children=new Set,this.options={},this.isTreeAnimating=!1,this.isAnimationBlocked=!1,this.isLayoutDirty=!1,this.isProjectionDirty=!1,this.isSharedProjectionDirty=!1,this.isTransformDirty=!1,this.updateManuallyBlocked=!1,this.updateBlockedByResize=!1,this.isUpdating=!1,this.isSVG=!1,this.needsReset=!1,this.shouldResetTransform=!1,this.hasCheckedOptimisedAppear=!1,this.treeScale={x:1,y:1},this.eventHandlers=new Map,this.hasTreeAnimated=!1,this.updateScheduled=!1,this.scheduleUpdate=()=>this.update(),this.projectionUpdateScheduled=!1,this.checkUpdateFailed=()=>{this.isUpdating&&(this.isUpdating=!1,this.clearAllSnapshots())},this.updateProjection=()=>{this.projectionUpdateScheduled=!1,wt&&(_e.totalNodes=_e.resolvedTargetDeltas=_e.recalculatedProjection=0),this.nodes.forEach(w2),this.nodes.forEach(P2),this.nodes.forEach(T2),this.nodes.forEach(b2),wt&&window.MotionDebug.record(_e)},this.resolvedRelativeTargetAt=0,this.hasProjected=!1,this.isVisible=!0,this.animationProgress=0,this.sharedNodes=new Map,this.latestValues=i,this.root=a?a.root||a:this,this.path=a?[...a.path,a]:[],this.parent=a,this.depth=a?a.depth+1:0;for(let c=0;c<this.path.length;c++)this.path[c].shouldResetTransform=!0;this.root===this&&(this.nodes=new i2)}addEventListener(i,a){return this.eventHandlers.has(i)||this.eventHandlers.set(i,new oo),this.eventHandlers.get(i).add(a)}notifyListeners(i,...a){const c=this.eventHandlers.get(i);c&&c.notify(...a)}hasListeners(i){return this.eventHandlers.has(i)}mount(i,a=this.root.hasTreeAnimated){if(this.instance)return;this.isSVG=o2(i),this.instance=i;const{layoutId:c,layout:l,visualElement:u}=this.options;if(u&&!u.current&&u.mount(i),this.root.nodes.add(this),this.parent&&this.parent.children.add(this),a&&(l||c)&&(this.isLayoutDirty=!0),e){let d;const p=()=>this.root.updateBlockedByResize=!1;e(i,()=>{this.root.updateBlockedByResize=!0,d&&d(),d=a2(p,250),sn.hasAnimatedSinceResize&&(sn.hasAnimatedSinceResize=!1,this.nodes.forEach(Ks))})}c&&this.root.registerSharedNode(c,this),this.options.animate!==!1&&u&&(c||l)&&this.addEventListener("didUpdate",({delta:d,hasLayoutChanged:p,hasRelativeTargetChanged:y,layout:g})=>{if(this.isTreeAnimationBlocked()){this.target=void 0,this.relativeTarget=void 0;return}const m=this.options.transition||u.getDefaultTransition()||V2,{onLayoutAnimationStart:v,onLayoutAnimationComplete:k}=u.getProps(),x=!this.targetLayout||!rc(this.targetLayout,g)||y,M=!p&&y;if(this.options.layoutRoot||this.resumeFrom&&this.resumeFrom.instance||M||p&&(x||!this.currentAnimation)){this.resumeFrom&&(this.resumingFrom=this.resumeFrom,this.resumingFrom.resumingFrom=void 0),this.setAnimationOrigin(d,M);const C={...Qr(m,"layout"),onPlay:v,onComplete:k};(u.shouldReduceMotion||this.options.layoutRoot)&&(C.delay=0,C.type=!1),this.startAnimation(C)}else p||Ks(this),this.isLead()&&this.options.onExitComplete&&this.options.onExitComplete();this.targetLayout=g})}unmount(){this.options.layoutId&&this.willUpdate(),this.root.nodes.remove(this);const i=this.getStack();i&&i.remove(this),this.parent&&this.parent.children.delete(this),this.instance=void 0,Re(this.updateProjection)}blockUpdate(){this.updateManuallyBlocked=!0}unblockUpdate(){this.updateManuallyBlocked=!1}isUpdateBlocked(){return this.updateManuallyBlocked||this.updateBlockedByResize}isTreeAnimationBlocked(){return this.isAnimationBlocked||this.parent&&this.parent.isTreeAnimationBlocked()||!1}startUpdate(){this.isUpdateBlocked()||(this.isUpdating=!0,this.nodes&&this.nodes.forEach(R2),this.animationId++)}getTransformTemplate(){const{visualElement:i}=this.options;return i&&i.getProps().transformTemplate}willUpdate(i=!0){if(this.root.hasTreeAnimated=!0,this.root.isUpdateBlocked()){this.options.onExitComplete&&this.options.onExitComplete();return}if(window.MotionCancelOptimisedAnimation&&!this.hasCheckedOptimisedAppear&&oc(this),!this.root.isUpdating&&this.root.startUpdate(),this.isLayoutDirty)return;this.isLayoutDirty=!0;for(let u=0;u<this.path.length;u++){const d=this.path[u];d.shouldResetTransform=!0,d.updateScroll("snapshot"),d.options.layoutRoot&&d.willUpdate(!1)}const{layoutId:a,layout:c}=this.options;if(a===void 0&&!c)return;const l=this.getTransformTemplate();this.prevTransformTemplateValue=l?l(this.latestValues,""):void 0,this.updateSnapshot(),i&&this.notifyListeners("willUpdate")}update(){if(this.updateScheduled=!1,this.isUpdateBlocked()){this.unblockUpdate(),this.clearAllSnapshots(),this.nodes.forEach(Gs);return}this.isUpdating||this.nodes.forEach(S2),this.isUpdating=!1,this.nodes.forEach(A2),this.nodes.forEach(x2),this.nodes.forEach(M2),this.clearAllSnapshots();const a=pe.now();G.delta=we(0,1e3/60,a-G.timestamp),G.timestamp=a,G.isProcessing=!0,zn.update.process(G),zn.preRender.process(G),zn.render.process(G),G.isProcessing=!1}didUpdate(){this.updateScheduled||(this.updateScheduled=!0,Hr.read(this.scheduleUpdate))}clearAllSnapshots(){this.nodes.forEach(C2),this.sharedNodes.forEach(E2)}scheduleUpdateProjection(){this.projectionUpdateScheduled||(this.projectionUpdateScheduled=!0,z.preRender(this.updateProjection,!1,!0))}scheduleCheckAfterUnmount(){z.postRender(()=>{this.isLayoutDirty?this.root.didUpdate():this.root.checkUpdateFailed()})}updateSnapshot(){this.snapshot||!this.instance||(this.snapshot=this.measure())}updateLayout(){if(!this.instance||(this.updateScroll(),!(this.options.alwaysMeasureLayout&&this.isLead())&&!this.isLayoutDirty))return;if(this.resumeFrom&&!this.resumeFrom.instance)for(let c=0;c<this.path.length;c++)this.path[c].updateScroll();const i=this.layout;this.layout=this.measure(!1),this.layoutCorrected=U(),this.isLayoutDirty=!1,this.projectionDelta=void 0,this.notifyListeners("measure",this.layout.layoutBox);const{visualElement:a}=this.options;a&&a.notify("LayoutMeasure",this.layout.layoutBox,i?i.layoutBox:void 0)}updateScroll(i="measure"){let a=!!(this.options.layoutScroll&&this.instance);if(this.scroll&&this.scroll.animationId===this.root.animationId&&this.scroll.phase===i&&(a=!1),a){const c=r(this.instance);this.scroll={animationId:this.root.animationId,phase:i,isRoot:c,offset:n(this.instance),wasRoot:this.scroll?this.scroll.isRoot:c}}}resetTransform(){if(!o)return;const i=this.isLayoutDirty||this.shouldResetTransform||this.options.alwaysMeasureLayout,a=this.projectionDelta&&!nc(this.projectionDelta),c=this.getTransformTemplate(),l=c?c(this.latestValues,""):void 0,u=l!==this.prevTransformTemplateValue;i&&(a||Ne(this.latestValues)||u)&&(o(this.instance,l),this.shouldResetTransform=!1,this.scheduleRender())}measure(i=!0){const a=this.measurePageBox();let c=this.removeElementScroll(a);return i&&(c=this.removeTransform(c)),O2(c),{animationId:this.root.animationId,measuredBox:a,layoutBox:c,latestValues:{},source:this.id}}measurePageBox(){var i;const{visualElement:a}=this.options;if(!a)return U();const c=a.measureViewportBox();if(!(((i=this.scroll)===null||i===void 0?void 0:i.wasRoot)||this.path.some(j2))){const{scroll:u}=this.root;u&&(et(c.x,u.offset.x),et(c.y,u.offset.y))}return c}removeElementScroll(i){var a;const c=U();if(oe(c,i),!((a=this.scroll)===null||a===void 0)&&a.wasRoot)return c;for(let l=0;l<this.path.length;l++){const u=this.path[l],{scroll:d,options:p}=u;u!==this.root&&d&&p.layoutScroll&&(d.wasRoot&&oe(c,i),et(c.x,d.offset.x),et(c.y,d.offset.y))}return c}applyTransform(i,a=!1){const c=U();oe(c,i);for(let l=0;l<this.path.length;l++){const u=this.path[l];!a&&u.options.layoutScroll&&u.scroll&&u!==u.root&&tt(c,{x:-u.scroll.offset.x,y:-u.scroll.offset.y}),Ne(u.latestValues)&&tt(c,u.latestValues)}return Ne(this.latestValues)&&tt(c,this.latestValues),c}removeTransform(i){const a=U();oe(a,i);for(let c=0;c<this.path.length;c++){const l=this.path[c];if(!l.instance||!Ne(l.latestValues))continue;br(l.latestValues)&&l.updateSnapshot();const u=U(),d=l.measurePageBox();oe(u,d),Bs(a,l.latestValues,l.snapshot?l.snapshot.layoutBox:void 0,u)}return Ne(this.latestValues)&&Bs(a,this.latestValues),a}setTargetDelta(i){this.targetDelta=i,this.root.scheduleUpdateProjection(),this.isProjectionDirty=!0}setOptions(i){this.options={...this.options,...i,crossfade:i.crossfade!==void 0?i.crossfade:!0}}clearMeasurements(){this.scroll=void 0,this.layout=void 0,this.snapshot=void 0,this.prevTransformTemplateValue=void 0,this.targetDelta=void 0,this.target=void 0,this.isLayoutDirty=!1}forceRelativeParentToResolveTarget(){this.relativeParent&&this.relativeParent.resolvedRelativeTargetAt!==G.timestamp&&this.relativeParent.resolveTargetDelta(!0)}resolveTargetDelta(i=!1){var a;const c=this.getLead();this.isProjectionDirty||(this.isProjectionDirty=c.isProjectionDirty),this.isTransformDirty||(this.isTransformDirty=c.isTransformDirty),this.isSharedProjectionDirty||(this.isSharedProjectionDirty=c.isSharedProjectionDirty);const l=!!this.resumingFrom||this!==c;if(!(i||l&&this.isSharedProjectionDirty||this.isProjectionDirty||!((a=this.parent)===null||a===void 0)&&a.isProjectionDirty||this.attemptToResolveRelativeTarget||this.root.updateBlockedByResize))return;const{layout:d,layoutId:p}=this.options;if(!(!this.layout||!(d||p))){if(this.resolvedRelativeTargetAt=G.timestamp,!this.targetDelta&&!this.relativeTarget){const y=this.getClosestProjectingParent();y&&y.layout&&this.animationProgress!==1?(this.relativeParent=y,this.forceRelativeParentToResolveTarget(),this.relativeTarget=U(),this.relativeTargetOrigin=U(),Pt(this.relativeTargetOrigin,this.layout.layoutBox,y.layout.layoutBox),oe(this.relativeTarget,this.relativeTargetOrigin)):this.relativeParent=this.relativeTarget=void 0}if(!(!this.relativeTarget&&!this.targetDelta)){if(this.target||(this.target=U(),this.targetWithTransforms=U()),this.relativeTarget&&this.relativeTargetOrigin&&this.relativeParent&&this.relativeParent.target?(this.forceRelativeParentToResolveTarget(),Nh(this.target,this.relativeTarget,this.relativeParent.target)):this.targetDelta?(this.resumingFrom?this.target=this.applyTransform(this.layout.layoutBox):oe(this.target,this.layout.layoutBox),Xa(this.target,this.targetDelta)):oe(this.target,this.layout.layoutBox),this.attemptToResolveRelativeTarget){this.attemptToResolveRelativeTarget=!1;const y=this.getClosestProjectingParent();y&&!!y.resumingFrom==!!this.resumingFrom&&!y.options.layoutScroll&&y.target&&this.animationProgress!==1?(this.relativeParent=y,this.forceRelativeParentToResolveTarget(),this.relativeTarget=U(),this.relativeTargetOrigin=U(),Pt(this.relativeTargetOrigin,this.target,y.target),oe(this.relativeTarget,this.relativeTargetOrigin)):this.relativeParent=this.relativeTarget=void 0}wt&&_e.resolvedTargetDeltas++}}}getClosestProjectingParent(){if(!(!this.parent||br(this.parent.latestValues)||Za(this.parent.latestValues)))return this.parent.isProjecting()?this.parent:this.parent.getClosestProjectingParent()}isProjecting(){return!!((this.relativeTarget||this.targetDelta||this.options.layoutRoot)&&this.layout)}calcProjection(){var i;const a=this.getLead(),c=!!this.resumingFrom||this!==a;let l=!0;if((this.isProjectionDirty||!((i=this.parent)===null||i===void 0)&&i.isProjectionDirty)&&(l=!1),c&&(this.isSharedProjectionDirty||this.isTransformDirty)&&(l=!1),this.resolvedRelativeTargetAt===G.timestamp&&(l=!1),l)return;const{layout:u,layoutId:d}=this.options;if(this.isTreeAnimating=!!(this.parent&&this.parent.isTreeAnimating||this.currentAnimation||this.pendingAnimation),this.isTreeAnimating||(this.targetDelta=this.relativeTarget=void 0),!this.layout||!(u||d))return;oe(this.layoutCorrected,this.layout.layoutBox);const p=this.treeScale.x,y=this.treeScale.y;Gh(this.layoutCorrected,this.treeScale,this.path,c),a.layout&&!a.target&&(this.treeScale.x!==1||this.treeScale.y!==1)&&(a.target=a.layout.layoutBox,a.targetWithTransforms=U());const{target:g}=a;if(!g){this.prevProjectionDelta&&(this.createProjectionDeltas(),this.scheduleRender());return}!this.projectionDelta||!this.prevProjectionDelta?this.createProjectionDeltas():(Fs(this.prevProjectionDelta.x,this.projectionDelta.x),Fs(this.prevProjectionDelta.y,this.projectionDelta.y)),At(this.projectionDelta,this.layoutCorrected,g,this.latestValues),(this.treeScale.x!==p||this.treeScale.y!==y||!$s(this.projectionDelta.x,this.prevProjectionDelta.x)||!$s(this.projectionDelta.y,this.prevProjectionDelta.y))&&(this.hasProjected=!0,this.scheduleRender(),this.notifyListeners("projectionUpdate",g)),wt&&_e.recalculatedProjection++}hide(){this.isVisible=!1}show(){this.isVisible=!0}scheduleRender(i=!0){var a;if((a=this.options.visualElement)===null||a===void 0||a.scheduleRender(),i){const c=this.getStack();c&&c.scheduleRender()}this.resumingFrom&&!this.resumingFrom.instance&&(this.resumingFrom=void 0)}createProjectionDeltas(){this.prevProjectionDelta=Je(),this.projectionDelta=Je(),this.projectionDeltaWithTransform=Je()}setAnimationOrigin(i,a=!1){const c=this.snapshot,l=c?c.latestValues:{},u={...this.latestValues},d=Je();(!this.relativeParent||!this.relativeParent.options.layoutRoot)&&(this.relativeTarget=this.relativeTargetOrigin=void 0),this.attemptToResolveRelativeTarget=!a;const p=U(),y=c?c.source:void 0,g=this.layout?this.layout.source:void 0,m=y!==g,v=this.getStack(),k=!v||v.members.length<=1,x=!!(m&&!k&&this.options.crossfade===!0&&!this.path.some(L2));this.animationProgress=0;let M;this.mixTargetDelta=C=>{const w=C/1e3;Zs(d.x,i.x,w),Zs(d.y,i.y,w),this.setTargetDelta(d),this.relativeTarget&&this.relativeTargetOrigin&&this.layout&&this.relativeParent&&this.relativeParent.layout&&(Pt(p,this.layout.layoutBox,this.relativeParent.layout.layoutBox),D2(this.relativeTarget,this.relativeTargetOrigin,p,w),M&&y2(this.relativeTarget,M)&&(this.isProjectionDirty=!1),M||(M=U()),oe(M,this.relativeTarget)),m&&(this.animationValues=u,l2(u,l,this.latestValues,w,x,k)),this.root.scheduleUpdateProjection(),this.scheduleRender(),this.animationProgress=w},this.mixTargetDelta(this.options.layoutRoot?1e3:0)}startAnimation(i){this.notifyListeners("animationStart"),this.currentAnimation&&this.currentAnimation.stop(),this.resumingFrom&&this.resumingFrom.currentAnimation&&this.resumingFrom.currentAnimation.stop(),this.pendingAnimation&&(Re(this.pendingAnimation),this.pendingAnimation=void 0),this.pendingAnimation=z.update(()=>{sn.hasAnimatedSinceResize=!0,this.currentAnimation=r2(0,Ws,{...i,onUpdate:a=>{this.mixTargetDelta(a),i.onUpdate&&i.onUpdate(a)},onComplete:()=>{i.onComplete&&i.onComplete(),this.completeAnimation()}}),this.resumingFrom&&(this.resumingFrom.currentAnimation=this.currentAnimation),this.pendingAnimation=void 0})}completeAnimation(){this.resumingFrom&&(this.resumingFrom.currentAnimation=void 0,this.resumingFrom.preserveOpacity=void 0);const i=this.getStack();i&&i.exitAnimationComplete(),this.resumingFrom=this.currentAnimation=this.animationValues=void 0,this.notifyListeners("animationComplete")}finishAnimation(){this.currentAnimation&&(this.mixTargetDelta&&this.mixTargetDelta(Ws),this.currentAnimation.stop()),this.completeAnimation()}applyTransformsToTarget(){const i=this.getLead();let{targetWithTransforms:a,target:c,layout:l,latestValues:u}=i;if(!(!a||!c||!l)){if(this!==i&&this.layout&&l&&ic(this.options.animationType,this.layout.layoutBox,l.layoutBox)){c=this.target||U();const d=ne(this.layout.layoutBox.x);c.x.min=i.target.x.min,c.x.max=c.x.min+d;const p=ne(this.layout.layoutBox.y);c.y.min=i.target.y.min,c.y.max=c.y.min+p}oe(a,c),tt(a,u),At(this.projectionDeltaWithTransform,this.layoutCorrected,a,u)}}registerSharedNode(i,a){this.sharedNodes.has(i)||this.sharedNodes.set(i,new m2),this.sharedNodes.get(i).add(a);const l=a.options.initialPromotionConfig;a.promote({transition:l?l.transition:void 0,preserveFollowOpacity:l&&l.shouldPreserveFollowOpacity?l.shouldPreserveFollowOpacity(a):void 0})}isLead(){const i=this.getStack();return i?i.lead===this:!0}getLead(){var i;const{layoutId:a}=this.options;return a?((i=this.getStack())===null||i===void 0?void 0:i.lead)||this:this}getPrevLead(){var i;const{layoutId:a}=this.options;return a?(i=this.getStack())===null||i===void 0?void 0:i.prevLead:void 0}getStack(){const{layoutId:i}=this.options;if(i)return this.root.sharedNodes.get(i)}promote({needsReset:i,transition:a,preserveFollowOpacity:c}={}){const l=this.getStack();l&&l.promote(this,c),i&&(this.projectionDelta=void 0,this.needsReset=!0),a&&this.setOptions({transition:a})}relegate(){const i=this.getStack();return i?i.relegate(this):!1}resetSkewAndRotation(){const{visualElement:i}=this.options;if(!i)return;let a=!1;const{latestValues:c}=i;if((c.z||c.rotate||c.rotateX||c.rotateY||c.rotateZ||c.skewX||c.skewY)&&(a=!0),!a)return;const l={};c.z&&Yn("z",i,l,this.animationValues);for(let u=0;u<Xn.length;u++)Yn(`rotate${Xn[u]}`,i,l,this.animationValues),Yn(`skew${Xn[u]}`,i,l,this.animationValues);i.render();for(const u in l)i.setStaticValue(u,l[u]),this.animationValues&&(this.animationValues[u]=l[u]);i.scheduleRender()}getProjectionStyles(i){var a,c;if(!this.instance||this.isSVG)return;if(!this.isVisible)return v2;const l={visibility:""},u=this.getTransformTemplate();if(this.needsReset)return this.needsReset=!1,l.opacity="",l.pointerEvents=rn(i==null?void 0:i.pointerEvents)||"",l.transform=u?u(this.latestValues,""):"none",l;const d=this.getLead();if(!this.projectionDelta||!this.layout||!d.target){const m={};return this.options.layoutId&&(m.opacity=this.latestValues.opacity!==void 0?this.latestValues.opacity:1,m.pointerEvents=rn(i==null?void 0:i.pointerEvents)||""),this.hasProjected&&!Ne(this.latestValues)&&(m.transform=u?u({},""):"none",this.hasProjected=!1),m}const p=d.animationValues||d.latestValues;this.applyTransformsToTarget(),l.transform=g2(this.projectionDeltaWithTransform,this.treeScale,p),u&&(l.transform=u(p,l.transform));const{x:y,y:g}=this.projectionDelta;l.transformOrigin=`${y.origin*100}% ${g.origin*100}% 0`,d.animationValues?l.opacity=d===this?(c=(a=p.opacity)!==null&&a!==void 0?a:this.latestValues.opacity)!==null&&c!==void 0?c:1:this.preserveOpacity?this.latestValues.opacity:p.opacityExit:l.opacity=d===this?p.opacity!==void 0?p.opacity:"":p.opacityExit!==void 0?p.opacityExit:0;for(const m in dn){if(p[m]===void 0)continue;const{correct:v,applyTo:k}=dn[m],x=l.transform==="none"?p[m]:v(p[m],d);if(k){const M=k.length;for(let C=0;C<M;C++)l[k[C]]=x}else l[m]=x}return this.options.layoutId&&(l.pointerEvents=d===this?rn(i==null?void 0:i.pointerEvents)||"":"none"),l}clearSnapshot(){this.resumeFrom=this.snapshot=void 0}resetTree(){this.root.nodes.forEach(i=>{var a;return(a=i.currentAnimation)===null||a===void 0?void 0:a.stop()}),this.root.nodes.forEach(Gs),this.root.sharedNodes.clear()}}}function x2(e){e.updateLayout()}function M2(e){var t;const n=((t=e.resumeFrom)===null||t===void 0?void 0:t.snapshot)||e.snapshot;if(e.isLead()&&e.layout&&n&&e.hasListeners("didUpdate")){const{layoutBox:r,measuredBox:o}=e.layout,{animationType:s}=e.options,i=n.source!==e.layout.source;s==="size"?se(d=>{const p=i?n.measuredBox[d]:n.layoutBox[d],y=ne(p);p.min=r[d].min,p.max=p.min+y}):ic(s,n.layoutBox,r)&&se(d=>{const p=i?n.measuredBox[d]:n.layoutBox[d],y=ne(r[d]);p.max=p.min+y,e.relativeTarget&&!e.currentAnimation&&(e.isProjectionDirty=!0,e.relativeTarget[d].max=e.relativeTarget[d].min+y)});const a=Je();At(a,r,n.layoutBox);const c=Je();i?At(c,e.applyTransform(o,!0),n.measuredBox):At(c,r,n.layoutBox);const l=!nc(a);let u=!1;if(!e.resumeFrom){const d=e.getClosestProjectingParent();if(d&&!d.resumeFrom){const{snapshot:p,layout:y}=d;if(p&&y){const g=U();Pt(g,n.layoutBox,p.layoutBox);const m=U();Pt(m,r,y.layoutBox),rc(g,m)||(u=!0),d.options.layoutRoot&&(e.relativeTarget=m,e.relativeTargetOrigin=g,e.relativeParent=d)}}}e.notifyListeners("didUpdate",{layout:r,snapshot:n,delta:c,layoutDelta:a,hasLayoutChanged:l,hasRelativeTargetChanged:u})}else if(e.isLead()){const{onExitComplete:r}=e.options;r&&r()}e.options.transition=void 0}function w2(e){wt&&_e.totalNodes++,e.parent&&(e.isProjecting()||(e.isProjectionDirty=e.parent.isProjectionDirty),e.isSharedProjectionDirty||(e.isSharedProjectionDirty=!!(e.isProjectionDirty||e.parent.isProjectionDirty||e.parent.isSharedProjectionDirty)),e.isTransformDirty||(e.isTransformDirty=e.parent.isTransformDirty))}function b2(e){e.isProjectionDirty=e.isSharedProjectionDirty=e.isTransformDirty=!1}function C2(e){e.clearSnapshot()}function Gs(e){e.clearMeasurements()}function S2(e){e.isLayoutDirty=!1}function A2(e){const{visualElement:t}=e.options;t&&t.getProps().onBeforeLayoutMeasure&&t.notify("BeforeLayoutMeasure"),e.resetTransform()}function Ks(e){e.finishAnimation(),e.targetDelta=e.relativeTarget=e.target=void 0,e.isProjectionDirty=!0}function P2(e){e.resolveTargetDelta()}function T2(e){e.calcProjection()}function R2(e){e.resetSkewAndRotation()}function E2(e){e.removeLeadSnapshot()}function Zs(e,t,n){e.translate=H(t.translate,0,n),e.scale=H(t.scale,1,n),e.origin=t.origin,e.originPoint=t.originPoint}function Xs(e,t,n,r){e.min=H(t.min,n.min,r),e.max=H(t.max,n.max,r)}function D2(e,t,n,r){Xs(e.x,t.x,n.x,r),Xs(e.y,t.y,n.y,r)}function L2(e){return e.animationValues&&e.animationValues.opacityExit!==void 0}const V2={duration:.45,ease:[.4,0,.1,1]},Ys=e=>typeof navigator<"u"&&navigator.userAgent&&navigator.userAgent.toLowerCase().includes(e),Qs=Ys("applewebkit/")&&!Ys("chrome/")?Math.round:ee;function Js(e){e.min=Qs(e.min),e.max=Qs(e.max)}function O2(e){Js(e.x),Js(e.y)}function ic(e,t,n){return e==="position"||e==="preserve-aspect"&&!Fh(Us(t),Us(n),.2)}function j2(e){var t;return e!==e.root&&((t=e.scroll)===null||t===void 0?void 0:t.wasRoot)}const I2=sc({attachResizeListener:(e,t)=>Lt(e,"resize",t),measureScroll:()=>({x:document.documentElement.scrollLeft||document.body.scrollLeft,y:document.documentElement.scrollTop||document.body.scrollTop}),checkIsScrollRoot:()=>!0}),Qn={current:void 0},ac=sc({measureScroll:e=>({x:e.scrollLeft,y:e.scrollTop}),defaultParent:()=>{if(!Qn.current){const e=new I2({});e.mount(window),e.setOptions({layoutScroll:!0}),Qn.current=e}return Qn.current},resetTransform:(e,t)=>{e.style.transform=t!==void 0?t:"none"},checkIsScrollRoot:e=>window.getComputedStyle(e).position==="fixed"}),F2={pan:{Feature:Jh},drag:{Feature:Qh,ProjectionNode:ac,MeasureLayout:Ja}};function ei(e,t,n){const{props:r}=e;e.animationState&&r.whileHover&&e.animationState.setActive("whileHover",n==="Start");const o="onHover"+n,s=r[o];s&&z.postRender(()=>s(t,Bt(t)))}class N2 extends Oe{mount(){const{current:t}=this.node;t&&(this.unmount=Fu(t,n=>(ei(this.node,n,"Start"),r=>ei(this.node,r,"End"))))}unmount(){}}class _2 extends Oe{constructor(){super(...arguments),this.isActive=!1}onFocus(){let t=!1;try{t=this.node.current.matches(":focus-visible")}catch{t=!0}!t||!this.node.animationState||(this.node.animationState.setActive("whileFocus",!0),this.isActive=!0)}onBlur(){!this.isActive||!this.node.animationState||(this.node.animationState.setActive("whileFocus",!1),this.isActive=!1)}mount(){this.unmount=_t(Lt(this.node.current,"focus",()=>this.onFocus()),Lt(this.node.current,"blur",()=>this.onBlur()))}unmount(){}}function ti(e,t,n){const{props:r}=e;e.animationState&&r.whileTap&&e.animationState.setActive("whileTap",n==="Start");const o="onTap"+(n==="End"?"":n),s=r[o];s&&z.postRender(()=>s(t,Bt(t)))}class B2 extends Oe{mount(){const{current:t}=this.node;t&&(this.unmount=zu(t,n=>(ti(this.node,n,"Start"),(r,{success:o})=>ti(this.node,r,o?"End":"Cancel")),{useGlobalTarget:this.node.props.globalTapTarget}))}unmount(){}}const Sr=new WeakMap,Jn=new WeakMap,z2=e=>{const t=Sr.get(e.target);t&&t(e)},H2=e=>{e.forEach(z2)};function q2({root:e,...t}){const n=e||document;Jn.has(n)||Jn.set(n,{});const r=Jn.get(n),o=JSON.stringify(t);return r[o]||(r[o]=new IntersectionObserver(H2,{root:e,...t})),r[o]}function U2(e,t,n){const r=q2(t);return Sr.set(e,n),r.observe(e),()=>{Sr.delete(e),r.unobserve(e)}}const $2={some:0,all:1};class W2 extends Oe{constructor(){super(...arguments),this.hasEnteredView=!1,this.isInView=!1}startObserver(){this.unmount();const{viewport:t={}}=this.node.getProps(),{root:n,margin:r,amount:o="some",once:s}=t,i={root:n?n.current:void 0,rootMargin:r,threshold:typeof o=="number"?o:$2[o]},a=c=>{const{isIntersecting:l}=c;if(this.isInView===l||(this.isInView=l,s&&!l&&this.hasEnteredView))return;l&&(this.hasEnteredView=!0),this.node.animationState&&this.node.animationState.setActive("whileInView",l);const{onViewportEnter:u,onViewportLeave:d}=this.node.getProps(),p=l?u:d;p&&p(c)};return U2(this.node.current,i,a)}mount(){this.startObserver()}update(){if(typeof IntersectionObserver>"u")return;const{props:t,prevProps:n}=this.node;["amount","margin","root"].some(G2(t,n))&&this.startObserver()}unmount(){}}function G2({viewport:e={}},{viewport:t={}}={}){return n=>e[n]!==t[n]}const K2={inView:{Feature:W2},tap:{Feature:B2},focus:{Feature:_2},hover:{Feature:N2}},Z2={layout:{ProjectionNode:ac,MeasureLayout:Ja}},gn={current:null},yo={current:!1};function cc(){if(yo.current=!0,!!Fr)if(window.matchMedia){const e=window.matchMedia("(prefers-reduced-motion)"),t=()=>gn.current=e.matches;e.addListener(t),t()}else gn.current=!1}const X2=[...Va,Z,Ee],Y2=e=>X2.find(La(e)),ni=new WeakMap;function Q2(e,t,n){for(const r in t){const o=t[r],s=n[r];if(X(o))e.addValue(r,o);else if(X(s))e.addValue(r,Et(o,{owner:e}));else if(s!==o)if(e.hasValue(r)){const i=e.getValue(r);i.liveStyle===!0?i.jump(o):i.hasAnimated||i.set(o)}else{const i=e.getStaticValue(r);e.addValue(r,Et(i!==void 0?i:o,{owner:e}))}}for(const r in n)t[r]===void 0&&e.removeValue(r);return t}const ri=["AnimationStart","AnimationComplete","Update","BeforeLayoutMeasure","LayoutMeasure","LayoutAnimationStart","LayoutAnimationComplete"];class J2{scrapeMotionValuesFromProps(t,n,r){return{}}constructor({parent:t,props:n,presenceContext:r,reducedMotionConfig:o,blockInitialAnimation:s,visualState:i},a={}){this.current=null,this.children=new Set,this.isVariantNode=!1,this.isControllingVariants=!1,this.shouldReduceMotion=null,this.values=new Map,this.KeyframeResolver=uo,this.features={},this.valueSubscriptions=new Map,this.prevMotionValues={},this.events={},this.propEventSubscriptions={},this.notifyUpdate=()=>this.notify("Update",this.latestValues),this.render=()=>{this.current&&(this.triggerBuild(),this.renderInstance(this.current,this.renderState,this.props.style,this.projection))},this.renderScheduledAt=0,this.scheduleRender=()=>{const y=pe.now();this.renderScheduledAt<y&&(this.renderScheduledAt=y,z.render(this.render,!1,!0))};const{latestValues:c,renderState:l,onUpdate:u}=i;this.onUpdate=u,this.latestValues=c,this.baseTarget={...c},this.initialValues=n.initial?{...c}:{},this.renderState=l,this.parent=t,this.props=n,this.presenceContext=r,this.depth=t?t.depth+1:0,this.reducedMotionConfig=o,this.options=a,this.blockInitialAnimation=!!s,this.isControllingVariants=Rn(n),this.isVariantNode=zi(n),this.isVariantNode&&(this.variantChildren=new Set),this.manuallyAnimateOnMount=!!(t&&t.current);const{willChange:d,...p}=this.scrapeMotionValuesFromProps(n,{},this);for(const y in p){const g=p[y];c[y]!==void 0&&X(g)&&g.set(c[y],!1)}}mount(t){this.current=t,ni.set(t,this),this.projection&&!this.projection.instance&&this.projection.mount(t),this.parent&&this.isVariantNode&&!this.isControllingVariants&&(this.removeFromVariantTree=this.parent.addVariantChild(this)),this.values.forEach((n,r)=>this.bindToMotionValue(r,n)),yo.current||cc(),this.shouldReduceMotion=this.reducedMotionConfig==="never"?!1:this.reducedMotionConfig==="always"?!0:gn.current,this.parent&&this.parent.children.add(this),this.update(this.props,this.presenceContext)}unmount(){ni.delete(this.current),this.projection&&this.projection.unmount(),Re(this.notifyUpdate),Re(this.render),this.valueSubscriptions.forEach(t=>t()),this.valueSubscriptions.clear(),this.removeFromVariantTree&&this.removeFromVariantTree(),this.parent&&this.parent.children.delete(this);for(const t in this.events)this.events[t].clear();for(const t in this.features){const n=this.features[t];n&&(n.unmount(),n.isMounted=!1)}this.current=null}bindToMotionValue(t,n){this.valueSubscriptions.has(t)&&this.valueSubscriptions.get(t)();const r=$e.has(t),o=n.on("change",a=>{this.latestValues[t]=a,this.props.onUpdate&&z.preRender(this.notifyUpdate),r&&this.projection&&(this.projection.isTransformDirty=!0)}),s=n.on("renderRequest",this.scheduleRender);let i;window.MotionCheckAppearSync&&(i=window.MotionCheckAppearSync(this,t,n)),this.valueSubscriptions.set(t,()=>{o(),s(),i&&i(),n.owner&&n.stop()})}sortNodePosition(t){return!this.current||!this.sortInstanceNodePosition||this.type!==t.type?0:this.sortInstanceNodePosition(this.current,t.current)}updateFeatures(){let t="animation";for(t in it){const n=it[t];if(!n)continue;const{isEnabled:r,Feature:o}=n;if(!this.features[t]&&o&&r(this.props)&&(this.features[t]=new o(this)),this.features[t]){const s=this.features[t];s.isMounted?s.update():(s.mount(),s.isMounted=!0)}}}triggerBuild(){this.build(this.renderState,this.latestValues,this.props)}measureViewportBox(){return this.current?this.measureInstanceViewportBox(this.current,this.props):U()}getStaticValue(t){return this.latestValues[t]}setStaticValue(t,n){this.latestValues[t]=n}update(t,n){(t.transformTemplate||this.props.transformTemplate)&&this.scheduleRender(),this.prevProps=this.props,this.props=t,this.prevPresenceContext=this.presenceContext,this.presenceContext=n;for(let r=0;r<ri.length;r++){const o=ri[r];this.propEventSubscriptions[o]&&(this.propEventSubscriptions[o](),delete this.propEventSubscriptions[o]);const s="on"+o,i=t[s];i&&(this.propEventSubscriptions[o]=this.on(o,i))}this.prevMotionValues=Q2(this,this.scrapeMotionValuesFromProps(t,this.prevProps,this),this.prevMotionValues),this.handleChildMotionValue&&this.handleChildMotionValue(),this.onUpdate&&this.onUpdate(this)}getProps(){return this.props}getVariant(t){return this.props.variants?this.props.variants[t]:void 0}getDefaultTransition(){return this.props.transition}getTransformPagePoint(){return this.props.transformPagePoint}getClosestVariantNode(){return this.isVariantNode?this:this.parent?this.parent.getClosestVariantNode():void 0}addVariantChild(t){const n=this.getClosestVariantNode();if(n)return n.variantChildren&&n.variantChildren.add(t),()=>n.variantChildren.delete(t)}addValue(t,n){const r=this.values.get(t);n!==r&&(r&&this.removeValue(t),this.bindToMotionValue(t,n),this.values.set(t,n),this.latestValues[t]=n.get())}removeValue(t){this.values.delete(t);const n=this.valueSubscriptions.get(t);n&&(n(),this.valueSubscriptions.delete(t)),delete this.latestValues[t],this.removeValueFromRenderState(t,this.renderState)}hasValue(t){return this.values.has(t)}getValue(t,n){if(this.props.values&&this.props.values[t])return this.props.values[t];let r=this.values.get(t);return r===void 0&&n!==void 0&&(r=Et(n===null?void 0:n,{owner:this}),this.addValue(t,r)),r}readValue(t,n){var r;let o=this.latestValues[t]!==void 0||!this.current?this.latestValues[t]:(r=this.getBaseTargetFromProps(this.props,t))!==null&&r!==void 0?r:this.readValueFromInstance(this.current,t,this.options);return o!=null&&(typeof o=="string"&&(Ea(o)||Ma(o))?o=parseFloat(o):!Y2(o)&&Ee.test(n)&&(o=Pa(t,n)),this.setBaseTarget(t,X(o)?o.get():o)),X(o)?o.get():o}setBaseTarget(t,n){this.baseTarget[t]=n}getBaseTarget(t){var n;const{initial:r}=this.props;let o;if(typeof r=="string"||typeof r=="object"){const i=Ur(this.props,r,(n=this.presenceContext)===null||n===void 0?void 0:n.custom);i&&(o=i[t])}if(r&&o!==void 0)return o;const s=this.getBaseTargetFromProps(this.props,t);return s!==void 0&&!X(s)?s:this.initialValues[t]!==void 0&&o===void 0?void 0:this.baseTarget[t]}on(t,n){return this.events[t]||(this.events[t]=new oo),this.events[t].add(n)}notify(t,...n){this.events[t]&&this.events[t].notify(...n)}}class lc extends J2{constructor(){super(...arguments),this.KeyframeResolver=Oa}sortInstanceNodePosition(t,n){return t.compareDocumentPosition(n)&2?1:-1}getBaseTargetFromProps(t,n){return t.style?t.style[n]:void 0}removeValueFromRenderState(t,{vars:n,style:r}){delete n[t],delete r[t]}handleChildMotionValue(){this.childSubscription&&(this.childSubscription(),delete this.childSubscription);const{children:t}=this.props;X(t)&&(this.childSubscription=t.on("change",n=>{this.current&&(this.current.textContent=`${n}`)}))}}function e0(e){return window.getComputedStyle(e)}class t0 extends lc{constructor(){super(...arguments),this.type="html",this.renderInstance=Xi}readValueFromInstance(t,n){if($e.has(n)){const r=lo(n);return r&&r.default||0}else{const r=e0(t),o=(Gi(n)?r.getPropertyValue(n):r[n])||0;return typeof o=="string"?o.trim():o}}measureInstanceViewportBox(t,{transformPagePoint:n}){return Ya(t,n)}build(t,n,r){Gr(t,n,r.transformTemplate)}scrapeMotionValuesFromProps(t,n,r){return Yr(t,n,r)}}class n0 extends lc{constructor(){super(...arguments),this.type="svg",this.isSVGTag=!1,this.measureInstanceViewportBox=U}getBaseTargetFromProps(t,n){return t[n]}readValueFromInstance(t,n){if($e.has(n)){const r=lo(n);return r&&r.default||0}return n=Yi.has(n)?n:zr(n),t.getAttribute(n)}scrapeMotionValuesFromProps(t,n,r){return ea(t,n,r)}build(t,n,r){Kr(t,n,this.isSVGTag,r.transformTemplate)}renderInstance(t,n,r,o){Qi(t,n,r,o)}mount(t){this.isSVGTag=Xr(t.tagName),super.mount(t)}}const r0=(e,t)=>qr(e)?new n0(t):new t0(t,{allowProjection:e!==f.Fragment}),o0=Eu({...Th,...K2,...F2,...Z2},r0),t3=$1(o0);function n3(){!yo.current&&cc();const[e]=f.useState(gn.current);return e}var s0=f.createContext(void 0);function uc(e){const t=f.useContext(s0);return e||t||"ltr"}var er=0;function dc(){f.useEffect(()=>{const e=document.querySelectorAll("[data-radix-focus-guard]");return document.body.insertAdjacentElement("afterbegin",e[0]??oi()),document.body.insertAdjacentElement("beforeend",e[1]??oi()),er++,()=>{er===1&&document.querySelectorAll("[data-radix-focus-guard]").forEach(t=>t.remove()),er--}},[])}function oi(){const e=document.createElement("span");return e.setAttribute("data-radix-focus-guard",""),e.tabIndex=0,e.style.outline="none",e.style.opacity="0",e.style.position="fixed",e.style.pointerEvents="none",e}var tr="focusScope.autoFocusOnMount",nr="focusScope.autoFocusOnUnmount",si={bubbles:!1,cancelable:!0},i0="FocusScope",mo=f.forwardRef((e,t)=>{const{loop:n=!1,trapped:r=!1,onMountAutoFocus:o,onUnmountAutoFocus:s,...i}=e,[a,c]=f.useState(null),l=Me(o),u=Me(s),d=f.useRef(null),p=K(t,m=>c(m)),y=f.useRef({paused:!1,pause(){this.paused=!0},resume(){this.paused=!1}}).current;f.useEffect(()=>{if(r){let m=function(M){if(y.paused||!a)return;const C=M.target;a.contains(C)?d.current=C:Ae(d.current,{select:!0})},v=function(M){if(y.paused||!a)return;const C=M.relatedTarget;C!==null&&(a.contains(C)||Ae(d.current,{select:!0}))},k=function(M){if(document.activeElement===document.body)for(const w of M)w.removedNodes.length>0&&Ae(a)};document.addEventListener("focusin",m),document.addEventListener("focusout",v);const x=new MutationObserver(k);return a&&x.observe(a,{childList:!0,subtree:!0}),()=>{document.removeEventListener("focusin",m),document.removeEventListener("focusout",v),x.disconnect()}}},[r,a,y.paused]),f.useEffect(()=>{if(a){ai.add(y);const m=document.activeElement;if(!a.contains(m)){const k=new CustomEvent(tr,si);a.addEventListener(tr,l),a.dispatchEvent(k),k.defaultPrevented||(a0(h0(hc(a)),{select:!0}),document.activeElement===m&&Ae(a))}return()=>{a.removeEventListener(tr,l),setTimeout(()=>{const k=new CustomEvent(nr,si);a.addEventListener(nr,u),a.dispatchEvent(k),k.defaultPrevented||Ae(m??document.body,{select:!0}),a.removeEventListener(nr,u),ai.remove(y)},0)}}},[a,l,u,y]);const g=f.useCallback(m=>{if(!n&&!r||y.paused)return;const v=m.key==="Tab"&&!m.altKey&&!m.ctrlKey&&!m.metaKey,k=document.activeElement;if(v&&k){const x=m.currentTarget,[M,C]=c0(x);M&&C?!m.shiftKey&&k===C?(m.preventDefault(),n&&Ae(M,{select:!0})):m.shiftKey&&k===M&&(m.preventDefault(),n&&Ae(C,{select:!0})):k===x&&m.preventDefault()}},[n,r,y.paused]);return b.jsx($.div,{tabIndex:-1,...i,ref:p,onKeyDown:g})});mo.displayName=i0;function a0(e,{select:t=!1}={}){const n=document.activeElement;for(const r of e)if(Ae(r,{select:t}),document.activeElement!==n)return}function c0(e){const t=hc(e),n=ii(t,e),r=ii(t.reverse(),e);return[n,r]}function hc(e){const t=[],n=document.createTreeWalker(e,NodeFilter.SHOW_ELEMENT,{acceptNode:r=>{const o=r.tagName==="INPUT"&&r.type==="hidden";return r.disabled||r.hidden||o?NodeFilter.FILTER_SKIP:r.tabIndex>=0?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP}});for(;n.nextNode();)t.push(n.currentNode);return t}function ii(e,t){for(const n of e)if(!l0(n,{upTo:t}))return n}function l0(e,{upTo:t}){if(getComputedStyle(e).visibility==="hidden")return!0;for(;e;){if(t!==void 0&&e===t)return!1;if(getComputedStyle(e).display==="none")return!0;e=e.parentElement}return!1}function u0(e){return e instanceof HTMLInputElement&&"select"in e}function Ae(e,{select:t=!1}={}){if(e&&e.focus){const n=document.activeElement;e.focus({preventScroll:!0}),e!==n&&u0(e)&&t&&e.select()}}var ai=d0();function d0(){let e=[];return{add(t){const n=e[0];t!==n&&(n==null||n.pause()),e=ci(e,t),e.unshift(t)},remove(t){var n;e=ci(e,t),(n=e[0])==null||n.resume()}}}function ci(e,t){const n=[...e],r=n.indexOf(t);return r!==-1&&n.splice(r,1),n}function h0(e){return e.filter(t=>t.tagName!=="A")}var f0=Pi[" useId ".trim().toString()]||(()=>{}),p0=0;function nt(e){const[t,n]=f.useState(f0());return Te(()=>{n(r=>r??String(p0++))},[e]),t?`radix-${t}`:""}const y0=["top","right","bottom","left"],De=Math.min,J=Math.max,vn=Math.round,Qt=Math.floor,ye=e=>({x:e,y:e}),m0={left:"right",right:"left",bottom:"top",top:"bottom"},g0={start:"end",end:"start"};function Ar(e,t,n){return J(e,De(t,n))}function be(e,t){return typeof e=="function"?e(t):e}function Ce(e){return e.split("-")[0]}function ht(e){return e.split("-")[1]}function go(e){return e==="x"?"y":"x"}function vo(e){return e==="y"?"height":"width"}const v0=new Set(["top","bottom"]);function he(e){return v0.has(Ce(e))?"y":"x"}function ko(e){return go(he(e))}function k0(e,t,n){n===void 0&&(n=!1);const r=ht(e),o=ko(e),s=vo(o);let i=o==="x"?r===(n?"end":"start")?"right":"left":r==="start"?"bottom":"top";return t.reference[s]>t.floating[s]&&(i=kn(i)),[i,kn(i)]}function x0(e){const t=kn(e);return[Pr(e),t,Pr(t)]}function Pr(e){return e.replace(/start|end/g,t=>g0[t])}const li=["left","right"],ui=["right","left"],M0=["top","bottom"],w0=["bottom","top"];function b0(e,t,n){switch(e){case"top":case"bottom":return n?t?ui:li:t?li:ui;case"left":case"right":return t?M0:w0;default:return[]}}function C0(e,t,n,r){const o=ht(e);let s=b0(Ce(e),n==="start",r);return o&&(s=s.map(i=>i+"-"+o),t&&(s=s.concat(s.map(Pr)))),s}function kn(e){return e.replace(/left|right|bottom|top/g,t=>m0[t])}function S0(e){return{top:0,right:0,bottom:0,left:0,...e}}function fc(e){return typeof e!="number"?S0(e):{top:e,right:e,bottom:e,left:e}}function xn(e){const{x:t,y:n,width:r,height:o}=e;return{width:r,height:o,top:n,left:t,right:t+r,bottom:n+o,x:t,y:n}}function di(e,t,n){let{reference:r,floating:o}=e;const s=he(t),i=ko(t),a=vo(i),c=Ce(t),l=s==="y",u=r.x+r.width/2-o.width/2,d=r.y+r.height/2-o.height/2,p=r[a]/2-o[a]/2;let y;switch(c){case"top":y={x:u,y:r.y-o.height};break;case"bottom":y={x:u,y:r.y+r.height};break;case"right":y={x:r.x+r.width,y:d};break;case"left":y={x:r.x-o.width,y:d};break;default:y={x:r.x,y:r.y}}switch(ht(t)){case"start":y[i]-=p*(n&&l?-1:1);break;case"end":y[i]+=p*(n&&l?-1:1);break}return y}const A0=async(e,t,n)=>{const{placement:r="bottom",strategy:o="absolute",middleware:s=[],platform:i}=n,a=s.filter(Boolean),c=await(i.isRTL==null?void 0:i.isRTL(t));let l=await i.getElementRects({reference:e,floating:t,strategy:o}),{x:u,y:d}=di(l,r,c),p=r,y={},g=0;for(let m=0;m<a.length;m++){const{name:v,fn:k}=a[m],{x,y:M,data:C,reset:w}=await k({x:u,y:d,initialPlacement:r,placement:p,strategy:o,middlewareData:y,rects:l,platform:i,elements:{reference:e,floating:t}});u=x??u,d=M??d,y={...y,[v]:{...y[v],...C}},w&&g<=50&&(g++,typeof w=="object"&&(w.placement&&(p=w.placement),w.rects&&(l=w.rects===!0?await i.getElementRects({reference:e,floating:t,strategy:o}):w.rects),{x:u,y:d}=di(l,p,c)),m=-1)}return{x:u,y:d,placement:p,strategy:o,middlewareData:y}};async function Vt(e,t){var n;t===void 0&&(t={});const{x:r,y:o,platform:s,rects:i,elements:a,strategy:c}=e,{boundary:l="clippingAncestors",rootBoundary:u="viewport",elementContext:d="floating",altBoundary:p=!1,padding:y=0}=be(t,e),g=fc(y),v=a[p?d==="floating"?"reference":"floating":d],k=xn(await s.getClippingRect({element:(n=await(s.isElement==null?void 0:s.isElement(v)))==null||n?v:v.contextElement||await(s.getDocumentElement==null?void 0:s.getDocumentElement(a.floating)),boundary:l,rootBoundary:u,strategy:c})),x=d==="floating"?{x:r,y:o,width:i.floating.width,height:i.floating.height}:i.reference,M=await(s.getOffsetParent==null?void 0:s.getOffsetParent(a.floating)),C=await(s.isElement==null?void 0:s.isElement(M))?await(s.getScale==null?void 0:s.getScale(M))||{x:1,y:1}:{x:1,y:1},w=xn(s.convertOffsetParentRelativeRectToViewportRelativeRect?await s.convertOffsetParentRelativeRectToViewportRelativeRect({elements:a,rect:x,offsetParent:M,strategy:c}):x);return{top:(k.top-w.top+g.top)/C.y,bottom:(w.bottom-k.bottom+g.bottom)/C.y,left:(k.left-w.left+g.left)/C.x,right:(w.right-k.right+g.right)/C.x}}const P0=e=>({name:"arrow",options:e,async fn(t){const{x:n,y:r,placement:o,rects:s,platform:i,elements:a,middlewareData:c}=t,{element:l,padding:u=0}=be(e,t)||{};if(l==null)return{};const d=fc(u),p={x:n,y:r},y=ko(o),g=vo(y),m=await i.getDimensions(l),v=y==="y",k=v?"top":"left",x=v?"bottom":"right",M=v?"clientHeight":"clientWidth",C=s.reference[g]+s.reference[y]-p[y]-s.floating[g],w=p[y]-s.reference[y],S=await(i.getOffsetParent==null?void 0:i.getOffsetParent(l));let A=S?S[M]:0;(!A||!await(i.isElement==null?void 0:i.isElement(S)))&&(A=a.floating[M]||s.floating[g]);const P=C/2-w/2,D=A/2-m[g]/2-1,L=De(d[k],D),j=De(d[x],D),N=L,B=A-m[g]-j,F=A/2-m[g]/2+P,W=Ar(N,F,B),I=!c.arrow&&ht(o)!=null&&F!==W&&s.reference[g]/2-(F<N?L:j)-m[g]/2<0,O=I?F<N?F-N:F-B:0;return{[y]:p[y]+O,data:{[y]:W,centerOffset:F-W-O,...I&&{alignmentOffset:O}},reset:I}}}),T0=function(e){return e===void 0&&(e={}),{name:"flip",options:e,async fn(t){var n,r;const{placement:o,middlewareData:s,rects:i,initialPlacement:a,platform:c,elements:l}=t,{mainAxis:u=!0,crossAxis:d=!0,fallbackPlacements:p,fallbackStrategy:y="bestFit",fallbackAxisSideDirection:g="none",flipAlignment:m=!0,...v}=be(e,t);if((n=s.arrow)!=null&&n.alignmentOffset)return{};const k=Ce(o),x=he(a),M=Ce(a)===a,C=await(c.isRTL==null?void 0:c.isRTL(l.floating)),w=p||(M||!m?[kn(a)]:x0(a)),S=g!=="none";!p&&S&&w.push(...C0(a,m,g,C));const A=[a,...w],P=await Vt(t,v),D=[];let L=((r=s.flip)==null?void 0:r.overflows)||[];if(u&&D.push(P[k]),d){const F=k0(o,i,C);D.push(P[F[0]],P[F[1]])}if(L=[...L,{placement:o,overflows:D}],!D.every(F=>F<=0)){var j,N;const F=(((j=s.flip)==null?void 0:j.index)||0)+1,W=A[F];if(W&&(!(d==="alignment"?x!==he(W):!1)||L.every(R=>he(R.placement)===x?R.overflows[0]>0:!0)))return{data:{index:F,overflows:L},reset:{placement:W}};let I=(N=L.filter(O=>O.overflows[0]<=0).sort((O,R)=>O.overflows[1]-R.overflows[1])[0])==null?void 0:N.placement;if(!I)switch(y){case"bestFit":{var B;const O=(B=L.filter(R=>{if(S){const T=he(R.placement);return T===x||T==="y"}return!0}).map(R=>[R.placement,R.overflows.filter(T=>T>0).reduce((T,_)=>T+_,0)]).sort((R,T)=>R[1]-T[1])[0])==null?void 0:B[0];O&&(I=O);break}case"initialPlacement":I=a;break}if(o!==I)return{reset:{placement:I}}}return{}}}};function hi(e,t){return{top:e.top-t.height,right:e.right-t.width,bottom:e.bottom-t.height,left:e.left-t.width}}function fi(e){return y0.some(t=>e[t]>=0)}const R0=function(e){return e===void 0&&(e={}),{name:"hide",options:e,async fn(t){const{rects:n}=t,{strategy:r="referenceHidden",...o}=be(e,t);switch(r){case"referenceHidden":{const s=await Vt(t,{...o,elementContext:"reference"}),i=hi(s,n.reference);return{data:{referenceHiddenOffsets:i,referenceHidden:fi(i)}}}case"escaped":{const s=await Vt(t,{...o,altBoundary:!0}),i=hi(s,n.floating);return{data:{escapedOffsets:i,escaped:fi(i)}}}default:return{}}}}},pc=new Set(["left","top"]);async function E0(e,t){const{placement:n,platform:r,elements:o}=e,s=await(r.isRTL==null?void 0:r.isRTL(o.floating)),i=Ce(n),a=ht(n),c=he(n)==="y",l=pc.has(i)?-1:1,u=s&&c?-1:1,d=be(t,e);let{mainAxis:p,crossAxis:y,alignmentAxis:g}=typeof d=="number"?{mainAxis:d,crossAxis:0,alignmentAxis:null}:{mainAxis:d.mainAxis||0,crossAxis:d.crossAxis||0,alignmentAxis:d.alignmentAxis};return a&&typeof g=="number"&&(y=a==="end"?g*-1:g),c?{x:y*u,y:p*l}:{x:p*l,y:y*u}}const D0=function(e){return e===void 0&&(e=0),{name:"offset",options:e,async fn(t){var n,r;const{x:o,y:s,placement:i,middlewareData:a}=t,c=await E0(t,e);return i===((n=a.offset)==null?void 0:n.placement)&&(r=a.arrow)!=null&&r.alignmentOffset?{}:{x:o+c.x,y:s+c.y,data:{...c,placement:i}}}}},L0=function(e){return e===void 0&&(e={}),{name:"shift",options:e,async fn(t){const{x:n,y:r,placement:o}=t,{mainAxis:s=!0,crossAxis:i=!1,limiter:a={fn:v=>{let{x:k,y:x}=v;return{x:k,y:x}}},...c}=be(e,t),l={x:n,y:r},u=await Vt(t,c),d=he(Ce(o)),p=go(d);let y=l[p],g=l[d];if(s){const v=p==="y"?"top":"left",k=p==="y"?"bottom":"right",x=y+u[v],M=y-u[k];y=Ar(x,y,M)}if(i){const v=d==="y"?"top":"left",k=d==="y"?"bottom":"right",x=g+u[v],M=g-u[k];g=Ar(x,g,M)}const m=a.fn({...t,[p]:y,[d]:g});return{...m,data:{x:m.x-n,y:m.y-r,enabled:{[p]:s,[d]:i}}}}}},V0=function(e){return e===void 0&&(e={}),{options:e,fn(t){const{x:n,y:r,placement:o,rects:s,middlewareData:i}=t,{offset:a=0,mainAxis:c=!0,crossAxis:l=!0}=be(e,t),u={x:n,y:r},d=he(o),p=go(d);let y=u[p],g=u[d];const m=be(a,t),v=typeof m=="number"?{mainAxis:m,crossAxis:0}:{mainAxis:0,crossAxis:0,...m};if(c){const M=p==="y"?"height":"width",C=s.reference[p]-s.floating[M]+v.mainAxis,w=s.reference[p]+s.reference[M]-v.mainAxis;y<C?y=C:y>w&&(y=w)}if(l){var k,x;const M=p==="y"?"width":"height",C=pc.has(Ce(o)),w=s.reference[d]-s.floating[M]+(C&&((k=i.offset)==null?void 0:k[d])||0)+(C?0:v.crossAxis),S=s.reference[d]+s.reference[M]+(C?0:((x=i.offset)==null?void 0:x[d])||0)-(C?v.crossAxis:0);g<w?g=w:g>S&&(g=S)}return{[p]:y,[d]:g}}}},O0=function(e){return e===void 0&&(e={}),{name:"size",options:e,async fn(t){var n,r;const{placement:o,rects:s,platform:i,elements:a}=t,{apply:c=()=>{},...l}=be(e,t),u=await Vt(t,l),d=Ce(o),p=ht(o),y=he(o)==="y",{width:g,height:m}=s.floating;let v,k;d==="top"||d==="bottom"?(v=d,k=p===(await(i.isRTL==null?void 0:i.isRTL(a.floating))?"start":"end")?"left":"right"):(k=d,v=p==="end"?"top":"bottom");const x=m-u.top-u.bottom,M=g-u.left-u.right,C=De(m-u[v],x),w=De(g-u[k],M),S=!t.middlewareData.shift;let A=C,P=w;if((n=t.middlewareData.shift)!=null&&n.enabled.x&&(P=M),(r=t.middlewareData.shift)!=null&&r.enabled.y&&(A=x),S&&!p){const L=J(u.left,0),j=J(u.right,0),N=J(u.top,0),B=J(u.bottom,0);y?P=g-2*(L!==0||j!==0?L+j:J(u.left,u.right)):A=m-2*(N!==0||B!==0?N+B:J(u.top,u.bottom))}await c({...t,availableWidth:P,availableHeight:A});const D=await i.getDimensions(a.floating);return g!==D.width||m!==D.height?{reset:{rects:!0}}:{}}}};function Ln(){return typeof window<"u"}function ft(e){return yc(e)?(e.nodeName||"").toLowerCase():"#document"}function te(e){var t;return(e==null||(t=e.ownerDocument)==null?void 0:t.defaultView)||window}function ge(e){var t;return(t=(yc(e)?e.ownerDocument:e.document)||window.document)==null?void 0:t.documentElement}function yc(e){return Ln()?e instanceof Node||e instanceof te(e).Node:!1}function ce(e){return Ln()?e instanceof Element||e instanceof te(e).Element:!1}function me(e){return Ln()?e instanceof HTMLElement||e instanceof te(e).HTMLElement:!1}function pi(e){return!Ln()||typeof ShadowRoot>"u"?!1:e instanceof ShadowRoot||e instanceof te(e).ShadowRoot}const j0=new Set(["inline","contents"]);function zt(e){const{overflow:t,overflowX:n,overflowY:r,display:o}=le(e);return/auto|scroll|overlay|hidden|clip/.test(t+r+n)&&!j0.has(o)}const I0=new Set(["table","td","th"]);function F0(e){return I0.has(ft(e))}const N0=[":popover-open",":modal"];function Vn(e){return N0.some(t=>{try{return e.matches(t)}catch{return!1}})}const _0=["transform","translate","scale","rotate","perspective"],B0=["transform","translate","scale","rotate","perspective","filter"],z0=["paint","layout","strict","content"];function xo(e){const t=Mo(),n=ce(e)?le(e):e;return _0.some(r=>n[r]?n[r]!=="none":!1)||(n.containerType?n.containerType!=="normal":!1)||!t&&(n.backdropFilter?n.backdropFilter!=="none":!1)||!t&&(n.filter?n.filter!=="none":!1)||B0.some(r=>(n.willChange||"").includes(r))||z0.some(r=>(n.contain||"").includes(r))}function H0(e){let t=Le(e);for(;me(t)&&!ct(t);){if(xo(t))return t;if(Vn(t))return null;t=Le(t)}return null}function Mo(){return typeof CSS>"u"||!CSS.supports?!1:CSS.supports("-webkit-backdrop-filter","none")}const q0=new Set(["html","body","#document"]);function ct(e){return q0.has(ft(e))}function le(e){return te(e).getComputedStyle(e)}function On(e){return ce(e)?{scrollLeft:e.scrollLeft,scrollTop:e.scrollTop}:{scrollLeft:e.scrollX,scrollTop:e.scrollY}}function Le(e){if(ft(e)==="html")return e;const t=e.assignedSlot||e.parentNode||pi(e)&&e.host||ge(e);return pi(t)?t.host:t}function mc(e){const t=Le(e);return ct(t)?e.ownerDocument?e.ownerDocument.body:e.body:me(t)&&zt(t)?t:mc(t)}function Ot(e,t,n){var r;t===void 0&&(t=[]),n===void 0&&(n=!0);const o=mc(e),s=o===((r=e.ownerDocument)==null?void 0:r.body),i=te(o);if(s){const a=Tr(i);return t.concat(i,i.visualViewport||[],zt(o)?o:[],a&&n?Ot(a):[])}return t.concat(o,Ot(o,[],n))}function Tr(e){return e.parent&&Object.getPrototypeOf(e.parent)?e.frameElement:null}function gc(e){const t=le(e);let n=parseFloat(t.width)||0,r=parseFloat(t.height)||0;const o=me(e),s=o?e.offsetWidth:n,i=o?e.offsetHeight:r,a=vn(n)!==s||vn(r)!==i;return a&&(n=s,r=i),{width:n,height:r,$:a}}function wo(e){return ce(e)?e:e.contextElement}function rt(e){const t=wo(e);if(!me(t))return ye(1);const n=t.getBoundingClientRect(),{width:r,height:o,$:s}=gc(t);let i=(s?vn(n.width):n.width)/r,a=(s?vn(n.height):n.height)/o;return(!i||!Number.isFinite(i))&&(i=1),(!a||!Number.isFinite(a))&&(a=1),{x:i,y:a}}const U0=ye(0);function vc(e){const t=te(e);return!Mo()||!t.visualViewport?U0:{x:t.visualViewport.offsetLeft,y:t.visualViewport.offsetTop}}function $0(e,t,n){return t===void 0&&(t=!1),!n||t&&n!==te(e)?!1:t}function He(e,t,n,r){t===void 0&&(t=!1),n===void 0&&(n=!1);const o=e.getBoundingClientRect(),s=wo(e);let i=ye(1);t&&(r?ce(r)&&(i=rt(r)):i=rt(e));const a=$0(s,n,r)?vc(s):ye(0);let c=(o.left+a.x)/i.x,l=(o.top+a.y)/i.y,u=o.width/i.x,d=o.height/i.y;if(s){const p=te(s),y=r&&ce(r)?te(r):r;let g=p,m=Tr(g);for(;m&&r&&y!==g;){const v=rt(m),k=m.getBoundingClientRect(),x=le(m),M=k.left+(m.clientLeft+parseFloat(x.paddingLeft))*v.x,C=k.top+(m.clientTop+parseFloat(x.paddingTop))*v.y;c*=v.x,l*=v.y,u*=v.x,d*=v.y,c+=M,l+=C,g=te(m),m=Tr(g)}}return xn({width:u,height:d,x:c,y:l})}function jn(e,t){const n=On(e).scrollLeft;return t?t.left+n:He(ge(e)).left+n}function kc(e,t){const n=e.getBoundingClientRect(),r=n.left+t.scrollLeft-jn(e,n),o=n.top+t.scrollTop;return{x:r,y:o}}function W0(e){let{elements:t,rect:n,offsetParent:r,strategy:o}=e;const s=o==="fixed",i=ge(r),a=t?Vn(t.floating):!1;if(r===i||a&&s)return n;let c={scrollLeft:0,scrollTop:0},l=ye(1);const u=ye(0),d=me(r);if((d||!d&&!s)&&((ft(r)!=="body"||zt(i))&&(c=On(r)),me(r))){const y=He(r);l=rt(r),u.x=y.x+r.clientLeft,u.y=y.y+r.clientTop}const p=i&&!d&&!s?kc(i,c):ye(0);return{width:n.width*l.x,height:n.height*l.y,x:n.x*l.x-c.scrollLeft*l.x+u.x+p.x,y:n.y*l.y-c.scrollTop*l.y+u.y+p.y}}function G0(e){return Array.from(e.getClientRects())}function K0(e){const t=ge(e),n=On(e),r=e.ownerDocument.body,o=J(t.scrollWidth,t.clientWidth,r.scrollWidth,r.clientWidth),s=J(t.scrollHeight,t.clientHeight,r.scrollHeight,r.clientHeight);let i=-n.scrollLeft+jn(e);const a=-n.scrollTop;return le(r).direction==="rtl"&&(i+=J(t.clientWidth,r.clientWidth)-o),{width:o,height:s,x:i,y:a}}const yi=25;function Z0(e,t){const n=te(e),r=ge(e),o=n.visualViewport;let s=r.clientWidth,i=r.clientHeight,a=0,c=0;if(o){s=o.width,i=o.height;const u=Mo();(!u||u&&t==="fixed")&&(a=o.offsetLeft,c=o.offsetTop)}const l=jn(r);if(l<=0){const u=r.ownerDocument,d=u.body,p=getComputedStyle(d),y=u.compatMode==="CSS1Compat"&&parseFloat(p.marginLeft)+parseFloat(p.marginRight)||0,g=Math.abs(r.clientWidth-d.clientWidth-y);g<=yi&&(s-=g)}else l<=yi&&(s+=l);return{width:s,height:i,x:a,y:c}}const X0=new Set(["absolute","fixed"]);function Y0(e,t){const n=He(e,!0,t==="fixed"),r=n.top+e.clientTop,o=n.left+e.clientLeft,s=me(e)?rt(e):ye(1),i=e.clientWidth*s.x,a=e.clientHeight*s.y,c=o*s.x,l=r*s.y;return{width:i,height:a,x:c,y:l}}function mi(e,t,n){let r;if(t==="viewport")r=Z0(e,n);else if(t==="document")r=K0(ge(e));else if(ce(t))r=Y0(t,n);else{const o=vc(e);r={x:t.x-o.x,y:t.y-o.y,width:t.width,height:t.height}}return xn(r)}function xc(e,t){const n=Le(e);return n===t||!ce(n)||ct(n)?!1:le(n).position==="fixed"||xc(n,t)}function Q0(e,t){const n=t.get(e);if(n)return n;let r=Ot(e,[],!1).filter(a=>ce(a)&&ft(a)!=="body"),o=null;const s=le(e).position==="fixed";let i=s?Le(e):e;for(;ce(i)&&!ct(i);){const a=le(i),c=xo(i);!c&&a.position==="fixed"&&(o=null),(s?!c&&!o:!c&&a.position==="static"&&!!o&&X0.has(o.position)||zt(i)&&!c&&xc(e,i))?r=r.filter(u=>u!==i):o=a,i=Le(i)}return t.set(e,r),r}function J0(e){let{element:t,boundary:n,rootBoundary:r,strategy:o}=e;const i=[...n==="clippingAncestors"?Vn(t)?[]:Q0(t,this._c):[].concat(n),r],a=i[0],c=i.reduce((l,u)=>{const d=mi(t,u,o);return l.top=J(d.top,l.top),l.right=De(d.right,l.right),l.bottom=De(d.bottom,l.bottom),l.left=J(d.left,l.left),l},mi(t,a,o));return{width:c.right-c.left,height:c.bottom-c.top,x:c.left,y:c.top}}function ef(e){const{width:t,height:n}=gc(e);return{width:t,height:n}}function tf(e,t,n){const r=me(t),o=ge(t),s=n==="fixed",i=He(e,!0,s,t);let a={scrollLeft:0,scrollTop:0};const c=ye(0);function l(){c.x=jn(o)}if(r||!r&&!s)if((ft(t)!=="body"||zt(o))&&(a=On(t)),r){const y=He(t,!0,s,t);c.x=y.x+t.clientLeft,c.y=y.y+t.clientTop}else o&&l();s&&!r&&o&&l();const u=o&&!r&&!s?kc(o,a):ye(0),d=i.left+a.scrollLeft-c.x-u.x,p=i.top+a.scrollTop-c.y-u.y;return{x:d,y:p,width:i.width,height:i.height}}function rr(e){return le(e).position==="static"}function gi(e,t){if(!me(e)||le(e).position==="fixed")return null;if(t)return t(e);let n=e.offsetParent;return ge(e)===n&&(n=n.ownerDocument.body),n}function Mc(e,t){const n=te(e);if(Vn(e))return n;if(!me(e)){let o=Le(e);for(;o&&!ct(o);){if(ce(o)&&!rr(o))return o;o=Le(o)}return n}let r=gi(e,t);for(;r&&F0(r)&&rr(r);)r=gi(r,t);return r&&ct(r)&&rr(r)&&!xo(r)?n:r||H0(e)||n}const nf=async function(e){const t=this.getOffsetParent||Mc,n=this.getDimensions,r=await n(e.floating);return{reference:tf(e.reference,await t(e.floating),e.strategy),floating:{x:0,y:0,width:r.width,height:r.height}}};function rf(e){return le(e).direction==="rtl"}const of={convertOffsetParentRelativeRectToViewportRelativeRect:W0,getDocumentElement:ge,getClippingRect:J0,getOffsetParent:Mc,getElementRects:nf,getClientRects:G0,getDimensions:ef,getScale:rt,isElement:ce,isRTL:rf};function wc(e,t){return e.x===t.x&&e.y===t.y&&e.width===t.width&&e.height===t.height}function sf(e,t){let n=null,r;const o=ge(e);function s(){var a;clearTimeout(r),(a=n)==null||a.disconnect(),n=null}function i(a,c){a===void 0&&(a=!1),c===void 0&&(c=1),s();const l=e.getBoundingClientRect(),{left:u,top:d,width:p,height:y}=l;if(a||t(),!p||!y)return;const g=Qt(d),m=Qt(o.clientWidth-(u+p)),v=Qt(o.clientHeight-(d+y)),k=Qt(u),M={rootMargin:-g+"px "+-m+"px "+-v+"px "+-k+"px",threshold:J(0,De(1,c))||1};let C=!0;function w(S){const A=S[0].intersectionRatio;if(A!==c){if(!C)return i();A?i(!1,A):r=setTimeout(()=>{i(!1,1e-7)},1e3)}A===1&&!wc(l,e.getBoundingClientRect())&&i(),C=!1}try{n=new IntersectionObserver(w,{...M,root:o.ownerDocument})}catch{n=new IntersectionObserver(w,M)}n.observe(e)}return i(!0),s}function af(e,t,n,r){r===void 0&&(r={});const{ancestorScroll:o=!0,ancestorResize:s=!0,elementResize:i=typeof ResizeObserver=="function",layoutShift:a=typeof IntersectionObserver=="function",animationFrame:c=!1}=r,l=wo(e),u=o||s?[...l?Ot(l):[],...Ot(t)]:[];u.forEach(k=>{o&&k.addEventListener("scroll",n,{passive:!0}),s&&k.addEventListener("resize",n)});const d=l&&a?sf(l,n):null;let p=-1,y=null;i&&(y=new ResizeObserver(k=>{let[x]=k;x&&x.target===l&&y&&(y.unobserve(t),cancelAnimationFrame(p),p=requestAnimationFrame(()=>{var M;(M=y)==null||M.observe(t)})),n()}),l&&!c&&y.observe(l),y.observe(t));let g,m=c?He(e):null;c&&v();function v(){const k=He(e);m&&!wc(m,k)&&n(),m=k,g=requestAnimationFrame(v)}return n(),()=>{var k;u.forEach(x=>{o&&x.removeEventListener("scroll",n),s&&x.removeEventListener("resize",n)}),d==null||d(),(k=y)==null||k.disconnect(),y=null,c&&cancelAnimationFrame(g)}}const cf=D0,lf=L0,uf=T0,df=O0,hf=R0,vi=P0,ff=V0,pf=(e,t,n)=>{const r=new Map,o={platform:of,...n},s={...o.platform,_c:r};return A0(e,t,{...o,platform:s})};var yf=typeof document<"u",mf=function(){},an=yf?f.useLayoutEffect:mf;function Mn(e,t){if(e===t)return!0;if(typeof e!=typeof t)return!1;if(typeof e=="function"&&e.toString()===t.toString())return!0;let n,r,o;if(e&&t&&typeof e=="object"){if(Array.isArray(e)){if(n=e.length,n!==t.length)return!1;for(r=n;r--!==0;)if(!Mn(e[r],t[r]))return!1;return!0}if(o=Object.keys(e),n=o.length,n!==Object.keys(t).length)return!1;for(r=n;r--!==0;)if(!{}.hasOwnProperty.call(t,o[r]))return!1;for(r=n;r--!==0;){const s=o[r];if(!(s==="_owner"&&e.$$typeof)&&!Mn(e[s],t[s]))return!1}return!0}return e!==e&&t!==t}function bc(e){return typeof window>"u"?1:(e.ownerDocument.defaultView||window).devicePixelRatio||1}function ki(e,t){const n=bc(e);return Math.round(t*n)/n}function or(e){const t=f.useRef(e);return an(()=>{t.current=e}),t}function gf(e){e===void 0&&(e={});const{placement:t="bottom",strategy:n="absolute",middleware:r=[],platform:o,elements:{reference:s,floating:i}={},transform:a=!0,whileElementsMounted:c,open:l}=e,[u,d]=f.useState({x:0,y:0,strategy:n,placement:t,middlewareData:{},isPositioned:!1}),[p,y]=f.useState(r);Mn(p,r)||y(r);const[g,m]=f.useState(null),[v,k]=f.useState(null),x=f.useCallback(R=>{R!==S.current&&(S.current=R,m(R))},[]),M=f.useCallback(R=>{R!==A.current&&(A.current=R,k(R))},[]),C=s||g,w=i||v,S=f.useRef(null),A=f.useRef(null),P=f.useRef(u),D=c!=null,L=or(c),j=or(o),N=or(l),B=f.useCallback(()=>{if(!S.current||!A.current)return;const R={placement:t,strategy:n,middleware:p};j.current&&(R.platform=j.current),pf(S.current,A.current,R).then(T=>{const _={...T,isPositioned:N.current!==!1};F.current&&!Mn(P.current,_)&&(P.current=_,Ai.flushSync(()=>{d(_)}))})},[p,t,n,j,N]);an(()=>{l===!1&&P.current.isPositioned&&(P.current.isPositioned=!1,d(R=>({...R,isPositioned:!1})))},[l]);const F=f.useRef(!1);an(()=>(F.current=!0,()=>{F.current=!1}),[]),an(()=>{if(C&&(S.current=C),w&&(A.current=w),C&&w){if(L.current)return L.current(C,w,B);B()}},[C,w,B,L,D]);const W=f.useMemo(()=>({reference:S,floating:A,setReference:x,setFloating:M}),[x,M]),I=f.useMemo(()=>({reference:C,floating:w}),[C,w]),O=f.useMemo(()=>{const R={position:n,left:0,top:0};if(!I.floating)return R;const T=ki(I.floating,u.x),_=ki(I.floating,u.y);return a?{...R,transform:"translate("+T+"px, "+_+"px)",...bc(I.floating)>=1.5&&{willChange:"transform"}}:{position:n,left:T,top:_}},[n,a,I.floating,u.x,u.y]);return f.useMemo(()=>({...u,update:B,refs:W,elements:I,floatingStyles:O}),[u,B,W,I,O])}const vf=e=>{function t(n){return{}.hasOwnProperty.call(n,"current")}return{name:"arrow",options:e,fn(n){const{element:r,padding:o}=typeof e=="function"?e(n):e;return r&&t(r)?r.current!=null?vi({element:r.current,padding:o}).fn(n):{}:r?vi({element:r,padding:o}).fn(n):{}}}},kf=(e,t)=>({...cf(e),options:[e,t]}),xf=(e,t)=>({...lf(e),options:[e,t]}),Mf=(e,t)=>({...ff(e),options:[e,t]}),wf=(e,t)=>({...uf(e),options:[e,t]}),bf=(e,t)=>({...df(e),options:[e,t]}),Cf=(e,t)=>({...hf(e),options:[e,t]}),Sf=(e,t)=>({...vf(e),options:[e,t]});var Af="Arrow",Cc=f.forwardRef((e,t)=>{const{children:n,width:r=10,height:o=5,...s}=e;return b.jsx($.svg,{...s,ref:t,width:r,height:o,viewBox:"0 0 30 10",preserveAspectRatio:"none",children:e.asChild?n:b.jsx("polygon",{points:"0,0 30,0 15,10"})})});Cc.displayName=Af;var Pf=Cc;function Tf(e){const[t,n]=f.useState(void 0);return Te(()=>{if(e){n({width:e.offsetWidth,height:e.offsetHeight});const r=new ResizeObserver(o=>{if(!Array.isArray(o)||!o.length)return;const s=o[0];let i,a;if("borderBoxSize"in s){const c=s.borderBoxSize,l=Array.isArray(c)?c[0]:c;i=l.inlineSize,a=l.blockSize}else i=e.offsetWidth,a=e.offsetHeight;n({width:i,height:a})});return r.observe(e,{box:"border-box"}),()=>r.unobserve(e)}else n(void 0)},[e]),t}var bo="Popper",[Sc,Ac]=lt(bo),[Rf,Pc]=Sc(bo),Tc=e=>{const{__scopePopper:t,children:n}=e,[r,o]=f.useState(null);return b.jsx(Rf,{scope:t,anchor:r,onAnchorChange:o,children:n})};Tc.displayName=bo;var Rc="PopperAnchor",Ec=f.forwardRef((e,t)=>{const{__scopePopper:n,virtualRef:r,...o}=e,s=Pc(Rc,n),i=f.useRef(null),a=K(t,i),c=f.useRef(null);return f.useEffect(()=>{const l=c.current;c.current=(r==null?void 0:r.current)||i.current,l!==c.current&&s.onAnchorChange(c.current)}),r?null:b.jsx($.div,{...o,ref:a})});Ec.displayName=Rc;var Co="PopperContent",[Ef,Df]=Sc(Co),Dc=f.forwardRef((e,t)=>{var ve,mt,re,gt,Io,Fo;const{__scopePopper:n,side:r="bottom",sideOffset:o=0,align:s="center",alignOffset:i=0,arrowPadding:a=0,avoidCollisions:c=!0,collisionBoundary:l=[],collisionPadding:u=0,sticky:d="partial",hideWhenDetached:p=!1,updatePositionStrategy:y="optimized",onPlaced:g,...m}=e,v=Pc(Co,n),[k,x]=f.useState(null),M=K(t,vt=>x(vt)),[C,w]=f.useState(null),S=Tf(C),A=(S==null?void 0:S.width)??0,P=(S==null?void 0:S.height)??0,D=r+(s!=="center"?"-"+s:""),L=typeof u=="number"?u:{top:0,right:0,bottom:0,left:0,...u},j=Array.isArray(l)?l:[l],N=j.length>0,B={padding:L,boundary:j.filter(Vf),altBoundary:N},{refs:F,floatingStyles:W,placement:I,isPositioned:O,middlewareData:R}=gf({strategy:"fixed",placement:D,whileElementsMounted:(...vt)=>af(...vt,{animationFrame:y==="always"}),elements:{reference:v.anchor},middleware:[kf({mainAxis:o+P,alignmentAxis:i}),c&&xf({mainAxis:!0,crossAxis:!1,limiter:d==="partial"?Mf():void 0,...B}),c&&wf({...B}),bf({...B,apply:({elements:vt,rects:No,availableWidth:Yl,availableHeight:Ql})=>{const{width:Jl,height:e1}=No.reference,Wt=vt.floating.style;Wt.setProperty("--radix-popper-available-width",`${Yl}px`),Wt.setProperty("--radix-popper-available-height",`${Ql}px`),Wt.setProperty("--radix-popper-anchor-width",`${Jl}px`),Wt.setProperty("--radix-popper-anchor-height",`${e1}px`)}}),C&&Sf({element:C,padding:a}),Of({arrowWidth:A,arrowHeight:P}),p&&Cf({strategy:"referenceHidden",...B})]}),[T,_]=Oc(I),Y=Me(g);Te(()=>{O&&(Y==null||Y())},[O,Y]);const de=(ve=R.arrow)==null?void 0:ve.x,pt=(mt=R.arrow)==null?void 0:mt.y,yt=((re=R.arrow)==null?void 0:re.centerOffset)!==0,[$t,je]=f.useState();return Te(()=>{k&&je(window.getComputedStyle(k).zIndex)},[k]),b.jsx("div",{ref:F.setFloating,"data-radix-popper-content-wrapper":"",style:{...W,transform:O?W.transform:"translate(0, -200%)",minWidth:"max-content",zIndex:$t,"--radix-popper-transform-origin":[(gt=R.transformOrigin)==null?void 0:gt.x,(Io=R.transformOrigin)==null?void 0:Io.y].join(" "),...((Fo=R.hide)==null?void 0:Fo.referenceHidden)&&{visibility:"hidden",pointerEvents:"none"}},dir:e.dir,children:b.jsx(Ef,{scope:n,placedSide:T,onArrowChange:w,arrowX:de,arrowY:pt,shouldHideArrow:yt,children:b.jsx($.div,{"data-side":T,"data-align":_,...m,ref:M,style:{...m.style,animation:O?void 0:"none"}})})})});Dc.displayName=Co;var Lc="PopperArrow",Lf={top:"bottom",right:"left",bottom:"top",left:"right"},Vc=f.forwardRef(function(t,n){const{__scopePopper:r,...o}=t,s=Df(Lc,r),i=Lf[s.placedSide];return b.jsx("span",{ref:s.onArrowChange,style:{position:"absolute",left:s.arrowX,top:s.arrowY,[i]:0,transformOrigin:{top:"",right:"0 0",bottom:"center 0",left:"100% 0"}[s.placedSide],transform:{top:"translateY(100%)",right:"translateY(50%) rotate(90deg) translateX(-50%)",bottom:"rotate(180deg)",left:"translateY(50%) rotate(-90deg) translateX(50%)"}[s.placedSide],visibility:s.shouldHideArrow?"hidden":void 0},children:b.jsx(Pf,{...o,ref:n,style:{...o.style,display:"block"}})})});Vc.displayName=Lc;function Vf(e){return e!==null}var Of=e=>({name:"transformOrigin",options:e,fn(t){var v,k,x;const{placement:n,rects:r,middlewareData:o}=t,i=((v=o.arrow)==null?void 0:v.centerOffset)!==0,a=i?0:e.arrowWidth,c=i?0:e.arrowHeight,[l,u]=Oc(n),d={start:"0%",center:"50%",end:"100%"}[u],p=(((k=o.arrow)==null?void 0:k.x)??0)+a/2,y=(((x=o.arrow)==null?void 0:x.y)??0)+c/2;let g="",m="";return l==="bottom"?(g=i?d:`${p}px`,m=`${-c}px`):l==="top"?(g=i?d:`${p}px`,m=`${r.floating.height+c}px`):l==="right"?(g=`${-c}px`,m=i?d:`${y}px`):l==="left"&&(g=`${r.floating.width+c}px`,m=i?d:`${y}px`),{data:{x:g,y:m}}}});function Oc(e){const[t,n="center"]=e.split("-");return[t,n]}var jf=Tc,If=Ec,Ff=Dc,Nf=Vc,_f=function(e){if(typeof document>"u")return null;var t=Array.isArray(e)?e[0]:e;return t.ownerDocument.body},Ke=new WeakMap,Jt=new WeakMap,en={},sr=0,jc=function(e){return e&&(e.host||jc(e.parentNode))},Bf=function(e,t){return t.map(function(n){if(e.contains(n))return n;var r=jc(n);return r&&e.contains(r)?r:(console.error("aria-hidden",n,"in not contained inside",e,". Doing nothing"),null)}).filter(function(n){return!!n})},zf=function(e,t,n,r){var o=Bf(t,Array.isArray(e)?e:[e]);en[n]||(en[n]=new WeakMap);var s=en[n],i=[],a=new Set,c=new Set(o),l=function(d){!d||a.has(d)||(a.add(d),l(d.parentNode))};o.forEach(l);var u=function(d){!d||c.has(d)||Array.prototype.forEach.call(d.children,function(p){if(a.has(p))u(p);else try{var y=p.getAttribute(r),g=y!==null&&y!=="false",m=(Ke.get(p)||0)+1,v=(s.get(p)||0)+1;Ke.set(p,m),s.set(p,v),i.push(p),m===1&&g&&Jt.set(p,!0),v===1&&p.setAttribute(n,"true"),g||p.setAttribute(r,"true")}catch(k){console.error("aria-hidden: cannot operate on ",p,k)}})};return u(t),a.clear(),sr++,function(){i.forEach(function(d){var p=Ke.get(d)-1,y=s.get(d)-1;Ke.set(d,p),s.set(d,y),p||(Jt.has(d)||d.removeAttribute(r),Jt.delete(d)),y||d.removeAttribute(n)}),sr--,sr||(Ke=new WeakMap,Ke=new WeakMap,Jt=new WeakMap,en={})}},Ic=function(e,t,n){n===void 0&&(n="data-aria-hidden");var r=Array.from(Array.isArray(e)?e:[e]),o=_f(e);return o?(r.push.apply(r,Array.from(o.querySelectorAll("[aria-live], script"))),zf(r,o,n,"aria-hidden")):function(){return null}},cn="right-scroll-bar-position",ln="width-before-scroll-bar",Hf="with-scroll-bars-hidden",qf="--removed-body-scroll-bar-size";function ir(e,t){return typeof e=="function"?e(t):e&&(e.current=t),e}function Uf(e,t){var n=f.useState(function(){return{value:e,callback:t,facade:{get current(){return n.value},set current(r){var o=n.value;o!==r&&(n.value=r,n.callback(r,o))}}}})[0];return n.callback=t,n.facade}var $f=typeof window<"u"?f.useLayoutEffect:f.useEffect,xi=new WeakMap;function Wf(e,t){var n=Uf(null,function(r){return e.forEach(function(o){return ir(o,r)})});return $f(function(){var r=xi.get(n);if(r){var o=new Set(r),s=new Set(e),i=n.current;o.forEach(function(a){s.has(a)||ir(a,null)}),s.forEach(function(a){o.has(a)||ir(a,i)})}xi.set(n,e)},[e]),n}function Gf(e){return e}function Kf(e,t){t===void 0&&(t=Gf);var n=[],r=!1,o={read:function(){if(r)throw new Error("Sidecar: could not `read` from an `assigned` medium. `read` could be used only with `useMedium`.");return n.length?n[n.length-1]:e},useMedium:function(s){var i=t(s,r);return n.push(i),function(){n=n.filter(function(a){return a!==i})}},assignSyncMedium:function(s){for(r=!0;n.length;){var i=n;n=[],i.forEach(s)}n={push:function(a){return s(a)},filter:function(){return n}}},assignMedium:function(s){r=!0;var i=[];if(n.length){var a=n;n=[],a.forEach(s),i=n}var c=function(){var u=i;i=[],u.forEach(s)},l=function(){return Promise.resolve().then(c)};l(),n={push:function(u){i.push(u),l()},filter:function(u){return i=i.filter(u),n}}}};return o}function Zf(e){e===void 0&&(e={});var t=Kf(null);return t.options=Pe({async:!0,ssr:!1},e),t}var Fc=function(e){var t=e.sideCar,n=Ti(e,["sideCar"]);if(!t)throw new Error("Sidecar: please provide `sideCar` property to import the right car");var r=t.read();if(!r)throw new Error("Sidecar medium not found");return f.createElement(r,Pe({},n))};Fc.isSideCarExport=!0;function Xf(e,t){return e.useMedium(t),Fc}var Nc=Zf(),ar=function(){},In=f.forwardRef(function(e,t){var n=f.useRef(null),r=f.useState({onScrollCapture:ar,onWheelCapture:ar,onTouchMoveCapture:ar}),o=r[0],s=r[1],i=e.forwardProps,a=e.children,c=e.className,l=e.removeScrollBar,u=e.enabled,d=e.shards,p=e.sideCar,y=e.noRelative,g=e.noIsolation,m=e.inert,v=e.allowPinchZoom,k=e.as,x=k===void 0?"div":k,M=e.gapMode,C=Ti(e,["forwardProps","children","className","removeScrollBar","enabled","shards","sideCar","noRelative","noIsolation","inert","allowPinchZoom","as","gapMode"]),w=p,S=Wf([n,t]),A=Pe(Pe({},C),o);return f.createElement(f.Fragment,null,u&&f.createElement(w,{sideCar:Nc,removeScrollBar:l,shards:d,noRelative:y,noIsolation:g,inert:m,setCallbacks:s,allowPinchZoom:!!v,lockRef:n,gapMode:M}),i?f.cloneElement(f.Children.only(a),Pe(Pe({},A),{ref:S})):f.createElement(x,Pe({},A,{className:c,ref:S}),a))});In.defaultProps={enabled:!0,removeScrollBar:!0,inert:!1};In.classNames={fullWidth:ln,zeroRight:cn};var Yf=function(){if(typeof __webpack_nonce__<"u")return __webpack_nonce__};function Qf(){if(!document)return null;var e=document.createElement("style");e.type="text/css";var t=Yf();return t&&e.setAttribute("nonce",t),e}function Jf(e,t){e.styleSheet?e.styleSheet.cssText=t:e.appendChild(document.createTextNode(t))}function ep(e){var t=document.head||document.getElementsByTagName("head")[0];t.appendChild(e)}var tp=function(){var e=0,t=null;return{add:function(n){e==0&&(t=Qf())&&(Jf(t,n),ep(t)),e++},remove:function(){e--,!e&&t&&(t.parentNode&&t.parentNode.removeChild(t),t=null)}}},np=function(){var e=tp();return function(t,n){f.useEffect(function(){return e.add(t),function(){e.remove()}},[t&&n])}},_c=function(){var e=np(),t=function(n){var r=n.styles,o=n.dynamic;return e(r,o),null};return t},rp={left:0,top:0,right:0,gap:0},cr=function(e){return parseInt(e||"",10)||0},op=function(e){var t=window.getComputedStyle(document.body),n=t[e==="padding"?"paddingLeft":"marginLeft"],r=t[e==="padding"?"paddingTop":"marginTop"],o=t[e==="padding"?"paddingRight":"marginRight"];return[cr(n),cr(r),cr(o)]},sp=function(e){if(e===void 0&&(e="margin"),typeof window>"u")return rp;var t=op(e),n=document.documentElement.clientWidth,r=window.innerWidth;return{left:t[0],top:t[1],right:t[2],gap:Math.max(0,r-n+t[2]-t[0])}},ip=_c(),ot="data-scroll-locked",ap=function(e,t,n,r){var o=e.left,s=e.top,i=e.right,a=e.gap;return n===void 0&&(n="margin"),`
  .`.concat(Hf,` {
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
    `).concat(qf,": ").concat(a,`px;
  }
`)},Mi=function(){var e=parseInt(document.body.getAttribute(ot)||"0",10);return isFinite(e)?e:0},cp=function(){f.useEffect(function(){return document.body.setAttribute(ot,(Mi()+1).toString()),function(){var e=Mi()-1;e<=0?document.body.removeAttribute(ot):document.body.setAttribute(ot,e.toString())}},[])},lp=function(e){var t=e.noRelative,n=e.noImportant,r=e.gapMode,o=r===void 0?"margin":r;cp();var s=f.useMemo(function(){return sp(o)},[o]);return f.createElement(ip,{styles:ap(s,!t,o,n?"":"!important")})},Rr=!1;if(typeof window<"u")try{var tn=Object.defineProperty({},"passive",{get:function(){return Rr=!0,!0}});window.addEventListener("test",tn,tn),window.removeEventListener("test",tn,tn)}catch{Rr=!1}var Ze=Rr?{passive:!1}:!1,up=function(e){return e.tagName==="TEXTAREA"},Bc=function(e,t){if(!(e instanceof Element))return!1;var n=window.getComputedStyle(e);return n[t]!=="hidden"&&!(n.overflowY===n.overflowX&&!up(e)&&n[t]==="visible")},dp=function(e){return Bc(e,"overflowY")},hp=function(e){return Bc(e,"overflowX")},wi=function(e,t){var n=t.ownerDocument,r=t;do{typeof ShadowRoot<"u"&&r instanceof ShadowRoot&&(r=r.host);var o=zc(e,r);if(o){var s=Hc(e,r),i=s[1],a=s[2];if(i>a)return!0}r=r.parentNode}while(r&&r!==n.body);return!1},fp=function(e){var t=e.scrollTop,n=e.scrollHeight,r=e.clientHeight;return[t,n,r]},pp=function(e){var t=e.scrollLeft,n=e.scrollWidth,r=e.clientWidth;return[t,n,r]},zc=function(e,t){return e==="v"?dp(t):hp(t)},Hc=function(e,t){return e==="v"?fp(t):pp(t)},yp=function(e,t){return e==="h"&&t==="rtl"?-1:1},mp=function(e,t,n,r,o){var s=yp(e,window.getComputedStyle(t).direction),i=s*r,a=n.target,c=t.contains(a),l=!1,u=i>0,d=0,p=0;do{if(!a)break;var y=Hc(e,a),g=y[0],m=y[1],v=y[2],k=m-v-s*g;(g||k)&&zc(e,a)&&(d+=k,p+=g);var x=a.parentNode;a=x&&x.nodeType===Node.DOCUMENT_FRAGMENT_NODE?x.host:x}while(!c&&a!==document.body||c&&(t.contains(a)||t===a));return(u&&Math.abs(d)<1||!u&&Math.abs(p)<1)&&(l=!0),l},nn=function(e){return"changedTouches"in e?[e.changedTouches[0].clientX,e.changedTouches[0].clientY]:[0,0]},bi=function(e){return[e.deltaX,e.deltaY]},Ci=function(e){return e&&"current"in e?e.current:e},gp=function(e,t){return e[0]===t[0]&&e[1]===t[1]},vp=function(e){return`
  .block-interactivity-`.concat(e,` {pointer-events: none;}
  .allow-interactivity-`).concat(e,` {pointer-events: all;}
`)},kp=0,Xe=[];function xp(e){var t=f.useRef([]),n=f.useRef([0,0]),r=f.useRef(),o=f.useState(kp++)[0],s=f.useState(_c)[0],i=f.useRef(e);f.useEffect(function(){i.current=e},[e]),f.useEffect(function(){if(e.inert){document.body.classList.add("block-interactivity-".concat(o));var m=n1([e.lockRef.current],(e.shards||[]).map(Ci),!0).filter(Boolean);return m.forEach(function(v){return v.classList.add("allow-interactivity-".concat(o))}),function(){document.body.classList.remove("block-interactivity-".concat(o)),m.forEach(function(v){return v.classList.remove("allow-interactivity-".concat(o))})}}},[e.inert,e.lockRef.current,e.shards]);var a=f.useCallback(function(m,v){if("touches"in m&&m.touches.length===2||m.type==="wheel"&&m.ctrlKey)return!i.current.allowPinchZoom;var k=nn(m),x=n.current,M="deltaX"in m?m.deltaX:x[0]-k[0],C="deltaY"in m?m.deltaY:x[1]-k[1],w,S=m.target,A=Math.abs(M)>Math.abs(C)?"h":"v";if("touches"in m&&A==="h"&&S.type==="range")return!1;var P=window.getSelection(),D=P&&P.anchorNode,L=D?D===S||D.contains(S):!1;if(L)return!1;var j=wi(A,S);if(!j)return!0;if(j?w=A:(w=A==="v"?"h":"v",j=wi(A,S)),!j)return!1;if(!r.current&&"changedTouches"in m&&(M||C)&&(r.current=w),!w)return!0;var N=r.current||w;return mp(N,v,m,N==="h"?M:C)},[]),c=f.useCallback(function(m){var v=m;if(!(!Xe.length||Xe[Xe.length-1]!==s)){var k="deltaY"in v?bi(v):nn(v),x=t.current.filter(function(w){return w.name===v.type&&(w.target===v.target||v.target===w.shadowParent)&&gp(w.delta,k)})[0];if(x&&x.should){v.cancelable&&v.preventDefault();return}if(!x){var M=(i.current.shards||[]).map(Ci).filter(Boolean).filter(function(w){return w.contains(v.target)}),C=M.length>0?a(v,M[0]):!i.current.noIsolation;C&&v.cancelable&&v.preventDefault()}}},[]),l=f.useCallback(function(m,v,k,x){var M={name:m,delta:v,target:k,should:x,shadowParent:Mp(k)};t.current.push(M),setTimeout(function(){t.current=t.current.filter(function(C){return C!==M})},1)},[]),u=f.useCallback(function(m){n.current=nn(m),r.current=void 0},[]),d=f.useCallback(function(m){l(m.type,bi(m),m.target,a(m,e.lockRef.current))},[]),p=f.useCallback(function(m){l(m.type,nn(m),m.target,a(m,e.lockRef.current))},[]);f.useEffect(function(){return Xe.push(s),e.setCallbacks({onScrollCapture:d,onWheelCapture:d,onTouchMoveCapture:p}),document.addEventListener("wheel",c,Ze),document.addEventListener("touchmove",c,Ze),document.addEventListener("touchstart",u,Ze),function(){Xe=Xe.filter(function(m){return m!==s}),document.removeEventListener("wheel",c,Ze),document.removeEventListener("touchmove",c,Ze),document.removeEventListener("touchstart",u,Ze)}},[]);var y=e.removeScrollBar,g=e.inert;return f.createElement(f.Fragment,null,g?f.createElement(s,{styles:vp(o)}):null,y?f.createElement(lp,{noRelative:e.noRelative,gapMode:e.gapMode}):null)}function Mp(e){for(var t=null;e!==null;)e instanceof ShadowRoot&&(t=e.host,e=e.host),e=e.parentNode;return t}const wp=Xf(Nc,xp);var So=f.forwardRef(function(e,t){return f.createElement(In,Pe({},e,{ref:t,sideCar:wp}))});So.classNames=In.classNames;function bp(e){const t=Cp(e),n=f.forwardRef((r,o)=>{const{children:s,...i}=r,a=f.Children.toArray(s),c=a.find(Ap);if(c){const l=c.props.children,u=a.map(d=>d===c?f.Children.count(l)>1?f.Children.only(null):f.isValidElement(l)?l.props.children:null:d);return b.jsx(t,{...i,ref:o,children:f.isValidElement(l)?f.cloneElement(l,void 0,u):null})}return b.jsx(t,{...i,ref:o,children:s})});return n.displayName=`${e}.Slot`,n}function Cp(e){const t=f.forwardRef((n,r)=>{const{children:o,...s}=n;if(f.isValidElement(o)){const i=Tp(o),a=Pp(s,o.props);return o.type!==f.Fragment&&(a.ref=r?Ue(r,i):i),f.cloneElement(o,a)}return f.Children.count(o)>1?f.Children.only(null):null});return t.displayName=`${e}.SlotClone`,t}var Sp=Symbol("radix.slottable");function Ap(e){return f.isValidElement(e)&&typeof e.type=="function"&&"__radixId"in e.type&&e.type.__radixId===Sp}function Pp(e,t){const n={...t};for(const r in t){const o=e[r],s=t[r];/^on[A-Z]/.test(r)?o&&s?n[r]=(...a)=>{const c=s(...a);return o(...a),c}:o&&(n[r]=o):r==="style"?n[r]={...o,...s}:r==="className"&&(n[r]=[o,s].filter(Boolean).join(" "))}return{...e,...n}}function Tp(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}var Fn="Dialog",[qc,r3]=lt(Fn),[Rp,ue]=qc(Fn),Uc=e=>{const{__scopeDialog:t,children:n,open:r,defaultOpen:o,onOpenChange:s,modal:i=!0}=e,a=f.useRef(null),c=f.useRef(null),[l,u]=Vr({prop:r,defaultProp:o??!1,onChange:s,caller:Fn});return b.jsx(Rp,{scope:t,triggerRef:a,contentRef:c,contentId:nt(),titleId:nt(),descriptionId:nt(),open:l,onOpenChange:u,onOpenToggle:f.useCallback(()=>u(d=>!d),[u]),modal:i,children:n})};Uc.displayName=Fn;var $c="DialogTrigger",Wc=f.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue($c,n),s=K(t,o.triggerRef);return b.jsx($.button,{type:"button","aria-haspopup":"dialog","aria-expanded":o.open,"aria-controls":o.contentId,"data-state":To(o.open),...r,ref:s,onClick:V(e.onClick,o.onOpenToggle)})});Wc.displayName=$c;var Ao="DialogPortal",[Ep,Gc]=qc(Ao,{forceMount:void 0}),Kc=e=>{const{__scopeDialog:t,forceMount:n,children:r,container:o}=e,s=ue(Ao,t);return b.jsx(Ep,{scope:t,forceMount:n,children:f.Children.map(r,i=>b.jsx(Ve,{present:n||s.open,children:b.jsx(Lr,{asChild:!0,container:o,children:i})}))})};Kc.displayName=Ao;var wn="DialogOverlay",Zc=f.forwardRef((e,t)=>{const n=Gc(wn,e.__scopeDialog),{forceMount:r=n.forceMount,...o}=e,s=ue(wn,e.__scopeDialog);return s.modal?b.jsx(Ve,{present:r||s.open,children:b.jsx(Lp,{...o,ref:t})}):null});Zc.displayName=wn;var Dp=bp("DialogOverlay.RemoveScroll"),Lp=f.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(wn,n);return b.jsx(So,{as:Dp,allowPinchZoom:!0,shards:[o.contentRef],children:b.jsx($.div,{"data-state":To(o.open),...r,ref:t,style:{pointerEvents:"auto",...r.style}})})}),qe="DialogContent",Xc=f.forwardRef((e,t)=>{const n=Gc(qe,e.__scopeDialog),{forceMount:r=n.forceMount,...o}=e,s=ue(qe,e.__scopeDialog);return b.jsx(Ve,{present:r||s.open,children:s.modal?b.jsx(Vp,{...o,ref:t}):b.jsx(Op,{...o,ref:t})})});Xc.displayName=qe;var Vp=f.forwardRef((e,t)=>{const n=ue(qe,e.__scopeDialog),r=f.useRef(null),o=K(t,n.contentRef,r);return f.useEffect(()=>{const s=r.current;if(s)return Ic(s)},[]),b.jsx(Yc,{...e,ref:o,trapFocus:n.open,disableOutsidePointerEvents:!0,onCloseAutoFocus:V(e.onCloseAutoFocus,s=>{var i;s.preventDefault(),(i=n.triggerRef.current)==null||i.focus()}),onPointerDownOutside:V(e.onPointerDownOutside,s=>{const i=s.detail.originalEvent,a=i.button===0&&i.ctrlKey===!0;(i.button===2||a)&&s.preventDefault()}),onFocusOutside:V(e.onFocusOutside,s=>s.preventDefault())})}),Op=f.forwardRef((e,t)=>{const n=ue(qe,e.__scopeDialog),r=f.useRef(!1),o=f.useRef(!1);return b.jsx(Yc,{...e,ref:t,trapFocus:!1,disableOutsidePointerEvents:!1,onCloseAutoFocus:s=>{var i,a;(i=e.onCloseAutoFocus)==null||i.call(e,s),s.defaultPrevented||(r.current||(a=n.triggerRef.current)==null||a.focus(),s.preventDefault()),r.current=!1,o.current=!1},onInteractOutside:s=>{var c,l;(c=e.onInteractOutside)==null||c.call(e,s),s.defaultPrevented||(r.current=!0,s.detail.originalEvent.type==="pointerdown"&&(o.current=!0));const i=s.target;((l=n.triggerRef.current)==null?void 0:l.contains(i))&&s.preventDefault(),s.detail.originalEvent.type==="focusin"&&o.current&&s.preventDefault()}})}),Yc=f.forwardRef((e,t)=>{const{__scopeDialog:n,trapFocus:r,onOpenAutoFocus:o,onCloseAutoFocus:s,...i}=e,a=ue(qe,n),c=f.useRef(null),l=K(t,c);return dc(),b.jsxs(b.Fragment,{children:[b.jsx(mo,{asChild:!0,loop:!0,trapped:r,onMountAutoFocus:o,onUnmountAutoFocus:s,children:b.jsx(Sn,{role:"dialog",id:a.contentId,"aria-describedby":a.descriptionId,"aria-labelledby":a.titleId,"data-state":To(a.open),...i,ref:l,onDismiss:()=>a.onOpenChange(!1)})}),b.jsxs(b.Fragment,{children:[b.jsx(jp,{titleId:a.titleId}),b.jsx(Fp,{contentRef:c,descriptionId:a.descriptionId})]})]})}),Po="DialogTitle",Qc=f.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(Po,n);return b.jsx($.h2,{id:o.titleId,...r,ref:t})});Qc.displayName=Po;var Jc="DialogDescription",el=f.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(Jc,n);return b.jsx($.p,{id:o.descriptionId,...r,ref:t})});el.displayName=Jc;var tl="DialogClose",nl=f.forwardRef((e,t)=>{const{__scopeDialog:n,...r}=e,o=ue(tl,n);return b.jsx($.button,{type:"button",...r,ref:t,onClick:V(e.onClick,()=>o.onOpenChange(!1))})});nl.displayName=tl;function To(e){return e?"open":"closed"}var rl="DialogTitleWarning",[o3,ol]=r1(rl,{contentName:qe,titleName:Po,docsSlug:"dialog"}),jp=({titleId:e})=>{const t=ol(rl),n=`\`${t.contentName}\` requires a \`${t.titleName}\` for the component to be accessible for screen reader users.

If you want to hide the \`${t.titleName}\`, you can wrap it with our VisuallyHidden component.

For more information, see https://radix-ui.com/primitives/docs/components/${t.docsSlug}`;return f.useEffect(()=>{e&&(document.getElementById(e)||console.error(n))},[n,e]),null},Ip="DialogDescriptionWarning",Fp=({contentRef:e,descriptionId:t})=>{const r=`Warning: Missing \`Description\` or \`aria-describedby={undefined}\` for {${ol(Ip).contentName}}.`;return f.useEffect(()=>{var s;const o=(s=e.current)==null?void 0:s.getAttribute("aria-describedby");t&&o&&(document.getElementById(t)||console.warn(r))},[r,e,t]),null},s3=Uc,i3=Wc,a3=Kc,c3=Zc,l3=Xc,u3=Qc,d3=el,h3=nl,lr="rovingFocusGroup.onEntryFocus",Np={bubbles:!1,cancelable:!0},Ht="RovingFocusGroup",[Er,sl,_p]=Ri(Ht),[Bp,il]=lt(Ht,[_p]),[zp,Hp]=Bp(Ht),al=f.forwardRef((e,t)=>b.jsx(Er.Provider,{scope:e.__scopeRovingFocusGroup,children:b.jsx(Er.Slot,{scope:e.__scopeRovingFocusGroup,children:b.jsx(qp,{...e,ref:t})})}));al.displayName=Ht;var qp=f.forwardRef((e,t)=>{const{__scopeRovingFocusGroup:n,orientation:r,loop:o=!1,dir:s,currentTabStopId:i,defaultCurrentTabStopId:a,onCurrentTabStopIdChange:c,onEntryFocus:l,preventScrollOnEntryFocus:u=!1,...d}=e,p=f.useRef(null),y=K(t,p),g=uc(s),[m,v]=Vr({prop:i,defaultProp:a??null,onChange:c,caller:Ht}),[k,x]=f.useState(!1),M=Me(l),C=sl(n),w=f.useRef(!1),[S,A]=f.useState(0);return f.useEffect(()=>{const P=p.current;if(P)return P.addEventListener(lr,M),()=>P.removeEventListener(lr,M)},[M]),b.jsx(zp,{scope:n,orientation:r,dir:g,loop:o,currentTabStopId:m,onItemFocus:f.useCallback(P=>v(P),[v]),onItemShiftTab:f.useCallback(()=>x(!0),[]),onFocusableItemAdd:f.useCallback(()=>A(P=>P+1),[]),onFocusableItemRemove:f.useCallback(()=>A(P=>P-1),[]),children:b.jsx($.div,{tabIndex:k||S===0?-1:0,"data-orientation":r,...d,ref:y,style:{outline:"none",...e.style},onMouseDown:V(e.onMouseDown,()=>{w.current=!0}),onFocus:V(e.onFocus,P=>{const D=!w.current;if(P.target===P.currentTarget&&D&&!k){const L=new CustomEvent(lr,Np);if(P.currentTarget.dispatchEvent(L),!L.defaultPrevented){const j=C().filter(I=>I.focusable),N=j.find(I=>I.active),B=j.find(I=>I.id===m),W=[N,B,...j].filter(Boolean).map(I=>I.ref.current);ul(W,u)}}w.current=!1}),onBlur:V(e.onBlur,()=>x(!1))})})}),cl="RovingFocusGroupItem",ll=f.forwardRef((e,t)=>{const{__scopeRovingFocusGroup:n,focusable:r=!0,active:o=!1,tabStopId:s,children:i,...a}=e,c=nt(),l=s||c,u=Hp(cl,n),d=u.currentTabStopId===l,p=sl(n),{onFocusableItemAdd:y,onFocusableItemRemove:g,currentTabStopId:m}=u;return f.useEffect(()=>{if(r)return y(),()=>g()},[r,y,g]),b.jsx(Er.ItemSlot,{scope:n,id:l,focusable:r,active:o,children:b.jsx($.span,{tabIndex:d?0:-1,"data-orientation":u.orientation,...a,ref:t,onMouseDown:V(e.onMouseDown,v=>{r?u.onItemFocus(l):v.preventDefault()}),onFocus:V(e.onFocus,()=>u.onItemFocus(l)),onKeyDown:V(e.onKeyDown,v=>{if(v.key==="Tab"&&v.shiftKey){u.onItemShiftTab();return}if(v.target!==v.currentTarget)return;const k=Wp(v,u.orientation,u.dir);if(k!==void 0){if(v.metaKey||v.ctrlKey||v.altKey||v.shiftKey)return;v.preventDefault();let M=p().filter(C=>C.focusable).map(C=>C.ref.current);if(k==="last")M.reverse();else if(k==="prev"||k==="next"){k==="prev"&&M.reverse();const C=M.indexOf(v.currentTarget);M=u.loop?Gp(M,C+1):M.slice(C+1)}setTimeout(()=>ul(M))}}),children:typeof i=="function"?i({isCurrentTabStop:d,hasTabStop:m!=null}):i})})});ll.displayName=cl;var Up={ArrowLeft:"prev",ArrowUp:"prev",ArrowRight:"next",ArrowDown:"next",PageUp:"first",Home:"first",PageDown:"last",End:"last"};function $p(e,t){return t!=="rtl"?e:e==="ArrowLeft"?"ArrowRight":e==="ArrowRight"?"ArrowLeft":e}function Wp(e,t,n){const r=$p(e.key,n);if(!(t==="vertical"&&["ArrowLeft","ArrowRight"].includes(r))&&!(t==="horizontal"&&["ArrowUp","ArrowDown"].includes(r)))return Up[r]}function ul(e,t=!1){const n=document.activeElement;for(const r of e)if(r===n||(r.focus({preventScroll:t}),document.activeElement!==n))return}function Gp(e,t){return e.map((n,r)=>e[(t+r)%e.length])}var Kp=al,Zp=ll;function Xp(e){const t=Yp(e),n=f.forwardRef((r,o)=>{const{children:s,...i}=r,a=f.Children.toArray(s),c=a.find(Jp);if(c){const l=c.props.children,u=a.map(d=>d===c?f.Children.count(l)>1?f.Children.only(null):f.isValidElement(l)?l.props.children:null:d);return b.jsx(t,{...i,ref:o,children:f.isValidElement(l)?f.cloneElement(l,void 0,u):null})}return b.jsx(t,{...i,ref:o,children:s})});return n.displayName=`${e}.Slot`,n}function Yp(e){const t=f.forwardRef((n,r)=>{const{children:o,...s}=n;if(f.isValidElement(o)){const i=ty(o),a=ey(s,o.props);return o.type!==f.Fragment&&(a.ref=r?Ue(r,i):i),f.cloneElement(o,a)}return f.Children.count(o)>1?f.Children.only(null):null});return t.displayName=`${e}.SlotClone`,t}var Qp=Symbol("radix.slottable");function Jp(e){return f.isValidElement(e)&&typeof e.type=="function"&&"__radixId"in e.type&&e.type.__radixId===Qp}function ey(e,t){const n={...t};for(const r in t){const o=e[r],s=t[r];/^on[A-Z]/.test(r)?o&&s?n[r]=(...a)=>{const c=s(...a);return o(...a),c}:o&&(n[r]=o):r==="style"?n[r]={...o,...s}:r==="className"&&(n[r]=[o,s].filter(Boolean).join(" "))}return{...e,...n}}function ty(e){var r,o;let t=(r=Object.getOwnPropertyDescriptor(e.props,"ref"))==null?void 0:r.get,n=t&&"isReactWarning"in t&&t.isReactWarning;return n?e.ref:(t=(o=Object.getOwnPropertyDescriptor(e,"ref"))==null?void 0:o.get,n=t&&"isReactWarning"in t&&t.isReactWarning,n?e.props.ref:e.props.ref||e.ref)}var Dr=["Enter"," "],ny=["ArrowDown","PageUp","Home"],dl=["ArrowUp","PageDown","End"],ry=[...ny,...dl],oy={ltr:[...Dr,"ArrowRight"],rtl:[...Dr,"ArrowLeft"]},sy={ltr:["ArrowLeft"],rtl:["ArrowRight"]},qt="Menu",[jt,iy,ay]=Ri(qt),[We,hl]=lt(qt,[ay,Ac,il]),Nn=Ac(),fl=il(),[cy,Ge]=We(qt),[ly,Ut]=We(qt),pl=e=>{const{__scopeMenu:t,open:n=!1,children:r,dir:o,onOpenChange:s,modal:i=!0}=e,a=Nn(t),[c,l]=f.useState(null),u=f.useRef(!1),d=Me(s),p=uc(o);return f.useEffect(()=>{const y=()=>{u.current=!0,document.addEventListener("pointerdown",g,{capture:!0,once:!0}),document.addEventListener("pointermove",g,{capture:!0,once:!0})},g=()=>u.current=!1;return document.addEventListener("keydown",y,{capture:!0}),()=>{document.removeEventListener("keydown",y,{capture:!0}),document.removeEventListener("pointerdown",g,{capture:!0}),document.removeEventListener("pointermove",g,{capture:!0})}},[]),b.jsx(jf,{...a,children:b.jsx(cy,{scope:t,open:n,onOpenChange:d,content:c,onContentChange:l,children:b.jsx(ly,{scope:t,onClose:f.useCallback(()=>d(!1),[d]),isUsingKeyboardRef:u,dir:p,modal:i,children:r})})})};pl.displayName=qt;var uy="MenuAnchor",Ro=f.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e,o=Nn(n);return b.jsx(If,{...o,...r,ref:t})});Ro.displayName=uy;var Eo="MenuPortal",[dy,yl]=We(Eo,{forceMount:void 0}),ml=e=>{const{__scopeMenu:t,forceMount:n,children:r,container:o}=e,s=Ge(Eo,t);return b.jsx(dy,{scope:t,forceMount:n,children:b.jsx(Ve,{present:n||s.open,children:b.jsx(Lr,{asChild:!0,container:o,children:r})})})};ml.displayName=Eo;var ie="MenuContent",[hy,Do]=We(ie),gl=f.forwardRef((e,t)=>{const n=yl(ie,e.__scopeMenu),{forceMount:r=n.forceMount,...o}=e,s=Ge(ie,e.__scopeMenu),i=Ut(ie,e.__scopeMenu);return b.jsx(jt.Provider,{scope:e.__scopeMenu,children:b.jsx(Ve,{present:r||s.open,children:b.jsx(jt.Slot,{scope:e.__scopeMenu,children:i.modal?b.jsx(fy,{...o,ref:t}):b.jsx(py,{...o,ref:t})})})})}),fy=f.forwardRef((e,t)=>{const n=Ge(ie,e.__scopeMenu),r=f.useRef(null),o=K(t,r);return f.useEffect(()=>{const s=r.current;if(s)return Ic(s)},[]),b.jsx(Lo,{...e,ref:o,trapFocus:n.open,disableOutsidePointerEvents:n.open,disableOutsideScroll:!0,onFocusOutside:V(e.onFocusOutside,s=>s.preventDefault(),{checkForDefaultPrevented:!1}),onDismiss:()=>n.onOpenChange(!1)})}),py=f.forwardRef((e,t)=>{const n=Ge(ie,e.__scopeMenu);return b.jsx(Lo,{...e,ref:t,trapFocus:!1,disableOutsidePointerEvents:!1,disableOutsideScroll:!1,onDismiss:()=>n.onOpenChange(!1)})}),yy=Xp("MenuContent.ScrollLock"),Lo=f.forwardRef((e,t)=>{const{__scopeMenu:n,loop:r=!1,trapFocus:o,onOpenAutoFocus:s,onCloseAutoFocus:i,disableOutsidePointerEvents:a,onEntryFocus:c,onEscapeKeyDown:l,onPointerDownOutside:u,onFocusOutside:d,onInteractOutside:p,onDismiss:y,disableOutsideScroll:g,...m}=e,v=Ge(ie,n),k=Ut(ie,n),x=Nn(n),M=fl(n),C=iy(n),[w,S]=f.useState(null),A=f.useRef(null),P=K(t,A,v.onContentChange),D=f.useRef(0),L=f.useRef(""),j=f.useRef(0),N=f.useRef(null),B=f.useRef("right"),F=f.useRef(0),W=g?So:f.Fragment,I=g?{as:yy,allowPinchZoom:!0}:void 0,O=T=>{var ve,mt;const _=L.current+T,Y=C().filter(re=>!re.disabled),de=document.activeElement,pt=(ve=Y.find(re=>re.ref.current===de))==null?void 0:ve.textValue,yt=Y.map(re=>re.textValue),$t=Py(yt,_,pt),je=(mt=Y.find(re=>re.textValue===$t))==null?void 0:mt.ref.current;(function re(gt){L.current=gt,window.clearTimeout(D.current),gt!==""&&(D.current=window.setTimeout(()=>re(""),1e3))})(_),je&&setTimeout(()=>je.focus())};f.useEffect(()=>()=>window.clearTimeout(D.current),[]),dc();const R=f.useCallback(T=>{var Y,de;return B.current===((Y=N.current)==null?void 0:Y.side)&&Ry(T,(de=N.current)==null?void 0:de.area)},[]);return b.jsx(hy,{scope:n,searchRef:L,onItemEnter:f.useCallback(T=>{R(T)&&T.preventDefault()},[R]),onItemLeave:f.useCallback(T=>{var _;R(T)||((_=A.current)==null||_.focus(),S(null))},[R]),onTriggerLeave:f.useCallback(T=>{R(T)&&T.preventDefault()},[R]),pointerGraceTimerRef:j,onPointerGraceIntentChange:f.useCallback(T=>{N.current=T},[]),children:b.jsx(W,{...I,children:b.jsx(mo,{asChild:!0,trapped:o,onMountAutoFocus:V(s,T=>{var _;T.preventDefault(),(_=A.current)==null||_.focus({preventScroll:!0})}),onUnmountAutoFocus:i,children:b.jsx(Sn,{asChild:!0,disableOutsidePointerEvents:a,onEscapeKeyDown:l,onPointerDownOutside:u,onFocusOutside:d,onInteractOutside:p,onDismiss:y,children:b.jsx(Kp,{asChild:!0,...M,dir:k.dir,orientation:"vertical",loop:r,currentTabStopId:w,onCurrentTabStopIdChange:S,onEntryFocus:V(c,T=>{k.isUsingKeyboardRef.current||T.preventDefault()}),preventScrollOnEntryFocus:!0,children:b.jsx(Ff,{role:"menu","aria-orientation":"vertical","data-state":Vl(v.open),"data-radix-menu-content":"",dir:k.dir,...x,...m,ref:P,style:{outline:"none",...m.style},onKeyDown:V(m.onKeyDown,T=>{const Y=T.target.closest("[data-radix-menu-content]")===T.currentTarget,de=T.ctrlKey||T.altKey||T.metaKey,pt=T.key.length===1;Y&&(T.key==="Tab"&&T.preventDefault(),!de&&pt&&O(T.key));const yt=A.current;if(T.target!==yt||!ry.includes(T.key))return;T.preventDefault();const je=C().filter(ve=>!ve.disabled).map(ve=>ve.ref.current);dl.includes(T.key)&&je.reverse(),Sy(je)}),onBlur:V(e.onBlur,T=>{T.currentTarget.contains(T.target)||(window.clearTimeout(D.current),L.current="")}),onPointerMove:V(e.onPointerMove,It(T=>{const _=T.target,Y=F.current!==T.clientX;if(T.currentTarget.contains(_)&&Y){const de=T.clientX>F.current?"right":"left";B.current=de,F.current=T.clientX}}))})})})})})})});gl.displayName=ie;var my="MenuGroup",Vo=f.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e;return b.jsx($.div,{role:"group",...r,ref:t})});Vo.displayName=my;var gy="MenuLabel",vl=f.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e;return b.jsx($.div,{...r,ref:t})});vl.displayName=gy;var bn="MenuItem",Si="menu.itemSelect",_n=f.forwardRef((e,t)=>{const{disabled:n=!1,onSelect:r,...o}=e,s=f.useRef(null),i=Ut(bn,e.__scopeMenu),a=Do(bn,e.__scopeMenu),c=K(t,s),l=f.useRef(!1),u=()=>{const d=s.current;if(!n&&d){const p=new CustomEvent(Si,{bubbles:!0,cancelable:!0});d.addEventListener(Si,y=>r==null?void 0:r(y),{once:!0}),Ei(d,p),p.defaultPrevented?l.current=!1:i.onClose()}};return b.jsx(kl,{...o,ref:c,disabled:n,onClick:V(e.onClick,u),onPointerDown:d=>{var p;(p=e.onPointerDown)==null||p.call(e,d),l.current=!0},onPointerUp:V(e.onPointerUp,d=>{var p;l.current||(p=d.currentTarget)==null||p.click()}),onKeyDown:V(e.onKeyDown,d=>{const p=a.searchRef.current!=="";n||p&&d.key===" "||Dr.includes(d.key)&&(d.currentTarget.click(),d.preventDefault())})})});_n.displayName=bn;var kl=f.forwardRef((e,t)=>{const{__scopeMenu:n,disabled:r=!1,textValue:o,...s}=e,i=Do(bn,n),a=fl(n),c=f.useRef(null),l=K(t,c),[u,d]=f.useState(!1),[p,y]=f.useState("");return f.useEffect(()=>{const g=c.current;g&&y((g.textContent??"").trim())},[s.children]),b.jsx(jt.ItemSlot,{scope:n,disabled:r,textValue:o??p,children:b.jsx(Zp,{asChild:!0,...a,focusable:!r,children:b.jsx($.div,{role:"menuitem","data-highlighted":u?"":void 0,"aria-disabled":r||void 0,"data-disabled":r?"":void 0,...s,ref:l,onPointerMove:V(e.onPointerMove,It(g=>{r?i.onItemLeave(g):(i.onItemEnter(g),g.defaultPrevented||g.currentTarget.focus({preventScroll:!0}))})),onPointerLeave:V(e.onPointerLeave,It(g=>i.onItemLeave(g))),onFocus:V(e.onFocus,()=>d(!0)),onBlur:V(e.onBlur,()=>d(!1))})})})}),vy="MenuCheckboxItem",xl=f.forwardRef((e,t)=>{const{checked:n=!1,onCheckedChange:r,...o}=e;return b.jsx(Sl,{scope:e.__scopeMenu,checked:n,children:b.jsx(_n,{role:"menuitemcheckbox","aria-checked":Cn(n)?"mixed":n,...o,ref:t,"data-state":jo(n),onSelect:V(o.onSelect,()=>r==null?void 0:r(Cn(n)?!0:!n),{checkForDefaultPrevented:!1})})})});xl.displayName=vy;var Ml="MenuRadioGroup",[ky,xy]=We(Ml,{value:void 0,onValueChange:()=>{}}),wl=f.forwardRef((e,t)=>{const{value:n,onValueChange:r,...o}=e,s=Me(r);return b.jsx(ky,{scope:e.__scopeMenu,value:n,onValueChange:s,children:b.jsx(Vo,{...o,ref:t})})});wl.displayName=Ml;var bl="MenuRadioItem",Cl=f.forwardRef((e,t)=>{const{value:n,...r}=e,o=xy(bl,e.__scopeMenu),s=n===o.value;return b.jsx(Sl,{scope:e.__scopeMenu,checked:s,children:b.jsx(_n,{role:"menuitemradio","aria-checked":s,...r,ref:t,"data-state":jo(s),onSelect:V(r.onSelect,()=>{var i;return(i=o.onValueChange)==null?void 0:i.call(o,n)},{checkForDefaultPrevented:!1})})})});Cl.displayName=bl;var Oo="MenuItemIndicator",[Sl,My]=We(Oo,{checked:!1}),Al=f.forwardRef((e,t)=>{const{__scopeMenu:n,forceMount:r,...o}=e,s=My(Oo,n);return b.jsx(Ve,{present:r||Cn(s.checked)||s.checked===!0,children:b.jsx($.span,{...o,ref:t,"data-state":jo(s.checked)})})});Al.displayName=Oo;var wy="MenuSeparator",Pl=f.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e;return b.jsx($.div,{role:"separator","aria-orientation":"horizontal",...r,ref:t})});Pl.displayName=wy;var by="MenuArrow",Tl=f.forwardRef((e,t)=>{const{__scopeMenu:n,...r}=e,o=Nn(n);return b.jsx(Nf,{...o,...r,ref:t})});Tl.displayName=by;var Cy="MenuSub",[f3,Rl]=We(Cy),bt="MenuSubTrigger",El=f.forwardRef((e,t)=>{const n=Ge(bt,e.__scopeMenu),r=Ut(bt,e.__scopeMenu),o=Rl(bt,e.__scopeMenu),s=Do(bt,e.__scopeMenu),i=f.useRef(null),{pointerGraceTimerRef:a,onPointerGraceIntentChange:c}=s,l={__scopeMenu:e.__scopeMenu},u=f.useCallback(()=>{i.current&&window.clearTimeout(i.current),i.current=null},[]);return f.useEffect(()=>u,[u]),f.useEffect(()=>{const d=a.current;return()=>{window.clearTimeout(d),c(null)}},[a,c]),b.jsx(Ro,{asChild:!0,...l,children:b.jsx(kl,{id:o.triggerId,"aria-haspopup":"menu","aria-expanded":n.open,"aria-controls":o.contentId,"data-state":Vl(n.open),...e,ref:Ue(t,o.onTriggerChange),onClick:d=>{var p;(p=e.onClick)==null||p.call(e,d),!(e.disabled||d.defaultPrevented)&&(d.currentTarget.focus(),n.open||n.onOpenChange(!0))},onPointerMove:V(e.onPointerMove,It(d=>{s.onItemEnter(d),!d.defaultPrevented&&!e.disabled&&!n.open&&!i.current&&(s.onPointerGraceIntentChange(null),i.current=window.setTimeout(()=>{n.onOpenChange(!0),u()},100))})),onPointerLeave:V(e.onPointerLeave,It(d=>{var y,g;u();const p=(y=n.content)==null?void 0:y.getBoundingClientRect();if(p){const m=(g=n.content)==null?void 0:g.dataset.side,v=m==="right",k=v?-5:5,x=p[v?"left":"right"],M=p[v?"right":"left"];s.onPointerGraceIntentChange({area:[{x:d.clientX+k,y:d.clientY},{x,y:p.top},{x:M,y:p.top},{x:M,y:p.bottom},{x,y:p.bottom}],side:m}),window.clearTimeout(a.current),a.current=window.setTimeout(()=>s.onPointerGraceIntentChange(null),300)}else{if(s.onTriggerLeave(d),d.defaultPrevented)return;s.onPointerGraceIntentChange(null)}})),onKeyDown:V(e.onKeyDown,d=>{var y;const p=s.searchRef.current!=="";e.disabled||p&&d.key===" "||oy[r.dir].includes(d.key)&&(n.onOpenChange(!0),(y=n.content)==null||y.focus(),d.preventDefault())})})})});El.displayName=bt;var Dl="MenuSubContent",Ll=f.forwardRef((e,t)=>{const n=yl(ie,e.__scopeMenu),{forceMount:r=n.forceMount,...o}=e,s=Ge(ie,e.__scopeMenu),i=Ut(ie,e.__scopeMenu),a=Rl(Dl,e.__scopeMenu),c=f.useRef(null),l=K(t,c);return b.jsx(jt.Provider,{scope:e.__scopeMenu,children:b.jsx(Ve,{present:r||s.open,children:b.jsx(jt.Slot,{scope:e.__scopeMenu,children:b.jsx(Lo,{id:a.contentId,"aria-labelledby":a.triggerId,...o,ref:l,align:"start",side:i.dir==="rtl"?"left":"right",disableOutsidePointerEvents:!1,disableOutsideScroll:!1,trapFocus:!1,onOpenAutoFocus:u=>{var d;i.isUsingKeyboardRef.current&&((d=c.current)==null||d.focus()),u.preventDefault()},onCloseAutoFocus:u=>u.preventDefault(),onFocusOutside:V(e.onFocusOutside,u=>{u.target!==a.trigger&&s.onOpenChange(!1)}),onEscapeKeyDown:V(e.onEscapeKeyDown,u=>{i.onClose(),u.preventDefault()}),onKeyDown:V(e.onKeyDown,u=>{var y;const d=u.currentTarget.contains(u.target),p=sy[i.dir].includes(u.key);d&&p&&(s.onOpenChange(!1),(y=a.trigger)==null||y.focus(),u.preventDefault())})})})})})});Ll.displayName=Dl;function Vl(e){return e?"open":"closed"}function Cn(e){return e==="indeterminate"}function jo(e){return Cn(e)?"indeterminate":e?"checked":"unchecked"}function Sy(e){const t=document.activeElement;for(const n of e)if(n===t||(n.focus(),document.activeElement!==t))return}function Ay(e,t){return e.map((n,r)=>e[(t+r)%e.length])}function Py(e,t,n){const o=t.length>1&&Array.from(t).every(l=>l===t[0])?t[0]:t,s=n?e.indexOf(n):-1;let i=Ay(e,Math.max(s,0));o.length===1&&(i=i.filter(l=>l!==n));const c=i.find(l=>l.toLowerCase().startsWith(o.toLowerCase()));return c!==n?c:void 0}function Ty(e,t){const{x:n,y:r}=e;let o=!1;for(let s=0,i=t.length-1;s<t.length;i=s++){const a=t[s],c=t[i],l=a.x,u=a.y,d=c.x,p=c.y;u>r!=p>r&&n<(d-l)*(r-u)/(p-u)+l&&(o=!o)}return o}function Ry(e,t){if(!t)return!1;const n={x:e.clientX,y:e.clientY};return Ty(n,t)}function It(e){return t=>t.pointerType==="mouse"?e(t):void 0}var Ey=pl,Dy=Ro,Ly=ml,Vy=gl,Oy=Vo,jy=vl,Iy=_n,Fy=xl,Ny=wl,_y=Cl,By=Al,zy=Pl,Hy=Tl,qy=El,Uy=Ll,Bn="DropdownMenu",[$y]=lt(Bn,[hl]),Q=hl(),[Wy,Ol]=$y(Bn),jl=e=>{const{__scopeDropdownMenu:t,children:n,dir:r,open:o,defaultOpen:s,onOpenChange:i,modal:a=!0}=e,c=Q(t),l=f.useRef(null),[u,d]=Vr({prop:o,defaultProp:s??!1,onChange:i,caller:Bn});return b.jsx(Wy,{scope:t,triggerId:nt(),triggerRef:l,contentId:nt(),open:u,onOpenChange:d,onOpenToggle:f.useCallback(()=>d(p=>!p),[d]),modal:a,children:b.jsx(Ey,{...c,open:u,onOpenChange:d,dir:r,modal:a,children:n})})};jl.displayName=Bn;var Il="DropdownMenuTrigger",Fl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,disabled:r=!1,...o}=e,s=Ol(Il,n),i=Q(n);return b.jsx(Dy,{asChild:!0,...i,children:b.jsx($.button,{type:"button",id:s.triggerId,"aria-haspopup":"menu","aria-expanded":s.open,"aria-controls":s.open?s.contentId:void 0,"data-state":s.open?"open":"closed","data-disabled":r?"":void 0,disabled:r,...o,ref:Ue(t,s.triggerRef),onPointerDown:V(e.onPointerDown,a=>{!r&&a.button===0&&a.ctrlKey===!1&&(s.onOpenToggle(),s.open||a.preventDefault())}),onKeyDown:V(e.onKeyDown,a=>{r||(["Enter"," "].includes(a.key)&&s.onOpenToggle(),a.key==="ArrowDown"&&s.onOpenChange(!0),["Enter"," ","ArrowDown"].includes(a.key)&&a.preventDefault())})})})});Fl.displayName=Il;var Gy="DropdownMenuPortal",Nl=e=>{const{__scopeDropdownMenu:t,...n}=e,r=Q(t);return b.jsx(Ly,{...r,...n})};Nl.displayName=Gy;var _l="DropdownMenuContent",Bl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Ol(_l,n),s=Q(n),i=f.useRef(!1);return b.jsx(Vy,{id:o.contentId,"aria-labelledby":o.triggerId,...s,...r,ref:t,onCloseAutoFocus:V(e.onCloseAutoFocus,a=>{var c;i.current||(c=o.triggerRef.current)==null||c.focus(),i.current=!1,a.preventDefault()}),onInteractOutside:V(e.onInteractOutside,a=>{const c=a.detail.originalEvent,l=c.button===0&&c.ctrlKey===!0,u=c.button===2||l;(!o.modal||u)&&(i.current=!0)}),style:{...e.style,"--radix-dropdown-menu-content-transform-origin":"var(--radix-popper-transform-origin)","--radix-dropdown-menu-content-available-width":"var(--radix-popper-available-width)","--radix-dropdown-menu-content-available-height":"var(--radix-popper-available-height)","--radix-dropdown-menu-trigger-width":"var(--radix-popper-anchor-width)","--radix-dropdown-menu-trigger-height":"var(--radix-popper-anchor-height)"}})});Bl.displayName=_l;var Ky="DropdownMenuGroup",zl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Oy,{...o,...r,ref:t})});zl.displayName=Ky;var Zy="DropdownMenuLabel",Hl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(jy,{...o,...r,ref:t})});Hl.displayName=Zy;var Xy="DropdownMenuItem",ql=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Iy,{...o,...r,ref:t})});ql.displayName=Xy;var Yy="DropdownMenuCheckboxItem",Ul=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Fy,{...o,...r,ref:t})});Ul.displayName=Yy;var Qy="DropdownMenuRadioGroup",$l=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Ny,{...o,...r,ref:t})});$l.displayName=Qy;var Jy="DropdownMenuRadioItem",Wl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(_y,{...o,...r,ref:t})});Wl.displayName=Jy;var em="DropdownMenuItemIndicator",Gl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(By,{...o,...r,ref:t})});Gl.displayName=em;var tm="DropdownMenuSeparator",Kl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(zy,{...o,...r,ref:t})});Kl.displayName=tm;var nm="DropdownMenuArrow",rm=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Hy,{...o,...r,ref:t})});rm.displayName=nm;var om="DropdownMenuSubTrigger",Zl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(qy,{...o,...r,ref:t})});Zl.displayName=om;var sm="DropdownMenuSubContent",Xl=f.forwardRef((e,t)=>{const{__scopeDropdownMenu:n,...r}=e,o=Q(n);return b.jsx(Uy,{...o,...r,ref:t,style:{...e.style,"--radix-dropdown-menu-content-transform-origin":"var(--radix-popper-transform-origin)","--radix-dropdown-menu-content-available-width":"var(--radix-popper-available-width)","--radix-dropdown-menu-content-available-height":"var(--radix-popper-available-height)","--radix-dropdown-menu-trigger-width":"var(--radix-popper-anchor-width)","--radix-dropdown-menu-trigger-height":"var(--radix-popper-anchor-height)"}})});Xl.displayName=sm;var p3=jl,y3=Fl,m3=Nl,g3=Bl,v3=zl,k3=Hl,x3=ql,M3=Ul,w3=$l,b3=Wl,C3=Gl,S3=Kl,A3=Zl,P3=Xl;export{Zm as $,If as A,lm as B,Ff as C,Sn as D,px as E,mo as F,Nm as G,_m as H,mk as I,H5 as J,lg as K,Fm as L,M4 as M,Sk as N,v5 as O,$ as P,eg as Q,cm as R,j5 as S,kx as T,Rx as U,Vx as V,Px as W,Zx as X,Jv as Y,e5 as Z,H4 as _,Vr as a,F5 as a$,Yv as a0,i4 as a1,S5 as a2,T5 as a3,Jg as a4,p5 as a5,U4 as a6,Z5 as a7,Qm as a8,cg as a9,ov as aA,c5 as aB,Zv as aC,i5 as aD,Xx as aE,Ug as aF,Om as aG,Fg as aH,J4 as aI,Bv as aJ,Km as aK,Ng as aL,Gx as aM,zx as aN,bg as aO,Ok as aP,Sg as aQ,Nv as aR,Mx as aS,ek as aT,Jk as aU,mx as aV,Fx as aW,a5 as aX,Nx as aY,Cm as aZ,wm as a_,bm as aa,yv as ab,A4 as ac,uk as ad,Im as ae,xk as af,D5 as ag,Lk as ah,Wm as ai,Lv as aj,Y4 as ak,Xk as al,Av as am,n5 as an,Qg as ao,K4 as ap,_k as aq,Jx as ar,t3 as as,x5 as at,Xg as au,Tm as av,xm as aw,tv as ax,sk as ay,Hg as az,Ve as b,Mk as b$,G4 as b0,h4 as b1,Hk as b2,vx as b3,s3 as b4,a3 as b5,l3 as b6,u3 as b7,d3 as b8,c3 as b9,f5 as bA,Xv as bB,Kx as bC,$k as bD,Ex as bE,o4 as bF,Zk as bG,r3 as bH,o3 as bI,h3 as bJ,Zg as bK,A5 as bL,_5 as bM,Uv as bN,qv as bO,o5 as bP,Pm as bQ,gm as bR,Hm as bS,qm as bT,U5 as bU,fv as bV,pg as bW,dg as bX,Tf as bY,W5 as bZ,L4 as b_,i3 as ba,Qk as bb,p3 as bc,y3 as bd,v3 as be,m3 as bf,g3 as bg,x3 as bh,S3 as bi,k3 as bj,M3 as bk,C3 as bl,A3 as bm,fg as bn,P3 as bo,b3 as bp,Ig as bq,w3 as br,Ck as bs,_x as bt,N5 as bu,Q5 as bv,c4 as bw,a4 as bx,um as by,Ak as bz,V as c,B4 as c$,M5 as c0,R5 as c1,m4 as c2,Bk as c3,h5 as c4,cv as c5,jg as c6,Rv as c7,Kp as c8,Zp as c9,Jm as cA,Vg as cB,$g as cC,ng as cD,iv as cE,Y5 as cF,s4 as cG,nx as cH,lk as cI,k5 as cJ,D4 as cK,xv as cL,hg as cM,Kg as cN,Gm as cO,Ax as cP,X5 as cQ,dv as cR,j4 as cS,q5 as cT,$5 as cU,Mg as cV,$x as cW,I4 as cX,z4 as cY,N4 as cZ,Wx as c_,il as ca,Wk as cb,fm as cc,vm as cd,y5 as ce,Pk as cf,d5 as cg,fk as ch,Nk as ci,T4 as cj,Sv as ck,rv as cl,jv as cm,Lx as cn,vg as co,ig as cp,ak as cq,dm as cr,Pg as cs,E4 as ct,Dm as cu,bx as cv,gx as cw,lv as cx,hm as cy,Mm as cz,Me as d,km as d$,n4 as d0,r4 as d1,nv as d2,F4 as d3,vk as d4,Yg as d5,hv as d6,Em as d7,Fv as d8,qk as d9,Bx as dA,Xm as dB,dk as dC,$v as dD,$4 as dE,W4 as dF,Sx as dG,yg as dH,yk as dI,Tx as dJ,ok as dK,Vv as dL,pm as dM,vv as dN,Vm as dO,r5 as dP,Tv as dQ,u5 as dR,Wg as dS,nk as dT,u4 as dU,tk as dV,Kk as dW,av as dX,Gk as dY,v4 as dZ,f4 as d_,Lm as da,b5 as db,ox as dc,V4 as dd,rx as de,t4 as df,S4 as dg,ix as dh,C5 as di,qg as dj,C4 as dk,P5 as dl,K5 as dm,$m as dn,tg as dp,Rg as dq,q4 as dr,b4 as ds,Iv as dt,m5 as du,n3 as dv,xg as dw,wg as dx,jx as dy,Bm as dz,Ri as e,y4 as e$,pk as e0,Am as e1,wv as e2,g5 as e3,s5 as e4,Pv as e5,Sm as e6,Ik as e7,ag as e8,kk as e9,w4 as eA,J5 as eB,Ov as eC,bv as eD,Dv as eE,zk as eF,Q4 as eG,Vk as eH,gg as eI,mg as eJ,jk as eK,sg as eL,Ag as eM,mv as eN,Cx as eO,R4 as eP,Gv as eQ,Qx as eR,Yx as eS,d4 as eT,ev as eU,hk as eV,Ym as eW,uv as eX,Fk as eY,e4 as eZ,P4 as e_,O4 as ea,Hv as eb,cx as ec,lx as ed,Rm as ee,Rk as ef,Uk as eg,Og as eh,Dg as ei,dx as ej,x4 as ek,rg as el,Dk as em,Dx as en,z5 as eo,Gg as ep,zv as eq,Eg as er,ux as es,Cv as et,t5 as eu,X4 as ev,_v as ew,_4 as ex,pv as ey,gk as ez,lt as f,wx as f0,E5 as f1,og as f2,gv as f3,Tg as f4,qx as f5,Kv as f6,yx as f7,mm as f8,zg as f9,ax as fA,ym as fB,G5 as fC,Bg as fD,fx as fE,sx as fF,ex as fG,w5 as fH,Tk as fI,Ox as fJ,Mv as fK,hx as fL,tx as fM,kv as fN,xx as fO,Z4 as fa,l4 as fb,ck as fc,Ix as fd,p4 as fe,I5 as ff,Hx as fg,l5 as fh,sv as fi,Qv as fj,g4 as fk,Lg as fl,rk as fm,ik as fn,Ek as fo,wk as fp,Yk as fq,Um as fr,zm as fs,Ux as ft,k4 as fu,V5 as fv,Wv as fw,bk as fx,jm as fy,B5 as fz,Lr as g,Te as h,Ei as i,Ue as j,uc as k,Ic as l,So as m,Ac as n,dc as o,jf as p,nt as q,Nf as r,kg as s,Cg as t,K as u,Ev as v,_g as w,O5 as x,L5 as y,ug as z};
