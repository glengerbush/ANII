// Disposable transport fixture. Not a model-quality test. Run: node tests/fixtures/ai/mock-ollama.mjs
import http from 'node:http';
const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/tags'){res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[{name:'qwen3.5:4b'}]}));return;}
  if(req.url!=='/api/chat'){res.writeHead(404);res.end();return;}
  let body='';for await(const chunk of req)body+=chunk;const input=JSON.parse(body);
  res.writeHead(200,{'content-type':'application/x-ndjson'});
  const send=value=>res.write(JSON.stringify(value)+'\n');
  send({message:{thinking:'I will look up the relevant tasks before proposing any changes. '},done:false});
  await new Promise(resolve=>setTimeout(resolve,700));
  if(input.format?.properties?.concerns){send({message:{content:JSON.stringify({concerns:[]})},done:true});res.end();return;}
  const result=input.messages.findLast(message=>message.role==='tool');
  if(!result&&input.tools){send({message:{tool_calls:[{function:{name:'search_tasks',arguments:{query:'',limit:3}}}]},done:true});res.end();return;}
  let existing;try{existing=JSON.parse(result?.content??'{}').tasks?.[0]?.id;}catch{}
  const plan={message:'Review these fixture tasks and required dependencies.',clarification:false,tasks:[{ref:'prepare',title:'AI fixture: prepare materials',details:'Created by the disposable mock transport.'},{ref:'finish',title:'AI fixture: finish work'}],dependencies:[{task:'finish',prerequisite:'prepare'},...(existing?[{task:'prepare',prerequisite:existing}]:[])]};
  send({message:{thinking:'The dependencies can be reviewed and accepted together.'},done:false});
  send({message:{content:JSON.stringify(plan)},done:true});res.end();
});
server.listen(11435,'127.0.0.1',()=>console.log('Mock Ollama: http://127.0.0.1:11435'));
