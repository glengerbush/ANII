import {fail} from '@sveltejs/kit';
import {setProjectCompleted} from './repository';

export async function projectCompletionAction(request:Request,projectId?:number){
  const data=await request.formData();
  try{
    const id=projectId??Number(data.get('id')),completed=String(data.get('completed'));
    if(!Number.isSafeInteger(id)||id<=0||!['true','false'].includes(completed))throw new Error('Choose a valid project and completion state.');
    setProjectCompleted(id,completed==='true');return {success:true};
  }catch(error){return fail(400,{error:error instanceof Error?error.message:'Could not update project.'});}
}
