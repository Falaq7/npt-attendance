const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-GB');
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s));
const firstOf=p=>p.firstName||p.name?.split(/\s+/)[0]||'';
const application={async fetch(req,env){try{
 const u=new URL(req.url),p=u.pathname;
 if(!p.startsWith('/api/'))return new Response(HTML,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin'}});
 const b=env.BUCKET||(env.DB?databaseStore(env.DB):null);if(!b)return json({error:'Storage is unavailable.'},503);
 const read=async k=>{const o=await b.get(k);return o?o.json():null};
 const list=async prefix=>{let objects=[],cursor;do{const page=await b.list({prefix,cursor});objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined}while(cursor);return Promise.all(objects.map(async o=>({...await read(o.key),_key:o.key})))};
 const session=async id=>{const s=await read('session/'+id);if(!s)return null;const people=new Map((s.people||[]).map(p=>[norm(p.id),p]));for(const prefix of ['registration/','person/'])for(const person of await list(prefix+id+'/'))people.set(norm(person.id),person);return {...s,people:[...people.values()].filter(p=>!p.removed),removedPeople:[...people.values()].filter(p=>p.removed)}};
 const checks=async id=>(await list('check/'+id+'/')).filter(r=>!r.inactive);
 const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
 if(p==='/api/auth/login'&&req.method==='POST'){
  if(!env.MANAGER_PASSWORD)return json({error:'Manager sign-in is not configured.'},503);
  const ip=await sha(req.headers.get('cf-connecting-ip')||'local'),attemptKey='auth/attempt/'+ip,now=Date.now(),prior=await read(attemptKey);const attempt=prior&&prior.until>now?prior:{count:0,until:now+900000};if(attempt.count>=10)return json({error:'Too many attempts. Try again in 15 minutes.'},429);
  const d=await req.json();if(typeof d.password!=='string'||d.password.length>256||await sha(d.password)!==await sha(env.MANAGER_PASSWORD)){attempt.count++;await b.put(attemptKey,JSON.stringify(attempt));return json({error:'Incorrect password.'},401)}
  await b.put(attemptKey,JSON.stringify({count:0,until:0}));
  if(typeof d.legacyKey==='string'&&d.legacyKey.length>=30){const oldOwner=await sha(d.legacyKey);for(const ref of await list('owner/'+oldOwner+'/')){const id=ref.id||ref._key.split('/').pop(),old=await read('session/'+id);if(old?.owner===oldOwner){old.owner='anatomy';await b.put('session/'+id,JSON.stringify(old));await b.put('owner/anatomy/'+id,JSON.stringify({id}))}}}
  const token=crypto.randomUUID()+crypto.randomUUID();await b.put('auth/session/'+await sha(token),JSON.stringify({expires:now+43200000}));return json({token});
 }
 const publicMatch=p.match(/^\/api\/public\/([\w-]+)$/);
 if(publicMatch&&req.method==='GET'){const s=await session(publicMatch[1]);if(!s||s.archived)return json({error:'Session not found.'},404);return json({title:s.title,label:s.label,date:s.date,time:s.time,open:s.open,registrationOpen:s.registrationOpen!==false})}
 if(p==='/api/register'&&req.method==='POST'){
  const d=await req.json(),s=await session(d.session);if(!s||s.archived||s.registrationOpen===false)return json({error:'Registration is closed.'},400);
  const first=String(d.firstName||'').trim().replace(/\s+/g,' ');if(!first||first.length>80)return json({error:'Enter your first name.'},400);
  if(!s.people.some(p=>norm(firstOf(p))===norm(first))){const person={id:crypto.randomUUID(),name:first,firstName:first,registeredAt:new Date().toISOString()};await b.put('registration/'+s.id+'/'+person.id,JSON.stringify(person))}return json({registered:true});
 }
 if(p==='/api/checkin'&&req.method==='POST'){
  const d=await req.json(),s=await session(d.session);if(!s||s.archived||!s.open)return json({error:'Check-in is closed for this session.'},400);
  const person=s.people.find(p=>norm(firstOf(p))===norm(d.firstName));if(!person)return json({error:'No matching registration. Check your first name or speak to the organiser.'},404);
  const k='check/'+s.id+'/'+encodeURIComponent(norm(person.id));let c=await read(k);if(!c||c.inactive){const wasInactive=c?.inactive;c={id:person.id,time:new Date().toISOString()};await b.put(k,JSON.stringify(c),wasInactive?undefined:{onlyIf:{etagDoesNotMatch:'*'}});c=await read(k)||c}return json({name:firstOf(person),time:c.time});
 }
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');const auth=token&&await read('auth/session/'+await sha(token));if(!auth||auth.expires<Date.now())return json({error:'Please sign in.'},401);
 if(p==='/api/auth/logout'&&req.method==='POST'){await b.put('auth/session/'+await sha(token),JSON.stringify({expires:0}));return json({signedOut:true})}
 const owner='anatomy';
 if(p==='/api/sessions'&&req.method==='GET'){const refs=await list('owner/'+owner+'/');const sessions=await Promise.all(refs.map(r=>session(r.id||r._key.split('/').pop())));return json(sessions.filter(Boolean))}
 if(p==='/api/sessions'&&req.method==='POST'){
  const d=await req.json();if(!String(d.title||'').trim()||!validDate(d.date)||!Array.isArray(d.people)||d.people.length>2000)return json({error:'Enter a session name and valid date.'},400);
  const people=[];for(const x of d.people){const first=String(x.firstName||x.name||'').trim();if(!first||first.length>80)return json({error:'Each row needs a first name.'},400);if(!people.some(p=>norm(firstOf(p))===norm(first)))people.push({id:String(x.id||crypto.randomUUID()),name:first,firstName:first})}
  const s={id:crypto.randomUUID(),owner,title:String(d.title).trim().slice(0,150),label:String(d.label||'').slice(0,150),date:d.date,time:String(d.time||'').slice(0,5),people,open:false,registrationOpen:true,archived:false};await b.put('session/'+s.id,JSON.stringify(s));await b.put('owner/'+owner+'/'+s.id,JSON.stringify({id:s.id}));return json(s)
 }
 const personMatch=p.match(/^\/api\/sessions\/([\w-]+)\/person$/);
 if(personMatch&&req.method==='PATCH'){
  const s=await session(personMatch[1]);if(!s||s.owner!==owner)return json({error:'Session not found.'},404);const d=await req.json();const person=[...s.people,...s.removedPeople].find(p=>p.id===d.id);if(!person)return json({error:'Entry not found.'},404);
  const updated={...person};delete updated._key;if('firstName'in d){const first=String(d.firstName||'').trim().replace(/\s+/g,' ');if(!first||first.length>80)return json({error:'Enter a first name.'},400);updated.name=first;updated.firstName=first}if('removed'in d)updated.removed=!!d.removed;
  await b.put('person/'+s.id+'/'+encodeURIComponent(norm(person.id)),JSON.stringify(updated));
  if('present'in d){const k='check/'+s.id+'/'+encodeURIComponent(norm(person.id)),prev=await read(k);await b.put(k,JSON.stringify(d.present?{id:person.id,time:prev&&!prev.inactive?prev.time:new Date().toISOString(),source:'manager'}:{id:person.id,inactive:true}))}
  const next=await session(s.id);return json({...next,records:await checks(s.id)})
 }
 const match=p.match(/^\/api\/sessions\/([\w-]+)$/);
 if(match){let s=await read('session/'+match[1]);if(!s||s.owner!==owner)return json({error:'Session not found.'},404);
  if(req.method==='DELETE'){s.archived=true;s.open=false;s.registrationOpen=false;await b.put('session/'+s.id,JSON.stringify(s))}
  if(req.method==='PATCH'){
   const d=await req.json();if('date'in d&&!validDate(d.date))return json({error:'Enter a valid date.'},400);if('title'in d&&!String(d.title).trim())return json({error:'Enter a session name.'},400);
   for(const f of ['title','label','date','time'])if(f in d)s[f]=String(d[f]).trim().slice(0,150);
   if('people'in d){if(!Array.isArray(d.people)||d.people.length>2000)return json({error:'Import up to 2,000 rows.'},400);const current=await session(s.id);const people=[...(s.people||[])];const names=new Set(current.people.map(p=>norm(firstOf(p))));for(const x of d.people){const first=String(x.firstName||x.name||'').trim();if(!first||first.length>80)return json({error:'Each row needs a first name.'},400);if(!names.has(norm(first))){people.push({id:crypto.randomUUID(),name:first,firstName:first});names.add(norm(first))}}s.people=people}
   for(const f of ['open','registrationOpen','archived'])if(f in d)s[f]=!!d[f];if(s.archived){s.open=false;s.registrationOpen=false}await b.put('session/'+s.id,JSON.stringify(s))
  }
  const current=await session(s.id);return json({...current,records:await checks(s.id)})
 }
 return json({error:'Not found.'},404)
 }catch(e){return json({error:'Request failed. Please try again.'},500)}}};

function databaseStore(db){return {async get(key){const row=await db.prepare('SELECT value FROM records WHERE key = ?').bind(key).first();return row?{json:async()=>JSON.parse(row.value)}:null},async put(key,value,options){if(options?.onlyIf){return db.prepare('INSERT OR IGNORE INTO records (key,value) VALUES (?,?)').bind(key,value).run()}return db.prepare('INSERT INTO records (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run()},async list({prefix,cursor}){const rows=await db.prepare('SELECT key FROM records WHERE key >= ? AND key < ? AND key > ? ORDER BY key LIMIT 1000').bind(prefix,prefix+'\uffff',cursor||'').all();return {objects:rows.results,truncated:rows.results.length===1000,cursor:rows.results.at(-1)?.key}}}}
export default {async fetch(request,env){const origin=request.headers.get('origin');const allowed=(env.ALLOWED_ORIGINS||'https://falaq7.github.io').split(',').map(x=>x.trim());const own=new URL(request.url).origin;if(origin&&origin!==own&&!allowed.includes(origin))return json({error:'Origin not allowed.'},403);if(request.headers.get('content-length')&&Number(request.headers.get('content-length'))>1048576)return json({error:'Request too large.'},413);const cors={'access-control-allow-origin':origin||allowed[0],'access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization','vary':'Origin','cache-control':'no-store'};if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});let response;if(new URL(request.url).pathname==='/api/health'){try{if(env.DB)await env.DB.prepare('SELECT key FROM records LIMIT 1').first();if(!env.DB&&!env.BUCKET)throw Error();response=json({status:'ok'})}catch(e){response=json({error:'Database is not ready.'},503)}}else response=await application.fetch(request,env);const headers=new Headers(response.headers);for(const [k,v] of Object.entries(cors))headers.set(k,v);headers.set('x-content-type-options','nosniff');return new Response(response.body,{status:response.status,headers})}};
