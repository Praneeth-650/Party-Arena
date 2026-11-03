const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static('public', { etag: false, lastModified: false, setHeaders: (res) => res.setHeader('Cache-Control', 'no-store, max-age=0') }));

const rooms = new Map();
const WORDS = [
  {category:'Monuments', word:'Taj Mahal'}, {category:'Animals', word:'Elephant'},
  {category:'Food', word:'Pizza'}, {category:'Countries', word:'Japan'},
  {category:'Sports', word:'Cricket'}, {category:'Movies', word:'Avatar'},
  {category:'Vehicles', word:'Motorcycle'}, {category:'Technology', word:'Smartphone'},
  {category:'Places', word:'Beach'}, {category:'Fruits', word:'Mango'},
  {category:'Professions', word:'Doctor'}, {category:'Instruments', word:'Guitar'},
  {category:'Nature', word:'Waterfall'}, {category:'Transport', word:'Airplane'}
];
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const clean = s => String(s || '').trim().slice(0, 18);
function pub(r, viewerId){ return {code:r.code, hostId:r.hostId, mode:r.mode, phase:r.phase, round:r.round, maxRounds:r.settings?.maxRounds||5, settings:r.settings||{maxRounds:5,scoring:'placement'},
  players:r.players.map(p=>({id:p.id,name:p.name,score:p.score,connected:p.connected,done:p.done,number:r.mode==='number'&&p.id!==viewerId?p.number:undefined})),
  currentTurn:r.currentTurn, log:r.log.slice(-30), category:r.category, clueCycle:r.clueCycle, clues:r.clues,
  votes:Object.keys(r.votes).length, votedOut:r.votedOut, result:r.result,
  secret:r.phase==='impostor-result'||r.phase==='impostor-steal'?r.secret:undefined,
  impostorId:r.phase==='impostor-result'||r.phase==='impostor-steal'?r.impostorId:undefined,
  // Role and word are calculated separately for each recipient; never broadcast a shared role.
  role:['impostor-clues','impostor-steal'].includes(r.phase) ? (viewerId===r.impostorId ? 'impostor' : 'player') : null,
  isImpostor:r.phase==='impostor-clues' && Boolean(r.impostorId) && viewerId===r.impostorId,
  secretWord:r.mode==='impostor' && r.phase==='impostor-clues' && viewerId!==r.impostorId ? r.secret : undefined,
  question:r.question, answer:r.answer, finishOrder:r.finishOrder}; }
function emit(r){ for(const p of r.players){io.to(p.id).emit('state',pub(r,p.id));} }
function say(r,msg){ r.log.push(msg); }
function nextConnected(r, afterId){
  const list=r.players.filter(p=>p.connected && (!p.done || r.mode==='impostor'));
  if(!list.length) return null;
  const idx=list.findIndex(p=>p.id===afterId);
  return list[(idx+1+list.length)%list.length].id;
}
function startNumberRound(r){
  r.phase='number-play'; r.currentTurn=r.players.find(p=>p.connected && !p.done)?.id || r.players[0].id;
  r.question=null; r.answer=null; r.finishOrder=[]; r.players.forEach(p=>{p.done=false;p.number=Math.floor(Math.random()*1001)});
  say(r,`Round ${r.round}: Hidden Number started. Numbers are between 0 and 1,000.`); emit(r);
}
function startImpostorRound(r){
  const activePlayers=r.players.filter(p=>p.connected);
  if(activePlayers.length<2) { r.phase='lobby'; return; }
  const chosen=WORDS[crypto.randomInt(WORDS.length)];
  // Choose exactly one connected player as impostor for this round.
  r.secret=chosen.word; r.category=chosen.category;
  r.impostorId=activePlayers[crypto.randomInt(activePlayers.length)].id;
  r.phase='impostor-clues'; r.clueCycle=1; r.clues=[]; r.votes={}; r.votedOut=null; r.result=null;
  r.currentTurn=activePlayers[0].id;
  say(r,`Round ${r.round}: Category is ${r.category}. Two clue cycles, then vote.`); emit(r);
}
function finishNumber(r){
  r.phase='round-result';
  const n=r.players.length, scoring=r.settings?.scoring||'placement';
  r.finishOrder.forEach((id,i)=>{const p=r.players.find(x=>x.id===id);p.score+=scoring==='placement'?Math.max(0,n-1-i):scoring==='winner-most'?(i===0?10:0):3});
  r.players.filter(p=>!p.done).forEach(p=>p.score+=0);
  r.result={type:'number',winner:r.finishOrder.length?r.players.find(p=>p.id===r.finishOrder[0]).name:'No winner',runnerUp:r.finishOrder.length>1?r.players.find(p=>p.id===r.finishOrder[1]).name:null,finishOrder:r.finishOrder.map((id,i)=>({name:r.players.find(p=>p.id===id).name,points:scoring==='placement'?Math.max(0,n-1-i):scoring==='winner-most'?(i===0?10:0):3})),unfinished:r.players.filter(p=>!p.done).map(p=>p.name)};
  say(r,'Hidden Number round complete.'); emit(r);
}
function finishImpostor(r){
  const impostor=r.players.find(p=>p.id===r.impostorId);
  if(r.votedOut!==r.impostorId){ impostor.score+=10; r.result={winner:'Impostor',message:'The group voted for an innocent player. The impostor escaped!',points:10}; r.phase='impostor-result'; }
  else { r.phase='impostor-steal'; r.result={winner:'Pending',message:'The impostor was caught. They get one final guess.'}; }
  say(r,r.result.message); emit(r);
}
function advanceRound(r){
  if(r.round>=(r.settings?.maxRounds||5)){r.phase='game-over';say(r,'Game over! Final leaderboard is ready.');emit(r);return;}
  r.round++; if(r.mode==='number') startNumberRound(r); else startImpostorRound(r);
}
function roomOf(socket){const id=socket.data.room;return id&&rooms.get(id)}
io.on('connection',socket=>{
 socket.on('create-room',({name})=>{
  if(!clean(name)) return socket.emit('error-msg','Enter a nickname first.');
  let c=code();while(rooms.has(c))c=code();
  const p={id:socket.id,name:clean(name),score:0,connected:true,done:false,number:null};
  const r={code:c,hostId:socket.id,players:[p],mode:null,phase:'lobby',round:0,currentTurn:null,log:[],finishOrder:[],clues:[],votes:{},settings:{maxRounds:5,scoring:'placement'}};
  rooms.set(c,r);socket.join(c);socket.data.room=c;socket.emit('joined',{id:socket.id,code:c});emit(r);
 });
 socket.on('join-room',({code:c,name})=>{
  c=String(c||'').toUpperCase();const r=rooms.get(c);
  if(!r)return socket.emit('error-msg','Room not found. Check the code.');
  if(r.phase!=='lobby')return socket.emit('error-msg','This game has already started.');
  if(r.players.length>=8)return socket.emit('error-msg','This room is full (8 players max).');
  if(!clean(name))return socket.emit('error-msg','Enter a nickname first.');
  const p={id:socket.id,name:clean(name),score:0,connected:true,done:false,number:null};r.players.push(p);socket.join(c);socket.data.room=c;socket.emit('joined',{id:socket.id,code:c});say(r,`${p.name} joined the room.`);emit(r);
 });
 socket.on('update-settings',({maxRounds,scoring}={})=>{const r=roomOf(socket);if(!r||socket.id!==r.hostId||r.phase!=='lobby')return;const n=Number(maxRounds);if(Number.isInteger(n)&&n>=1&&n<=30)r.settings.maxRounds=n;if(['placement','winner-most','flat'].includes(scoring))r.settings.scoring=scoring;emit(r);});
 socket.on('end-room',()=>{const r=roomOf(socket);if(!r||socket.id!==r.hostId)return;for(const p of r.players)io.to(p.id).emit('room-closed',{message:'The host ended this room.'});rooms.delete(r.code);});
 socket.on('start-game',({mode})=>{const r=roomOf(socket);if(!r||socket.id!==r.hostId)return;
  if(r.players.filter(p=>p.connected).length<2)return socket.emit('error-msg','At least 2 connected players are required.');
  if(!['number','impostor'].includes(mode))return;
  r.mode=mode;r.round=1;r.players.forEach(p=>p.score=0);r.log=[];
  mode==='number'?startNumberRound(r):startImpostorRound(r);
 });
 socket.on('number-question',({kind,value,high})=>{const r=roomOf(socket);if(!r||r.phase!=='number-play'||r.currentTurn!==socket.id)return;
  const p=r.players.find(x=>x.id===socket.id);if(!p||p.done)return;
  let q='',a=false;const n=p.number;value=Number(value);high=Number(high);
  if(kind==='greater'){q=`Is my number greater than ${value}?`;a=n>value}
  else if(kind==='less'){q=`Is my number less than ${value}?`;a=n<value}
  else if(kind==='even'){q='Is my number even?';a=n%2===0}
  else if(kind==='odd'){q='Is my number odd?';a=n%2===1}
  else if(kind==='between'){q=`Is my number between ${value} and ${high}?`;a=n>=Math.min(value,high)&&n<=Math.max(value,high)}
  else if(kind==='divisible'){const d=Math.max(1,Math.floor(value));q=`Is my number divisible by ${d}?`;a=n%d===0}
  else return;
  r.question={playerId:socket.id,text:q};r.answer=a?'Yes':'No';say(r,`${p.name} asked: ${q} — ${r.answer}`);emit(r);
 });
 socket.on('number-guess',({guess})=>{const r=roomOf(socket);if(!r||r.phase!=='number-play'||r.currentTurn!==socket.id)return;
  const p=r.players.find(x=>x.id===socket.id);if(!p||p.done)return;const g=Number(guess);
  if(!Number.isInteger(g)||g<0||g>1000)return socket.emit('error-msg','Enter a whole number from 0 to 1,000.');
  if(g===p.number){p.done=true;r.finishOrder.push(p.id);say(r,`${p.name} found their number! Place ${r.finishOrder.length}.`);
    if(r.players.every(x=>x.done||!x.connected)){finishNumber(r);return;}
  } else {say(r,`${p.name} made an incorrect guess.`);}
  r.currentTurn=nextConnected(r,socket.id);r.question=null;r.answer=null;emit(r);
 });
 socket.on('number-pass',()=>{const r=roomOf(socket);if(!r||r.phase!=='number-play'||r.currentTurn!==socket.id)return;r.currentTurn=nextConnected(r,socket.id);r.question=null;r.answer=null;emit(r)});
 socket.on('impostor-clue',({clue})=>{const r=roomOf(socket);if(!r||r.phase!=='impostor-clues'||r.currentTurn!==socket.id)return;
  const p=r.players.find(x=>x.id===socket.id);clue=String(clue||'').trim().slice(0,90);if(!clue)return;
  if(r.clues.some(x=>x.playerId===socket.id&&x.cycle===r.clueCycle))return;
  r.clues.push({playerId:socket.id,name:p.name,clue,cycle:r.clueCycle});say(r,`${p.name} gave a clue in cycle ${r.clueCycle}.`);
  const done=r.players.filter(x=>x.connected).every(x=>r.clues.some(c=>c.playerId===x.id&&c.cycle===r.clueCycle));
  if(done){if(r.clueCycle===1){r.clueCycle=2;r.currentTurn=r.players[0].id;say(r,'Clue cycle 2 begins.');}else{r.phase='impostor-vote';r.currentTurn=null;say(r,'Both clue cycles are complete. Vote for the impostor.');}}
  else r.currentTurn=nextConnected(r,socket.id);
  emit(r);
 });
 socket.on('impostor-vote',({targetId})=>{const r=roomOf(socket);if(!r||r.phase!=='impostor-vote'||r.votes[socket.id])return;
  if(!r.players.some(p=>p.id===targetId)||targetId===socket.id)return socket.emit('error-msg','Choose another player.');
  r.votes[socket.id]=targetId;
  if(r.players.filter(p=>p.connected).every(p=>r.votes[p.id]) ){const counts={};Object.values(r.votes).forEach(id=>counts[id]=(counts[id]||0)+1);const max=Math.max(...Object.values(counts));const tied=Object.keys(counts).filter(id=>counts[id]===max);
   if(tied.length>1){r.votes={};say(r,'The vote was tied. Everyone votes again.');}
   else r.votedOut=tied[0];
   if(r.votedOut)finishImpostor(r);
  } else say(r,`${r.players.find(p=>p.id===socket.id).name} voted.`);
  emit(r);
 });
 socket.on('impostor-steal-guess',({word})=>{const r=roomOf(socket);if(!r||r.phase!=='impostor-steal'||socket.id!==r.impostorId)return;
  const ok=String(word||'').trim().toLowerCase()===r.secret.toLowerCase();
  if(ok){r.players.find(p=>p.id===r.impostorId).score+=10;r.result={winner:'Impostor',message:'The impostor guessed the secret word and stole the win!',points:10};}
  else {r.result={winner:'Players',message:'The impostor guessed incorrectly. The other players win!',points:5};r.players.filter(p=>p.id!==r.impostorId).forEach(p=>p.score+=5);}
  r.phase='impostor-result';say(r,r.result.message);emit(r);
 });
 socket.on('end-game',()=>{
  const r=roomOf(socket);
  if(!r||socket.id!==r.hostId||r.phase==='lobby')return;
  // End the match for everyone while preserving the room, players and voice connections.
  r.mode=null; r.phase='lobby'; r.round=0; r.currentTurn=null;
  r.players.forEach(p=>{p.score=0;p.done=false;p.number=null;});
  r.finishOrder=[]; r.clues=[]; r.votes={}; r.votedOut=null;
  r.impostorId=null; r.secret=null; r.category=null; r.clueCycle=0;
  r.question=null; r.answer=null; r.result=null;
  r.log=[]; say(r,'The host ended the game. Choose a new game mode!');
  emit(r);
 });
 socket.on('next-round',()=>{const r=roomOf(socket);if(!r||socket.id!==r.hostId||!['round-result','impostor-result'].includes(r.phase))return;advanceRound(r)});
 // WebRTC voice-chat signaling: audio stays peer-to-peer; the server only relays setup messages.
 socket.on('voice-ready',()=>{const r=roomOf(socket);if(!r)return;r.players.filter(p=>p.id!==socket.id&&p.connected).forEach(p=>io.to(p.id).emit('voice-peer-ready',socket.id));});
 socket.on('voice-left',()=>{const r=roomOf(socket);if(!r)return;r.players.filter(p=>p.id!==socket.id).forEach(p=>io.to(p.id).emit('voice-peer-left',socket.id));r.players.filter(p=>p.id!==socket.id).forEach(p=>io.to(p.id).emit('voice-speaking',{id:socket.id,speaking:false}));});
 socket.on('voice-speaking',({speaking})=>{const r=roomOf(socket);if(!r)return;r.players.filter(p=>p.id!==socket.id&&p.connected).forEach(p=>io.to(p.id).emit('voice-speaking',{id:socket.id,speaking:!!speaking}));});
 socket.on('voice-signal',({to,signal})=>{
  const r=roomOf(socket); if(!r||!to||!signal) return;
  if(!r.players.some(p=>p.id===to&&p.connected)) return;
  io.to(to).emit('voice-signal',{from:socket.id,signal});
 });
 socket.on('disconnect',()=>{const r=roomOf(socket);if(!r)return;r.players.filter(x=>x.id!==socket.id).forEach(x=>io.to(x.id).emit('voice-peer-left',socket.id));r.players.filter(x=>x.id!==socket.id).forEach(x=>io.to(x.id).emit('voice-speaking',{id:socket.id,speaking:false}));const p=r.players.find(x=>x.id===socket.id);if(p){p.connected=false;say(r,`${p.name} disconnected.`);if(r.currentTurn===socket.id&&['number-play','impostor-clues'].includes(r.phase)){r.currentTurn=nextConnected(r,socket.id);if(r.phase==='number-play'&&!r.currentTurn)finishNumber(r); }if(r.phase==='lobby'&&r.hostId===socket.id){const next=r.players.find(x=>x.connected);if(next)r.hostId=next.id;}}emit(r);});
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Party Arena running on port ${PORT}`);
});
