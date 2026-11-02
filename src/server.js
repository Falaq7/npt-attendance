const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-GB');
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s));
export default {async fetch(req,env){try{
 const u=new URL(req.url),p=u.pathname;
 if(!p.startsWith('/api/'))return new Response(HTML,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin'}});
 if(req.method!=='GET'&&req.headers.get('origin')&&req.headers.get('origin')!==u.origin)return json({error:'Invalid request origin.'},403);
 const b=env.BUCKET;if(!b)return json({error:'Storage is unavailable.'},503);
 const read=async k=>{const o=await b.get(k);return o?o.json():null};
 const list=async prefix=>{let objects=[],cursor;do{const page=await b.list({prefix,cursor});objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined}while(cursor);return Promise.all(objects.map(async o=>({...await read(o.key),_key:o.key})))};
 const session=async id=>{const s=await read('session/'+id);if(!s)return null;const registered=await list('registration/'+id+'/');const people=new Map((s.people||[]).map(p=>[norm(p.id),p]));for(const p of registered)if(!people.has(norm(p.id)))people.set(norm(p.id),p);return {...s,people:[...people.values()]}};
 const pub=p.match(/^\/api\/public\/([\w-]+)$/);
 if(pub&&req.method==='GET'){const s=await session(pub[1]);if(!s)return json({error:'Session not found.'},404);return json({title:s.title,label:s.label,date:s.date,time:s.time,room:s.room,open:s.open,registrationOpen:s.registrationOpen!==false})}
 if(p==='/api/register'&&req.method==='POST'){
 const d=await req.json(),s=await session(d.session);if(!s||s.registrationOpen===false)return json({error:'Registration is closed.'},400);
 const first=String(d.firstName||'').trim(),email=norm(d.email);if(!first||first.length>80||!/^\S+@\S+\.\S+$/.test(email)||email.length>254)return json({error:'Enter your first name and a valid email.'},400);
 const existing=s.people.find(p=>norm(p.id)===email);if(!existing){await b.put('registration/'+s.id+'/'+encodeURIComponent(email),JSON.stringify({name:first,firstName:first,id:email,registeredAt:new Date().toISOString()}))}return json({registered:true});}
 if(p==='/api/checkin'&&req.method==='POST'){
 const d=await req.json(),s=await session(d.session);if(!s||!s.open)return json({error:'Check-in is closed for this session.'},400);
 const candidates=d.id?s.people.filter(p=>norm(p.id)===norm(d.id)):s.people.filter(p=>norm(p.firstName||p.name.split(/\s+/)[0])===norm(d.firstName));
 if(!candidates.length)return json({error:'No matching registration. Check your first name or speak to the organiser.'},404);
 const person=candidates[0],k='check/'+s.id+'/'+encodeURIComponent(norm(person.id));let c=await read(k);if(!c){c={id:person.id,time:new Date().toISOString()};await b.put(k,JSON.stringify(c),{onlyIf:{etagDoesNotMatch:'*'}});c=await read(k)||c}return json({name:person.name,time:c.time});}
 const key=req.headers.get('x-admin-key');if(!key||key.length<30)return json({error:'Manager access required.'},401);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key));const owner=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 if(p==='/api/sessions'&&req.method==='GET'){const refs=await list('owner/'+owner+'/');const sessions=await Promise.all(refs.map(r=>session(r.id||r._key.split('/').pop())));return json(sessions.filter(Boolean))}
 if(p==='/api/sessions'&&req.method==='POST'){
 const d=await req.json();if(!String(d.title||'').trim()||!validDate(d.date)||!Array.isArray(d.people)||d.people.length>2000)return json({error:'Enter a session name and valid date.'},400);
 const ids=new Set();for(const p of d.people){if(!p.name||!p.id||ids.has(norm(p.id)))return json({error:'Register rows need a name and unique email or ID.'},400);ids.add(norm(p.id))}
 const s={id:crypto.randomUUID(),owner,title:String(d.title).trim().slice(0,150),label:String(d.label||'').slice(0,150),date:d.date,time:String(d.time||'').slice(0,5),room:String(d.room||'').slice(0,150),people:d.people,open:false,registrationOpen:true};await b.put('session/'+s.id,JSON.stringify(s));await b.put('owner/'+owner+'/'+s.id,JSON.stringify({id:s.id}));return json(s)}
 const m=p.match(/^\/api\/sessions\/([\w-]+)$/);if(m){let s=await read('session/'+m[1]);if(!s||s.owner!==owner)return json({error:'Session not found.'},404);
 if(req.method==='PATCH'){const d=await req.json();if('date'in d&&!validDate(d.date))return json({error:'Enter a valid date.'},400);if('title'in d&&!String(d.title).trim())return json({error:'Enter a session name.'},400);for(const f of ['title','label','date','time','room'])if(f in d)s[f]=String(d[f]).trim().slice(0,150);if('people'in d){if(!Array.isArray(d.people)||d.people.length>2000)return json({error:'Import up to 2,000 rows.'},400);const people=new Map((s.people||[]).map(p=>[norm(p.id),p]));for(const p of d.people){if(!String(p.name||'').trim()||!String(p.id||'').trim())return json({error:'Each row needs a name and email or ID.'},400);people.set(norm(p.id),{name:String(p.name).trim().slice(0,180),id:String(p.id).trim().slice(0,254)})}s.people=[...people.values()]}for(const f of ['open','registrationOpen'])if(f in d)s[f]=!!d[f];await b.put('session/'+s.id,JSON.stringify(s))}
 s=await session(s.id);return json({...s,records:await list('check/'+s.id+'/')})}
 return json({error:'Not found.'},404)
 }catch(e){return json({error:'Request failed. Please try again.'},500)}}};
