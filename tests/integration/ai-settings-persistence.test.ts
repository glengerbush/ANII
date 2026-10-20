import {expect, test} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDatabase} from '../../src/lib/server/db';
import {getSettings, saveSettings} from '../../src/lib/server/repository';

test.each(['http://anii-llama:11434', 'https://ai.example.test/v1'])(
  'startup preserves saved AI settings at %s', (url) => {
    const directory=mkdtempSync(join(tmpdir(),'anii-settings-'));
    const path=join(directory,'life.db');
    let db:ReturnType<typeof createDatabase>|undefined;
    try {
      db=createDatabase(path);
      const saved={ai_url:url,model:'custom-model',ai_timeout_seconds:'300'};
      saveSettings(saved,db.sqlite);
      db.sqlite.close();db=undefined;

      // Re-run the real startup/migration path against an existing on-disk database.
      for(let restart=0;restart<2;restart++) {
        db=createDatabase(path);
        expect(getSettings(db.sqlite)).toMatchObject(saved);
        saveSettings({theme:'dark'},db.sqlite);
        expect(getSettings(db.sqlite)).toMatchObject(saved);
        db.sqlite.close();db=undefined;
      }
    } finally {
      db?.sqlite.close();
      rmSync(directory,{recursive:true,force:true});
    }
  }
);
