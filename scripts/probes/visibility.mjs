export default async function run({ page, frame }) {
  return JSON.stringify(await (frame ?? page).evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus() })));
}
