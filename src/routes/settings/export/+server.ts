import { exportData } from '$lib/server/repository';
export const GET=()=>new Response(JSON.stringify(exportData(),null,2),{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="life-export-${new Date().toISOString().slice(0,10)}.json"`,'cache-control':'no-store'}});
