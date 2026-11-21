// 命令行里直接问一个问题，用来不开网页就验证整条链路：
//   npm run ask -- "forfettario 今年的营业额上限是多少？"
import { ask } from './agent.mjs';

const question = process.argv.slice(2).join(' ').trim();
if (!question) {
  console.error('用法：npm run ask -- "你的问题"');
  process.exit(1);
}

for await (const ev of ask(question)) {
  if (ev.type === 'delta') process.stdout.write(ev.text);
  else if (ev.type === 'tool') process.stdout.write(`\n  · ${ev.text}\n`);
  else if (ev.type === 'done') {
    console.log(`\n\n—— 用时 ${(ev.durationMs / 1000).toFixed(0)} 秒，${ev.turns} 轮，引用知识库文档 ${ev.sources.length} 篇`);
    for (const s of ev.sources) console.log(`   ${s.title}\n   ${s.url}`);
  } else if (ev.type === 'error') {
    console.error(`\n✗ ${ev.message}`);
    process.exitCode = 1;
  }
}
