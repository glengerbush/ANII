import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { chmodSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { database, databasePath, type AppDatabase } from '$lib/server/db';
import { exportData, importData, SNAPSHOT_TABLES, validateImportData } from '$lib/server/repository';
import {RESTORE_STAGING_PREFIX} from '$lib/server/restore-staging';

export const MAX_DATABASE_UPLOAD_BYTES=10_000_000;
const sqliteMagic=Buffer.from('SQLite format 3\0');
let restoreInProgress=false;

export class DatabaseRestoreError extends Error {
  constructor(message:string,public status=400){super(message);this.name='DatabaseRestoreError';}
}

type Column={name:string;type:string;notnull:number;dflt_value:string|null;pk:number};
type RestoreOptions={liveDatabase?:AppDatabase;livePath?:string;stagingRoot?:string;cleanupStaging?:(path:string)=>Promise<void>;prepareRecoveryDirectory?:(path:string)=>Promise<void>;cleanupRecoveryArtifact?:(path:string)=>Promise<void>};

function fail(message:string,status=400):never{throw new DatabaseRestoreError(message,status);}
function configureReadOnly(db:Database.Database){db.pragma('trusted_schema = OFF');db.pragma('query_only = ON');}
function checkIntegrity(db:Database.Database){
  const integrity=db.pragma('integrity_check') as {integrity_check:string}[];
  if(integrity.length!==1||integrity[0]?.integrity_check!=='ok')fail('SQLite backup failed its integrity check.');
  if((db.pragma('foreign_key_check') as unknown[]).length)fail('SQLite backup contains invalid foreign keys.');
}
function columns(db:Database.Database,table:string){return (db.prepare(`PRAGMA table_info(${table})`).all() as Column[]).map(({name,type,notnull,dflt_value,pk})=>({name,type,notnull,dflt_value,pk}));}
function checkSchema(source:Database.Database,live:Database.Database){
  const tables=(source.prepare(`SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as {name:string}[]).map((row)=>row.name);
  const legacy=SNAPSHOT_TABLES.filter(table=>!['chores','chore_assignees','chore_occurrences'].includes(table)).sort();
  if(JSON.stringify(tables)!==JSON.stringify([...SNAPSHOT_TABLES].sort())&&JSON.stringify(tables)!==JSON.stringify(legacy))fail('Database file is not a current ANII database backup.');
  for(const table of tables){
    if(JSON.stringify(columns(source,table))!==JSON.stringify(columns(live,table)))fail('Database file uses an incompatible ANII database schema.');
  }

}
function stamp(){return new Date().toISOString().replace(/[:.]/g,'-');}
async function defaultPrepareRecoveryDirectory(path:string){await mkdir(path,{recursive:true,mode:0o700});chmodSync(path,0o700);}
async function createRecoveryBackup(liveDatabase:AppDatabase,livePath:string,prepareDirectory:(path:string)=>Promise<void>,cleanupArtifact:(path:string)=>Promise<void>){
  if(livePath===':memory:')fail('A recovery backup cannot be created for an in-memory database.',500);
  const directory=join(dirname(livePath),'backups');const name=`life-pre-restore-${stamp()}-${randomUUID()}.db`;const path=join(directory,name);
  try{
    await prepareDirectory(directory);
    await liveDatabase.sqlite.backup(path);chmodSync(path,0o600);
    const verification=new Database(path,{readonly:true,fileMustExist:true});try{configureReadOnly(verification);checkIntegrity(verification);}finally{verification.close();}
    rmSync(`${path}-wal`,{force:true});rmSync(`${path}-shm`,{force:true});
    return {path,name};
  }catch{await Promise.allSettled([path,`${path}-wal`,`${path}-shm`].map((artifact)=>cleanupArtifact(artifact)));fail('Could not create and verify the recovery backup. Current data was not changed.',500);}
}

export async function restoreDatabaseBytes(bytes:Uint8Array,options:RestoreOptions={}){
  if(restoreInProgress)fail('Another database restore is already in progress.',409);
  if(bytes.byteLength<sqliteMagic.length||!Buffer.from(bytes.subarray(0,sqliteMagic.length)).equals(sqliteMagic))fail('Choose a valid SQLite backup file.');
  restoreInProgress=true;
  const liveDatabase=options.liveDatabase??database;const livePath=options.livePath??databasePath;const root=options.stagingRoot??tmpdir();const cleanup=options.cleanupStaging??((path:string)=>rm(path,{recursive:true,force:true}));const prepareRecoveryDirectory=options.prepareRecoveryDirectory??defaultPrepareRecoveryDirectory;const cleanupRecoveryArtifact=options.cleanupRecoveryArtifact??((path:string)=>rm(path,{force:true}));let stagingDirectory:string|undefined;let source:Database.Database|undefined;let outcome:{recoveryBackupPath:string;recoveryBackupName:string;warning?:string}|undefined;
  try{
    stagingDirectory=await mkdtemp(join(root,RESTORE_STAGING_PREFIX));const stagedPath=join(stagingDirectory,'upload.db');await writeFile(stagedPath,bytes,{mode:0o600,flag:'wx'});
    try{
      source=new Database(stagedPath,{readonly:true,fileMustExist:true});configureReadOnly(source);checkIntegrity(source);checkSchema(source,liveDatabase.sqlite);
      const snapshot=validateImportData(exportData(source),liveDatabase.sqlite);source.close();source=undefined;
      const recovery=await createRecoveryBackup(liveDatabase,livePath,prepareRecoveryDirectory,cleanupRecoveryArtifact);
      try{importData(snapshot,liveDatabase.sqlite);}catch{throw new DatabaseRestoreError(`Restore failed. Current data was not changed. Recovery backup ${recovery.name} was retained.`,500);}
      outcome={recoveryBackupPath:recovery.path,recoveryBackupName:recovery.name};return outcome;
    }catch(error){if(error instanceof DatabaseRestoreError)throw error;throw new DatabaseRestoreError('Database file is not a valid supported ANII database backup.');}
  }finally{
    try{source?.close();}catch{if(outcome)outcome.warning='Database restored, but temporary-file cleanup needs attention.';}
    if(stagingDirectory)try{await cleanup(stagingDirectory);}catch{if(outcome)outcome.warning='Database restored, but temporary-file cleanup needs attention.';}
    restoreInProgress=false;
  }
}

export async function restoreJsonData(raw:unknown,options:RestoreOptions={}){
  if(restoreInProgress)fail('Another database restore is already in progress.',409);
  restoreInProgress=true;
  const liveDatabase=options.liveDatabase??database;
  try{
    const snapshot=validateImportData(raw,liveDatabase.sqlite);
    const recovery=await createRecoveryBackup(liveDatabase,options.livePath??databasePath,options.prepareRecoveryDirectory??defaultPrepareRecoveryDirectory,options.cleanupRecoveryArtifact??((path)=>rm(path,{force:true})));
    try{importData(snapshot,liveDatabase.sqlite);}catch{fail(`Restore failed. Current data was not changed. Recovery backup ${recovery.name} was retained.`,500);}
    return {recoveryBackupPath:recovery.path,recoveryBackupName:recovery.name};
  }finally{restoreInProgress=false;}
}
