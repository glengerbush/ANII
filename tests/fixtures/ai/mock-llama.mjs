// Disposable transport fixture. Not a model-quality test. Run: node tests/fixtures/ai/mock-llama.mjs
import http from 'node:http';
const server=http.createServer(async(req,res)=>{
  if(req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({data:[{id:'qwen3.6-35b-a3b'}]}));return;}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
  res.writeHead(200,{'content-type':'text/event-stream'});
  const send=(delta,finish_reason=null)=>res.write(`data: ${JSON.stringify({choices:[{index:0,delta,finish_reason}]})}\n\n`);
  const finish=()=>{res.write('data: [DONE]\n\n');res.end();};
  send({reasoning_content:'I will look up the relevant tasks before proposing any changes. '});
  await new Promise(resolve=>setTimeout(resolve,700));
  if(input.response_format?.json_schema?.schema?.properties?.concerns){send({content:JSON.stringify({concerns:[]})},'stop');finish();return;}
  const result=input.messages.findLast(message=>message.role==='tool');
  if(!result&&input.tools){send({tool_calls:[{index:0,id:'fixture-search',type:'function',function:{name:'search_tasks',arguments:JSON.stringify({query:'',limit:3})}}]},'tool_calls');finish();return;}
  let existing;try{existing=JSON.parse(result?.content??'{}').tasks?.[0]?.id;}catch{}
  const plan={message:'Review these fixture tasks and required dependencies.',clarification:false,tasks:[{ref:'prepare',title:'AI fixture: prepare materials',details:'Created by the disposable mock transport.'},{ref:'finish',title:'AI fixture: finish work'}],dependencies:[{task:'finish',prerequisite:'prepare'},...(existing?[{task:'prepare',prerequisite:existing}]:[])]};
  send({reasoning_content:'The dependencies can be reviewed and accepted together.'});
  send({content:JSON.stringify(plan)},'stop');finish();
});
server.listen(11435,'127.0.0.1',()=>console.log('Mock llama.cpp: http://127.0.0.1:11435'));
