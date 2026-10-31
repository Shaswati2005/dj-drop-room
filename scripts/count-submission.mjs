// node scripts/count-submission.mjs: counts the tagline characters (max 140) and the description
// words (max 500) in SUBMISSION.md, writes the counts into the "(N characters)" / "(N words)" lines
// and prints PASS/FAIL. Markdown markers (**, `, links) are not counted as words or characters.
import fs from 'node:fs';

const file = 'SUBMISSION.md';
let text = fs.readFileSync(file, 'utf8');
const plain = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');

const tagline = /## Tagline[^\n]*\n\n([^\n]+)\n/.exec(text)?.[1] ?? '';
const chars = [...plain(tagline).trim()].length;
const block = /<!-- DESCRIPTION:START -->\n([\s\S]*?)\n<!-- DESCRIPTION:END -->/.exec(text)?.[1] ?? '';
const words = plain(block).split(/\s+/).filter(Boolean).length;

text = text.replace(/\((?:TAGLINE_CHARS|\d+) characters\)/, `(${chars} characters)`).replace(/\((?:DESCRIPTION_WORDS|\d+) words\)/, `(${words} words)`);
fs.writeFileSync(file, text, 'utf8');
console.log(`${chars <= 140 ? 'PASS' : 'FAIL'} tagline is ${chars} characters (max 140)`);
console.log(`${words <= 500 ? 'PASS' : 'FAIL'} description is ${words} words (max 500)`);
const required = ['## Project name', '## Tagline', 'Track: **Entertainment**', 'Division: **New Experience**', '## Description', '## Hand-interaction write-up', '## Accessibility', '## Come-back paragraph', '## Future plans', '## Launch date', '## Team', '<LIVE URL — pending deploy>'];
const missing = required.filter((r) => !text.includes(r));
console.log(`${missing.length === 0 ? 'PASS' : 'FAIL'} every form field is present${missing.length ? ': missing ' + missing.join(', ') : ''}`);
