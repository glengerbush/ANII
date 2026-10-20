/** Date-only arithmetic avoids DST and browser timezone shifts. */
export function validDate(value:string):boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number(value.slice(0,4))>=1000&&Number.isFinite(Date.parse(`${value}T12:00:00Z`))&&new Date(`${value}T12:00:00Z`).toISOString().slice(0,10)===value;
}
export function shiftDate(date:string,days:number):string {
  const value=new Date(`${date}T12:00:00Z`);value.setUTCDate(value.getUTCDate()+days);return value.toISOString().slice(0,10);
}
export function calendarDate(timeZone='local',instant=new Date()):string {
  if(timeZone==='local')return `${instant.getFullYear()}-${String(instant.getMonth()+1).padStart(2,'0')}-${String(instant.getDate()).padStart(2,'0')}`;
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(instant);
  const part=(name:string)=>parts.find(part=>part.type===name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function calendarRange(anchor:string,view:'week'|'month') {
  const value=new Date(`${anchor}T12:00:00Z`);
  const first=view==='month'?`${anchor.slice(0,7)}-01`:anchor;
  const weekday=new Date(`${first}T12:00:00Z`).getUTCDay();
  const start=shiftDate(first,-((weekday+6)%7));
  let end=shiftDate(start,6),previous=shiftDate(anchor,-7),next=shiftDate(anchor,7);
  if(view==='month'){
    const last=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,0,12)).toISOString().slice(0,10);
    end=shiftDate(last,6-((new Date(`${last}T12:00:00Z`).getUTCDay()+6)%7));
    previous=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()-1,1,12)).toISOString().slice(0,10);
    next=new Date(Date.UTC(value.getUTCFullYear(),value.getUTCMonth()+1,1,12)).toISOString().slice(0,10);
  }
  const days:string[]=[];for(let day=start;day<=end;day=shiftDate(day,1))days.push(day);
  return {rangeStart:start,rangeEnd:end,days,previous,next};
}
