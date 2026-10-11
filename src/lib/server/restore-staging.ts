import {lstatSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

export const RESTORE_STAGING_PREFIX='life-restore-';
export function cleanupStaleRestoreDirectories(root=tmpdir(),now=Date.now(),minimumAgeMs=24*60*60*1000){
  for(const name of readdirSync(root)){
    if(!name.startsWith(RESTORE_STAGING_PREFIX))continue;const path=join(root,name);
    try{const stat=lstatSync(path);if(stat.isDirectory()&&!stat.isSymbolicLink()&&now-stat.mtimeMs>=minimumAgeMs)rmSync(path,{recursive:true,force:true});}catch{/* another cleanup may have won */}
  }
}
