(function(global){
  "use strict";

  const text = value => value == null ? "" : String(value);
  const array = value => Array.isArray(value) ? value : [];
  const csv = value => text(value).split(",").map(item=>item.trim()).filter(Boolean);
  const statusLabels = {
    draft:"Draft",proposed:"Meeting request",awaiting_response:"Awaiting response",
    counter_proposed:"New time proposal",accepted:"Accepted",
    confirmed:"Confirmed",declined:"Declined",cancelled:"Cancelled",
    completed:"Completed",no_show:"No-show",expired:"Expired",
    pending:"Pending response",connected:"Connected",saved:"Saved",
    dismissed:"Not interested",connection_requested:"Connection requested",
    new:"New",viewed:"Viewed"
  };

  function statusLabel(value){
    const key=text(value).toLowerCase();
    return statusLabels[key] || key.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
  }

  function activeProposer(meeting){
    const proposals=array(meeting&&meeting.proposals)
      .filter(proposal=>Number(proposal.proposal_round)===Number(meeting&&meeting.proposal_round)&&proposal.status==="active");
    return proposals[0]&&proposals[0].proposed_by_profile_id||null;
  }

  function meetingRole(meeting,currentProfileId){
    const current=text(currentProfileId);
    const proposer=text(activeProposer(meeting));
    if(proposer&&proposer===current)return "proposer";
    if(text(meeting&&meeting.requester_profile_id)===current)return "requester";
    return "recipient";
  }

  function meetingStatusLabel(meeting,currentProfileId){
    const status=text(meeting&&meeting.status).toLowerCase();
    const role=meetingRole(meeting,currentProfileId);
    if(status==="draft")return "Draft";
    if(status==="proposed"||status==="awaiting_response"){
      return role==="proposer"||role==="requester"?"Awaiting response":"Action required";
    }
    if(status==="counter_proposed"){
      return role==="proposer"?"Awaiting response":"New time proposal";
    }
    if(status==="accepted"||status==="confirmed")return "Confirmed";
    return statusLabel(status);
  }

  function meetingPermissions(meeting,currentProfileId){
    const status=text(meeting&&meeting.status).toLowerCase();
    const role=meetingRole(meeting,currentProfileId);
    const awaiting=["proposed","awaiting_response","counter_proposed"].includes(status);
    return {
      role,
      canAccept:awaiting&&role!=="proposer",
      canCounter:awaiting&&role!=="proposer",
      canDecline:awaiting&&role!=="proposer",
      canEdit:(status==="draft"&&text(meeting&&meeting.requester_profile_id)===text(currentProfileId))||(awaiting&&role==="proposer"),
      canWithdraw:awaiting&&role==="proposer"
    };
  }

  function categorizeMeetings(meetings,nowValue=Date.now()){
    const now=Number(nowValue);
    const result={requests:[],upcoming:[],past:[]};
    array(meetings).forEach(meeting=>{
      const status=text(meeting.status).toLowerCase();
      const end=Date.parse(meeting.confirmed_end||meeting.confirmed_start||"");
      if(["draft","proposed","awaiting_response","counter_proposed"].includes(status))result.requests.push(meeting);
      else if(["accepted","confirmed"].includes(status)&&(!Number.isFinite(end)||end>=now))result.upcoming.push(meeting);
      else result.past.push(meeting);
    });
    return result;
  }

  function badgeLabel(value){
    const count=Math.max(0,Math.floor(Number(value)||0));
    if(!count)return "";
    if(count>=100)return "99+";
    if(count>=10)return "9+";
    return String(count);
  }

  function safeHttpUrl(value){
    try{
      const parsed=new URL(text(value));
      return parsed.protocol==="https:"||parsed.protocol==="http:"?parsed.toString():null;
    }catch(_){ return null; }
  }

  function dateTime(value,timeZone){
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return "Time unavailable";
    try{
      return new Intl.DateTimeFormat(undefined,{
        timeZone:timeZone||undefined,dateStyle:"medium",timeStyle:"short"
      }).format(date);
    }catch(_){ return date.toLocaleString(); }
  }

  function relativeTime(value,nowValue=Date.now()){
    const timestamp=Date.parse(value),now=Number(nowValue);
    if(!Number.isFinite(timestamp)||!Number.isFinite(now))return "Time unavailable";
    const seconds=Math.max(0,Math.floor((now-timestamp)/1000));
    if(seconds<60)return "Just now";
    const minutes=Math.floor(seconds/60);
    if(minutes<60)return minutes+"m ago";
    const hours=Math.floor(minutes/60);
    if(hours<24)return hours+"h ago";
    const days=Math.floor(hours/24);
    if(days<7)return days+"d ago";
    return dateTime(value);
  }

  function groupNotifications(notifications,nowValue=Date.now()){
    const now=new Date(nowValue),today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
    const groups=[];
    array(notifications).forEach(notification=>{
      const timestamp=Date.parse(notification&&notification.created_at);
      const date=Number.isFinite(timestamp)?new Date(timestamp):null;
      const day=date?new Date(date.getFullYear(),date.getMonth(),date.getDate()).getTime():NaN;
      const age=Number.isFinite(day)?Math.floor((today-day)/86400000):Infinity;
      const label=age<=0?"Today":age===1?"Yesterday":age<7?"Earlier this week":"Older";
      let group=groups.find(item=>item.label===label);
      if(!group){group={label,items:[]};groups.push(group);}
      group.items.push(notification);
    });
    return groups;
  }

  function isoToCalendar(value){
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return "";
    return date.toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  }

  function icsEscape(value){
    return text(value).replace(/\\/g,"\\\\").replace(/\r?\n/g,"\\n").replace(/,/g,"\\,").replace(/;/g,"\\;");
  }

  function icsFold(line){
    const chunks=[];let current="",bytes=0;
    for(const character of line){
      const size=new TextEncoder().encode(character).length;
      const limit=chunks.length?74:75;
      if(current&&bytes+size>limit){chunks.push(current);current=character;bytes=size;}
      else{current+=character;bytes+=size;}
    }
    if(current||!chunks.length)chunks.push(current);
    return chunks.join("\r\n ");
  }

  function calendarEvent(meeting,origin,entryPath){
    if(!meeting||!meeting.confirmed_start||!meeting.confirmed_end) return null;
    const base=(origin||"https://medichall.com").replace(/\/+$/,"");
    const path=text(entryPath)||"/portal.html";
    const deepLink=base+(path.startsWith("/")?path:"/"+path)+"#matchmaking-meeting="+meeting.id;
    const title=text(meeting.title)||"MedicHall meeting";
    const agenda=text(meeting.agenda);
    const start=isoToCalendar(meeting.confirmed_start);
    const end=isoToCalendar(meeting.confirmed_end);
    if(!start||!end) return null;
    const uid="medichall-matchmaking-"+meeting.id+"@medichall.com";
    const stamp=isoToCalendar(new Date().toISOString());
    const description=[agenda,"Open the authenticated MedicHall workspace: "+deepLink].filter(Boolean).join("\n\n");
    const ics=[
      "BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//MedicHall//Matchmaking Workspace//EN",
      "CALSCALE:GREGORIAN","METHOD:PUBLISH","BEGIN:VEVENT",
      "UID:"+icsEscape(uid),"DTSTAMP:"+stamp,"DTSTART:"+start,"DTEND:"+end,
      "SUMMARY:"+icsEscape(title),"DESCRIPTION:"+icsEscape(description),
      "LOCATION:"+icsEscape("MedicHall secure meeting"),"URL:"+icsEscape(deepLink),
      "STATUS:CONFIRMED","END:VEVENT","END:VCALENDAR",""
    ].map(icsFold).join("\r\n");
    const dates=start+"/"+end;
    return {
      title,deepLink,ics,
      filename:"medichall-meeting-"+meeting.id+".ics",
      google:"https://calendar.google.com/calendar/render?action=TEMPLATE&text="+encodeURIComponent(title)+"&dates="+encodeURIComponent(dates)+"&details="+encodeURIComponent(description)+"&location="+encodeURIComponent(deepLink),
      outlook:"https://outlook.live.com/calendar/0/deeplink/compose?path=%2Fcalendar%2Faction%2Fcompose&rru=addevent&subject="+encodeURIComponent(title)+"&startdt="+encodeURIComponent(new Date(meeting.confirmed_start).toISOString())+"&enddt="+encodeURIComponent(new Date(meeting.confirmed_end).toISOString())+"&body="+encodeURIComponent(description)+"&location="+encodeURIComponent(deepLink)
    };
  }

  function wallTimeToIso(dateValue,timeValue,timeZone){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(text(dateValue))||!/^\d{2}:\d{2}$/.test(text(timeValue)))throw new Error("Choose a valid date and time for every option.");
    const [year,month,day]=dateValue.split("-").map(Number);
    const [hour,minute]=timeValue.split(":").map(Number);
    let guess=Date.UTC(year,month-1,day,hour,minute);
    const formatter=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
    for(let attempt=0;attempt<3;attempt++){
      const parts=Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(part=>part.type!=="literal").map(part=>[part.type,Number(part.value)]));
      const represented=Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
      guess+=Date.UTC(year,month-1,day,hour,minute)-represented;
    }
    const verification=Object.fromEntries(formatter.formatToParts(new Date(guess)).filter(part=>part.type!=="literal").map(part=>[part.type,part.value]));
    if(`${verification.year}-${verification.month}-${verification.day}`!==dateValue||`${verification.hour}:${verification.minute}`!==timeValue)throw new Error("That local time does not exist in the selected timezone.");
    return new Date(guess).toISOString();
  }

  function proposalSlots(localValues,durationMinutes,timeZone){
    const duration=Number(durationMinutes);
    if(!Number.isFinite(duration)||duration<15||duration>240) throw new Error("Choose a valid duration.");
    if(!Array.isArray(localValues)||localValues.length!==3)throw new Error("Provide exactly three meeting options.");
    const zone=text(timeZone)||"UTC";
    try{new Intl.DateTimeFormat("en",{timeZone:zone}).format(new Date());}catch(_){throw new Error("Choose a valid timezone.");}
    const starts=localValues.map(value=>{
      if(typeof value==="string"){
        const [date,time]=value.split("T");
        return new Date(wallTimeToIso(date,time,zone));
      }
      return new Date(wallTimeToIso(value&&value.date,value&&value.time,zone));
    });
    if(starts.some(date=>Number.isNaN(date.getTime()))) throw new Error("Choose three valid meeting options.");
    if(starts.some(date=>date.getTime()<=Date.now()))throw new Error("Every meeting option must be in the future.");
    const unique=new Set(starts.map(date=>date.toISOString()));
    if(unique.size!==3) throw new Error("Each proposal must use a different time.");
    return starts.map(start=>({
      start_at:start.toISOString(),
      end_at:new Date(start.getTime()+duration*60000).toISOString()
    }));
  }

  global.MedicHallMatchmakingDomain={
    array,csv,statusLabel,meetingRole,meetingStatusLabel,meetingPermissions,
    categorizeMeetings,badgeLabel,safeHttpUrl,dateTime,relativeTime,groupNotifications,calendarEvent,
    wallTimeToIso,proposalSlots
  };
})(globalThis);
