// Read-only release comparison. Uses the authenticated Vercel CLI; no credentials
// are read or printed. No deployment, file write, Git change or mutation occurs.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const deployment=process.argv[2];
if (!/^dpl_[A-Za-z0-9]+$/.test(deployment??'')) throw new Error('Exact deployment ID required');
const raw=execFileSync('vercel',['api',`/v6/deployments/${deployment}/files?teamId=team_p4jbv0hs2wUcNanU36hls9NQ`,
  '--method','GET','--raw','--scope','nkzmhmtw4w-5153s-projects'],{encoding:'utf8',maxBuffer:16*1024*1024});
const root=JSON.parse(raw).find(f=>f.name==='src' && f.type==='directory');
if (!root?.children) throw new Error('Source manifest unavailable');
const files=[];
function walk(children,base='') {
  for (const file of children) {
    const path=base+file.name;
    if(path.startsWith('/') || path.split('/').some(p=>p==='..'||p==='')) throw new Error('Unsafe source path');
    if(file.type==='directory') walk(file.children??[],path+'/');
    else if(file.type==='file' && /^[a-f0-9]{40}$/.test(file.uid??'')) files.push({path,remoteSha1:file.uid});
    else throw new Error('Unrecognized source file');
  }
}
walk(root.children);
const changed=[],missing=[];let matching=0;
for(const file of files) {
  if(!existsSync(file.path)){missing.push(file.path);continue;}
  if(!lstatSync(file.path).isFile()) throw new Error('Non-regular local file: '+file.path);
  const localSha1=createHash('sha1').update(readFileSync(file.path)).digest('hex');
  if(localSha1===file.remoteSha1) matching++;
  else changed.push({...file,localSha1});
}
const deployed=new Set(files.map(f=>f.path));
const local=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const added=local.filter(f=>!deployed.has(f));
console.log(JSON.stringify({deployment,workspace:resolve('.'),sourceFileCount:files.length,matching,
  changed,missing,localAdditionalFiles:added,
  note:'Additional paths include files excluded by .vercelignore; review that file before classifying the deployment delta.'},null,2));
