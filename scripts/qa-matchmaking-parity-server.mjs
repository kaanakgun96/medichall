import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const port = Number(process.argv[2] || 4173);

const qaBootstrap = String.raw`<script>
(() => {
  const nativeFetch = window.fetch.bind(window);
  const profile = {
    id:"profile-qa-manufacturer",user_id:"qa-user",role:"manufacturer",
    display_name:"MedicHall Manufacturing QA",country:"Türkiye",
    description:"MDR-ready sterile medical products for international distribution.",
    offered_products:["Sterile probe covers","Surgical drapes"],
    interested_products:["European distributors"],product_categories:["Operating Room"],
    partner_types_sought:["distributor","buyer"],target_countries:["Germany","Italy"],
    served_countries:["Türkiye","EU"],certifications:["CE MDR","ISO 13485"],
    required_certifications:[],sales_channels:["Hospitals","Tenders"],
    profile_completeness:94,is_active:true
  };
  const partner = {
    id:"profile-qa-distributor",role:"distributor",display_name:"NordCare Distribution QA",
    country:"Germany",description:"Hospital distributor focused on infection control and operating room products.",
    offered_products:["Hospital distribution"],interested_products:["Sterile probe covers"],
    company_size:"51–200 employees",website:"https://example.com"
  };
  const connection = {
    id:501,status:"accepted",state_version:3,requester_profile_id:profile.id,
    recipient_profile_id:partner.id,introduction_message:"Explore an EU distribution partnership.",
    other_profile:partner
  };
  const slot = (id,start,status="active",proposer=profile.id,round=1) => ({
    id,proposal_round:round,status,proposed_by_profile_id:proposer,
    start_at:start,end_at:new Date(Date.parse(start)+30*60000).toISOString(),
    source_timezone:"Europe/Istanbul"
  });
  const outgoing = {
    id:701,connection_id:connection.id,title:"Portfolio and distribution fit",
    agenda:"Review product evidence, market priorities and next steps.",
    status:"awaiting_response",state_version:2,proposal_round:1,duration_minutes:30,
    timezone:"Europe/Istanbul",language:"English",requester_profile_id:profile.id,
    recipient_profile_id:partner.id,other_profile:partner,video_status:"unconfigured",
    proposals:[
      slot(7101,"2035-08-06T07:00:00.000Z"),
      slot(7102,"2035-08-07T11:00:00.000Z"),
      slot(7103,"2035-08-08T07:30:00.000Z")
    ]
  };
  const incoming = {
    id:702,connection_id:connection.id,title:"Hospital channel introduction",
    agenda:"Confirm launch timing and hospital network coverage.",
    status:"counter_proposed",state_version:4,proposal_round:2,duration_minutes:45,
    timezone:"Europe/Berlin",language:"English",requester_profile_id:partner.id,
    recipient_profile_id:profile.id,other_profile:partner,video_status:"unconfigured",
    proposals:[
      slot(7201,"2035-08-12T08:00:00.000Z","active",partner.id,2),
      slot(7202,"2035-08-13T12:00:00.000Z","active",partner.id,2),
      slot(7203,"2035-08-14T09:30:00.000Z","active",partner.id,2)
    ]
  };
  const upcoming = {
    id:703,connection_id:connection.id,title:"Confirmed MDR portfolio review",
    agenda:"Review certificates, target accounts and commercial next steps.",
    status:"confirmed",state_version:5,proposal_round:1,duration_minutes:30,
    timezone:"Europe/Istanbul",language:"English",requester_profile_id:profile.id,
    recipient_profile_id:partner.id,other_profile:partner,video_status:"unconfigured",
    confirmed_start:"2035-09-03T07:00:00.000Z",confirmed_end:"2035-09-03T07:30:00.000Z",
    proposals:[slot(7301,"2035-09-03T07:00:00.000Z","accepted")]
  };
  const past = {
    id:704,connection_id:connection.id,title:"Completed qualification call",
    agenda:"Initial product and market qualification.",status:"completed",
    state_version:6,proposal_round:1,duration_minutes:30,timezone:"Europe/Istanbul",
    language:"English",requester_profile_id:profile.id,recipient_profile_id:partner.id,
    other_profile:partner,video_status:"revoked",
    confirmed_start:"2026-01-15T07:00:00.000Z",confirmed_end:"2026-01-15T07:30:00.000Z",
    proposals:[slot(7401,"2026-01-15T07:00:00.000Z","accepted")]
  };
  const workspace = {
    profile,
    matches:[{
      id:401,status:"connected",match_score:91,confidence_level:"high",
      target:partner,connection,
      explanation:{
        summary:"Strong product demand, certification and market-channel alignment.",
        top_reasons:[
          {label:"Product fit",score:96,weight_percent:35,reason:"Demand matches sterile portfolio"},
          {label:"Market fit",score:91,weight_percent:25,reason:"Priority EU markets overlap"},
          {label:"Certificates",score:88,weight_percent:20,reason:"MDR requirements align"}
        ],
        risk_signals:{commercial:"Confirm annual volume and exclusivity expectations."},
        confidence_note:"High confidence from complete structured profiles."
      }
    }],
    connections:[connection],
    meetings:[outgoing,incoming,upcoming,past],
    notifications:[],unread_count:2
  };
  const center = {
    notifications:[
      {id:901,title:"Meeting times need your response",body:"NordCare proposed three new times.",source_kind:"meeting",source_id:702,action_required:true,read_at:null,resolved_at:null,created_at:"2026-07-29T06:00:00.000Z",action_url:"#matchmaking-meeting=702"},
      {id:902,title:"New relationship message",body:"NordCare sent a portfolio question.",source_kind:"message",source_id:501,action_required:false,read_at:null,resolved_at:null,created_at:"2026-07-29T05:30:00.000Z",action_url:"#matchmaking-relationship=501"}
    ],
    unread_count:2,action_required_count:1,badge_count:2
  };
  const json = value => Promise.resolve(new Response(JSON.stringify(value),{
    status:200,headers:{"Content-Type":"application/json"}
  }));
  window.fetch = (input,options={}) => {
    const url=String(input);
    if(!url.startsWith("https://azdmuarzntzqdyirysux.supabase.co")){
      return nativeFetch(input,options);
    }
    if(url.includes("/auth/v1/user"))return json({id:"qa-user",email:"qa@local.invalid"});
    if(url.includes("/rest/v1/companies?"))return json([{id:42,owner_id:"qa-user",name:"MedicHall Manufacturing QA",country:"Türkiye",description:profile.description,is_approved:true,is_verified:true}]);
    if(url.includes("/rest/v1/buyer_profiles?"))return json([]);
    if(url.includes("/rest/v1/rpc/get_matchmaking_workspace"))return json(workspace);
    if(url.includes("/rest/v1/rpc/get_portal_notification_center"))return json(center);
    if(url.includes("/rest/v1/rpc/get_matchmaking_relationship"))return json({
      connection,other_profile:partner,messages:[],private_notes:[],
      meetings:[outgoing,incoming,upcoming,past]
    });
    if(url.includes("/functions/v1/meeting-video"))return json({video_status:"unconfigured"});
    return json([]);
  };
})();
</script>`;

function contentType(pathname) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png"
  }[extname(pathname)] || "application/octet-stream";
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host}`);
    const pathname = url.pathname === "/" ? "/portal.html" : url.pathname;
    const filePath = resolve(root, `.${pathname}`);
    if (!filePath.startsWith(`${root}/`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    let body = await readFile(filePath);
    if (pathname === "/portal.html") {
      const html = body.toString("utf8")
        .replace("<body>", `<body>${qaBootstrap}`)
        .replace(
          'let TOKEN = localStorage.getItem("mh_p_token") || null;',
          'let TOKEN = "qa-browser-session";'
        );
      body = Buffer.from(html);
    }
    response.writeHead(200, {
      "Content-Type": contentType(pathname),
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"});
    response.end(String(error.message || error));
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`MedicHall parity QA server: http://127.0.0.1:${port}`);
});
