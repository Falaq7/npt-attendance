import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const source=await fs.readFile('worker/index.js','utf8');
const {default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const rows=new Map(Object.entries({
 'owner/anatomy/session1':{id:'session1'},
 'session/session1':{id:'session1',owner:'anatomy',title:'Head & neck',label:'Week 1',date:'2026-11-02',time:'17:00',people:[{id:'private-id',firstName:'Amy',email:'never-export@example.test'}]},
 'check/session1/private-id':{id:'private-id',time:'2026-11-02T17:01:00Z'}
}));
const env={EXCEL_FEED_TOKEN:'fixture-only',BUCKET:{get:async key=>rows.has(key)?{json:async()=>rows.get(key)}:null,list:async({prefix})=>({objects:[...rows.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))})}};
const call=token=>worker.fetch(new Request('https://test/api/excel/feed'+(token?'?token='+token:'')),env);
assert.equal((await call()).status,404);
assert.equal((await call('wrong')).status,404);
let result=await call('fixture-only');assert.equal(result.status,200);assert.match(result.headers.get('content-type'),/rss/);
let xml=await result.text();assert.ok(xml.includes('Amy'));assert.ok(xml.includes('2026-11-02T17:01:00Z'));assert.ok(xml.includes('Head &amp; neck'));assert.ok(!xml.includes('private-id'));assert.ok(!xml.includes('never-export'));assert.ok(!xml.includes('owner'));
rows.get('session/session1').archived=true;xml=await (await call('fixture-only')).text();assert.ok(!xml.includes('Amy'));
console.log('Passed: feed authentication, XML escaping, attendance timestamps, private field exclusion and session deletion.');
