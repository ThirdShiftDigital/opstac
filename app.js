// OpsTac Phone App — wired to real Supabase backend

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let currentProfile = null;   // { id, full_name, role, agency_id }
let currentAgency = null;
let currentSettings = null;  // agency_settings row
let myPersonnel = null;      // this user's own personnel row, if linked

let allPersonnel = [];
let allSubteams = [];

function memberById(id){ return allPersonnel.find(p => p.id === id); }
function mapsLink(address){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`; }
function mapsLinkHtml(address, label){
  if(!address) return '';
  return ` <a href="${mapsLink(address)}" target="_blank" rel="noopener" style="color:var(--olive-bright); font-size:11px; text-decoration:underline; margin-left:6px;" onclick="event.stopPropagation()">${label||'Open in Maps'}</a>`;
}
function subTeamById(id){ return allSubteams.find(t => t.id === id); }
function daysUntil(dateStr){
  if(!dateStr) return null;
  return Math.round((new Date(dateStr) - new Date()) / (1000*60*60*24));
}

function canEditOps(){
  if(!currentProfile) return false;
  if(currentProfile.role === 'commander') return true;
  if(currentProfile.role === 'team-leader') return currentSettings ? currentSettings.team_leader_edit_ops : true;
  return false;
}
function canManageCallouts(){
  if(!currentProfile) return false;
  if(currentProfile.role === 'commander') return true;
  if(currentProfile.role === 'team-leader') return currentSettings ? currentSettings.team_leader_callouts : true;
  return false;
}
function canManageRecords(){
  if(!currentProfile) return false;
  if(currentProfile.role === 'commander') return true;
  if(currentProfile.role === 'team-leader') return currentSettings ? currentSettings.team_leader_manage_records : true;
  return false;
}

async function loadCorePersonnel(){
  const [{ data: personnel }, { data: subteams }] = await Promise.all([
    supabaseClient.from('personnel').select('*').order('name'),
    supabaseClient.from('subteams').select('*'),
  ]);
  allPersonnel = personnel || [];
  allSubteams = subteams || [];
}

function applyTheme(accent, bright){
  document.documentElement.style.setProperty('--olive', accent);
  document.documentElement.style.setProperty('--olive-bright', bright);
}
function roleLabel(role){
  return { commander:'Commander', 'team-leader':'Team Leader', member:'Member' }[role] || role;
}

// ---------- Auth ----------
async function checkExistingSession(){
  const { data: { session } } = await supabaseClient.auth.getSession();
  if(session) await onSignedIn();
}

$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#loginBtn');
  const errorBox = $('#loginError');
  errorBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in...';

  const email = $('#loginEmail').value.trim();
  const password = $('#loginPassword').value;
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if(error){
    errorBox.textContent = error.message === 'Invalid login credentials' ? 'Incorrect email or password.' : error.message;
    errorBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Sign In';
    return;
  }

  const { data: factorsData } = await supabaseClient.auth.mfa.listFactors();
  const verifiedFactor = factorsData ? (factorsData.totp || []).find(f => f.status === 'verified') : null;
  if(verifiedFactor){
    pendingMfaFactorId = verifiedFactor.id;
    btn.disabled = false; btn.textContent = 'Sign In';
    $('#loginScreen').style.display = 'none';
    $('#mfaChallengeScreen').style.display = 'flex';
    return;
  }

  await onSignedIn();
});

$('#forgotPasswordLink').addEventListener('click', () => {
  $('#loginForm').style.display = 'none';
  $('#forgotPasswordLink').style.display = 'none';
  $('#forgotPasswordForm').style.display = 'block';
});
$('#backToLoginLink').addEventListener('click', () => {
  $('#forgotPasswordForm').style.display = 'none';
  $('#forgotSuccessMsg').style.display = 'none';
  $('#loginForm').style.display = 'block';
  $('#forgotPasswordLink').style.display = 'block';
});
$('#forgotSubmitBtn').addEventListener('click', async () => {
  const email2 = $('#forgotEmail').value.trim();
  const errorBox2 = $('#forgotError');
  errorBox2.style.display = 'none';
  if(!email2){ errorBox2.textContent = 'Enter your email first.'; errorBox2.style.display = 'block'; return; }

  const btn2 = $('#forgotSubmitBtn');
  btn2.disabled = true; btn2.textContent = 'Sending...';
  const { error: resetError } = await supabaseClient.auth.resetPasswordForEmail(email2, {
    redirectTo: window.location.origin + '/app.html',
  });
  btn2.disabled = false; btn2.textContent = 'Send Reset Link';
  if(resetError){
    errorBox2.textContent = resetError.message;
    errorBox2.style.display = 'block';
    return;
  }
  $('#forgotPasswordForm').style.display = 'none';
  $('#forgotSuccessMsg').style.display = 'block';
});

// Supabase only fires PASSWORD_RECOVERY for genuine password-reset links —
// an invite link just fires a plain SIGNED_IN event, so without this check
// an invited user would land straight in the app having never set a
// password at all. Capture the URL hash at page load, before Supabase's
// client can clear it, so we can still tell "this was an invite" even
// after the async auth event fires.
const initialUrlHash = window.location.hash;
let isInviteLink = initialUrlHash.includes('type=invite');

supabaseClient.auth.onAuthStateChange((event) => {
  if(event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && isInviteLink)){
    $('#loginScreen').style.display = 'none';
    $('#setPasswordScreen').style.display = 'flex';
  }
});

$('#setPasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#setPasswordBtn');
  const errorBox = $('#setPasswordError');
  errorBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Setting password...';

  const { error } = await supabaseClient.auth.updateUser({ password: $('#newPassword').value });
  if(error){
    errorBox.textContent = error.message;
    errorBox.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Set Password & Continue';
    return;
  }
  isInviteLink = false;
  $('#setPasswordScreen').style.display = 'none';
  await onSignedIn();
});

$('#signOutRow').addEventListener('click', async () => {
  await supabaseClient.auth.signOut();
  location.reload();
});

async function onSignedIn(){
  const { data: { user } } = await supabaseClient.auth.getUser();
  if(!user) return;

  const { data: profile, error: profileError } = await supabaseClient
    .from('profiles').select('id, full_name, role, agency_id').eq('id', user.id).single();

  if(profileError || !profile){
    $('#loginError').textContent = 'Could not load your profile. Contact your administrator.';
    $('#loginError').style.display = 'block';
    return;
  }
  currentProfile = profile;

  const [{ data: agency }, { data: settings }, { data: myRow }] = await Promise.all([
    supabaseClient.from('agencies').select('name, agency_code').eq('id', profile.agency_id).single(),
    supabaseClient.from('agency_settings').select('*').eq('agency_id', profile.agency_id).single(),
    supabaseClient.from('personnel').select('*').eq('profile_id', user.id).single(),
  ]);
  currentAgency = agency;
  currentSettings = settings;
  myPersonnel = myRow || null;

  if(settings && settings.accent_color) applyTheme(settings.accent_color, settings.accent_bright);

  $('#topAvatar').textContent = profile.full_name.split(' ').map(w=>w[0]).slice(-2).join('').toUpperCase();
  $('#acctNameLabel').textContent = profile.full_name;
  $('#acctRoleLabel').textContent = roleLabel(profile.role);
  $('#acctAgencyLabel').textContent = agency ? agency.name : '';

  $('#loginScreen').style.display = 'none';
  $('#setPasswordScreen').style.display = 'none';
  $('#appShell').style.display = 'flex';

  renderPermissionsSettings();
  loadPendingJoinRequests();
  goToSection('overview');
}

// ---------- Navigation ----------
const PAGE_META = {
  overview:  { title:'Overview' },
  roster:    { title:'Roster' },
  operations:{ title:'Operations' },
  equipment: { title:'Equipment' },
  certs:     { title:'Certifications' },
  training:  { title:'Training' },
  callouts:  { title:'Callouts' },
  more:      { title:'More' },
};
const FAB_LABEL = {
  roster:'Add Operator', equipment:'Log Equipment', certs:'Log Certification',
  training:'Log Session', operations:'New Operation'
};

$$('.tab-item').forEach(el => el.addEventListener('click', () => goToSection(el.dataset.section)));
$$('.more-nav-item').forEach(el => el.addEventListener('click', () => goToSection(el.dataset.jump)));

function goToSection(name){
  $$('.tab-item').forEach(el => el.classList.toggle('active', el.dataset.section === name));
  $$('.section').forEach(el => el.classList.toggle('active', el.id === `sec-${name}`));
  $('#content').scrollTop = 0;
  updateFab(name);

  if(name === 'overview') loadOverview();
  if(name === 'roster') loadRoster();
  if(name === 'equipment') loadEquipment();
  if(name === 'certs') loadCerts();
  if(name === 'training') loadTraining();
  if(name === 'operations'){ opsView='list'; $('#opsListView').style.display='block'; $('#opsDetailView').style.display='none'; loadOpsList(); }
}

function updateFab(name){
  const fab = $('#fab');
  const showFor = ['roster','equipment','certs','training','operations'];
  const opsListActive = name !== 'operations' || opsView === 'list';
  let allowed;
  if(name === 'operations') allowed = canEditOps();
  else allowed = canManageRecords();
  const shouldShow = allowed && showFor.includes(name) && opsListActive;
  fab.style.display = shouldShow ? 'flex' : 'none';
  fab.title = FAB_LABEL[name] || 'Add';
}
$('#fab').addEventListener('click', () => {
  const active = $('.section.active').id.replace('sec-','');
  if(active === 'operations'){ openNewOpSheet(); return; }
  if(active === 'roster'){ openMemberSheet(null); return; }
  if(active === 'equipment'){ openEquipSheet(); return; }
  if(active === 'certs'){ openCertSheet(); return; }
  if(active === 'training'){ openTrainingSheet(); return; }
});

// ---------- Overview ----------
async function loadOverview(){
  $('#overviewContent').innerHTML = `<div class="loading-state" style="padding:60px; text-align:center; color:var(--text-dim);">Loading...</div>`;
  await loadCorePersonnel();
  if(currentProfile.role === 'commander') await renderCommanderOverview();
  else if(currentProfile.role === 'team-leader') await renderTeamLeaderOverview();
  else await renderMemberOverview();
}

async function renderCommanderOverview(){
  $('#overviewTitle').textContent = 'Team Overview';
  $('#overviewSub').textContent = 'Team readiness at a glance';

  const [certsRes, opsRes, calloutsRes] = await Promise.all([
    supabaseClient.from('certifications').select('member_id, expires'),
    supabaseClient.from('operations').select('*'),
    supabaseClient.from('callouts').select('*, callout_recipients(*)').order('created_at',{ascending:false}).limit(10),
  ]);
  const certs = certsRes.data || [];
  const ops = opsRes.data || [];
  const callouts = calloutsRes.data || [];

  const ready = allPersonnel.filter(p=>p.status==='ready').length;
  const attention = allPersonnel.filter(p=>p.status==='attention').length;
  const certsDue = certs.filter(c=>{ const d=daysUntil(c.expires); return d!==null && d<=30; }).length;
  const activeOps = ops.filter(o=>o.status==='planning').length;

  const statRowHtml = `
    <div class="stat-strip">
      <div class="stat-card good"><div class="stat-num">${ready}/${allPersonnel.length}</div><div class="stat-label">Ready</div></div>
      <div class="stat-card ${attention>0?'warn':''}"><div class="stat-num">${attention}</div><div class="stat-label">Attention</div></div>
      <div class="stat-card ${certsDue>0?'warn':''}"><div class="stat-num">${certsDue}</div><div class="stat-label">Certs Due</div></div>
      <div class="stat-card"><div class="stat-num">${activeOps}</div><div class="stat-label">Active Ops</div></div>
    </div>`;

  const boardHtml = allPersonnel.map(p=>{
    const dotClass = p.status==='ready'?'good':p.status==='attention'?'warn':'bad';
    const tileClass = p.status==='unavailable'?'alert':(p.on_call?'on-call':'');
    const flags = [];
    if(p.on_call) flags.push(`<span class="flag oncall">On-call</span>`);
    certs.filter(c=>c.member_id===p.id).forEach(c=>{
      const d = daysUntil(c.expires);
      if(d<0) flags.push(`<span class="flag bad">Cert expired</span>`);
      else if(d<=30) flags.push(`<span class="flag warn">Cert ${d}d</span>`);
    });
    return `<div class="member-tile ${tileClass}">
      <div class="tile-top"><div><div class="tile-name">${p.name}</div><div class="tile-rank">${p.rank||''}</div></div><div class="tile-status-dot dot ${dotClass}"></div></div>
      <div class="tile-role">${p.team_role||''}</div>
      <div class="tile-flags">${flags.join('')}</div>
    </div>`;
  }).join('');

  $('#overviewContent').innerHTML = `
    <div class="hero-callout-btn" id="heroCalloutBtn">
      <div class="hero-callout-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13.73 4a2 2 0 0 0-3.46 0L2.34 18a2 2 0 0 0 1.73 3h15.86a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <div><div class="hero-callout-title">Callout Team</div><div class="hero-callout-sub">Activate & notify — text, Signal, or share</div></div>
    </div>
    ${statRowHtml}
    <div class="section-label-row"><div class="section-label">Status Board <span class="n">(${allPersonnel.length})</span></div></div>
    <div class="legend-mini px" style="margin-bottom:10px;">
      <span><span class="dot good"></span>Ready</span><span><span class="dot warn"></span>Attention</span><span><span class="dot bad"></span>Unavailable</span>
    </div>
    <div class="status-board">${boardHtml}</div>
  `;
  $('#heroCalloutBtn').addEventListener('click', () => { goToSection('operations'); openCalloutSheet(); });
}

async function renderTeamLeaderOverview(){
  const me = myPersonnel;
  const myTeam = me ? subTeamById(me.subteam_id) : null;
  const teamMembers = me ? allPersonnel.filter(p => p.subteam_id === me.subteam_id) : allPersonnel;
  const teamLabel = myTeam ? myTeam.name : 'Team';

  $('#overviewTitle').textContent = `${teamLabel} Dashboard`;
  $('#overviewSub').textContent = me ? `Welcome back, ${me.name}` : 'Welcome back';

  const [certsRes, opsRes] = await Promise.all([
    supabaseClient.from('certifications').select('member_id, expires'),
    supabaseClient.from('operations').select('*'),
  ]);
  const certs = certsRes.data || [];
  const ops = opsRes.data || [];

  const teamReady = teamMembers.filter(p=>p.status==='ready').length;
  const teamCertsDue = certs.filter(c => teamMembers.some(p=>p.id===c.member_id) && daysUntil(c.expires)<=30).length;
  const teamOnCall = teamMembers.filter(p=>p.on_call).length;
  const teamUpcomingOps = ops.filter(o=>o.status==='planning').length;

  const statRowHtml = `
    <div class="stat-strip">
      <div class="stat-card good"><div class="stat-num">${teamReady}/${teamMembers.length}</div><div class="stat-label">Team Ready</div></div>
      <div class="stat-card ${teamCertsDue>0?'warn':''}"><div class="stat-num">${teamCertsDue}</div><div class="stat-label">Certs Due</div></div>
      <div class="stat-card ${teamUpcomingOps>0?'warn':''}"><div class="stat-num">${teamUpcomingOps}</div><div class="stat-label">Upcoming Ops</div></div>
      <div class="stat-card"><div class="stat-num">${teamOnCall}</div><div class="stat-label">On-Call Now</div></div>
    </div>`;

  const myStatusHtml = me ? renderMyStatusCard(me, myTeam ? `${myTeam.name} Leader` : 'Team Leader') : '';

  const boardHtml = teamMembers.map(p=>{
    const dotClass = p.status==='ready'?'good':p.status==='attention'?'warn':'bad';
    const tileClass = p.status==='unavailable'?'alert':(p.on_call?'on-call':'');
    const flags = [];
    if(p.on_call) flags.push(`<span class="flag oncall">On-call</span>`);
    if(myTeam && myTeam.leader_personnel_id === p.id) flags.push(`<span class="flag" style="background:rgba(168,153,104,0.16); color:var(--olive-bright);">Leader</span>`);
    return `<div class="member-tile ${tileClass}">
      <div class="tile-top"><div><div class="tile-name">${p.name}</div><div class="tile-rank">${p.rank||''}</div></div><div class="tile-status-dot dot ${dotClass}"></div></div>
      <div class="tile-role">${p.team_role||''}</div>
      <div class="tile-flags">${flags.join('')}</div>
    </div>`;
  }).join('');

  $('#overviewContent').innerHTML = `
    <div class="hero-callout-btn" id="heroCalloutBtn">
      <div class="hero-callout-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13.73 4a2 2 0 0 0-3.46 0L2.34 18a2 2 0 0 0 1.73 3h15.86a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
      <div><div class="hero-callout-title">Callout ${teamLabel}</div><div class="hero-callout-sub">Activate & notify — text, Signal, or share</div></div>
    </div>
    ${myStatusHtml}
    ${statRowHtml}
    <div class="section-label-row"><div class="section-label">${teamLabel} Status <span class="n">(${teamMembers.length})</span></div></div>
    <div class="status-board">${boardHtml}</div>
  `;
  wireMyStatusCard();
  $('#heroCalloutBtn').addEventListener('click', () => { goToSection('operations'); openCalloutSheet(); });
}

async function renderMemberOverview(){
  const me = myPersonnel;
  $('#overviewTitle').textContent = 'My Dashboard';
  $('#overviewSub').textContent = me ? `Welcome back, ${me.name}` : 'Welcome back';

  const [certsRes, equipRes, opsRes] = await Promise.all([
    supabaseClient.from('certifications').select('*'),
    supabaseClient.from('equipment').select('*'),
    supabaseClient.from('operations').select('*, operation_operators(*)'),
  ]);
  const allCerts = certsRes.data || [];
  const allEquip = equipRes.data || [];
  const allOps = opsRes.data || [];

  const myCerts = me ? allCerts.filter(c=>c.member_id===me.id).sort((a,b)=>daysUntil(a.expires)-daysUntil(b.expires)) : [];
  const myCertsDue = myCerts.filter(c=>daysUntil(c.expires)<=30).length;
  const myEquipment = me ? allEquip.filter(e=>e.assigned_to===me.id) : [];
  const myOps = me ? allOps.filter(op => (op.operation_operators||[]).some(o=>o.member_id===me.id)) : [];
  const myUpcomingOps = myOps.filter(op=>op.status==='planning').length;

  const statRowHtml = `
    <div class="stat-strip">
      <div class="stat-card ${myCertsDue>0?'warn':''}"><div class="stat-num">${myCertsDue}</div><div class="stat-label">My Certs Due</div></div>
      <div class="stat-card"><div class="stat-num">${myEquipment.length}</div><div class="stat-label">Gear Assigned</div></div>
      <div class="stat-card ${myUpcomingOps>0?'warn':''}"><div class="stat-num">${myUpcomingOps}</div><div class="stat-label">Upcoming Ops</div></div>
      <div class="stat-card good"><div class="stat-num">0</div><div class="stat-label">Training Hrs 90d</div></div>
    </div>`;

  const myStatusHtml = me ? renderMyStatusCard(me, me.team_role || 'Operator') : '';

  const certsPreview = myCerts.length ? myCerts.slice(0,3).map(c=>{
    const d = daysUntil(c.expires);
    let label, cls;
    if(d<0){ label=`Expired ${Math.abs(d)}d ago`; cls='bad'; } else if(d<=30){ label=`Expires in ${d}d`; cls='warn'; } else { label='Current'; cls='good'; }
    return `<div class="row-card"><div class="row-top"><div class="row-title">${c.name}</div><span class="pill ${cls}"><span class="pill-dot"></span>${label}</span></div></div>`;
  }).join('') : `<div class="preview-empty">No certifications on file.</div>`;

  const equipPreview = myEquipment.length ? myEquipment.slice(0,3).map(e=>`
    <div class="row-card"><div class="row-top"><div><div class="row-title">${e.item}</div><div class="row-subtitle mono">${e.asset_no||''}</div></div>
    <span class="pill neutral">${e.condition==='good'?'Good':e.condition==='needs-service'?'Needs Service':'Inspect Due'}</span></div></div>
  `).join('') : `<div class="preview-empty">No equipment currently assigned.</div>`;

  const opsPreview = myOps.length ? myOps.slice(0,3).map(op=>`
    <div class="row-card" data-jump-op="${op.id}"><div class="row-top"><div><div class="row-title">${op.name}</div><div class="row-subtitle">${op.date||'Date TBD'}</div></div>
    <span class="pill ${op.status==='complete'?'good':'warn'}"><span class="pill-dot"></span>${op.status==='complete'?'Complete':'Planning'}</span></div></div>
  `).join('') : `<div class="preview-empty">No operations assigned right now.</div>`;

  $('#overviewContent').innerHTML = `
    ${myStatusHtml}
    ${statRowHtml}
    <div class="section-label-row"><div class="section-label">My Certifications</div><div class="section-view-all" data-jump="certs">View All</div></div>
    <div class="card-list">${certsPreview}</div>
    <div class="section-label-row"><div class="section-label">My Equipment</div><div class="section-view-all" data-jump="equipment">View All</div></div>
    <div class="card-list">${equipPreview}</div>
    <div class="section-label-row"><div class="section-label">My Operations</div><div class="section-view-all" data-jump="operations">View All</div></div>
    <div class="card-list">${opsPreview}</div>
  `;
  wireMyStatusCard();
  $$('.section-view-all').forEach(el => el.addEventListener('click', () => goToSection(el.dataset.jump)));
  $$('[data-jump-op]').forEach(card => card.addEventListener('click', () => { goToSection('operations'); openOpDetail(card.dataset.jumpOp); }));
}

function renderMyStatusCard(me, roleLine){
  const statusOptions = [
    { key:'ready', label:'Ready', cls:'qt-good' }, { key:'attention', label:'Attention', cls:'qt-warn' }, { key:'unavailable', label:'Unavailable', cls:'qt-bad' },
  ];
  return `
    <div class="my-status-card">
      <div class="my-status-top">
        <div class="my-status-avatar">${me.name.split(' ').map(w=>w[0]).slice(-2).join('')}</div>
        <div><div class="my-status-name">${me.name}</div><div class="my-status-role">${me.rank||''} · ${roleLine}</div></div>
      </div>
      <div class="quick-toggle-row" id="myStatusToggleRow">
        ${statusOptions.map(o=>`<div class="quick-toggle ${o.cls} ${me.status===o.key?'active':''}" data-status="${o.key}">${o.label}</div>`).join('')}
      </div>
      <div class="oncall-row"><span class="oncall-label">Available for callout</span><div class="oncall-switch ${me.on_call?'on':''}" id="myOnCallSwitch"></div></div>
    </div>`;
}
function wireMyStatusCard(){
  const row = $('#myStatusToggleRow');
  if(!row || !myPersonnel) return;
  $$('#myStatusToggleRow .quick-toggle').forEach(btn => btn.addEventListener('click', async () => {
    await supabaseClient.from('personnel').update({ status: btn.dataset.status }).eq('id', myPersonnel.id);
    myPersonnel.status = btn.dataset.status;
    loadOverview();
  }));
  const onCallSwitch = $('#myOnCallSwitch');
  if(onCallSwitch) onCallSwitch.addEventListener('click', async () => {
    const newVal = !myPersonnel.on_call;
    await supabaseClient.from('personnel').update({ on_call: newVal }).eq('id', myPersonnel.id);
    myPersonnel.on_call = newVal;
    loadOverview();
  });
}

// ---------- Roster ----------
async function loadRoster(){
  $('#addSubteamLink').style.display = canManageRecords() ? 'inline-block' : 'none';
  $('#linkExistingLink').style.display = currentProfile.role === 'commander' ? 'inline-block' : 'none';
  loadPendingJoinRequests();
  $('#rosterList').innerHTML = `<div class="loading-state" style="padding:40px; text-align:center; color:var(--text-dim);">Loading...</div>`;
  await loadCorePersonnel();
  const { data: certs } = await supabaseClient.from('certifications').select('member_id');

  const groups = [{ id:null, label:'Command' }, ...allSubteams.map(t => ({ id:t.id, label:`${t.name}${t.focus?' — '+t.focus:''}`, subteam:t }))];
  let html = '';
  groups.forEach(group => {
    const members = allPersonnel.filter(p => p.subteam_id === group.id);
    if(members.length === 0 && group.id === null) return; // hide empty "Command" pseudo-group only
    const editableHeader = group.subteam && canManageRecords();
    html += `<div class="section-label-row" style="padding-top:6px;" ${editableHeader ? `data-edit-subteam="${group.id}"` : ''}><div class="section-label" style="${editableHeader?'cursor:pointer;':''}">${group.label}${editableHeader ? ' <span style="opacity:0.5; font-size:10px;">(edit)</span>' : ''}</div></div>`;
    if(members.length === 0){
      html += `<div class="preview-empty" style="margin:6px 18px 14px;">No one assigned yet.</div>`;
      return;
    }
    html += members.map(p => {
      const dotClass = p.status==='ready'?'good':p.status==='attention'?'warn':'bad';
      const statusLabel = p.status==='ready'?'Ready':p.status==='attention'?'Attention':'Unavailable';
      const certCount = (certs||[]).filter(c=>c.member_id===p.id).length;
      const loginBadge = p.profile_id
        ? `<span class="flag oncall" style="margin-left:6px;">Has Login</span>`
        : `<span class="flag" style="margin-left:6px; background:rgba(138,143,148,0.14); color:var(--steel);">No Login</span>`;
      return `
        <div class="row-card" data-personnel-id="${p.id}">
          <div class="row-top">
            <div class="row-name-wrap">
              <div class="mini-avatar">${p.name.split(' ').map(w=>w[0]).slice(-2).join('')}</div>
              <div><div class="row-title">${p.name}${loginBadge}</div><div class="row-subtitle">${p.rank||''} · ${p.team_role||''}</div></div>
            </div>
            <span class="pill ${dotClass}"><span class="pill-dot"></span>${statusLabel}</span>
          </div>
          <div class="row-meta">
            <div class="meta-pair"><span class="meta-label">Certs on file</span><span class="meta-val">${certCount}</span></div>
            <div class="meta-pair"><span class="meta-label">Contact</span><span class="meta-val">${p.phone||''}</span></div>
          </div>
        </div>`;
    }).join('');
  });
  if(allPersonnel.length === 0) html = `<div class="preview-empty" style="margin:20px 18px;">No personnel on the roster yet.</div>`;
  $('#rosterList').innerHTML = html;

  $$('[data-edit-subteam]').forEach(header => header.addEventListener('click', () => {
    const subteam = allSubteams.find(t => t.id === header.dataset.editSubteam);
    if(subteam) openSubteamEditSheet(subteam);
  }));

  if(canManageRecords()){
    $$('#rosterList [data-personnel-id]').forEach(card => card.addEventListener('click', () => openMemberSheet(memberById(card.dataset.personnelId))));
  }
}

async function loadPendingJoinRequests(){
  const wrap = $('#pendingRequestsWrap');
  const badge = $('#pendingRequestsBadge');
  if(currentProfile.role !== 'commander'){ if(wrap) wrap.innerHTML = ''; if(badge) badge.style.display = 'none'; return; }
  const { data: requests } = await supabaseClient.from('join_requests').select('*').eq('status', 'pending').order('requested_at');

  if(badge){
    if(requests && requests.length > 0){ badge.textContent = requests.length; badge.style.display = 'block'; }
    else { badge.style.display = 'none'; }
  }
  if(!wrap) return;
  if(!requests || requests.length === 0){ wrap.innerHTML = ''; return; }

  const subteamOptions = `<option value="">Command (no sub-team)</option>` + allSubteams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

  wrap.innerHTML = `
    <div style="background:var(--bg-panel); border:1px solid var(--olive); border-radius:10px; padding:14px; margin:10px 0;">
      <div style="font-weight:700; margin-bottom:10px;">Pending Join Requests (${requests.length})</div>
      ${requests.map(r => `
        <div data-request-id="${r.id}" style="padding:10px 0; border-top:1px solid var(--line);">
          <div style="font-weight:600;">${r.name}</div>
          <div style="font-size:11.5px; color:var(--text-dim); margin-bottom:8px;">${r.email}${r.phone?' · '+r.phone:''}</div>
          <select class="field-input request-role" style="margin-bottom:8px;"><option value="member">Member</option><option value="team-leader">Team Leader</option></select>
          <select class="field-input request-subteam" style="margin-bottom:8px;">${subteamOptions}</select>
          <div style="display:flex; gap:8px;">
            <button class="btn request-approve" style="flex:1; padding:8px;">Approve</button>
            <button class="btn btn-danger-outline request-deny" style="flex:1; padding:8px;">Deny</button>
          </div>
        </div>
      `).join('')}
    </div>
  `;

  $$('.request-approve').forEach(btn => btn.addEventListener('click', async () => {
    const row = btn.closest('[data-request-id]');
    await reviewJoinRequest(row.dataset.requestId, 'approve', row.querySelector('.request-role').value, row.querySelector('.request-subteam').value);
  }));
  $$('.request-deny').forEach(btn => btn.addEventListener('click', async () => {
    const row = btn.closest('[data-request-id]');
    if(!confirm('Deny this join request?')) return;
    await reviewJoinRequest(row.dataset.requestId, 'deny');
  }));
}

async function reviewJoinRequest(requestId, decision, role, subteamId){
  const { data: { session } } = await supabaseClient.auth.getSession();
  const res = await fetch('/.netlify/functions/approve-join-request', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessToken: session.access_token, requestId, decision, role, subteamId }),
  });
  const data = await res.json();
  if(!res.ok){ alert(data.error || 'Could not process this request.'); return; }
  loadRoster();
}

function populateSubteamSelect(existing){
  $('#mMemberSubteam').innerHTML = `<option value="">Command (no sub-team)</option>` +
    allSubteams.map(t => `<option value="${t.id}" ${existing && existing.subteam_id===t.id ? 'selected':''}>${t.name}</option>`).join('');
}

let editingMemberId = null;
let mMemberOnCallVal = false;

function openMemberSheet(existing){
  editingMemberId = existing ? existing.id : null;
  $('#memberSheetTitle').textContent = existing ? 'Edit Operator' : 'Add Operator';
  $('#mMemberName').value = existing ? existing.name : '';
  $('#mMemberRank').value = existing ? existing.rank||'' : '';
  $('#mMemberRole').value = existing ? existing.team_role||'' : '';
  $('#mMemberPhone').value = existing ? existing.phone||'' : '';
  $('#mMemberStatus').value = existing ? existing.status : 'ready';
  populateSubteamSelect(existing);
  mMemberOnCallVal = existing ? !!existing.on_call : false;
  $('#mMemberOnCall').classList.toggle('on', mMemberOnCallVal);
  $('#mMemberSave').textContent = existing ? 'Save Changes' : 'Add to Roster';

  const showAddInvite = !existing && currentProfile.role === 'commander';
  $('#mMemberInviteRow').style.display = showAddInvite ? 'block' : 'none';
  if(showAddInvite){ $('#mMemberInviteEmail').value = ''; $('#mAddInviteError').style.display = 'none'; }
  $('#mMemberPermission').value = existing ? (existing.permission || 'member') : 'member';

  const showInvite = existing && !existing.profile_id && currentProfile.role === 'commander';
  $('#memberSheetInviteRow').style.display = showInvite ? 'block' : 'none';
  $('#mInviteError').style.display = 'none';
  $('#mInviteBtn').disabled = false;
  $('#mInviteBtn').textContent = 'Invite to App';

  const showRemove = existing && currentProfile.role === 'commander';
  $('#memberSheetRemoveRow').style.display = showRemove ? 'block' : 'none';
  if(showRemove){
    $('#mRemoveSub').textContent = existing.profile_id ? 'This also revokes their app login.' : 'They have no login, so this only removes the roster entry.';
  }
  $('#mRemoveError').style.display = 'none';
  $('#mRemoveBtn').disabled = false;
  $('#mRemoveBtn').textContent = 'Remove';

  $('#memberSheet').classList.add('active');
}
$('#mMemberOnCall').addEventListener('click', () => {
  mMemberOnCallVal = !mMemberOnCallVal;
  $('#mMemberOnCall').classList.toggle('on', mMemberOnCallVal);
});
$('#mMemberCancel').addEventListener('click', () => $('#memberSheet').classList.remove('active'));
$('#mMemberSave').addEventListener('click', async () => {
  const name = $('#mMemberName').value.trim();
  if(!name) return;
  const permission = $('#mMemberPermission').value;
  const payload = {
    name,
    rank: $('#mMemberRank').value.trim() || null,
    team_role: $('#mMemberRole').value.trim() || null,
    subteam_id: $('#mMemberSubteam').value || null,
    phone: $('#mMemberPhone').value.trim() || null,
    status: $('#mMemberStatus').value,
    permission,
    on_call: mMemberOnCallVal,
  };
  if(editingMemberId){
    await supabaseClient.from('personnel').update(payload).eq('id', editingMemberId);
    $('#memberSheet').classList.remove('active');
    loadRoster();
    return;
  }

  const { data: created } = await supabaseClient.from('personnel')
    .insert({ agency_id: currentProfile.agency_id, ...payload }).select().single();

  const inviteEmail = $('#mMemberInviteEmail') ? $('#mMemberInviteEmail').value.trim() : '';
  if(!inviteEmail || !created){
    $('#memberSheet').classList.remove('active');
    loadRoster();
    return;
  }

  const saveBtn = $('#mMemberSave');
  saveBtn.disabled = true; saveBtn.textContent = 'Adding & Inviting...';
  const { data: { session } } = await supabaseClient.auth.getSession();
  try {
    const res = await fetch('/.netlify/functions/invite-member', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token, personnelId: created.id, email: inviteEmail, role: permission }),
    });
    const data = await res.json();
    if(!res.ok){
      const errorBox = $('#mAddInviteError');
      errorBox.textContent = `Operator was added, but the invite failed: ${data.error || 'unknown error'}. You can retry from their roster entry.`;
      errorBox.style.display = 'block';
      saveBtn.disabled = false; saveBtn.textContent = 'Add to Roster';
      return;
    }
  } catch(err){
    const errorBox = $('#mAddInviteError');
    errorBox.textContent = 'Operator was added, but the invite could not be sent — network error. You can retry from their roster entry.';
    errorBox.style.display = 'block';
    saveBtn.disabled = false; saveBtn.textContent = 'Add to Roster';
    return;
  }
  saveBtn.disabled = false; saveBtn.textContent = 'Add to Roster';
  $('#memberSheet').classList.remove('active');
  loadRoster();
});

$('#mInviteBtn').addEventListener('click', async () => {
  const existing = memberById(editingMemberId);
  const email = prompt(`Email address for ${existing.name}:`);
  if(!email || !email.trim()) return;
  const btn = $('#mInviteBtn');
  btn.disabled = true; btn.textContent = 'Sending...';
  const errorBox = $('#mInviteError');
  errorBox.style.display = 'none';

  const { data: { session } } = await supabaseClient.auth.getSession();
  try {
    const res = await fetch('/.netlify/functions/invite-member', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token, personnelId: existing.id, email: email.trim(), role: 'member' }),
    });
    const data = await res.json();
    if(!res.ok){
      errorBox.textContent = data.error || 'Could not send invite.';
      errorBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Invite to App';
      return;
    }
    btn.textContent = 'Invite Sent';
    $('#memberSheet').classList.remove('active');
    loadRoster();
  } catch(err){
    errorBox.textContent = 'Network error — please try again.';
    errorBox.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Invite to App';
  }
});

$('#mRemoveBtn').addEventListener('click', async () => {
  const existing = memberById(editingMemberId);
  const warning = existing.profile_id
    ? `Remove ${existing.name} from the roster and revoke their app login? This can't be undone.`
    : `Remove ${existing.name} from the roster? This can't be undone.`;
  if(!confirm(warning)) return;

  const btn = $('#mRemoveBtn');
  btn.disabled = true; btn.textContent = 'Removing...';
  const errorBox = $('#mRemoveError');
  errorBox.style.display = 'none';

  const { data: { session } } = await supabaseClient.auth.getSession();
  try {
    const res = await fetch('/.netlify/functions/remove-member', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: session.access_token, personnelId: existing.id }),
    });
    const data = await res.json();
    if(!res.ok){
      errorBox.textContent = data.error || 'Could not remove them.';
      errorBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Remove';
      return;
    }
    $('#memberSheet').classList.remove('active');
    loadRoster();
  } catch(err){
    errorBox.textContent = 'Network error — please try again.';
    errorBox.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Remove';
  }
});

$('#addSubteamLink').addEventListener('click', () => $('#subteamSheet').classList.add('active'));

$('#linkExistingLink').addEventListener('click', async () => {
  await loadCorePersonnel();
  $('#lExSubteam').innerHTML = `<option value="">Command (no sub-team)</option>` + allSubteams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  $('#lExEmail').value=''; $('#lExName').value=''; $('#lExRank').value=''; $('#lExRole').value=''; $('#lExPhone').value='';
  $('#lExError').style.display = 'none';
  $('#linkExistingSheet').classList.add('active');
});
$('#lExCancel').addEventListener('click', () => $('#linkExistingSheet').classList.remove('active'));
$('#lExSave').addEventListener('click', async () => {
  const email = $('#lExEmail').value.trim();
  const name = $('#lExName').value.trim();
  const errorBox = $('#lExError');
  errorBox.style.display = 'none';
  if(!email || !name){
    errorBox.textContent = 'Email and name are required.';
    errorBox.style.display = 'block';
    return;
  }
  const btn = $('#lExSave');
  btn.disabled = true; btn.textContent = 'Adding...';

  const { data: { session } } = await supabaseClient.auth.getSession();
  try {
    const res = await fetch('/.netlify/functions/link-existing-account', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: session.access_token, email, name,
        rank: $('#lExRank').value.trim(), teamRole: $('#lExRole').value.trim(),
        subteamId: $('#lExSubteam').value, phone: $('#lExPhone').value.trim(),
        role: $('#lExPermission').value,
      }),
    });
    const data = await res.json();
    if(!res.ok){
      errorBox.textContent = data.error || 'Could not add this account.';
      errorBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Add to Roster';
      return;
    }
    $('#linkExistingSheet').classList.remove('active');
    btn.disabled = false; btn.textContent = 'Add to Roster';
    loadRoster();
  } catch(err){
    errorBox.textContent = 'Network error — please try again.';
    errorBox.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Add to Roster';
  }
});

// ---------- Equipment ----------
async function loadEquipment(){
  $('#equipList').innerHTML = `<div class="loading-state" style="padding:40px; text-align:center; color:var(--text-dim);">Loading...</div>`;
  await loadCorePersonnel();
  const { data: equipment } = await supabaseClient.from('equipment').select('*').order('item');
  if(!equipment || equipment.length === 0){
    $('#equipList').innerHTML = `<div class="preview-empty" style="margin:20px 18px;">No equipment logged yet.</div>`;
    return;
  }
  const condLabel = { good:['Good','good'], 'needs-service':['Needs Service','bad'], 'inspect-due':['Inspection Due','warn'] };
  const statusLabel = { 'checked-out':['Checked Out','warn'], 'in-storage':['In Storage','good'] };
  $('#equipList').innerHTML = equipment.map(e => {
    const assignee = e.assigned_to ? (memberById(e.assigned_to)?.name || '—') : 'Unassigned';
    const [cLabel,cClass] = condLabel[e.condition] || ['—',''];
    const [sLabel,sClass] = statusLabel[e.status] || ['—',''];
    return `<div class="row-card">
      <div class="row-top"><div><div class="row-title">${e.item}</div><div class="row-subtitle mono">${e.asset_no||''}</div></div>
      <span class="pill ${cClass}"><span class="pill-dot"></span>${cLabel}</span></div>
      <div class="row-meta">
        <div class="meta-pair"><span class="meta-label">Assigned to</span><span class="meta-val" style="font-family:'Inter',sans-serif;">${assignee}</span></div>
        <div class="meta-pair"><span class="meta-label">Status</span><span class="meta-val" style="font-family:'Inter',sans-serif;">${sLabel}</span></div>
      </div></div>`;
  }).join('');
}
$('#mEquipCancel').addEventListener('click', () => $('#equipSheet').classList.remove('active'));
async function openEquipSheet(){
  await loadCorePersonnel();
  $('#mEquipAssignee').innerHTML = `<option value="">Unassigned</option>` + allPersonnel.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  $('#mEquipItem').value=''; $('#mEquipAsset').value=''; $('#mEquipCondition').value='good'; $('#mEquipStatus').value='in-storage';
  $('#equipSheet').classList.add('active');
}
$('#mEquipSave').addEventListener('click', async () => {
  const item = $('#mEquipItem').value.trim();
  if(!item) return;
  await supabaseClient.from('equipment').insert({
    agency_id: currentProfile.agency_id, item,
    asset_no: $('#mEquipAsset').value.trim() || null,
    assigned_to: $('#mEquipAssignee').value || null,
    condition: $('#mEquipCondition').value, status: $('#mEquipStatus').value,
  });
  $('#equipSheet').classList.remove('active');
  loadEquipment();
});

// ---------- Certifications ----------
async function loadCerts(){
  $('#certList').innerHTML = `<div class="loading-state" style="padding:40px; text-align:center; color:var(--text-dim);">Loading...</div>`;
  await loadCorePersonnel();
  let { data: certs } = await supabaseClient.from('certifications').select('*');
  certs = certs || [];
  if(currentProfile.role === 'member' && myPersonnel){
    certs = certs.filter(c => c.member_id === myPersonnel.id);
    $('#certsSub') && ($('#certsSub').textContent = 'Your certification status');
  }
  if(certs.length === 0){
    $('#certList').innerHTML = `<div class="preview-empty" style="margin:20px 18px;">No certifications on file.</div>`;
    return;
  }
  const sorted = [...certs].sort((a,b)=>daysUntil(a.expires)-daysUntil(b.expires));
  $('#certList').innerHTML = sorted.map(c => {
    const m = memberById(c.member_id);
    const d = daysUntil(c.expires);
    let label, cls;
    if(d<0){ label=`Expired ${Math.abs(d)}d ago`; cls='bad'; } else if(d<=30){ label=`Expires in ${d}d`; cls='warn'; } else { label='Current'; cls='good'; }
    return `<div class="row-card">
      <div class="row-top"><div class="row-name-wrap"><div class="mini-avatar">${m?m.name.split(' ').map(w=>w[0]).slice(-2).join(''):'—'}</div>
      <div><div class="row-title">${c.name}</div><div class="row-subtitle">${currentProfile.role!=='member' && m ? m.name : ''}</div></div></div>
      <span class="pill ${cls}"><span class="pill-dot"></span>${label}</span></div>
      <div class="row-meta">
        <div class="meta-pair"><span class="meta-label">Issued</span><span class="meta-val">${c.issued||''}</span></div>
        <div class="meta-pair"><span class="meta-label">Expires</span><span class="meta-val">${c.expires}</span></div>
      </div></div>`;
  }).join('');
}
$('#mCertCancel').addEventListener('click', () => $('#certSheet').classList.remove('active'));
async function openCertSheet(){
  await loadCorePersonnel();
  $('#mCertMember').innerHTML = allPersonnel.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  $('#mCertName').value=''; $('#mCertIssued').value=''; $('#mCertExpires').value='';
  $('#certSheet').classList.add('active');
}
$('#mCertSave').addEventListener('click', async () => {
  const name = $('#mCertName').value.trim();
  const expires = $('#mCertExpires').value;
  if(!name || !expires) return;
  await supabaseClient.from('certifications').insert({
    agency_id: currentProfile.agency_id, member_id: $('#mCertMember').value, name,
    issued: $('#mCertIssued').value || null, expires,
  });
  $('#certSheet').classList.remove('active');
  loadCerts();
});

// ---------- Training ----------
async function loadTraining(){
  $('#trainingList').innerHTML = `<div class="loading-state" style="padding:40px; text-align:center; color:var(--text-dim);">Loading...</div>`;
  await loadCorePersonnel();
  const { data: sessions } = await supabaseClient.from('training_sessions').select('*').order('date',{ascending:false});
  const { data: attendees } = await supabaseClient.from('training_attendees').select('*');
  const sessionList = sessions || [];
  const totalHours = sessionList.reduce((s,t)=>s+Number(t.hours||0),0);
  const avgAttendance = sessionList.length ? Math.round((attendees||[]).length / sessionList.length) : 0;
  $('#trainingStats').innerHTML = `
    <div class="stat-card"><div class="stat-num">${totalHours}</div><div class="stat-label">Total Hours</div></div>
    <div class="stat-card"><div class="stat-num">${sessionList.length}</div><div class="stat-label">Sessions</div></div>
    <div class="stat-card"><div class="stat-num">${avgAttendance}</div><div class="stat-label">Avg Attend.</div></div>`;
  if(sessionList.length === 0){
    $('#trainingList').innerHTML = `<div class="preview-empty" style="margin:20px 18px;">No training sessions logged yet.</div>`;
    return;
  }
  $('#trainingList').innerHTML = sessionList.map(t => {
    const count = (attendees||[]).filter(a=>a.session_id===t.id).length;
    return `<div class="row-card">
      <div class="row-top"><div><div class="row-title">${t.title}</div><div class="row-subtitle mono">${t.date}</div></div><span class="pill neutral">${t.type||''}</span></div>
      <div class="row-meta">
        <div class="meta-pair"><span class="meta-label">Attendees</span><span class="meta-val">${count}</span></div>
        <div class="meta-pair"><span class="meta-label">Hours</span><span class="meta-val">${t.hours}h</span></div>
      </div></div>`;
  }).join('');
}
let trainAttendeeSelection = new Set();
$('#mTrainCancel').addEventListener('click', () => $('#trainingSheet').classList.remove('active'));
async function openTrainingSheet(){
  await loadCorePersonnel();
  trainAttendeeSelection = new Set();
  $('#mTrainAttendees').innerHTML = allPersonnel.map(p => `
    <div class="callout-roster-item" data-id="${p.id}"><div class="callout-checkbox"></div><span>${p.name}</span></div>`).join('');
  $$('#mTrainAttendees .callout-roster-item').forEach(row => row.addEventListener('click', () => {
    const id = row.dataset.id;
    if(trainAttendeeSelection.has(id)){ trainAttendeeSelection.delete(id); row.querySelector('.callout-checkbox').classList.remove('checked'); }
    else { trainAttendeeSelection.add(id); row.querySelector('.callout-checkbox').classList.add('checked'); }
  }));
  $('#mTrainDate').value=''; $('#mTrainHours').value=''; $('#mTrainTitle').value=''; $('#mTrainType').value='';
  $('#trainingSheet').classList.add('active');
}
$('#mTrainSave').addEventListener('click', async () => {
  const title = $('#mTrainTitle').value.trim();
  const date = $('#mTrainDate').value;
  if(!title || !date) return;
  const { data: session } = await supabaseClient.from('training_sessions').insert({
    agency_id: currentProfile.agency_id, date, title,
    type: $('#mTrainType').value.trim() || null, hours: Number($('#mTrainHours').value) || 0,
  }).select().single();
  if(session && trainAttendeeSelection.size > 0){
    await supabaseClient.from('training_attendees').insert([...trainAttendeeSelection].map(memberId => ({ session_id: session.id, member_id: memberId })));
  }
  $('#trainingSheet').classList.remove('active');
  loadTraining();
});

// ---------- Operations ----------
let opsView = 'list';
let currentOpId = null;
let armedOperatorId = null;

async function loadOpsList(){
  $('#opsHeroCalloutBtn').style.display = canManageCallouts() ? 'flex' : 'none';
  $('#opsList').innerHTML = `<div class="loading-state" style="padding:40px; text-align:center; color:var(--text-dim);">Loading...</div>`;
  const { data: ops } = await supabaseClient.from('operations').select('*').order('date',{ascending:false});
  if(!ops || ops.length === 0){
    $('#opsList').innerHTML = `<div class="preview-empty">No operations logged yet.</div>`;
  } else {
    $('#opsList').innerHTML = ops.map(o => {
      const statusCls = o.status==='complete'?'good':'warn';
      const statusLabel = o.status==='complete'?'Complete':'Planning';
      return `<div class="op-card" data-op-id="${o.id}">
        <div class="op-card-top"><div><div class="op-name">${o.name}</div><div class="op-meta">${o.type||''}</div></div>
        <span class="pill ${statusCls}"><span class="pill-dot"></span>${statusLabel}</span></div>
        <div class="op-meta-row"><div class="op-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>${o.date||''}</div><div class="op-meta-item"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>${o.location||''}${mapsLinkHtml(o.location)}</div></div>
      </div>`;
    }).join('');
    $$('#opsList .op-card').forEach(card => card.addEventListener('click', () => openOpDetail(card.dataset.opId)));
  }
  loadCalloutsIntoOpsList();
}

$('#cancelNewOp').addEventListener('click', () => $('#newOpSheet').classList.remove('active'));
function openNewOpSheet(){ $('#newOpSheet').classList.add('active'); }
$('#createNewOp').addEventListener('click', async () => {
  const name = $('#newOpName').value.trim();
  if(!name) return;
  const { data: op } = await supabaseClient.from('operations').insert({
    agency_id: currentProfile.agency_id, name,
    type: $('#newOpType').value.trim() || null, date: $('#newOpDate').value || null,
    location: $('#newOpLocation').value.trim() || null, status:'planning', plan:{},
  }).select().single();
  $('#newOpName').value=''; $('#newOpType').value=''; $('#newOpDate').value=''; $('#newOpLocation').value='';
  $('#newOpSheet').classList.remove('active');
  if(op) openOpDetail(op.id);
});

async function openOpDetail(opId){
  currentOpId = opId;
  opsView = 'detail';
  armedOperatorId = null;
  selectedPinMemberId = null;
  $('#opsListView').style.display = 'none';
  $('#opsDetailView').style.display = 'block';
  $$('.subtab').forEach(t => t.classList.toggle('active', t.dataset.subtab==='map'));
  $$('.subpanel').forEach(p => p.classList.toggle('active', p.id==='opPanel-map'));

  await loadCorePersonnel();
  const { data: op } = await supabaseClient.from('operations').select('*').eq('id', opId).single();
  const { data: operators } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', opId);
  // Normalize log: support top-level ops_log or nested under debrief._ops_log
  if(op && !Array.isArray(op.ops_log) && op.debrief && Array.isArray(op.debrief._ops_log)){
    op.ops_log = op.debrief._ops_log;
  }
  if(op && !Array.isArray(op.ops_log)) op.ops_log = [];
  renderOpDetail(op, operators || []);
  updateFab('operations');
}
$('#opBackBtn').addEventListener('click', () => {
  opsView = 'list';
  $('#opsDetailView').style.display = 'none';
  $('#opsListView').style.display = 'block';
  loadOpsList();
  updateFab('operations');
});
$$('.subtab').forEach(tab => tab.addEventListener('click', () => {
  $$('.subtab').forEach(t => t.classList.toggle('active', t===tab));
  $$('.subpanel').forEach(p => p.classList.toggle('active', p.id === `opPanel-${tab.dataset.subtab}`));
  if(tab.dataset.subtab === 'callouts' && currentOpId) renderOpCallouts(currentOpId);
  if(tab.dataset.subtab === 'log' && currentOpCache) renderOpsLog(currentOpCache);
}));
$('#opCalloutBtn') && $('#opCalloutBtn').addEventListener('click', () => {
  if(currentOpCache) openCalloutSheet({ id: currentOpCache.id, name: currentOpCache.name });
});
async function renderOpCallouts(opId){
  $('#opCalloutsContent').innerHTML = `<div class="loading-state" style="padding:30px; text-align:center; color:var(--text-dim);">Loading...</div>`;
  const { data: callouts } = await supabaseClient.from('callouts').select('*, callout_recipients(*)').eq('operation_id', opId).order('created_at', { ascending:false });
  if(!callouts || callouts.length === 0){
    $('#opCalloutsContent').innerHTML = `<div class="preview-empty">No callouts linked to this operation yet.</div>`;
    return;
  }
  const methodLabel = { text:'Sent via Text', share:'Shared', logged:'Logged Verbally', 'signal-group':'Sent to Signal Group' };
  $('#opCalloutsContent').innerHTML = callouts.map(co => {
    const total = (co.callout_recipients||[]).length;
    const acked = (co.callout_recipients||[]).filter(r => r.ack === 'acknowledged').length;
    const modeCls = co.mode === 'deploy' ? 'bad' : 'warn';
    const rows = (co.callout_recipients||[]).map(r => {
      const m = memberById(r.member_id);
      return `<div class="callout-recipient-row">
        <span class="callout-recipient-name">${m ? m.name : '—'}</span>
        <div class="callout-ack-chip ${r.ack==='acknowledged'?'acknowledged':''}" data-callout-id="${co.id}" data-member-id="${r.member_id}">${r.ack==='acknowledged'?'Acknowledged':'Pending'}</div>
      </div>`;
    }).join('');
    return `<div class="callout-card">
      <div class="callout-marker ${co.active?'active':''}"></div>
      <div style="min-width:0; flex:1;">
        <div class="callout-type">${co.type||'Callout'}</div>
        <div class="callout-meta">${co.date||''} ${co.location?'— '+co.location:''}${mapsLinkHtml(co.location)}</div>
        <div><span class="mode-pill ${co.mode}">${co.mode==='deploy'?'Deploy':'Standby'}</span>
          <div class="callout-method-tag" style="display:inline-block; vertical-align:top; margin-top:6px;">${methodLabel[co.method]||co.method}</div></div>
        <div class="callout-ack-list">${rows}</div>
      </div></div>`;
  }).join('');

  if(canManageCallouts()){
    $$('#opCalloutsContent .callout-ack-chip').forEach(chip => chip.addEventListener('click', async () => {
      const calloutId = chip.dataset.calloutId, memberId = chip.dataset.memberId;
      const { data: current } = await supabaseClient.from('callout_recipients').select('ack').eq('callout_id', calloutId).eq('member_id', memberId).single();
      const newAck = current && current.ack === 'acknowledged' ? 'pending' : 'acknowledged';
      await supabaseClient.from('callout_recipients').update({ ack: newAck }).eq('callout_id', calloutId).eq('member_id', memberId);
      renderOpCallouts(opId);
    }));
  }
}

let currentOpCache = null;
let currentOperatorsCache = [];

function renderOpDetail(op, operators){
  currentOpCache = op;
  currentOperatorsCache = operators;
  $('#opDetailTitle').textContent = op.name;
  $('#opDetailSub').innerHTML = `${op.type||''} · ${op.date||''} · ${op.location||''}${mapsLinkHtml(op.location)}`;
  $('#opDeleteBtn').style.display = canEditOps() ? 'flex' : 'none';
  renderMapPalette(op, operators);
  renderMapImageState(op);
  renderMapPins(operators);
  renderPlan(op);
  renderOpsLog(op);
  renderDebrief(op);
}
$('#opDeleteBtn').addEventListener('click', async () => {
  if(!currentOpCache) return;
  if(!confirm(`Delete "${currentOpCache.name}"? This removes its map, plan, and debrief permanently. Any callouts logged against it stay in your Callouts history, just unlinked.`)) return;
  await supabaseClient.from('operations').delete().eq('id', currentOpCache.id);
  opsView = 'list';
  $('#opsDetailView').style.display = 'none';
  $('#opsListView').style.display = 'block';
  loadOpsList();
});

let selectedPinMemberId = null; // pin selected for move/remove

const OP_ASSIGNMENT_ROLES = [
  'Entry', 'Perimeter', 'Overwatch', 'Breach', 'Cover',
  'Less-Lethal', 'Medic', 'Command', 'Rear Security', 'Other'
];

function renderMapPalette(op, operators){
  const editable = canEditOps();
  const focusId = armedOperatorId || selectedPinMemberId;

  $('#opPalette').innerHTML = allPersonnel.map(p => {
    const placed = operators.find(o => o.member_id === p.id);
    const role = placed && placed.role ? placed.role : '';
    const isFocus = focusId === p.id;
    return `<div class="op-chip ${armedOperatorId===p.id?'armed':''} ${selectedPinMemberId===p.id?'selected-chip':''} ${placed?'placed':''}" data-member-id="${p.id}">
      <div class="mini-avatar" style="${placed?'box-shadow:0 0 0 2px var(--olive);':''}${isFocus?' outline:2px solid var(--olive-bright);':''}">${p.name.split(' ').map(w=>w[0]).slice(-2).join('')}</div>
      <div class="op-chip-label">${p.name.split(' ').map(w=>w[0]).slice(-2).join('')}</div>
      ${role ? `<div class="op-chip-role">${role}</div>` : ''}
    </div>`;
  }).join('');

  const roleBar = $('#opRoleBar');
  if(roleBar){
    if(editable && focusId){
      const existing = operators.find(o => o.member_id === focusId);
      const currentRole = (existing && existing.role) || (roleBar.dataset.pendingRole || '');
      const who = memberById(focusId);
      roleBar.style.display = 'flex';
      roleBar.innerHTML = `<div class="op-role-bar-label">${who ? who.name.split(' ')[0] : 'Operator'} — assignment</div>` +
        OP_ASSIGNMENT_ROLES.map(r =>
          `<button type="button" class="op-role-chip ${currentRole===r?'active':''}" data-role="${r}">${r}</button>`
        ).join('') +
        `<button type="button" class="op-role-chip ${!currentRole?'active':''}" data-role="">No role</button>`;

      $$('#opRoleBar .op-role-chip').forEach(chip => {
        chip.addEventListener('click', async () => {
          const role = chip.dataset.role || null;
          const placed = operators.find(o => o.member_id === focusId);
          if(placed){
            const { error } = await supabaseClient.from('operation_operators').update({ role }).eq('operation_id', currentOpId).eq('member_id', focusId);
            if(error) console.warn('role update failed', error);
            const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
            currentOperatorsCache = refreshed || [];
            renderMapPins(currentOperatorsCache);
            renderMapPalette(currentOpCache, currentOperatorsCache);
          } else {
            roleBar.dataset.pendingRole = role || '';
            $$('#opRoleBar .op-role-chip').forEach(c => c.classList.toggle('active', (c.dataset.role||'') === (role||'')));
          }
        });
      });
    } else {
      roleBar.style.display = 'none';
      roleBar.innerHTML = '';
      if(!armedOperatorId) roleBar.dataset.pendingRole = '';
    }
  }

  if(!editable) return;
  $$('.op-chip').forEach(chip => chip.addEventListener('click', () => {
    const id = chip.dataset.memberId;
    const placed = operators.find(o => o.member_id === id);
    if(placed){
      selectedPinMemberId = selectedPinMemberId === id ? null : id;
      armedOperatorId = null;
      renderMapPalette(op, currentOperatorsCache);
      renderMapPins(currentOperatorsCache);
      $('#mapHint').textContent = selectedPinMemberId
        ? `Selected ${memberById(id).name}. Change role above, tap map to move, or × to remove.`
        : 'Tap a team member, choose a role, then tap the map.';
      return;
    }
    selectedPinMemberId = null;
    armedOperatorId = armedOperatorId === id ? null : id;
    const rb = $('#opRoleBar');
    if(rb) rb.dataset.pendingRole = '';
    renderMapPalette(op, operators);
    renderMapPins(operators);
    $('#mapHint').textContent = armedOperatorId
      ? `Place ${memberById(armedOperatorId).name} — choose role above, then tap the map.`
      : 'Tap a team member, choose a role, then tap the map.';
  }));
}

function renderMapImageState(op){
  const canvas = $('#mapCanvas');
  const img = $('#mapBgImage');
  const prompt = $('#mapUploadPrompt');
  const changeBtn = $('#mapChangeBtn');
  const scaleLabel = $('#mapScaleLabel');
  const editable = canEditOps();

  if(op.map_image_url){
    canvas.classList.add('has-image');
    canvas.style.aspectRatio = op.map_image_ratio || '1 / 1';
    prompt.style.display = 'none';
    changeBtn.style.display = editable ? 'block' : 'none';
    scaleLabel.style.display = 'none';
    supabaseClient.storage.from('operation-maps').createSignedUrl(op.map_image_url, 3600).then(({data, error}) => {
      if(error){ console.error('renderMapImageState: could not get signed URL', { path: op.map_image_url, error }); return; }
      img.src = data ? data.signedUrl : '';
      img.style.display = 'block';
    });
  } else {
    canvas.classList.remove('has-image');
    canvas.style.aspectRatio = '';
    img.style.display = 'none'; img.src = '';
    prompt.style.display = editable ? 'flex' : 'none';
    changeBtn.style.display = 'none';
    scaleLabel.style.display = 'block';
  }
}


$('#mapUploadPrompt').addEventListener('click', () => { if(canEditOps()) $('#mapImageInput').click(); });
$('#mapChangeBtn').addEventListener('click', () => { if(canEditOps()) $('#mapImageInput').click(); });
$('#mapImageInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file || !currentOpId) return;
  const path = `${currentProfile.agency_id}/${currentOpId}/${Date.now()}-${file.name}`;
  const { error } = await supabaseClient.storage.from('operation-maps').upload(path, file, { upsert:true });
  if(error){ alert('Upload failed: ' + error.message); return; }

  const img = new Image();
  const reader = new FileReader();
  reader.onload = (ev) => {
    img.onload = async () => {
      const ratio = `${img.naturalWidth} / ${img.naturalHeight}`;
      await supabaseClient.from('operations').update({ map_image_url: path, map_image_ratio: ratio }).eq('id', currentOpId);
      currentOpCache.map_image_url = path; currentOpCache.map_image_ratio = ratio;
      renderMapImageState(currentOpCache);
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

function renderMapPins(operators){
  $$('.map-pin').forEach(p => p.remove());
  const canvas = $('#mapCanvas');
  const editable = canEditOps();
  operators.forEach(o => {
    const m = memberById(o.member_id);
    if(!m) return;
    const pin = document.createElement('div');
    pin.className = 'map-pin' + (selectedPinMemberId === o.member_id ? ' selected' : '');
    pin.style.left = o.x + '%';
    pin.style.top = o.y + '%';
    const initials = m.name.split(' ').map(w=>w[0]).slice(-2).join('');
    pin.innerHTML = `<span class="map-pin-label">${initials}</span>` +
      (o.role ? `<span class="map-pin-role">${o.role}</span>` : '') +
      (editable && selectedPinMemberId === o.member_id
        ? `<button type="button" class="map-pin-remove" title="Remove">×</button>` : '');
    pin.title = m.name + (o.role ? ' · ' + o.role : '');

    pin.addEventListener('click', async (e) => {
      e.stopPropagation();
      if(!editable) return;
      // Remove button
      if(e.target.closest('.map-pin-remove')){
        await supabaseClient.from('operation_operators').delete()
          .eq('operation_id', currentOpId).eq('member_id', o.member_id);
        selectedPinMemberId = null;
        const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
        currentOperatorsCache = refreshed || [];
        renderMapPins(currentOperatorsCache);
        renderMapPalette(currentOpCache, currentOperatorsCache);
        $('#mapHint').textContent = 'Tap a team member below, then tap the map to place them.';
        return;
      }
      // Select pin for move/remove
      selectedPinMemberId = selectedPinMemberId === o.member_id ? null : o.member_id;
      armedOperatorId = null;
      renderMapPins(operators);
      renderMapPalette(currentOpCache, operators);
      $('#mapHint').textContent = selectedPinMemberId
        ? `Selected ${m.name}. Tap map to move, or tap × to remove.`
        : 'Tap a team member below, then tap the map to place them.';
    });
    canvas.appendChild(pin);
  });
}

// Re-bind map click (remove old listeners by cloning would be complex; replace handler body via flag)
if(!window._mapClickBound){
  window._mapClickBound = true;
  $('#mapCanvas').addEventListener('click', async (e) => {
    if(!canEditOps()) return;
    if(e.target.closest('#mapUploadPrompt') || e.target.closest('#mapChangeBtn') || e.target.closest('.map-pin')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    const clampedX = Math.max(3, Math.min(97, x));
    const clampedY = Math.max(3, Math.min(97, y));

    // Move selected pin
    if(selectedPinMemberId){
      await supabaseClient.from('operation_operators').update({
        x: clampedX, y: clampedY
      }).eq('operation_id', currentOpId).eq('member_id', selectedPinMemberId);
      selectedPinMemberId = null;
      const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
      currentOperatorsCache = refreshed || [];
      renderMapPins(currentOperatorsCache);
      renderMapPalette(currentOpCache, currentOperatorsCache);
      $('#mapHint').textContent = 'Tap a team member below, then tap the map to place them.';
      return;
    }

    if(!armedOperatorId) return;
    const roleBar = $('#opRoleBar');
    const role = (roleBar && roleBar.dataset.pendingRole) ? roleBar.dataset.pendingRole : null;
    const payload = {
      operation_id: currentOpId,
      member_id: armedOperatorId,
      x: clampedX,
      y: clampedY
    };
    if(role) payload.role = role;

    const { error } = await supabaseClient.from('operation_operators').upsert(payload, { onConflict:'operation_id,member_id' });
    if(error && role){
      // role column may not exist — retry without role
      console.warn('upsert with role failed, retrying without', error);
      await supabaseClient.from('operation_operators').upsert({
        operation_id: currentOpId, member_id: armedOperatorId, x: clampedX, y: clampedY
      }, { onConflict:'operation_id,member_id' });
    }
    armedOperatorId = null;
    selectedPinMemberId = null;
    const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
    currentOperatorsCache = refreshed || [];
    renderMapPins(currentOperatorsCache);
    renderMapPalette(currentOpCache, currentOperatorsCache);
    $('#mapHint').textContent = 'Tap a team member below, then tap the map to place them.';
  });
}

const PLAN_FIELDS = [
  { key:'objective', label:'Objective' }, { key:'approach', label:'Approach / Entry Plan' },
  { key:'rallyPoint', label:'Rally Point' }, { key:'comms', label:'Communications Plan' },
  { key:'contingencies', label:'Contingencies' }, { key:'equipment', label:'Equipment Needed' },
];
function renderPlan(op){
  const editable = canEditOps();
  const plan = op.plan || {};
  const commanderOptions = `<option value="">Not yet designated</option>` +
    allPersonnel.map(p => `<option value="${p.id}" ${op.incident_commander_personnel_id===p.id?'selected':''}>${p.name}</option>`).join('');

  $('#planFields').innerHTML = `
    <div class="field-group">
      <label class="field-label">Target Location Photos</label>
      <div id="targetPhotosGrid" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;"></div>
      ${editable ? `
        <input type="file" id="targetPhotoInput" accept="image/*" style="display:none;">
        <button class="btn btn-outline btn-block" id="uploadTargetPhotoBtn" type="button">+ Upload Photo</button>
      ` : ''}
    </div>
    <div class="field-group">
      <label class="field-label">Overall Command</label>
      <select class="field-input" id="opCommanderSelect" ${!editable?'disabled':''}>${commanderOptions}</select>
    </div>
    <div class="field-group">
      <label class="field-label">Assets Utilized</label>
      <div id="opAssetsChecklist" style="font-size:12.5px; color:var(--text-dim);">Loading...</div>
    </div>
  ` + PLAN_FIELDS.map(f => `
    <div class="field-group"><label class="field-label">${f.label}</label>
      ${editable ? `<textarea class="field-textarea" data-plan-field="${f.key}" placeholder="Not yet filled in...">${plan[f.key]||''}</textarea>`
                 : `<div class="field-static ${plan[f.key]?'':'field-empty'}">${plan[f.key]||'Not yet filled in'}</div>`}
    </div>`).join('') + (editable ? (
      op.status==='planning' ? `<button class="btn btn-primary btn-block" id="activateOpBtn">Mark Operation Active</button>` :
      op.status==='active' ? `<button class="btn btn-primary btn-block" id="completeOpBtn">Mark Operation Complete</button>` : ''
    ) : '');

  loadTargetPhotos(op.id, editable);
  loadOpAssets(op.id, editable);

  if(editable){
    $('#opCommanderSelect').addEventListener('change', async () => {
      const val = $('#opCommanderSelect').value || null;
      await supabaseClient.from('operations').update({ incident_commander_personnel_id: val }).eq('id', currentOpId);
      currentOpCache.incident_commander_personnel_id = val;
    });

    $('#uploadTargetPhotoBtn').addEventListener('click', () => $('#targetPhotoInput').click());
    $('#targetPhotoInput').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if(!file) return;
      const path = `${currentProfile.agency_id}/${currentOpId}/photos/${Date.now()}-${file.name}`;
      const { error } = await supabaseClient.storage.from('operation-maps').upload(path, file);
      if(error){ alert('Upload failed: ' + error.message); return; }
      await supabaseClient.from('operation_photos').insert({
        agency_id: currentProfile.agency_id, operation_id: op.id, storage_path: path,
      });
      e.target.value = '';
      loadTargetPhotos(op.id, editable);
    });

    $$('[data-plan-field]').forEach(ta => ta.addEventListener('blur', async () => {
      const newPlan = { ...currentOpCache.plan, [ta.dataset.planField]: ta.value };
      await supabaseClient.from('operations').update({ plan: newPlan }).eq('id', currentOpId);
      currentOpCache.plan = newPlan;
    }));
    const activateBtn = $('#activateOpBtn');
    if(activateBtn) activateBtn.addEventListener('click', async () => {
      await supabaseClient.from('operations').update({ status:'active' }).eq('id', currentOpId);
      currentOpCache.status = 'active';
      renderPlan(currentOpCache);
      renderOpsLog(currentOpCache);
      $$('.subtab').forEach(t => t.classList.toggle('active', t.dataset.subtab==='log'));
      $$('.subpanel').forEach(p => p.classList.toggle('active', p.id==='opPanel-log'));
    });
    const completeBtn = $('#completeOpBtn');
    if(completeBtn) completeBtn.addEventListener('click', async () => {
      // Build timeline from ops log if empty
      const log = currentOpCache.ops_log || [];
      let debrief = currentOpCache.debrief || {};
      if(!debrief.timeline && log.length){
        debrief = {
          ...debrief,
          timeline: log.slice().reverse().map(e => {
            const t = new Date(e.ts);
            const time = t.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
            return `[${time}] ${e.tag}${e.critical?' ★':''}: ${e.text}`;
          }).join('\n')
        };
      }
      await supabaseClient.from('operations').update({ status:'complete', debrief }).eq('id', currentOpId);
      currentOpCache.status = 'complete';
      currentOpCache.debrief = debrief;
      renderPlan(currentOpCache);
      renderOpsLog(currentOpCache);
      renderDebrief(currentOpCache);
      $$('.subtab').forEach(t => t.classList.toggle('active', t.dataset.subtab==='debrief'));
      $$('.subpanel').forEach(p => p.classList.toggle('active', p.id==='opPanel-debrief'));
    });
  }
}

async function loadTargetPhotos(operationId, editable){
  const { data: photos } = await supabaseClient.from('operation_photos').select('*').eq('operation_id', operationId).order('created_at');
  const grid = $('#targetPhotosGrid');
  if(!grid) return;
  if(!photos || photos.length === 0){
    grid.innerHTML = `<div style="font-size:12px; color:var(--text-dim);">No reference photos uploaded yet.</div>`;
    return;
  }
  const withUrls = await Promise.all(photos.map(async p => {
    const { data, error } = await supabaseClient.storage.from('operation-maps').createSignedUrl(p.storage_path, 3600);
    if(error){ console.error('loadTargetPhotos: could not get signed URL', { path: p.storage_path, error }); return { ...p, url: '', failed: true }; }
    return { ...p, url: data.signedUrl, failed: false };
  }));
  grid.innerHTML = withUrls.map(p => `
    <div style="position:relative;">
      ${p.failed
        ? `<div style="width:80px; height:80px; border-radius:6px; border:1px solid var(--bad); display:flex; align-items:center; justify-content:center; font-size:9px; color:var(--bad); text-align:center; padding:4px;">Failed to load</div>`
        : `<img src="${p.url}" data-expand-photo="${p.url}" style="width:80px; height:80px; object-fit:cover; border-radius:6px; border:1px solid var(--line); cursor:pointer;">`}
      ${editable ? `<button data-delete-photo="${p.id}" data-photo-path="${p.storage_path}" style="position:absolute; top:-6px; right:-6px; width:20px; height:20px; border-radius:50%; background:var(--bad); color:#fff; border:none; cursor:pointer; font-size:12px; line-height:1;">×</button>` : ''}
    </div>
  `).join('');
  $$('[data-expand-photo]').forEach(img => img.addEventListener('click', () => {
    $('#photoLightboxImg').src = img.dataset.expandPhoto;
    $('#photoLightbox').style.display = 'flex';
  }));
  $$('[data-delete-photo]').forEach(btn => btn.addEventListener('click', async () => {
    await supabaseClient.storage.from('operation-maps').remove([btn.dataset.photoPath]);
    await supabaseClient.from('operation_photos').delete().eq('id', btn.dataset.deletePhoto);
    loadTargetPhotos(operationId, editable);
  }));
}

async function loadOpAssets(operationId, editable){
  const [{ data: allEquipment }, { data: linked }] = await Promise.all([
    supabaseClient.from('equipment').select('id, item').order('item'),
    supabaseClient.from('operation_equipment').select('equipment_id').eq('operation_id', operationId),
  ]);
  const linkedIds = new Set((linked||[]).map(l => l.equipment_id));
  const container = $('#opAssetsChecklist');
  if(!container) return;

  if(!allEquipment || allEquipment.length === 0){
    container.innerHTML = `No equipment logged for this agency yet.`;
    return;
  }
  container.innerHTML = allEquipment.map(e => `
    <div class="callout-roster-item" data-equip-id="${e.id}">
      <div class="callout-checkbox ${linkedIds.has(e.id)?'checked':''}">${linkedIds.has(e.id)?'✓':''}</div>
      <span>${e.item}</span>
    </div>`).join('');

  if(editable){
    $$('#opAssetsChecklist .callout-roster-item').forEach(row => row.addEventListener('click', async () => {
      const equipId = row.dataset.equipId;
      const box = row.querySelector('.callout-checkbox');
      if(box.classList.contains('checked')){
        await supabaseClient.from('operation_equipment').delete().eq('operation_id', operationId).eq('equipment_id', equipId);
        box.classList.remove('checked'); box.textContent = '';
      } else {
        await supabaseClient.from('operation_equipment').insert({ operation_id: operationId, equipment_id: equipId });
        box.classList.add('checked'); box.textContent = '✓';
      }
    }));
  }
}


// ---------- Ops Log ----------
const OPS_LOG_TAGS = [
  'Note', 'Decision', 'Movement', 'Entry / Breach',
  'Suspect Contact', 'Suspect Custody', 'Use of Force', 'Shots Fired',
  'Injury', 'Medical', 'Equipment', 'Command'
];

const OPS_QUICK_ACTIONS = [
  { label: 'On Scene', tag: 'Movement', text: 'Team on scene' },
  { label: 'Entry Made', tag: 'Entry / Breach', text: 'Entry made' },
  { label: 'Suspect Contact', tag: 'Suspect Contact', text: 'Suspect contact' },
  { label: 'Suspect Custody', tag: 'Suspect Custody', text: 'Suspect in custody' },
  { label: 'Shots Fired', tag: 'Shots Fired', text: 'Shots fired' },
  { label: 'Use of Force', tag: 'Use of Force', text: 'Use of force' },
  { label: 'Injury – Suspect', tag: 'Injury', text: 'Suspect injury' },
  { label: 'Injury – Team', tag: 'Injury', text: 'Team member injury' },
  { label: 'Medical', tag: 'Medical', text: 'Medical activated' },
  { label: 'All Clear', tag: 'Note', text: 'All clear / scene secure' },
];

async function saveOpsLog(newLog){
  const { error } = await supabaseClient.from('operations').update({ ops_log: newLog }).eq('id', currentOpId);
  if(error){
    console.warn('ops_log update failed, trying nested store', error);
    const debrief = { ...(currentOpCache.debrief || {}), _ops_log: newLog };
    await supabaseClient.from('operations').update({ debrief }).eq('id', currentOpId);
    currentOpCache.debrief = debrief;
  }
  currentOpCache.ops_log = newLog;
}

async function addOpsLogEntry({ tag, text, critical = false }){
  const entry = {
    id: (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2),
    ts: new Date().toISOString(),
    tag: tag || 'Note',
    text: text || '',
    critical: !!critical,
    author: (currentProfile && currentProfile.full_name) || 'Commander'
  };
  const newLog = [entry, ...(currentOpCache.ops_log || [])];
  await saveOpsLog(newLog);
  renderOpsLog(currentOpCache);
  return entry;
}

function renderOpsLog(op){
  const el = $('#opsLogContent');
  if(!el) return;
  const editable = canEditOps();
  const log = Array.isArray(op.ops_log) ? op.ops_log : [];
  const status = op.status || 'planning';

  const statusLabel = status === 'active' ? 'ACTIVE' : status === 'complete' ? 'COMPLETE' : 'PLANNING';
  const statusCls = status === 'active' ? 'active-status' : status === 'complete' ? 'complete-status' : '';

  let actionsHtml = '';
  if(editable){
    if(status === 'planning'){
      actionsHtml = `<button class="btn btn-primary" id="logActivateBtn" style="font-size:12px; padding:7px 12px;">Mark Active</button>`;
    } else if(status === 'active'){
      actionsHtml = `<button class="btn btn-primary" id="logCompleteBtn" style="font-size:12px; padding:7px 12px;">Mark Complete</button>`;
    } else if(status === 'complete'){
      actionsHtml = `<button class="btn btn-outline" id="logReopenBtn" style="font-size:12px; padding:7px 12px;">Reopen Operation</button>`;
    }
  }

  const entriesHtml = log.length === 0
    ? `<div class="ops-log-empty">No entries yet.<br>Tap a quick action or type a note.</div>`
    : `<div class="ops-log-list">${log.map(e => {
        const t = new Date(e.ts);
        const timeStr = isNaN(t) ? '' : t.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit', second:'2-digit'});
        const actions = editable ? `<div class="ops-log-entry-actions">
            <button type="button" class="ops-log-edit" data-id="${e.id}">Edit</button>
            <button type="button" class="ops-log-del" data-id="${e.id}">Delete</button>
          </div>` : '';
        return `<div class="ops-log-entry ${e.critical ? 'critical' : ''}" data-entry-id="${e.id}">
          <div class="ops-log-meta">
            <span class="ops-log-time">${timeStr}</span>
            <span class="ops-log-tag-label">${e.tag || 'Note'}</span>
            ${e.critical ? '<span style="color:var(--olive-bright); font-size:12px;">★</span>' : ''}
            <span class="ops-log-author">${e.author || ''}</span>
            ${actions}
          </div>
          <div class="ops-log-text" data-text-for="${e.id}">${escapeHtml(e.text || '')}</div>
        </div>`;
      }).join('')}</div>`;

  const quickHtml = editable && status !== 'complete' ? `
    <div class="ops-quick-row" id="opsQuickRow">
      ${OPS_QUICK_ACTIONS.map((q, i) =>
        `<button type="button" class="ops-quick-btn" data-quick-idx="${i}">${q.label}</button>`
      ).join('')}
    </div>` : '';

  const composeHtml = editable && status !== 'complete' ? `
    <div class="ops-log-input-bar">
      ${quickHtml}
      <div class="ops-log-tags" id="opsLogTags">
        ${OPS_LOG_TAGS.map((tag,i) => `<div class="ops-log-tag ${i===0?'active':''}" data-tag="${tag}">${tag}</div>`).join('')}
      </div>
      <div class="ops-log-compose">
        <textarea id="opsLogInput" placeholder="Custom note..." rows="1"></textarea>
        <button class="ops-log-add" id="opsLogAddBtn">Add</button>
      </div>
      <div style="display:flex; align-items:center; gap:10px; margin-top:8px;">
        <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--text-dim); cursor:pointer;">
          <input type="checkbox" id="opsLogCritical" style="accent-color:var(--olive);"> Critical
        </label>
      </div>
      <div id="opsQuickNotePrompt" style="display:none; margin-top:10px; padding:10px; background:var(--bg-panel); border:1px solid var(--line); border-radius:var(--radius);">
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:6px;">Entry logged. Add a short note? <span style="color:var(--steel);">(optional)</span></div>
        <div style="display:flex; gap:8px;">
          <input type="text" id="opsQuickNoteInput" class="field-input" placeholder="Optional details..." style="flex:1; font-size:13px; padding:8px 10px;">
          <button type="button" class="btn btn-primary" id="opsQuickNoteSave" style="font-size:12px; padding:8px 12px;">Save</button>
          <button type="button" class="btn btn-outline" id="opsQuickNoteSkip" style="font-size:12px; padding:8px 12px;">Skip</button>
        </div>
      </div>
    </div>` : '';

  el.innerHTML = `
    <div class="ops-log-wrap">
      <div class="ops-log-status-bar">
        <span class="ops-log-status-pill ${statusCls}">${statusLabel}</span>
        <div class="ops-log-actions">${actionsHtml}</div>
      </div>
      ${entriesHtml}
      ${composeHtml}
    </div>`;

  // Wire free-text
  if(editable && status !== 'complete'){
    let selectedTag = 'Note';
    $$('#opsLogTags .ops-log-tag').forEach(tagEl => {
      tagEl.addEventListener('click', () => {
        $$('#opsLogTags .ops-log-tag').forEach(t => t.classList.remove('active'));
        tagEl.classList.add('active');
        selectedTag = tagEl.dataset.tag;
      });
    });

    const addCustom = async () => {
      const input = $('#opsLogInput');
      const text = (input && input.value || '').trim();
      if(!text) return;
      await addOpsLogEntry({
        tag: selectedTag,
        text,
        critical: !!( $('#opsLogCritical') && $('#opsLogCritical').checked )
      });
      if(input) input.value = '';
      if($('#opsLogCritical')) $('#opsLogCritical').checked = false;
    };

    $('#opsLogAddBtn') && $('#opsLogAddBtn').addEventListener('click', addCustom);
    $('#opsLogInput') && $('#opsLogInput').addEventListener('keydown', (e) => {
      if(e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); addCustom(); }
    });

    // Quick actions
    let lastQuickEntryId = null;
    $$('#opsQuickRow .ops-quick-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const q = OPS_QUICK_ACTIONS[Number(btn.dataset.quickIdx)];
        if(!q) return;
        const entry = await addOpsLogEntry({ tag: q.tag, text: q.text, critical: false });
        lastQuickEntryId = entry.id;
        const prompt = $('#opsQuickNotePrompt');
        const noteInput = $('#opsQuickNoteInput');
        if(prompt){
          prompt.style.display = 'block';
          if(noteInput){ noteInput.value = ''; noteInput.focus(); }
        }
      });
    });

    $('#opsQuickNoteSkip') && $('#opsQuickNoteSkip').addEventListener('click', () => {
      const prompt = $('#opsQuickNotePrompt');
      if(prompt) prompt.style.display = 'none';
      lastQuickEntryId = null;
    });

    $('#opsQuickNoteSave') && $('#opsQuickNoteSave').addEventListener('click', async () => {
      const note = ($('#opsQuickNoteInput') && $('#opsQuickNoteInput').value || '').trim();
      if(note && lastQuickEntryId){
        const newLog = (currentOpCache.ops_log || []).map(e => {
          if(e.id === lastQuickEntryId){
            return { ...e, text: e.text + (e.text ? ' — ' : '') + note };
          }
          return e;
        });
        await saveOpsLog(newLog);
        renderOpsLog(currentOpCache);
      } else {
        const prompt = $('#opsQuickNotePrompt');
        if(prompt) prompt.style.display = 'none';
      }
      lastQuickEntryId = null;
    });
  }

  $('#logActivateBtn') && $('#logActivateBtn').addEventListener('click', async () => {
    await supabaseClient.from('operations').update({ status:'active' }).eq('id', currentOpId);
    currentOpCache.status = 'active';
    renderPlan(currentOpCache);
    renderOpsLog(currentOpCache);
  });

  $('#logCompleteBtn') && $('#logCompleteBtn').addEventListener('click', async () => {
    const log = currentOpCache.ops_log || [];
    let debrief = currentOpCache.debrief || {};
    if(!debrief.timeline && log.length){
      debrief = {
        ...debrief,
        timeline: log.slice().reverse().map(e => {
          const t = new Date(e.ts);
          const time = t.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
          return `[${time}] ${e.tag}${e.critical?' ★':''}: ${e.text}`;
        }).join('\\n')
      };
    }
    await supabaseClient.from('operations').update({ status:'complete', debrief }).eq('id', currentOpId);
    currentOpCache.status = 'complete';
    currentOpCache.debrief = debrief;
    renderPlan(currentOpCache);
    renderOpsLog(currentOpCache);
    renderDebrief(currentOpCache);
    $$('.subtab').forEach(t => t.classList.toggle('active', t.dataset.subtab==='debrief'));
    $$('.subpanel').forEach(p => p.classList.toggle('active', p.id==='opPanel-debrief'));
  });

  // Edit / delete existing log entries
  if(editable){
    $$('.ops-log-del').forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if(!confirm('Delete this log entry?')) return;
      const newLog = (currentOpCache.ops_log || []).filter(e => e.id !== id);
      await saveOpsLog(newLog);
      renderOpsLog(currentOpCache);
    }));
    $$('.ops-log-edit').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      const entry = (currentOpCache.ops_log || []).find(e => e.id === id);
      if(!entry) return;
      const textEl = document.querySelector(`[data-text-for="${id}"]`);
      if(!textEl || textEl.querySelector('textarea')) return;
      const original = entry.text || '';
      textEl.innerHTML = `<textarea class="ops-log-edit-area">${original.replace(/</g,'&lt;')}</textarea>
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button type="button" class="btn btn-primary ops-log-save-edit" data-id="${id}" style="font-size:12px; padding:6px 12px;">Save</button>
          <button type="button" class="btn btn-outline ops-log-cancel-edit" data-id="${id}" style="font-size:12px; padding:6px 12px;">Cancel</button>
        </div>`;
      const ta = textEl.querySelector('textarea');
      if(ta){ ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
      textEl.querySelector('.ops-log-save-edit').addEventListener('click', async () => {
        const newText = (textEl.querySelector('textarea').value || '').trim();
        const newLog = (currentOpCache.ops_log || []).map(e => e.id === id ? { ...e, text: newText } : e);
        await saveOpsLog(newLog);
        renderOpsLog(currentOpCache);
      });
      textEl.querySelector('.ops-log-cancel-edit').addEventListener('click', () => renderOpsLog(currentOpCache));
    }));
  }

  $('#logReopenBtn') && $('#logReopenBtn').addEventListener('click', async () => {
    if(!confirm('Reopen this operation? It will return to Active status so you can continue logging.')) return;
    await supabaseClient.from('operations').update({ status:'active' }).eq('id', currentOpId);
    currentOpCache.status = 'active';
    renderPlan(currentOpCache);
    renderOpsLog(currentOpCache);
    renderDebrief(currentOpCache);
  });
}

function escapeHtml(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const DEBRIEF_FIELDS = [
  { key:'outcome', label:'Outcome' }, { key:'timeline', label:'Timeline' }, { key:'injuries', label:'Injuries' },
  { key:'equipmentIssues', label:'Equipment Issues' }, { key:'lessonsLearned', label:'Lessons Learned' }, { key:'narrative', label:'Narrative Summary' },
];
function renderDebrief(op){
  if(op.status !== 'complete'){
    $('#debriefContent').innerHTML = `<div class="field-static field-empty">Debrief unlocks once the operation is marked complete. Use the Ops Log while the operation is active.</div>`;
    return;
  }
  const editable = canEditOps();
  const debrief = op.debrief || {};
  const fieldsHtml = DEBRIEF_FIELDS.map(f => `
    <div class="field-group"><label class="field-label">${f.label}</label>
      ${editable ? `<textarea class="field-textarea" data-debrief-field="${f.key}" placeholder="Not yet filled in...">${debrief[f.key]||''}</textarea>`
                 : `<div class="field-static ${debrief[f.key]?'':'field-empty'}">${debrief[f.key]||'Not yet filled in'}</div>`}
    </div>`).join('');
  const analyzerBtn = editable ? `<button class="btn btn-block btn-outline" id="runAnalyzerBtn">Run Debrief Analyzer</button>` : '';
  const analysisHtml = op.analysis ? renderAnalysisCard(op.analysis) : '';
  $('#debriefContent').innerHTML = fieldsHtml + analyzerBtn + `<div id="analysisSlot">${analysisHtml}</div>`;

  if(editable){
    $$('[data-debrief-field]').forEach(ta => ta.addEventListener('blur', async () => {
      const newDebrief = { ...currentOpCache.debrief, [ta.dataset.debriefField]: ta.value };
      await supabaseClient.from('operations').update({ debrief: newDebrief }).eq('id', currentOpId);
      currentOpCache.debrief = newDebrief;
    }));
    const btn = $('#runAnalyzerBtn');
    if(btn) btn.addEventListener('click', async () => {
      const analysis = analyzeDebrief(currentOpCache);
      await supabaseClient.from('operations').update({ analysis }).eq('id', currentOpId);
      currentOpCache.analysis = analysis;
      $('#analysisSlot').innerHTML = renderAnalysisCard(analysis);
    });
  }
}
function renderAnalysisCard(analysis){
  return `<div class="analysis-card">
    <div class="analysis-title">Debrief Analysis</div>
    <div class="analysis-flags">${analysis.flags.map(f=>`<div class="analysis-flag"><span class="pill ${f.level}" style="margin-top:1px;"><span class="pill-dot"></span></span><span>${f.text}</span></div>`).join('')}</div>
    <div class="analysis-summary">${analysis.summary}</div>
    <div class="analysis-disclaimer">Rule-based v1 analyzer.</div>
  </div>`;
}
function analyzeDebrief(op){
  const d = op.debrief || {};
  const flags = [];
  const injuryText = (d.injuries||'').toLowerCase().trim();
  if(!injuryText || /^(none|n\/a|no injuries?)\.?$/.test(injuryText)) flags.push({level:'good', text:'No injuries reported.'});
  else flags.push({level:'bad', text:'Injury reported — flagged for command review.'});
  const equipText = (d.equipmentIssues||'').toLowerCase();
  if(/fail|malfunction|broken|jam|stiff|inoperable/.test(equipText)) flags.push({level:'warn', text:'Equipment issue noted — recommend maintenance follow-up.'});
  else flags.push({level:'good', text:'No equipment issues reported.'});
  if(op.response_minutes != null){
    if(op.response_minutes > 25) flags.push({level:'warn', text:`Response time (${op.response_minutes} min) above the 25-min target.`});
    else flags.push({level:'good', text:`Response time (${op.response_minutes} min) within target.`});
  }
  if((d.lessonsLearned||'').trim()) flags.push({level:'warn', text:'Lessons-learned item logged — review for SOP update.'});
  const summary = [d.outcome || 'Outcome not yet documented.', (d.lessonsLearned||'').trim() ? `Key takeaway: ${d.lessonsLearned}` : ''].filter(Boolean).join(' ');
  return { flags, summary };
}
$('#opPrintBtn').addEventListener('click', async () => {
  const op = currentOpCache;
  const w = window.open('', '_blank'); // open synchronously first — same popup-blocker fix as Signal group sends
  const { data: photos } = await supabaseClient.from('operation_photos').select('*').eq('operation_id', op.id).order('created_at');
  const photosWithUrls = await Promise.all((photos||[]).map(async p => {
    const { data, error } = await supabaseClient.storage.from('operation-maps').createSignedUrl(p.storage_path, 3600);
    if(error){ console.error('Print report: could not get signed URL for photo', { path: p.storage_path, error }); return { ...p, url: '' }; }
    return { ...p, url: data.signedUrl };
  })).then(list => list.filter(p => p.url)); // drop any that failed rather than print a broken image silently
  const photosHtml = photosWithUrls.length > 0
    ? `<h3>Target Location Photos</h3><div style="display:flex; gap:10px; flex-wrap:wrap;">${photosWithUrls.map(p => `<a href="${p.url}" target="_blank"><img src="${p.url}" style="width:160px; height:160px; object-fit:cover; border-radius:4px; cursor:pointer;"></a>`).join('')}</div>`
    : '';
  const commander = op.incident_commander_personnel_id ? memberById(op.incident_commander_personnel_id) : null;
  const rosterLines = currentOperatorsCache.map(o => { const m = memberById(o.member_id); return m ? `<div>${m.name} — ${m.team_role||''}</div>` : ''; }).join('');
  w.document.write(`<html><head><title>${op.name}</title><style>@media print{.no-print{display:none!important;}}</style></head><body style="font-family:sans-serif; padding:40px; color:#111;">
    <button class="no-print" onclick="window.close()" style="position:fixed; top:16px; right:16px; padding:10px 18px; background:#0c0e0c; color:#e8e6df; border:none; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; z-index:10;">✕ Close & Return to OpsTac</button>
    <h1>${op.name}</h1><p>${op.type||''} · ${op.status} · ${op.date||''} · ${op.location||''}</p>
    ${commander ? `<p><strong>Overall Command:</strong> ${commander.name}</p>` : ''}
    <h3>Operators</h3>${rosterLines || '<p>None assigned.</p>'}
    ${photosHtml}
    <h3>Pre-Ops Plan</h3>${PLAN_FIELDS.map(f => `<p><strong>${f.label}:</strong> ${(op.plan||{})[f.key]||'—'}</p>`).join('')}
    ${op.status==='complete' ? `<h3>Debrief</h3>${DEBRIEF_FIELDS.map(f => `<p><strong>${f.label}:</strong> ${(op.debrief||{})[f.key]||'—'}</p>`).join('')}` : ''}
  </body></html>`);
  w.document.close();
  // Printing immediately after document.write() is a long-documented browser
  // bug (calling print() before the new content has actually finished
  // rendering captures a blank page instead). Waiting for the window's own
  // load event — which also correctly waits for any photos to finish
  // loading — is the standard fix.
  w.onload = () => { w.focus(); w.print(); };
});

$('#opPresentBtn').addEventListener('click', async () => {
  const op = currentOpCache;
  const btn = $('#opPresentBtn');
  btn.style.pointerEvents = 'none'; btn.style.opacity = '0.5';

  try {
    const pres = new window.PptxGenJS();
    pres.layout = 'LAYOUT_16x9';
    const W = 10, MARGIN = 0.5;

    let slide = pres.addSlide();
    slide.background = { color: '0c0e0c' };
    slide.addText(op.name, { x: MARGIN, y: 2.1, w: W-MARGIN*2, h: 1, fontSize: 32, bold: true, color: 'e8e6df', align: 'center' });
    slide.addText(`${op.type||''}  ·  ${op.date||''}  ·  ${op.location||''}`, { x: MARGIN, y: 3.0, w: W-MARGIN*2, h: 0.5, fontSize: 14, color: 'a89968', align: 'center' });

    const commander = op.incident_commander_personnel_id ? memberById(op.incident_commander_personnel_id) : null;
    slide = pres.addSlide();
    slide.background = { color: '0c0e0c' };
    slide.addText('Overview', { x: MARGIN, y: 0.3, fontSize: 26, bold: true, color: 'c7b482' });
    let y = 1.2;
    if(commander){
      slide.addText(`Overall Command: ${commander.name}`, { x: MARGIN, y, fontSize: 15, bold: true, color: 'e8e6df' });
      y += 0.5;
    }
    slide.addText('Operators', { x: MARGIN, y, fontSize: 13, bold: true, color: 'a89968' }); y += 0.4;
    currentOperatorsCache.forEach(o => {
      const m = memberById(o.member_id);
      if(m){ slide.addText(`${m.name} — ${m.team_role||''}`, { x: MARGIN+0.2, y, fontSize: 12, color: 'e8e6df' }); y += 0.32; }
    });

    PLAN_FIELDS.forEach(f => {
      const text = (op.plan||{})[f.key];
      if(!text) return;
      const s = pres.addSlide();
      s.background = { color: '0c0e0c' };
      s.addText(f.label, { x: MARGIN, y: 0.3, fontSize: 26, bold: true, color: 'c7b482' });
      s.addText(text, { x: MARGIN, y: 1.1, w: W-MARGIN*2, h: 4, fontSize: 14, color: 'e8e6df', valign: 'top' });
    });

    const { data: linkedEquip } = await supabaseClient.from('operation_equipment').select('equipment_id').eq('operation_id', op.id);
    if(linkedEquip && linkedEquip.length > 0){
      const { data: allEquip } = await supabaseClient.from('equipment').select('id, item');
      const names = linkedEquip.map(l => (allEquip||[]).find(e=>e.id===l.equipment_id)).filter(Boolean).map(e=>e.item);
      if(names.length > 0){
        const s = pres.addSlide();
        s.background = { color: '0c0e0c' };
        s.addText('Assets Utilized', { x: MARGIN, y: 0.3, fontSize: 26, bold: true, color: 'c7b482' });
        let yy = 1.2;
        names.forEach(n => { s.addText(n, { x: MARGIN+0.2, y: yy, fontSize: 14, color: 'e8e6df' }); yy += 0.4; });
      }
    }

    const { data: photos } = await supabaseClient.from('operation_photos').select('*').eq('operation_id', op.id).order('created_at');
    for(const p of (photos||[])){
      try {
        const { data: signed, error } = await supabaseClient.storage.from('operation-maps').createSignedUrl(p.storage_path, 3600);
        if(error || !signed){ console.error('Presentation export: could not get signed URL', { path: p.storage_path, error }); continue; }
        const resp = await fetch(signed.signedUrl);
        const blob = await resp.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        const s = pres.addSlide();
        s.background = { color: '0c0e0c' };
        s.addText('Target Location Photo', { x: MARGIN, y: 0.25, fontSize: 18, bold: true, color: 'c7b482' });
        s.addImage({ data: dataUrl, x: MARGIN, y: 0.9, w: 9, h: 4.4 });
      } catch(imgErr){
        console.error('Presentation export: could not embed photo', { path: p.storage_path, error: imgErr });
      }
    }

    await pres.writeFile({ fileName: `${op.name} - Pre-Ops Brief.pptx` });
  } catch(err){
    console.error('Presentation export failed', err);
    alert('Could not generate the presentation. Please try again.');
  } finally {
    btn.style.pointerEvents = ''; btn.style.opacity = '';
  }
});

// ---------- Callouts ----------
function toE164(phone){
  const digits = (phone||'').replace(/\D/g,'');
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

async function loadCalloutsIntoOpsList(){
  const { data: callouts } = await supabaseClient.from('callouts').select('*, callout_recipients(*), operations(id, name)').order('created_at',{ascending:false});
  const list = callouts || [];
  const methodLabel = { text:'Sent via Text', share:'Shared', logged:'Logged Verbally', 'signal-group':'Sent to Signal Group' };

  const pendingCount = list.filter(co=>co.active).reduce((sum,co)=>{
    return sum + (co.callout_recipients||[]).filter(r=>r.ack!=='acknowledged').length;
  }, 0);
  const badge = $('#calloutTabBadge');
  badge.style.display = pendingCount>0 ? 'block' : 'none';

  if(list.length === 0){
    $('#calloutList').innerHTML = `<div class="preview-empty">No callouts logged yet.</div>`;
    return;
  }
  $('#calloutList').innerHTML = list.map(co => {
    const recipients = co.callout_recipients || [];
    const rows = recipients.map(r => {
      const m = memberById(r.member_id);
      if(!m) return '';
      const signalLink = `https://signal.me/#p/${toE164(m.phone)}`;
      return `<div class="callout-recipient-row">
        <span class="callout-recipient-name">${m.name}</span>
        <div class="callout-recipient-actions">
          <a class="callout-signal-icon" href="${signalLink}" target="_blank" rel="noopener" title="Message ${m.name} on Signal">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>
          </a>
          <div class="callout-ack-chip ${r.ack==='acknowledged'?'acknowledged':''}" data-callout-id="${co.id}" data-member-id="${r.member_id}">${r.ack==='acknowledged'?'Acknowledged':'Pending'}</div>
        </div></div>`;
    }).join('');
    const editBtn = canManageCallouts() ? `<button class="btn btn-ghost" data-edit-callout="${co.id}" style="padding:5px 12px; font-size:11px; flex-shrink:0;">Edit</button>` : '';
    return `<div class="callout-card">
      <div class="callout-marker ${co.active?'active':''}"></div>
      <div style="min-width:0; flex:1;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
          <div class="callout-type">${co.type||'Callout'}</div>
          ${editBtn}
        </div>
        <div class="callout-meta">${co.date||''} at ${co.time||''}${co.location?' — '+co.location:''}${mapsLinkHtml(co.location)}</div>
        <div>${co.mode ? `<span class="mode-pill ${co.mode}">${co.mode==='standby'?'Standby Only':'Deploy'}</span>` : ''}
          ${co.method ? `<div class="callout-method-tag" style="display:inline-block; vertical-align:top; margin-top:6px;">${methodLabel[co.method]||co.method}</div>` : ''}
          ${!co.active ? `<span class="flag oncall" style="margin-left:6px;">Resolved</span>` : ''}</div>
        ${co.rally_location ? `<div class="callout-meta" style="margin-top:6px;">Rally: ${co.rally_location}${mapsLinkHtml(co.rally_location)}</div>` : ''}
        ${co.operations ? `<span class="flag" data-jump-op="${co.operations.id}" style="background:rgba(138,143,148,0.14); color:var(--steel); cursor:pointer; display:inline-block; margin-top:6px;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3M8 11h8M8 15h5"/></svg>${co.operations.name}</span>` : ''}
        ${co.outcome ? `<div class="callout-outcome">${co.outcome}</div>` : ''}
        <div class="callout-ack-list">${rows}</div>
      </div></div>`;
  }).join('');

  $$('[data-edit-callout]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditCalloutSheet(list.find(c => c.id === btn.dataset.editCallout));
  }));

  $$('[data-jump-op]').forEach(tag => tag.addEventListener('click', (e) => {
    e.stopPropagation();
    const opId = tag.dataset.jumpOp;
    goToSection('operations');
    setTimeout(() => openOpDetail(opId), 50);
  }));

  if(canManageCallouts()){
    $$('.callout-ack-chip').forEach(chip => chip.addEventListener('click', async () => {
      const calloutId = chip.dataset.calloutId, memberId = chip.dataset.memberId;
      const { data: current } = await supabaseClient.from('callout_recipients').select('ack').eq('callout_id', calloutId).eq('member_id', memberId).single();
      const newAck = current && current.ack === 'acknowledged' ? 'pending' : 'acknowledged';
      await supabaseClient.from('callout_recipients').update({ ack: newAck }).eq('callout_id', calloutId).eq('member_id', memberId);
      loadCalloutsIntoOpsList();
    }));
  }
}

let calloutSelectedIds = new Set();
let calloutRallyMapPath = null, calloutRallyMapRatio = null, calloutRallyPinX = null, calloutRallyPinY = null, calloutRallyMapId = null;

$('#calloutRallyMapPrompt').addEventListener('click', () => { if(canManageCallouts()) $('#calloutRallyMapInput').click(); });
$('#calloutRallyMapInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const path = `${currentProfile.agency_id}/callouts/${calloutRallyMapId}/${Date.now()}-${file.name}`;
  const { error } = await supabaseClient.storage.from('operation-maps').upload(path, file, { upsert:true });
  if(error){ alert('Upload failed: ' + error.message); return; }
  const img = new Image();
  const reader = new FileReader();
  reader.onload = (ev) => {
    img.onload = () => {
      calloutRallyMapPath = path;
      calloutRallyMapRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      $('#calloutRallyMapCanvas').classList.add('has-image');
      $('#calloutRallyMapCanvas').style.aspectRatio = calloutRallyMapRatio;
      $('#calloutRallyMapImg').src = ev.target.result;
      $('#calloutRallyMapImg').style.display = 'block';
      $('#calloutRallyMapPrompt').style.display = 'none';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
$('#calloutRallyMapCanvas').addEventListener('click', (e) => {
  if(!calloutRallyMapPath || e.target.closest('#calloutRallyMapPrompt')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
  const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
  calloutRallyPinX = Math.max(3, Math.min(97, x));
  calloutRallyPinY = Math.max(3, Math.min(97, y));
  $$('#calloutRallyMapCanvas .rally-pin-marker').forEach(p => p.remove());
  const pin = document.createElement('div');
  pin.className = 'map-pin rally-pin-marker';
  pin.style.left = calloutRallyPinX + '%'; pin.style.top = calloutRallyPinY + '%';
  pin.textContent = 'R';
  $('#calloutRallyMapCanvas').appendChild(pin);
});

let calloutAutoMessage = '';
let calloutMode = null;

$('#opsHeroCalloutBtn').addEventListener('click', () => openCalloutSheet());

function setCalloutMode(mode){
  calloutMode = mode;
  $$('.mode-btn').forEach(b => b.classList.toggle('selected', b.dataset.mode === mode));
  updateCalloutMessageTemplate(true);
}
$$('#calloutModeToggle .mode-btn').forEach(btn => btn.addEventListener('click', () => setCalloutMode(btn.dataset.mode)));

let calloutLockedOp = null;

async function openCalloutSheet(lockedOp){
  calloutLockedOp = lockedOp || null;
  await loadCorePersonnel();
  if(currentProfile.role === 'team-leader' && myPersonnel && myPersonnel.subteam_id){
    calloutSelectedIds = new Set(allPersonnel.filter(p => p.on_call && p.subteam_id === myPersonnel.subteam_id).map(p=>p.id));
  } else {
    calloutSelectedIds = new Set(allPersonnel.filter(p=>p.on_call).map(p=>p.id));
  }
  $('#calloutType').value=''; $('#calloutLocation').value=''; $('#calloutRally').value='';
  calloutMode = null;
  $$('.mode-btn').forEach(b => b.classList.remove('selected'));
  calloutAutoMessage = 'SRT ACTIVATION. Report to staging ASAP. Await further instructions.';
  $('#calloutMessage').value = calloutAutoMessage;
  renderCalloutRosterList();

  calloutRallyMapPath = null; calloutRallyMapRatio = null; calloutRallyPinX = null; calloutRallyPinY = null;
  calloutRallyMapId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);
  $('#calloutRallyMapCanvas').classList.remove('has-image');
  $('#calloutRallyMapCanvas').style.aspectRatio = '';
  $('#calloutRallyMapImg').style.display = 'none';
  $('#calloutRallyMapPrompt').style.display = 'flex';
  $$('#calloutRallyMapCanvas .rally-pin-marker').forEach(p => p.remove());

  if(calloutLockedOp){
    $('#calloutOpLockedGroup').style.display = 'block';
    $('#calloutOpLockedLabel').textContent = calloutLockedOp.name;
    $('#calloutOpPickerGroup').style.display = 'none';
    $('#calloutNewOpNameGroup').style.display = 'none';
  } else {
    $('#calloutOpLockedGroup').style.display = 'none';
    $('#calloutOpPickerGroup').style.display = 'block';
    $('#calloutNewOpNameGroup').style.display = 'none';
    const { data: ops } = await supabaseClient.from('operations').select('id, name, status').order('date', { ascending:false });
    $('#calloutOperation').innerHTML = `<option value="">— None —</option>` +
      (ops||[]).map(o => `<option value="${o.id}">${o.name} (${o.status==='complete'?'Complete':'Planning'})</option>`).join('') +
      `<option value="__new__">+ Create New Operation</option>`;
  }

  const hasSignalGroup = !!(currentSettings && currentSettings.signal_group_link);
  $('#sendCalloutSignalGroup').style.display = hasSignalGroup ? 'block' : 'none';
  $('#signalSetupHint') && ($('#signalSetupHint').style.display = hasSignalGroup ? 'none' : 'block');

  const scopeNote = $('#calloutScopeNote');
  if(currentProfile.role === 'team-leader' && myPersonnel && myPersonnel.subteam_id){
    const team = subTeamById(myPersonnel.subteam_id);
    scopeNote.textContent = `Defaulted to ${team?team.name:'your team'} on-call members — add or remove anyone below.`;
    scopeNote.style.display = 'block';
  } else {
    scopeNote.style.display = 'none';
  }
  $('#newCalloutSheet').classList.add('active');
}
$('#calloutOperation') && $('#calloutOperation').addEventListener('change', () => {
  $('#calloutNewOpNameGroup').style.display = $('#calloutOperation').value === '__new__' ? 'block' : 'none';
});
function closeCalloutSheet(){ $('#newCalloutSheet').classList.remove('active'); }

function renderCalloutRosterList(){
  $('#calloutRosterList').innerHTML = allPersonnel.map(p => {
    const checked = calloutSelectedIds.has(p.id);
    return `<div class="callout-roster-item" data-member-id="${p.id}">
      <div class="callout-checkbox ${checked?'checked':''}">${checked?'✓':''}</div>
      <div><div class="callout-roster-name">${p.name}</div><div class="callout-roster-sub">${p.team_role||''}</div></div>
      ${p.on_call ? '<span class="callout-oncall-tag">On-call</span>' : ''}
    </div>`;
  }).join('');
  $$('.callout-roster-item').forEach(item => item.addEventListener('click', () => {
    const id = item.dataset.memberId;
    if(calloutSelectedIds.has(id)) calloutSelectedIds.delete(id); else calloutSelectedIds.add(id);
    renderCalloutRosterList();
  }));
}
function updateCalloutMessageTemplate(force){
  const type = $('#calloutType').value.trim();
  const loc = $('#calloutLocation').value.trim();
  const rally = $('#calloutRally').value.trim();
  const current = $('#calloutMessage').value;
  if(!force && current !== calloutAutoMessage) return;
  let newMsg;
  if(calloutMode === 'standby') newMsg = `SRT STANDBY${type?': '+type:''}. Do not respond yet — stand by for further instructions.${rally?' Rally point if activated: '+rally+'.':''}`;
  else if(calloutMode === 'deploy') newMsg = `SRT DEPLOY${type?': '+type:''}. Report to ${rally||'rally point'} ASAP.${loc?' Scene: '+loc+'.':''}`;
  else newMsg = `SRT ACTIVATION${type?': '+type:''}. Report to ${loc||'staging'} ASAP. Await further instructions.`;
  calloutAutoMessage = newMsg;
  $('#calloutMessage').value = newMsg;
}
$('#calloutType').addEventListener('input', () => updateCalloutMessageTemplate(false));
$('#calloutLocation').addEventListener('input', () => updateCalloutMessageTemplate(false));
$('#calloutRally').addEventListener('input', () => updateCalloutMessageTemplate(false));
$('#cancelNewCallout') && $('#cancelNewCallout').addEventListener('click', closeCalloutSheet);

async function finalizeCallout(method){
  if(calloutSelectedIds.size === 0){ alert('Select at least one team member.'); return null; }
  if(!calloutMode){ alert('Select Standby Only or Deploy.'); return null; }
  const message = $('#calloutMessage').value.trim();
  if(!message){ alert('Enter a message.'); return null; }

  let opId = calloutLockedOp ? calloutLockedOp.id : null;
  if(!calloutLockedOp){
    const picked = $('#calloutOperation').value;
    if(picked === '__new__'){
      const newName = $('#calloutNewOpName').value.trim();
      if(!newName){ alert('Enter a name for the new operation.'); return null; }
      const { data: newOp } = await supabaseClient.from('operations').insert({
        agency_id: currentProfile.agency_id, name: newName, status:'planning', plan:{},
        location: $('#calloutLocation').value.trim() || null,
      }).select().single();
      opId = newOp ? newOp.id : null;
    } else {
      opId = picked || null;
    }
  }

  const now = new Date();
  const { data: callout } = await supabaseClient.from('callouts').insert({
    agency_id: currentProfile.agency_id,
    type: $('#calloutType').value.trim() || 'SRT Activation',
    date: now.toISOString().slice(0,10), time: now.toTimeString().slice(0,5),
    location: $('#calloutLocation').value.trim() || null,
    rally_location: $('#calloutRally').value.trim() || null,
    mode: calloutMode, method, message, active: true, operation_id: opId || null,
    rally_map_image_url: calloutRallyMapPath, rally_map_ratio: calloutRallyMapRatio,
    rally_pin_x: calloutRallyPinX, rally_pin_y: calloutRallyPinY,
  }).select().single();
  if(callout){
    await supabaseClient.from('callout_recipients').insert([...calloutSelectedIds].map(id => ({ callout_id: callout.id, member_id: id, ack:'pending' })));
  }
  return callout;
}

$('#sendCalloutText').addEventListener('click', async () => {
  const co = await finalizeCallout('text');
  if(!co) return;
  const numbers = [...calloutSelectedIds].map(id => toE164(memberById(id).phone)).join(',');
  window.location.href = `sms:${numbers}?body=${encodeURIComponent(co.message)}`;
  closeCalloutSheet();
  loadCalloutsIntoOpsList();
});
$('#sendCalloutSignalGroup') && $('#sendCalloutSignalGroup').addEventListener('click', async () => {
  // Open the window synchronously, immediately on click — browsers block window.open()
  // calls that happen after an await, since they only allow popups triggered directly
  // by user input. We open a blank tab now and redirect it once the save completes.
  const signalWindow = window.open('', '_blank');
  const co = await finalizeCallout('signal-group');
  if(!co){ if(signalWindow) signalWindow.close(); return; }

  try { await navigator.clipboard.writeText(co.message); } catch(e){ /* clipboard optional, non-blocking */ }

  if(signalWindow) signalWindow.location.href = currentSettings.signal_group_link;
  else window.open(currentSettings.signal_group_link, '_blank'); // fallback if the pre-open was itself blocked

  closeCalloutSheet();
  loadCalloutsIntoOpsList();
});
$('#sendCalloutShare').addEventListener('click', async () => {
  const co = await finalizeCallout('share');
  if(!co) return;
  const recipientNames = [...calloutSelectedIds].map(id=>memberById(id).name).join(', ');
  const shareText = `${co.message}\n\nTeam: ${recipientNames}`;
  if(navigator.share) navigator.share({ title: co.type, text: shareText }).catch(()=>{});
  else alert('Sharing isn\'t supported in this browser. The callout has been logged — use "Send via Text Message" instead, or copy this message:\n\n' + shareText);
  closeCalloutSheet();
  loadCalloutsIntoOpsList();
});
$('#logCalloutOnly').addEventListener('click', async () => {
  const co = await finalizeCallout('logged');
  if(!co) return;
  closeCalloutSheet();
  loadCalloutsIntoOpsList();
});

// ---------- Edit Callout ----------
let editingCalloutId = null;
let eCoModeVal = null;
let eCoActiveVal = false;

let eCoRallyMapPath = null, eCoRallyMapRatio = null, eCoRallyPinX = null, eCoRallyPinY = null;
function openEditCalloutSheet(callout){
  editingCalloutId = callout.id;
  $('#eCoType').value = callout.type || '';
  $('#eCoLocation').value = callout.location || '';
  $('#eCoRally').value = callout.rally_location || '';
  $('#eCoMessage').value = callout.message || '';
  $('#eCoOutcome').value = callout.outcome || '';

  eCoModeVal = callout.mode;
  $$('#eCoModeToggle .mode-btn').forEach(b => b.classList.toggle('selected', b.dataset.mode === callout.mode));

  eCoActiveVal = !!callout.active;
  $('#eCoActive').classList.toggle('on', eCoActiveVal);

  eCoRallyMapPath = callout.rally_map_image_url || null;
  eCoRallyMapRatio = callout.rally_map_ratio || null;
  eCoRallyPinX = callout.rally_pin_x != null ? callout.rally_pin_x : null;
  eCoRallyPinY = callout.rally_pin_y != null ? callout.rally_pin_y : null;
  $$('#eCoRallyMapCanvas .rally-pin-marker').forEach(p => p.remove());
  if(eCoRallyMapPath){
    $('#eCoRallyMapCanvas').classList.add('has-image');
    if(eCoRallyMapRatio) $('#eCoRallyMapCanvas').style.aspectRatio = eCoRallyMapRatio;
    $('#eCoRallyMapPrompt').style.display = 'none';
    $('#eCoRallyMapImg').style.display = 'block';
    supabaseClient.storage.from('operation-maps').createSignedUrl(eCoRallyMapPath, 3600).then(({data, error}) => {
      if(error){ console.error('Edit callout rally map: could not get signed URL', { path: eCoRallyMapPath, error }); return; }
      $('#eCoRallyMapImg').src = data.signedUrl;
    });
    if(eCoRallyPinX != null && eCoRallyPinY != null){
      const pin = document.createElement('div');
      pin.className = 'map-pin rally-pin-marker';
      pin.style.left = eCoRallyPinX + '%'; pin.style.top = eCoRallyPinY + '%';
      pin.textContent = 'R';
      $('#eCoRallyMapCanvas').appendChild(pin);
    }
  } else {
    $('#eCoRallyMapCanvas').classList.remove('has-image');
    $('#eCoRallyMapCanvas').style.aspectRatio = '';
    $('#eCoRallyMapPrompt').style.display = 'flex';
    $('#eCoRallyMapImg').style.display = 'none';
  }

  $('#editCalloutSheet').classList.add('active');
}
$('#eCoRallyMapPrompt').addEventListener('click', () => $('#eCoRallyMapInput').click());
$('#eCoRallyMapInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if(!file) return;
  const path = `${currentProfile.agency_id}/callouts/${editingCalloutId}/${Date.now()}-${file.name}`;
  const { error } = await supabaseClient.storage.from('operation-maps').upload(path, file, { upsert:true });
  if(error){ alert('Upload failed: ' + error.message); return; }
  const img = new Image();
  const reader = new FileReader();
  reader.onload = (ev) => {
    img.onload = () => {
      eCoRallyMapPath = path;
      eCoRallyMapRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
      $('#eCoRallyMapCanvas').classList.add('has-image');
      $('#eCoRallyMapCanvas').style.aspectRatio = eCoRallyMapRatio;
      $('#eCoRallyMapImg').src = ev.target.result;
      $('#eCoRallyMapImg').style.display = 'block';
      $('#eCoRallyMapPrompt').style.display = 'none';
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
});
$('#eCoRallyMapCanvas').addEventListener('click', (e) => {
  if(!eCoRallyMapPath || e.target.closest('#eCoRallyMapPrompt')) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
  const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
  eCoRallyPinX = Math.max(3, Math.min(97, x));
  eCoRallyPinY = Math.max(3, Math.min(97, y));
  $$('#eCoRallyMapCanvas .rally-pin-marker').forEach(p => p.remove());
  const pin = document.createElement('div');
  pin.className = 'map-pin rally-pin-marker';
  pin.style.left = eCoRallyPinX + '%'; pin.style.top = eCoRallyPinY + '%';
  pin.textContent = 'R';
  $('#eCoRallyMapCanvas').appendChild(pin);
});
$$('#eCoModeToggle .mode-btn').forEach(btn => btn.addEventListener('click', () => {
  eCoModeVal = btn.dataset.mode;
  $$('#eCoModeToggle .mode-btn').forEach(b => b.classList.toggle('selected', b===btn));
}));
$('#eCoActive').addEventListener('click', () => {
  eCoActiveVal = !eCoActiveVal;
  $('#eCoActive').classList.toggle('on', eCoActiveVal);
});
$('#eCoCancel').addEventListener('click', () => $('#editCalloutSheet').classList.remove('active'));
$('#eCoDelete').addEventListener('click', async () => {
  if(!confirm(`Delete this callout? This can't be undone.`)) return;
  await supabaseClient.from('callouts').delete().eq('id', editingCalloutId);
  $('#editCalloutSheet').classList.remove('active');
  loadCalloutsIntoOpsList();
});
$('#eCoSave').addEventListener('click', async () => {
  await supabaseClient.from('callouts').update({
    type: $('#eCoType').value.trim() || null,
    mode: eCoModeVal,
    location: $('#eCoLocation').value.trim() || null,
    rally_location: $('#eCoRally').value.trim() || null,
    message: $('#eCoMessage').value.trim(),
    active: eCoActiveVal,
    outcome: $('#eCoOutcome').value.trim() || null,
    rally_map_image_url: eCoRallyMapPath, rally_map_ratio: eCoRallyMapRatio,
    rally_pin_x: eCoRallyPinX, rally_pin_y: eCoRallyPinY,
  }).eq('id', editingCalloutId);
  $('#editCalloutSheet').classList.remove('active');
  loadCalloutsIntoOpsList();
});

// ---------- Settings ----------
function renderPermissionsSettings(){
  if(currentAgency) $('#agencyCodeDisplay').textContent = currentAgency.agency_code || '—';
  loadTwoFactorStatus();
  const isCommander = currentProfile && currentProfile.role === 'commander';
  $('#permissionsSettingsGroup').style.display = isCommander ? 'block' : 'none';
  if(!currentSettings) return;
  $('#permEditOps').classList.toggle('on', currentSettings.team_leader_edit_ops);
  $('#permCallouts').classList.toggle('on', currentSettings.team_leader_callouts);
  $('#permManageRecords').classList.toggle('on', currentSettings.team_leader_manage_records);
  $('#signalGroupLinkInput').value = currentSettings.signal_group_link || '';
  refreshSignalGroupStatus();
  $$('.swatch').forEach(sw => sw.classList.toggle('selected', sw.dataset.accent === currentSettings.accent_color));
}
$('#permEditOps').addEventListener('click', async () => {
  if(currentProfile.role !== 'commander') return;
  const newVal = !currentSettings.team_leader_edit_ops;
  currentSettings.team_leader_edit_ops = newVal;
  $('#permEditOps').classList.toggle('on', newVal);
  await supabaseClient.from('agency_settings').update({ team_leader_edit_ops: newVal }).eq('agency_id', currentProfile.agency_id);
});
$('#permCallouts').addEventListener('click', async () => {
  if(currentProfile.role !== 'commander') return;
  const newVal = !currentSettings.team_leader_callouts;
  currentSettings.team_leader_callouts = newVal;
  $('#permCallouts').classList.toggle('on', newVal);
  await supabaseClient.from('agency_settings').update({ team_leader_callouts: newVal }).eq('agency_id', currentProfile.agency_id);
});
$('#permManageRecords').addEventListener('click', async () => {
  if(currentProfile.role !== 'commander') return;
  const newVal = !currentSettings.team_leader_manage_records;
  currentSettings.team_leader_manage_records = newVal;
  $('#permManageRecords').classList.toggle('on', newVal);
  await supabaseClient.from('agency_settings').update({ team_leader_manage_records: newVal }).eq('agency_id', currentProfile.agency_id);
});
function refreshSignalGroupStatus(){
  const status = $('#signalGroupStatus');
  status.textContent = (currentSettings && currentSettings.signal_group_link)
    ? 'Connected — callouts can send directly to this group.'
    : 'Not set — callouts will use Text or Share instead.';
}
$('#saveSignalGroupLink').addEventListener('click', async () => {
  const link = $('#signalGroupLinkInput').value.trim();
  currentSettings.signal_group_link = link;
  await supabaseClient.from('agency_settings').update({ signal_group_link: link }).eq('agency_id', currentProfile.agency_id);
  refreshSignalGroupStatus();
});
$$('.swatch').forEach(sw => sw.addEventListener('click', async () => {
  $$('.swatch').forEach(s => s.classList.remove('selected'));
  sw.classList.add('selected');
  const accent = sw.dataset.accent, bright = sw.dataset.bright;
  applyTheme(accent, bright);
  currentSettings.accent_color = accent; currentSettings.accent_bright = bright;
  await supabaseClient.from('agency_settings').update({ accent_color: accent, accent_bright: bright }).eq('agency_id', currentProfile.agency_id);
}));

$('#photoLightbox').addEventListener('click', () => { $('#photoLightbox').style.display = 'none'; });

$('#changePasswordBtn').addEventListener('click', async () => {
  const newPw = $('#newPasswordField').value;
  const confirmPw = $('#confirmPasswordField').value;
  const errorBox = $('#changePasswordError');
  const successBox = $('#changePasswordSuccess');
  errorBox.style.display = 'none';
  successBox.style.display = 'none';

  if(newPw.length < 8){ errorBox.textContent = 'Password must be at least 8 characters.'; errorBox.style.display = 'block'; return; }
  if(newPw !== confirmPw){ errorBox.textContent = 'Passwords do not match.'; errorBox.style.display = 'block'; return; }

  const btn = $('#changePasswordBtn');
  btn.disabled = true; btn.textContent = 'Updating...';
  const { error } = await supabaseClient.auth.updateUser({ password: newPw });
  btn.disabled = false; btn.textContent = 'Update Password';
  if(error){
    errorBox.textContent = error.message;
    errorBox.style.display = 'block';
    return;
  }
  $('#newPasswordField').value = '';
  $('#confirmPasswordField').value = '';
  successBox.textContent = 'Password updated.';
  successBox.style.display = 'block';
});

let pendingFactorId = null;

async function loadTwoFactorStatus(){
  if(!currentProfile) return;
  const { data: mfaData } = await supabaseClient.auth.mfa.listFactors();
  const totpFactor = mfaData ? (mfaData.totp || []).find(f => f.status === 'verified') : null;
  const statusEl = $('#twoFactorStatus');
  if(!statusEl) return;
  statusEl.innerHTML = totpFactor ? `
    <div style="font-size:12px; color:var(--good); margin-bottom:12px;">✓ Two-factor authentication is enabled.</div>
    <button class="btn btn-block" id="disable2faBtn" style="border:1px solid var(--bad); color:var(--bad); background:transparent;">Disable Two-Factor Authentication</button>
  ` : `
    <div style="font-size:12px; color:var(--text-dim); line-height:1.5; margin-bottom:12px;">
      Add an extra layer of security — after your password, you'll also need a code from an authenticator app (like Google Authenticator or Authy) to sign in.
    </div>
    <button class="btn btn-primary btn-block" id="enable2faBtn">Enable Two-Factor Authentication</button>
  `;
  $('#twoFactorEnrollFlow').style.display = 'none';

  const enableBtn = $('#enable2faBtn');
  if(enableBtn) enableBtn.addEventListener('click', async () => {
    enableBtn.disabled = true; enableBtn.textContent = 'Preparing...';
    const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'OpsTac' });
    enableBtn.disabled = false; enableBtn.textContent = 'Enable Two-Factor Authentication';
    if(error){ alert('Could not start 2FA setup: ' + error.message); return; }
    pendingFactorId = data.id;
    $('#totpQrCode').innerHTML = `<img src="${data.totp.qr_code}" style="width:180px; height:180px; background:#fff; border-radius:6px; padding:8px;">`;
    $('#totpManualSecret').textContent = `Can't scan? Enter this code manually: ${data.totp.secret}`;
    $('#totpVerifyCode').value = '';
    $('#totpVerifyError').style.display = 'none';
    statusEl.style.display = 'none';
    $('#twoFactorEnrollFlow').style.display = 'block';
  });

  const disableBtn = $('#disable2faBtn');
  if(disableBtn) disableBtn.addEventListener('click', async () => {
    if(!confirm('Disable two-factor authentication? Your account will only require a password to sign in.')) return;
    const { data: factorsData } = await supabaseClient.auth.mfa.listFactors();
    const factor = (factorsData.totp || []).find(f => f.status === 'verified');
    if(factor){ await supabaseClient.auth.mfa.unenroll({ factorId: factor.id }); }
    loadTwoFactorStatus();
  });
}

$('#totpCancelBtn').addEventListener('click', async () => {
  if(pendingFactorId){ await supabaseClient.auth.mfa.unenroll({ factorId: pendingFactorId }); }
  pendingFactorId = null;
  loadTwoFactorStatus();
});

$('#totpVerifyBtn').addEventListener('click', async () => {
  const code = $('#totpVerifyCode').value.trim();
  const errorBox = $('#totpVerifyError');
  errorBox.style.display = 'none';
  if(!/^\d{6}$/.test(code)){ errorBox.textContent = 'Enter the 6-digit code from your authenticator app.'; errorBox.style.display = 'block'; return; }

  const btn = $('#totpVerifyBtn');
  btn.disabled = true; btn.textContent = 'Verifying...';
  const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({ factorId: pendingFactorId });
  if(challengeError){
    errorBox.textContent = challengeError.message;
    errorBox.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Verify & Enable';
    return;
  }
  const { error: verifyError } = await supabaseClient.auth.mfa.verify({ factorId: pendingFactorId, challengeId: challenge.id, code });
  btn.disabled = false; btn.textContent = 'Verify & Enable';
  if(verifyError){
    errorBox.textContent = 'Incorrect code. Please try again.';
    errorBox.style.display = 'block';
    return;
  }
  pendingFactorId = null;
  loadTwoFactorStatus();
});

let pendingMfaFactorId = null;
$('#mfaChallengeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#mfaChallengeBtn');
  const errorBox = $('#mfaChallengeError');
  errorBox.style.display = 'none';
  const code = $('#mfaChallengeCode').value.trim();
  if(!/^\d{6}$/.test(code)){ errorBox.textContent = 'Enter the 6-digit code from your authenticator app.'; errorBox.style.display = 'block'; return; }

  btn.disabled = true; btn.textContent = 'Verifying...';
  const { data: challenge, error: challengeError } = await supabaseClient.auth.mfa.challenge({ factorId: pendingMfaFactorId });
  if(challengeError){
    errorBox.textContent = challengeError.message;
    errorBox.style.display = 'block';
    btn.disabled = false; btn.textContent = 'Verify';
    return;
  }
  const { error: verifyError } = await supabaseClient.auth.mfa.verify({ factorId: pendingMfaFactorId, challengeId: challenge.id, code });
  btn.disabled = false; btn.textContent = 'Verify';
  if(verifyError){
    errorBox.textContent = 'Incorrect code. Please try again.';
    errorBox.style.display = 'block';
    $('#mfaChallengeCode').value = '';
    return;
  }
  $('#mfaChallengeScreen').style.display = 'none';
  pendingMfaFactorId = null;
  await onSignedIn();
});

checkExistingSession();
$('#mSubteamCancel').addEventListener('click', () => $('#subteamSheet').classList.remove('active'));
$('#mSubteamSave').addEventListener('click', async () => {
  const name = $('#mSubteamName').value.trim();
  if(!name) return;
  await supabaseClient.from('subteams').insert({
    agency_id: currentProfile.agency_id, name, focus: $('#mSubteamFocus').value.trim() || null,
  });
  $('#mSubteamName').value = ''; $('#mSubteamFocus').value = '';
  $('#subteamSheet').classList.remove('active');
  loadRoster();
});

let editingSubteamId = null;
function openSubteamEditSheet(subteam){
  editingSubteamId = subteam.id;
  $('#eSubteamName').value = subteam.name;
  $('#eSubteamFocus').value = subteam.focus || '';
  const members = allPersonnel.filter(p => p.subteam_id === subteam.id);
  $('#eSubteamLeader').innerHTML = `<option value="">No leader assigned</option>` +
    members.map(p => `<option value="${p.id}" ${subteam.leader_personnel_id===p.id?'selected':''}>${p.name}</option>`).join('');
  $('#eSubteamNoMembers').style.display = members.length === 0 ? 'block' : 'none';
  $('#editSubteamSheet').classList.add('active');
}
$('#eSubteamCancel').addEventListener('click', () => $('#editSubteamSheet').classList.remove('active'));
$('#eSubteamSave').addEventListener('click', async () => {
  const name = $('#eSubteamName').value.trim();
  if(!name) return;
  await supabaseClient.from('subteams').update({
    name, focus: $('#eSubteamFocus').value.trim() || null,
    leader_personnel_id: $('#eSubteamLeader').value || null,
  }).eq('id', editingSubteamId);
  $('#editSubteamSheet').classList.remove('active');
  loadRoster();
});
$('#eSubteamDelete').addEventListener('click', async () => {
  const name = $('#eSubteamName').value;
  if(!confirm(`Delete ${name}? Anyone assigned to it moves back to Command.`)) return;
  await supabaseClient.from('subteams').delete().eq('id', editingSubteamId);
  $('#editSubteamSheet').classList.remove('active');
  loadRoster();
});
