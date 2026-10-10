const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../extension/offscreen.js'),'utf8');
function setup({captureFails = false,saveFails = false,settingsOverride = null,tabMuted = false,mp4Supported = true} = {}) {
  let listener, constraints, writes = [], closed = false, removed = 0, aborted = 0, stopped = 0, downloads = 0, speakerConnections = 0;
  const tracks = ['video','audio'].map(kind => ({kind,stop(){stopped++},addEventListener(name,fn){this.ended = fn}}));
  tracks[0].getSettings = () => settingsOverride || ({width:constraints?.video.mandatory.maxWidth || 1280,height:constraints?.video.mandatory.maxHeight || 720,frameRate:constraints?.video.mandatory.maxFrameRate || 30});
  const stream = {getTracks:()=>tracks,getVideoTracks:()=>[tracks[0]],getAudioTracks:()=>[tracks[1]]};
  const writer = {async write(blob){await new Promise(r=>setTimeout(r,5));writes.push(blob)},async close(){closed=true},async abort(){aborted++}};
  const root = {async getFileHandle(){return {async createWritable(){return writer},async getFile(){assert(closed,'download before file close');return new Blob(writes)}}},async removeEntry(){removed++}};
  class Recorder {
    static isTypeSupported(type){return mp4Supported && type.startsWith('video/mp4')}
    constructor(media,options){this.state='inactive';this.options=options;this.mimeType=options.mimeType;Recorder.instance=this}
    start(){this.state='recording';this.ondataavailable({data:new Blob(['first'])})}
    stop(){assert.equal(this.state,'recording');this.state='inactive';queueMicrotask(()=>{this.ondataavailable({data:new Blob(['last'])});this.onstop()})}
  }
  const context = vm.createContext({
    chrome:{runtime:{id:'test',onMessage:{addListener(fn){listener=fn}},async sendMessage(m){
      if(m.type==='prepare-audio')return {ok:true,data:{originallyMuted:tabMuted}};
      if(m.type==='save-file'){downloads++;if(saveFails)return {ok:false,error:'cancelled'};return {ok:true,data:{downloadId:7}}}return {ok:true};
    }}},
    navigator:{storage:{getDirectory:async()=>root},mediaDevices:{async getUserMedia(c){constraints=c;if(captureFails)throw Error('denied');return stream}}},
    MediaRecorder:Recorder,AudioContext:class{createMediaStreamSource(){return {connect(){speakerConnections++}}}destination={};async resume(){}async close(){}},
    URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Date,Promise,console
  });
  vm.runInContext(source,context);
  const command = (type,extra={}) => new Promise(resolve=>listener({target:'offscreen',type,...extra},{id:'test'},resolve));
  return {command,tracks,get stats(){return {constraints,writes,closed,removed,aborted,stopped,downloads,speakerConnections,encoding:Recorder.instance?.options}}};
}
async function until(test,phase) {
  for(let i=0;i<100;i++){const s=await test.command('status');if(s.data.phase===phase)return s.data;await new Promise(r=>setTimeout(r,5))}
  throw Error(`never reached ${phase}`);
}
(async()=>{
  const t = setup();
  assert((await t.command('start',{streamId:'tab-123',title:'video'})).ok);
  assert.equal(t.stats.constraints.audio.mandatory.chromeMediaSource,'tab');
  assert.equal(t.stats.constraints.video.mandatory.chromeMediaSourceId,'tab-123');
  assert(t.stats.encoding.mimeType.startsWith('video/mp4'));
  assert.equal(t.stats.speakerConnections,0,'silent mode must not connect tab audio to speakers');
  assert.equal(t.tracks[1].enabled,undefined,'silent mode must not disable recorded audio track');
  assert(!(await t.command('start',{streamId:'other'})).ok,'must prevent concurrent capture');
  assert((await t.command('stop')).ok);
  const saved = await until(t,'downloading');
  assert.equal(saved.bytes,9,'must include final chunk');
  assert.equal(t.stats.stopped,2,'release both capture tracks');
  assert.equal(t.stats.writes.length,2);
  await t.command('download-ended',{complete:false,error:'cancelled'});
  await until(t,'ready');
  assert.equal(t.stats.removed,0,'must retain file on canceled download');
  assert((await t.command('download')).ok);
  assert.equal(t.stats.downloads,2);
  await t.command('download-ended',{complete:true});
  await until(t,'idle');
  assert.equal(t.stats.removed,1,'delete temp only after completed download');
  assert((await t.command('start',{streamId:'again',title:'again'})).ok);
  t.tracks[0].ended();
  await until(t,'downloading');
  const failure = setup({captureFails:true});
  assert(!(await failure.command('start',{streamId:'bad'})).ok);
  await until(failure,'error');
  assert.equal(failure.stats.aborted,1,'abort temp writer when acquisition fails');
  const cancel = setup({saveFails:true});
  await cancel.command('start',{streamId:'ok'});
  await cancel.command('stop');
  const pending = await until(cancel,'ready');
  assert(pending.error.includes('cancelled'));
  assert.equal(cancel.stats.removed,0);
  for(const fps of [60,120]) {
    const hd=setup();
    const result=await hd.command('start',{streamId:'hd',quality:`1080p${fps}`});
    assert(result.ok,result.error);
    assert.equal(hd.stats.constraints.video.mandatory.minWidth,1920);
    assert.equal(hd.stats.constraints.video.mandatory.maxHeight,1080);
    assert.equal(hd.stats.constraints.video.mandatory.minFrameRate,fps);
    assert.equal(hd.stats.encoding.videoBitsPerSecond,fps===120?32000000:16000000);
    assert(result.data.captureFormat.includes(String(fps)));
    await hd.command('stop');await until(hd,'downloading');
  }
  const limited=setup({settingsOverride:{width:1920,height:1080,frameRate:60}});
  const rejected=await limited.command('start',{streamId:'limited',quality:'1080p120'});
  assert(!rejected.ok,'must not silently claim 120 FPS when Chrome reports 60');
  assert.equal(limited.stats.stopped,2);
  assert.equal(limited.stats.aborted,1);
  const audible=setup();
  const listen=await audible.command('start',{streamId:'listen',monitorAudio:true});
  assert(listen.ok);
  assert.equal(audible.stats.speakerConnections,1,'explicit monitoring routes the tab stream to speakers');
  await audible.command('stop');await until(audible,'downloading');
  const originallyMuted=setup({tabMuted:true});
  assert((await originallyMuted.command('start',{streamId:'muted',monitorAudio:true})).ok);
  assert.equal(originallyMuted.stats.speakerConnections,0,'muted tab must stay silent even if monitoring was selected');
  await originallyMuted.command('stop');await until(originallyMuted,'downloading');
  const unsupported=setup({mp4Supported:false});
  const noMp4=await unsupported.command('start',{streamId:'not-used'});
  assert(!noMp4.ok && noMp4.error.includes('MP4'));
  assert.equal(unsupported.stats.constraints,undefined,'reject before any capture or mute change');
  console.log('PASS: tab-only media, concurrent guard, final chunk flush, track cleanup, download retry, temp cleanup, target closed, acquisition failure.');
})().catch(error=>{console.error(error);process.exitCode=1});
