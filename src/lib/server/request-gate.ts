type Release=()=>void;
type Waiter={kind:'shared'|'exclusive';resolve:(release:Release)=>void};

export class RequestGate {
  private readers=0;private writer=false;private queue:Waiter[]=[];
  acquireShared():Promise<Release>{return this.acquire('shared');}
  acquireExclusive():Promise<Release>{return this.acquire('exclusive');}
  async withShared<T>(work:()=>T|Promise<T>):Promise<T>{const release=await this.acquireShared();try{return await work();}finally{release();}}
  async withExclusive<T>(work:()=>T|Promise<T>):Promise<T>{const release=await this.acquireExclusive();try{return await work();}finally{release();}}
  private acquire(kind:Waiter['kind']):Promise<Release>{
    if(kind==='shared'&&!this.writer&&!this.queue.some((waiter)=>waiter.kind==='exclusive')){this.readers++;return Promise.resolve(this.releaseShared());}
    if(kind==='exclusive'&&!this.writer&&this.readers===0&&this.queue.length===0){this.writer=true;return Promise.resolve(this.releaseExclusive());}
    return new Promise((resolve)=>{this.queue.push({kind,resolve});this.drain();});
  }
  private releaseShared():Release{let released=false;return ()=>{if(released)return;released=true;this.readers--;this.drain();};}
  private releaseExclusive():Release{let released=false;return ()=>{if(released)return;released=true;this.writer=false;this.drain();};}
  private drain(){
    if(this.writer||this.readers>0||!this.queue.length)return;
    if(this.queue[0].kind==='exclusive'){this.writer=true;this.queue.shift()!.resolve(this.releaseExclusive());return;}
    while(this.queue[0]?.kind==='shared'){this.readers++;this.queue.shift()!.resolve(this.releaseShared());}
  }
}

export const appRequestGate=new RequestGate();

export function requestGateMode(method:string,url:URL):'shared'|'exclusive'{
  if(method!=='POST'||url.pathname!=='/settings')return 'shared';
  const action=[...url.searchParams.keys()].find((key)=>key.startsWith('/'));
  return action==='/restoreDatabase'||action==='/import'?'exclusive':'shared';
}
