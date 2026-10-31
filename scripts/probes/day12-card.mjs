export default async function run({ page, frame }) {
  const app = frame ?? page;
  await app.evaluate(async () => { const d = window.__dropRoom; await d.start(); d.forceHype(0.9); await new Promise(r=>setTimeout(r,2500)); d.forceHype(null); d.finishSet(); });
  return 'ok';
}
