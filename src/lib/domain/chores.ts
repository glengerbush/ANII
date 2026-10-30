import { z } from 'zod';
import { validDate, shiftDate } from '$lib/calendar';

const date = z.string().refine(validDate, 'Choose a valid date.');
const numbers = (min:number,max:number) => z.array(z.number().int().min(min).max(max)).max(max-min+1).refine(values=>new Set(values).size===values.length,'Selections must be unique.');
export const choreRuleSchema = z.object({
  startDate: date,
  frequency: z.enum(['daily','weekly','monthly','yearly']),
  interval: z.number().int().min(1).max(1000),
  weekdays: numbers(0,6),
  monthDays: z.array(z.number().int().refine(n=>n===-1 || n>=1&&n<=31)).max(32).refine(v=>new Set(v).size===v.length),
  months: numbers(1,12)
}).strict();
export type ChoreRule = z.infer<typeof choreRuleSchema>;
export type ChoreDefinition = {
  id:number; title:string; notes:string; rule:ChoreRule; assigneeIds:number[];
  active:boolean; revision:number; nextDate:string|null;
};
export type ChoreOccurrence = {
  id:number; chore_id:number; title:string; notes:string; due_date:string;
  assignee_id:number|null; assignee_name:string|null; completed_at:string|null;
  completed_by:number|null; completed_by_name:string|null; revision:number; occurrence_count:number; last_due_date:string;
};
const utc = (date:string) => new Date(`${date}T12:00:00Z`);
const dayNumber = (date:string) => Math.floor(utc(date).getTime()/86_400_000);

/** Date-only recurrence: weeks start Monday; nonexistent month dates are skipped. */
export function occursOn(rule:ChoreRule,date:string):boolean {
  if(date<rule.startDate || !validDate(date))return false;
  const d=utc(date),start=utc(rule.startDate),month=d.getUTCMonth()+1,weekday=d.getUTCDay();
  if(rule.months.length&&!rule.months.includes(month))return false;
  if(rule.weekdays.length&&!rule.weekdays.includes(weekday))return false;
  const day=d.getUTCDate(),last=new Date(Date.UTC(d.getUTCFullYear(),month,0)).getUTCDate();
  if(rule.monthDays.length&&!rule.monthDays.includes(day)&&!(rule.monthDays.includes(-1)&&day===last))return false;
  switch(rule.frequency){
    case 'daily': return (dayNumber(date)-dayNumber(rule.startDate))%rule.interval===0;
    case 'weekly': {
      const week=(dayNumber(date)-(weekday+6)%7)-(dayNumber(rule.startDate)-(start.getUTCDay()+6)%7);
      return week%(rule.interval*7)===0 && (rule.weekdays.length>0||weekday===start.getUTCDay());
    }
    case 'monthly': return ((d.getUTCFullYear()-start.getUTCFullYear())*12+d.getUTCMonth()-start.getUTCMonth())%rule.interval===0 && (rule.monthDays.length>0||day===start.getUTCDate());
    case 'yearly': return (d.getUTCFullYear()-start.getUTCFullYear())%rule.interval===0 && (rule.months.length>0||month===start.getUTCMonth()+1) && (rule.monthDays.length>0||day===start.getUTCDate());
  }
}
export function* occurrenceDates(rule:ChoreRule,from:string,through:string):Generator<string> {
  from=from>rule.startDate?from:rule.startDate;
  if(from>through)return;
  const start=utc(rule.startDate),first=utc(from),end=utc(through);
  const iso=(d:Date)=>d.toISOString().slice(0,10);
  if(rule.frequency==='daily'){
    const offset=Math.max(0,Math.ceil((dayNumber(from)-dayNumber(rule.startDate))/rule.interval))*rule.interval;
    for(let n=dayNumber(rule.startDate)+offset;n<=dayNumber(through);n+=rule.interval){
      const date=iso(new Date(n*86_400_000));if(occursOn(rule,date))yield date;
    }
  }else if(rule.frequency==='weekly'){
    const anchor=dayNumber(rule.startDate)-(start.getUTCDay()+6)%7;
    const week=Math.max(0,Math.floor((dayNumber(from)-anchor)/(7*rule.interval)))*7*rule.interval;
    const weekdays=(rule.weekdays.length?rule.weekdays:[start.getUTCDay()]).map(n=>(n+6)%7).sort((a,b)=>a-b);
    for(let n=anchor+week;n<=dayNumber(through);n+=7*rule.interval)for(const weekday of weekdays){
      const date=iso(new Date((n+weekday)*86_400_000));if(date>=from&&date<=through&&occursOn(rule,date))yield date;
    }
  }else{
    const startMonth=start.getUTCFullYear()*12+start.getUTCMonth(),firstMonth=first.getUTCFullYear()*12+first.getUTCMonth(),lastMonth=end.getUTCFullYear()*12+end.getUTCMonth();
    const monthDays=rule.monthDays.length?rule.monthDays:[start.getUTCDate()];
    for(let month=firstMonth;month<=lastMonth;month++){
      const year=Math.floor(month/12),m=month%12;
      if(rule.frequency==='monthly'&&(month-startMonth)%rule.interval!==0)continue;
      if(rule.frequency==='yearly'&&((year-start.getUTCFullYear())%rule.interval!==0||!(rule.months.length?rule.months:[start.getUTCMonth()+1]).includes(m+1)))continue;
      const last=new Date(Date.UTC(year,m+1,0)).getUTCDate();
      const days=[...new Set(monthDays.map(n=>n===-1?last:n))].filter(n=>n<=last).sort((a,b)=>a-b);
      for(const day of days){const date=iso(new Date(Date.UTC(year,m,day,12)));if(date>=from&&date<=through&&occursOn(rule,date))yield date;}
    }
  }
}
export function nextChoreDate(rule:ChoreRule,after:string):string|null {
  if(after>='9999-12-31')return null;
  // Gregorian weekdays repeat every 400 years; the interval can lengthen that cycle.
  const finalYear=Math.min(9999,Math.max(Number(after.slice(0,4)),Number(rule.startDate.slice(0,4)))+400*rule.interval);
  for(const date of occurrenceDates(rule,shiftDate(after,1),`${finalYear}-12-31`))return date;
  return null;
}
export function describeChoreRule(rule:ChoreRule):string {
  const unit={daily:'day',weekly:'week',monthly:'month',yearly:'year'}[rule.frequency];
  const parts=[`Every ${rule.interval===1?'':`${rule.interval} `}${unit}${rule.interval===1?'':'s'}`];
  if(rule.weekdays.length)parts.push(rule.weekdays.map(n=>['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][n]).join(', '));
  if(rule.monthDays.length)parts.push(`on ${rule.monthDays.map(n=>n===-1?'the last day':String(n)).join(', ')}`);
  if(rule.months.length)parts.push(rule.months.map(n=>['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][n-1]).join(', '));
  return parts.join(' · ');
}
