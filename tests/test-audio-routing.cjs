const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
let session={},muted=true,closed=false,events=[],monitorStops=0,otherMuted=true;
const ctx=vm.createContext({
 chrome:{storage:{session:{async get(){return {...session}},async set(data){Object.assign(session,data)},async remove(key){delete session[key]}}},tabs:{async get(id){if(closed)throw Error('closed');return {id,mutedInfo:{muted:id===42 ? muted : otherMuted}}},async update(id,data){events.push({id,muted:data.muted});if(id===42)muted=data.muted;else otherMuted=data.muted;return {id}}}},
 async offscreen(type,{tabId}){assert.equal(type,'monitor-off');assert.equal(tabId,42);monitorStops++}
});
vm.runInContext(fs.readFileSync('extension/audio-routing.js','utf8'),ctx);
(async()=>{
 assert((await ctx.prepareCapturedAudio(42)).originallyMuted);
 assert.equal(muted,false);
 await ctx.capturedTabMuted(99,{mutedInfo:{muted:true}});
 assert.equal(monitorStops,0,'unrelated tabs untouched');
 await ctx.restoreCapturedAudio();assert.equal(muted,true);assert.equal(session.captureAudio,undefined);
 muted=false;await ctx.prepareCapturedAudio(42);
 await ctx.restoreCapturedAudio();assert.equal(muted,false,'unmuted tabs stay unmuted');
 await ctx.prepareCapturedAudio(42);muted=true;
 await ctx.capturedTabMuted(42,{mutedInfo:{muted:true}});
 assert.equal(monitorStops,1);assert.equal(muted,false);
 await ctx.restoreCapturedAudio();assert.equal(muted,true,'restore mute chosen during recording');
 await ctx.prepareCapturedAudio(42);closed=true;await ctx.restoreCapturedAudio();
 assert.equal(session.captureAudio,undefined,'closed tab cleanup');
 assert(events.every(x=>x.id===42));
 closed=false;muted=true;
 await Promise.all([ctx.prepareCapturedAudio(42),ctx.prepareCapturedAudio(99)]);
 assert(!muted && !otherMuted);
 await ctx.restoreCapturedAudio(42);
 assert(muted && !otherMuted);
 assert.equal(session.captureAudio[99].tabId,99);
 await ctx.restoreCapturedAudio(99);
 assert(otherMuted);assert.equal(session.captureAudio,undefined);
 console.log('PASS: muted-start preparation, restore before stream release, unrelated tabs, mute during recording disables speakers, closed target cleanup.');
})().catch(e=>{console.error(e);process.exitCode=1});
