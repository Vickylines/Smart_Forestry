<script setup lang="ts">
import { onLaunch, onHide } from '@dcloudio/uni-app';
import { pauseRecognition } from './services/recognition';
import { installButtonKeyboardSupport } from './services/accessibility';
onLaunch(() => {
  installButtonKeyboardSupport();
  try { uni.removeStorageSync('forest-observer:service:v1'); } catch { /* Legacy settings are no longer used. */ }
});
onHide(pauseRecognition);
</script>

<style>
page {
  --canvas:#f5f6f7;
  --surface:#ffffff;
  --ink:#202b26;
  --secondary:#626e67;
  --accent:#236447;
  --tint:#eaf2ec;
  --separator:#e5e9e6;
  --control:#e9edea;
  background:var(--canvas);
  color:var(--ink);
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;
  font-size:16px;
  line-height:1.5;
  font-optical-sizing:auto;
  -webkit-font-smoothing:antialiased;
}
view, text, button, input, textarea { box-sizing:border-box; }
.page { max-width:880px; margin:0 auto; padding:24px 20px 40px; }
.root-page { padding-top:calc(28px + var(--status-bar-height, 0px)); }
.page button, .page uni-button {
  display:flex; align-items:center; justify-content:center; gap:8px;
  min-height:44px; margin:0; padding:10px 16px;
  color:inherit; font:inherit; font-size:.9375rem; font-weight:600;
  line-height:1.4; border-radius:14px; cursor:pointer;
  -webkit-tap-highlight-color:transparent;
}
.page button::after, .page uni-button::after { border:none; }
.page button[disabled], .page uni-button[disabled] { opacity:.42; cursor:default; }
.page .control-pressed { opacity:.66; }
.page .primary { color:#fff; background:var(--accent); padding:14px 20px; }
.page .secondary { color:var(--accent); background:var(--tint); padding:14px 18px; }
.page .plain { color:var(--accent); background:transparent; padding:10px 4px; }
.page .danger { color:#b1382e; background:transparent; }
.page .settings-row { display:flex; justify-content:space-between; width:100%; min-height:60px; padding:16px 0; background:transparent; border-radius:0; font-weight:400; text-align:left; }
.settings-row + .settings-row { border-top:1px solid var(--separator); }
.settings-group { padding:0 18px; }
.settings-heading { display:block; margin:0 4px 12px; color:var(--secondary); font-size:.8125rem; font-weight:500; }
.page .icon-button { flex-shrink:0; width:44px; height:44px; padding:10px; background:var(--control); border-radius:50%; }
.wide { width:100%; }
.eyebrow { display:block; font-size:.8125rem; line-height:1.5; font-weight:500; color:var(--secondary); }
.page-title { display:block; margin-top:6px; font-size:2rem; line-height:1.22; font-weight:700; letter-spacing:-.035em; overflow-wrap:anywhere; text-wrap:balance; }
.subtitle { display:block; margin-top:8px; color:var(--secondary); font-size:.875rem; line-height:1.65; overflow-wrap:anywhere; }
.row { display:flex; align-items:center; gap:12px; }
.between { justify-content:space-between; }
.grow { flex:1; min-width:0; }
.page .section { margin-top:28px; }
.section-title { font-size:1.125rem; font-weight:650; letter-spacing:-.02em; line-height:1.4; }
.muted { color:var(--secondary); }
.small { font-size:.8125rem; line-height:1.6; }
.demo-notice { margin:20px 0; padding:14px 16px; border-radius:14px; background:#ecefec; color:#56655b; font-size:.8125rem; line-height:1.65; overflow-wrap:anywhere; }
.error-notice { display:block; max-width:100%; min-width:0; overflow-wrap:anywhere; white-space:normal; color:#a03323; background:#fff0eb; border:1px solid #efc2b4; padding:14px; border-radius:12px; margin:12px 0; font-size:.875rem; line-height:1.6; }
.card { background:var(--surface); border:1px solid var(--separator); border-radius:20px; overflow:hidden; }
.padded { padding:20px; }
.badge { display:inline-block; flex-shrink:0; font-size:.75rem; font-weight:500; padding:4px 8px; line-height:1.5; border-radius:7px; background:#edf0ed; color:#59665e; }
.status-pending { background:#fff2d9; color:#815b17; }
.status-confirmed { background:#e6f1e9; color:#27633f; }
.status-undetermined { background:#eceeed; color:#5a635e; }
.field-label { display:block; font-size:.875rem; font-weight:500; margin:18px 0 8px; }
.field { width:100%; height:3.125rem; min-height:50px; padding:12px 14px; background:var(--surface); color:var(--ink); border:1px solid #cbd3cd; border-radius:12px; font-size:1rem; font-family:inherit; }
.textarea { min-height:112px; height:7rem; line-height:1.6; }
.empty { padding:36px 20px; text-align:center; color:var(--secondary); line-height:1.8; }
.divider { height:1px; background:var(--separator); margin:18px 0; }
.filter-row { display:flex; gap:4px; flex-wrap:wrap; margin:20px 0 18px; padding:4px; border-radius:13px; background:var(--control); }
.page .filter { flex:1 1 0; min-width:3.6em; padding:9px 6px; color:#59665e; background:transparent; font-size:.8125rem; font-weight:500; border-radius:9px; }
.page .filter.active { color:var(--ink); background:var(--surface); box-shadow:0 1px 4px #2038281c; font-weight:600; }
.stats { display:flex; flex-wrap:wrap; gap:12px; padding:24px 0; }
.stats > view { flex:1; min-width:4.5em; }
.stat-number { display:block; color:var(--ink); font-size:1.875rem; line-height:1.15; font-weight:600; letter-spacing:-.035em; font-variant-numeric:tabular-nums; }
.stat-label { display:block; font-size:.8125rem; color:var(--secondary); margin-top:8px; text-wrap:balance; }
.back-link { color:var(--accent); margin-bottom:15px; font-size:.875rem; }
/* Native buttons also use hover-class with a zero-delay press state. */
@media (hover:hover) { .page button:not([disabled]):hover, .page uni-button:not([disabled]):hover { filter:brightness(.97); } }
@media (min-width:700px) { .page { padding:36px 32px 56px; } .root-page { padding-top:44px; } .page-title { font-size:2.25rem; } }
@media (max-width:350px) { .page { padding-left:16px; padding-right:16px; } .page-title { font-size:1.875rem; } .row { gap:8px; } .padded { padding:16px; } }
@media (prefers-reduced-motion:reduce) { *, *::before, *::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; } }
@media (prefers-contrast:more) {
  page { --secondary:#3d4a41; --separator:#8f9d94; --control:#e0e7e1; }
  .card, .demo-notice, .field, .filter-row { border:1px solid #829187; }
  .page .filter.active { outline:1px solid #687d6e; }
}
/* #ifdef H5 */
html, body { font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif; background:#f5f6f7; }
/* This UI uses px for geometry and rem for type, not uni-app's rpx/rem scaling. */
html { font-size:100%!important; }
.page button:not([disabled]):active, .page uni-button:not([disabled]):active { opacity:.66; }
.page :focus-visible { outline:3px solid #6b9e81; outline-offset:3px; }
.field:focus-within { border-color:#236447; box-shadow:0 0 0 3px #23644714; }
.field input:focus-visible, .field textarea:focus-visible { outline:none; }
.field input, .field textarea { font-family:inherit; }
uni-page-head .uni-page-head { border-bottom:1px solid #e5e9e6; }
uni-tabbar .uni-tabbar { border-top:1px solid #e5e9e6; }
uni-tabbar .uni-tabbar__label { font-weight:500; }
/* Keep the framework's mobile navigation shadow available without its CDN bitmap. */
.uni-page-head-shadow-grey::after, .uni-page-head-shadow-blue::after { background-image:linear-gradient(to right,transparent,#202b2618)!important; }
@keyframes shadow-preload { from, to { background-image:none; } }
@supports (backdrop-filter:blur(20px)) {
  uni-page-head .uni-page-head { background:rgba(245,246,247,.94)!important; backdrop-filter:blur(20px); }
  uni-tabbar .uni-tabbar { background:rgba(255,255,255,.94)!important; backdrop-filter:blur(20px)!important; }
}
@media (prefers-reduced-transparency:reduce), (prefers-contrast:more) {
  uni-page-head .uni-page-head { background:#f5f6f7!important; backdrop-filter:none!important; }
  uni-tabbar .uni-tabbar { background:#fff!important; backdrop-filter:none!important; }
}
/* #endif */
</style>
