const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const norm=s=>String(s||'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-GB');
const validDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s));
const londonDay=()=>new Date().toLocaleDateString('en-CA',{timeZone:'Europe/London'});
const emailOf=s=>String(s||'').trim().toLowerCase();
const validEmail=s=>s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const cleanName=s=>String(s||'').trim().replace(/\s+/g,' ');
const validHours=h=>typeof h==='number'&&Number.isFinite(h)&&h>0&&h<=24;
const application={async fetch(req,env){try{
 const u=new URL(req.url),p=u.pathname;
 if(!p.startsWith('/api/'))return new Response(HTML,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store','referrer-policy':'same-origin'}});
 const b=env.BUCKET||(env.DB?databaseStore(env.DB):null);if(!b)return json({error:'Storage is unavailable.'},503);
 const read=async k=>{const o=await b.get(k);return o?o.json():null};
 const list=async prefix=>{let objects=[],cursor;do{const page=await b.list({prefix,cursor});objects.push(...page.objects);cursor=page.truncated?page.cursor:undefined}while(cursor);return Promise.all(objects.map(async o=>({...await read(o.key),_key:o.key})))};
 const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
 const all=async(sql,...args)=>(await env.DB.prepare(sql).bind(...args).all()).results;
 const bookingView=(r,s)=>({id:r.id,name:r.name,firstName:r.name,email:r.email,registeredAt:r.registered_at,removed:!!r.removed,attendance:r.attended==='Yes'?'Yes':r.attended==='No'||s.date<londonDay()?'No':'Pending',hours:Number(r.hours),notes:r.notes||'',signedOutAt:r.signed_out_at||'',updatedAt:r.updated_at||'',source:r.source||''});
 const session=async id=>{const s=await read('session/'+id);if(!s)return null;const bookings=await all('SELECT * FROM bookings WHERE session = ? ORDER BY registered_at,id',id);const people=bookings.map(r=>bookingView(r,s));return {...s,capacity:s.capacity??4,defaultHours:s.defaultHours??2,endTime:s.endTime||'',people:people.filter(r=>!r.removed),removedPeople:people.filter(r=>r.removed),records:people.filter(r=>!r.removed&&r.attendance==='Yes').map(r=>({id:r.id,time:r.signedOutAt,hours:r.hours,notes:r.notes})),legacyCount:(s.people||[]).length}};
 const sessions=async()=>{const refs=await list('owner/anatomy/');return (await Promise.all(refs.map(r=>session(r.id||r._key.split('/').pop())))).filter(Boolean)};
 const rosterOf=ss=>{const people=new Map();for(const s of ss.filter(s=>!s.archived))for(const p of s.people){let row=people.get(p.email);if(!row){row={name:p.name,email:p.email,hours:0,sessions:0};people.set(p.email,row)}if(p.attendance==='Yes'){row.hours+=p.hours;row.sessions++}}return [...people.values()].sort((a,b)=>a.name.localeCompare(b.name))};
 if(p==='/api/excel/feed'&&req.method==='GET'){
  const secret=u.searchParams.get('token');if(!env.EXCEL_FEED_TOKEN||!secret||await sha(secret)!==await sha(env.EXCEL_FEED_TOKEN))return json({error:'Not found.'},404);
  const ss=(await sessions()).filter(s=>!s.archived).sort((a,b)=>a.date.localeCompare(b.date));
  const capturedAt=new Date().toISOString(),payload=JSON.stringify({version:2,capturedAt,sessions:ss.map(s=>({id:s.id,code:s.code||'',sheetName:s.sheetName||'',title:s.title,label:s.label||'',date:s.date,time:s.time||'',endTime:s.endTime||'',capacity:s.capacity,defaultHours:s.defaultHours,people:s.people.map(({id,name,email,registeredAt,attendance,hours,notes,signedOutAt,updatedAt,source})=>({id,name,email,registeredAt,attendance,hours,notes,signedOutAt,updatedAt,source}))})),roster:rosterOf(ss)}),escape=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return new Response('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Anatomy register</title><link>https://falaq7.github.io/npt-attendance/</link><description>Private register sync</description><item><title>Register snapshot</title><guid isPermaLink="false">'+capturedAt+'</guid><pubDate>'+new Date(capturedAt).toUTCString()+'</pubDate><description>'+escape(payload)+'</description></item></channel></rss>',{headers:{'content-type':'application/rss+xml;charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer'}});
 }
  if(p==='/api/auth/login'&&req.method==='POST'){
  if(!env.MANAGER_PASSWORD)return json({error:'Manager sign-in is not configured.'},503);
  const ip=await sha(req.headers.get('cf-connecting-ip')||'local'),attemptKey='auth/attempt/'+ip,now=Date.now(),prior=await read(attemptKey);const attempt=prior&&prior.until>now?prior:{count:0,until:now+900000};if(attempt.count>=10)return json({error:'Too many attempts. Try again in 15 minutes.'},429);
  const d=await req.json();if(typeof d.password!=='string'||d.password.length>256||await sha(d.password)!==await sha(env.MANAGER_PASSWORD)){attempt.count++;await b.put(attemptKey,JSON.stringify(attempt));return json({error:'Incorrect password.'},401)}
  await b.put(attemptKey,JSON.stringify({count:0,until:0}));
  if(typeof d.legacyKey==='string'&&d.legacyKey.length>=30){const oldOwner=await sha(d.legacyKey);for(const ref of await list('owner/'+oldOwner+'/')){const id=ref.id||ref._key.split('/').pop(),old=await read('session/'+id);if(old?.owner===oldOwner){old.owner='anatomy';await b.put('session/'+id,JSON.stringify(old));await b.put('owner/anatomy/'+id,JSON.stringify({id}))}}}
  const token=crypto.randomUUID()+crypto.randomUUID();await b.put('auth/session/'+await sha(token),JSON.stringify({expires:now+43200000}));return json({token});
 }

 const publicMatch=p.match(/^\/api\/public\/([\w-]+)$/);
 if(publicMatch&&req.method==='GET'){const s=await session(publicMatch[1]);if(!s||s.archived)return json({error:'Session not found.'},404);return json({title:s.title,label:s.label,date:s.date,time:s.time,endTime:s.endTime,open:s.open,registrationOpen:s.registrationOpen!==false,capacity:s.capacity,registered:s.people.length,remaining:Math.max(0,s.capacity-s.people.length),defaultHours:s.defaultHours,past:s.date<londonDay(),signOutAvailable:s.open&&s.date===londonDay()})}
 if(p==='/api/register'&&req.method==='POST'){
  const d=await req.json(),s=await session(d.session);if(!s||s.archived||s.registrationOpen===false||s.date<londonDay())return json({error:'Registration is closed.'},400);
  const name=cleanName(d.name),email=emailOf(d.email);if(!name||name.length>120||!validEmail(email))return json({error:'Enter your name and a valid email address.'},400);
  const existing=await env.DB.prepare('SELECT id,removed FROM bookings WHERE session=? AND email=?').bind(s.id,email).first();if(existing&&!existing.removed)return json({registered:true,duplicate:true});
  const id=crypto.randomUUID(),cancelToken=crypto.randomUUID()+crypto.randomUUID(),now=new Date().toISOString();
  // One SQLite statement reserves a place and checks capacity, including simultaneous submissions.
  await env.DB.prepare(`INSERT INTO bookings(id,session,email,name,registered_at,hours,cancel_token)
   SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM bookings WHERE session=? AND removed=0)<COALESCE((SELECT json_extract(value,'$.capacity') FROM records WHERE key=?),4)
   AND COALESCE((SELECT json_extract(value,'$.archived') FROM records WHERE key=?),0)=0
   AND COALESCE((SELECT json_extract(value,'$.registrationOpen') FROM records WHERE key=?),1)=1
   ON CONFLICT(session,email) DO UPDATE SET name=excluded.name,removed=0,registered_at=excluded.registered_at,cancel_token=excluded.cancel_token,attended=NULL,hours=excluded.hours,notes='',signed_out_at=NULL,updated_at=NULL,source=NULL WHERE bookings.removed=1`).bind(id,s.id,email,name,now,s.defaultHours,cancelToken,s.id,'session/'+s.id,'session/'+s.id,'session/'+s.id).run();
  const saved=await env.DB.prepare('SELECT removed,cancel_token FROM bookings WHERE session=? AND email=?').bind(s.id,email).first();if(!saved||saved.removed)return json({error:'This session is full. No place was booked.'},409);
  return json({registered:true,duplicate:saved.cancel_token!==cancelToken,...(saved.cancel_token===cancelToken?{cancelToken}:{})});
 }
 if(p==='/api/cancel'&&req.method==='POST'){
  const d=await req.json();if(typeof d.token!=='string'||d.token.length>100)return json({error:'Invalid cancellation link.'},400);
  const row=await env.DB.prepare('SELECT * FROM bookings WHERE cancel_token=?').bind(d.token).first();if(!row)return json({error:'Cancellation link not found.'},404);const s=await session(row.session);if(!s||s.archived||s.date<londonDay()||row.attended==='Yes')return json({error:'Contact the organiser to change this booking.'},400);
  await env.DB.prepare('UPDATE bookings SET removed=1,updated_at=?,source=? WHERE id=?').bind(new Date().toISOString(),'volunteer cancellation',row.id).run();return json({cancelled:true});
 }
 if((p==='/api/signout'||p==='/api/checkin')&&req.method==='POST'){
  const d=await req.json(),s=await session(d.session);if(!s||s.archived||!s.open||s.date!==londonDay())return json({error:s?.date<londonDay()?'This session has ended. Contact the organiser for a correction.':'Sign-out is available on the session date when opened by the organiser.'},400);
  const email=emailOf(d.email),hours=d.hours===undefined?s.defaultHours:Number(d.hours),notes=String(d.notes||'').trim();if(!validEmail(email)||!validHours(hours)||notes.length>2000)return json({error:'Enter your registration email, hours above 0 and up to 24, and notes up to 2,000 characters.'},400);
  const row=await env.DB.prepare('SELECT * FROM bookings WHERE session=? AND email=? AND removed=0').bind(s.id,email).first();if(!row)return json({error:'No matching registration. Use the email you registered with or contact the organiser.'},404);
  const now=new Date().toISOString();await env.DB.prepare("UPDATE bookings SET attended='Yes',hours=?,notes=?,signed_out_at=?,updated_at=?,source='volunteer sign-out' WHERE id=? AND attended IS NOT 'Yes'").bind(hours,notes,now,now,row.id).run();
  const saved=await env.DB.prepare('SELECT name,hours,signed_out_at FROM bookings WHERE id=?').bind(row.id).first();return json({signedOut:true,name:saved.name,hours:saved.hours,time:saved.signed_out_at});
 }
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'');const auth=token&&await read('auth/session/'+await sha(token));if(!auth||auth.expires<Date.now())return json({error:'Please sign in.'},401);
 if(p==='/api/auth/logout'&&req.method==='POST'){await b.put('auth/session/'+await sha(token),JSON.stringify({expires:0}));return json({signedOut:true})}
 if(p==='/api/excel'&&req.method==='GET')return json({connected:!!env.EXCEL_WORKBOOK_URL,workbookUrl:env.EXCEL_WORKBOOK_URL||'',intervalMinutes:1});
 if(p==='/api/roster'&&req.method==='GET')return json(rosterOf(await sessions()));
 if(p==='/api/sessions'&&req.method==='GET')return json(await sessions());
 const validateSession=(d,current)=>{if('title'in d&&(!String(d.title).trim()||String(d.title).length>150))return 'Enter a session name up to 150 characters.';if('date'in d&&!validDate(d.date))return 'Enter a valid date.';for(const key of ['time','endTime'])if(key in d&&d[key]&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(d[key]))return 'Enter a valid time.';if('capacity'in d&&(!Number.isInteger(Number(d.capacity))||Number(d.capacity)<1||Number(d.capacity)>2000))return 'Volunteer limit must be a whole number between 1 and 2,000.';if(current&&'capacity'in d&&Number(d.capacity)<current.people.length)return 'The limit cannot be lower than the current bookings. Cancel an entry first.';if('defaultHours'in d&&!validHours(Number(d.defaultHours)))return 'Default hours must be above 0 and up to 24.';return ''};
 if(p==='/api/sessions'&&req.method==='POST'){
  const d=await req.json(),error=validateSession(d);if(error||!d.title||!d.date)return json({error:error||'Enter a session name and date.'},400);if(d.people?.length)return json({error:'Create the session, then add volunteers with name and email.'},400);
  const s={id:crypto.randomUUID(),owner:'anatomy',title:cleanName(d.title),label:String(d.label||'').slice(0,150),date:d.date,time:d.time||'',endTime:d.endTime||'',capacity:Number(d.capacity??4),defaultHours:Number(d.defaultHours??2),people:[],open:true,registrationOpen:true,archived:false,code:String(d.code||'').slice(0,30),sheetName:String(d.sheetName||'').slice(0,31)};await b.put('session/'+s.id,JSON.stringify(s));await b.put('owner/anatomy/'+s.id,JSON.stringify({id:s.id}));return json(await session(s.id));
 }
 const personMatch=p.match(/^\/api\/sessions\/([\w-]+)\/person$/);
 if(personMatch&&req.method==='PATCH'){
  const s=await session(personMatch[1]);if(!s||s.owner!=='anatomy')return json({error:'Session not found.'},404);const d=await req.json(),person=[...s.people,...s.removedPeople].find(p=>p.id===d.id);if(!person)return json({error:'Entry not found.'},404);
  const name='name'in d?cleanName(d.name):person.name,email='email'in d?emailOf(d.email):person.email,hours='hours'in d?Number(d.hours):person.hours,notes='notes'in d?String(d.notes).trim():person.notes,removed='removed'in d?!!d.removed:person.removed,status=d.attendance||person.attendance;
  if(!name||name.length>120||!validEmail(email)||!validHours(hours)||notes.length>2000||!['Yes','No','Pending'].includes(status))return json({error:'Check the name, email, attendance, hours and notes.'},400);
  if(person.removed&&!removed&&s.people.length>=s.capacity)return json({error:'This session is full. Increase the limit before restoring this entry.'},409);
  const duplicate=await env.DB.prepare('SELECT id FROM bookings WHERE session=? AND email=? AND id<>?').bind(s.id,email,person.id).first();if(duplicate)return json({error:'That email is already on this session register.'},409);
  const now=new Date().toISOString(),signedOut=status==='Yes'?(person.signedOutAt||now):null;
  await env.DB.prepare('UPDATE bookings SET name=?,email=?,hours=?,notes=?,removed=?,attended=?,signed_out_at=?,updated_at=?,source=? WHERE id=?').bind(name,email,hours,notes,removed?1:0,status==='Pending'?null:status,signedOut,now,'manager correction',person.id).run();return json(await session(s.id));
 }
 const match=p.match(/^\/api\/sessions\/([\w-]+)$/);
 if(match){const s=await read('session/'+match[1]);if(!s||s.owner!=='anatomy')return json({error:'Session not found.'},404);
  if(req.method==='DELETE'){s.archived=true;s.open=false;s.registrationOpen=false;await b.put('session/'+s.id,JSON.stringify(s))}
  if(req.method==='PATCH'){const d=await req.json(),current=await session(s.id),error=validateSession(d,current);if(error)return json({error},400);if(d.people?.length)return json({error:'Use name and email registration to add volunteers.'},400);for(const f of ['title','label','date','time','endTime'])if(f in d)s[f]=String(d[f]).trim().slice(0,150);for(const f of ['capacity','defaultHours'])if(f in d)s[f]=Number(d[f]);for(const f of ['open','registrationOpen','archived'])if(f in d)s[f]=!!d[f];if(s.archived){s.open=false;s.registrationOpen=false}await b.put('session/'+s.id,JSON.stringify(s))}
  return json(await session(s.id));
 }
 return json({error:'Not found.'},404)
 }catch(e){return json({error:'Request failed. Please try again.'},500)}}};
 function databaseStore(db){return {async get(key){const row=await db.prepare('SELECT value FROM records WHERE key = ?').bind(key).first();return row?{json:async()=>JSON.parse(row.value)}:null},async put(key,value,options){if(options?.onlyIf){return db.prepare('INSERT OR IGNORE INTO records (key,value) VALUES (?,?)').bind(key,value).run()}return db.prepare('INSERT INTO records (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key,value).run()},async list({prefix,cursor}){const rows=await db.prepare('SELECT key FROM records WHERE key >= ? AND key < ? AND key > ? ORDER BY key LIMIT 1000').bind(prefix,prefix+'\uffff',cursor||'').all();return {objects:rows.results,truncated:rows.results.length===1000,cursor:rows.results.at(-1)?.key}}}}
export default {async fetch(request,env){const origin=request.headers.get('origin');const allowed=(env.ALLOWED_ORIGINS||'https://falaq7.github.io').split(',').map(x=>x.trim());const own=new URL(request.url).origin;if(origin&&origin!==own&&!allowed.includes(origin))return json({error:'Origin not allowed.'},403);if(request.headers.get('content-length')&&Number(request.headers.get('content-length'))>1048576)return json({error:'Request too large.'},413);const cors={'access-control-allow-origin':origin||allowed[0],'access-control-allow-methods':'GET,POST,PATCH,DELETE,OPTIONS','access-control-allow-headers':'content-type,authorization','vary':'Origin','cache-control':'no-store'};if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});let response;if(new URL(request.url).pathname==='/api/health'){try{if(env.DB)await env.DB.prepare('SELECT key FROM records LIMIT 1').first();if(!env.DB&&!env.BUCKET)throw Error();response=json({status:'ok'})}catch(e){response=json({error:'Database is not ready.'},503)}}else response=await application.fetch(request,env);const headers=new Headers(response.headers);for(const [k,v] of Object.entries(cors))headers.set(k,v);headers.set('x-content-type-options','nosniff');return new Response(response.body,{status:response.status,headers})}};

