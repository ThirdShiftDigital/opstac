
function shouldKeepAutofill(el){
  const type = (el.getAttribute('type') || el.type || '').toLowerCase();
  if(type === 'password') return true;
  const id = el.id || '';
  return /^(loginEmail|loginPassword|forgotEmail|newPassword|newPasswordField|confirmPasswordField|mfaChallengeCode|totpVerifyCode|joinEmail|joinPassword|email|password)$/i.test(id);
}
function disableAutofill(root){
  (root || document).querySelectorAll('input, textarea, select').forEach(el => {
    if(shouldKeepAutofill(el)) return;
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'none');
    if((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && (el.type === 'text' || el.tagName === 'TEXTAREA' || !el.type)){
      el.setAttribute('spellcheck', 'false');
    }
  });
}
if(!window._autofillGuard){
  window._autofillGuard = true;
  document.addEventListener('DOMContentLoaded', () => disableAutofill(document));
  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if(!el || !el.matches || !el.matches('input, textarea, select')) return;
    if(shouldKeepAutofill(el)) return;
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('autocapitalize', 'none');
  });
  const mo = new MutationObserver((muts) => {
    muts.forEach(m => m.addedNodes.forEach(n => {
      if(n.nodeType === 1) disableAutofill(n);
    }));
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
}

// OpsTac Desktop Dashboard

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

let currentProfile = null;
let currentAgency = null;
let currentSettings = null;
let allPersonnel = [];
let allSubteams = [];

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

function memberById(id){ return allPersonnel.find(p => p.id === id); }
function mapsLink(address){ return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`; }
function mapsLinkHtml(address, label){
  if(!address) return '';
  return ` <a href="${mapsLink(address)}" target="_blank" rel="noopener" style="color:var(--olive-bright); font-size:11px; text-decoration:underline; margin-left:6px;" onclick="event.stopPropagation()">${label||'Open in Maps'}</a>`;
}
function daysUntil(dateStr){
  if(!dateStr) return null;
  return Math.round((new Date(dateStr) - new Date()) / (1000*60*60*24));
}

// ---------- Modal ----------
function openModal(title, bodyHtml){
  $('#modalCard').innerHTML = `<div class="modal-title">${title}</div>${bodyHtml}`;
  $('#modalOverlay').classList.add('active');
}
function closeModal(){
  $('#modalOverlay').classList.remove('active');
  $('#modalCard').innerHTML = '';
}
$('#modalOverlay').addEventListener('click', (e) => { if(e.target.id === 'modalOverlay') closeModal(); });

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
  const email = $('#forgotEmail').value.trim();
  const errorBox = $('#forgotError');
  errorBox.style.display = 'none';
  if(!email){ errorBox.textContent = 'Enter your email first.'; errorBox.style.display = 'block'; return; }

  const btn = $('#forgotSubmitBtn');
  btn.disabled = true; btn.textContent = 'Sending...';
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + '/app.html',
  });
  btn.disabled = false; btn.textContent = 'Send Reset Link';
  if(error){
    errorBox.textContent = error.message;
    errorBox.style.display = 'block';
    return;
  }
  $('#forgotPasswordForm').style.display = 'none';
  $('#forgotSuccessMsg').style.display = 'block';
});
$('#signOutBtn').addEventListener('click', async () => {
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

  const [{ data: agency }, { data: settings }] = await Promise.all([
    supabaseClient.from('agencies').select('name, patch_path').eq('id', profile.agency_id).single(),
    supabaseClient.from('agency_settings').select('*').eq('agency_id', profile.agency_id).single(),
  ]);
  currentAgency = agency;
  currentSettings = settings;
  (async () => {
    const path = (agency && agency.patch_path) || (settings && settings.patch_path);
    if(!path) return;
    const { data } = await supabaseClient.storage.from('operation-maps').createSignedUrl(path, 3600);
    if(data && data.signedUrl){
      window._agencyPatchUrl = data.signedUrl;
      const img = document.getElementById('sidebarAgencyPatch');
      if(img){ img.src = data.signedUrl; img.style.display = 'block'; }
    }
  })();

  if(settings && settings.accent_color) applyTheme(settings.accent_color, settings.accent_bright);

  $('#agencyNameLabel').textContent = agency ? agency.name : '';
  $('#userNameLabel').textContent = profile.full_name;
  $('#userRoleLabel').textContent = roleLabel(profile.role);

  $('#loginScreen').style.display = 'none';
  $('#appShell').classList.add('active');

  loadPendingJoinRequests();
  loadOverview();
}

function roleLabel(role){
  return { commander:'Commander', 'team-leader':'Team Leader', member:'Member' }[role] || role;
}
function applyTheme(accent, bright){
  document.documentElement.style.setProperty('--olive', accent);
  document.documentElement.style.setProperty('--olive-bright', bright);
}

// ---------- Navigation ----------
const PAGE_META = {
  overview: { title:'Command Overview', sub:'Real-time status across the team' },
  roster: { title:'Roster', sub:'Full personnel roster' },
  operations: { title:'Operations', sub:'Plan, run, and debrief activations' },
  equipment: { title:'Equipment', sub:'Assigned gear and checkout status' },
  certs: { title:'Certifications', sub:'Certification status across the team' },
  training: { title:'Training', sub:'Logged sessions and hours' },
  callouts: { title:'Callouts', sub:'Activation history and acknowledgment tracking' },
  settings: { title:'Settings', sub:'Agency, permissions, and appearance' },
};

$$('.nav-item').forEach(item => item.addEventListener('click', () => {
  const section = item.dataset.section;
  $$('.nav-item').forEach(n => n.classList.toggle('active', n === item));
  $$('.section').forEach(s => s.classList.toggle('active', s.id === `sec-${section}`));
  $('#pageTitle').textContent = PAGE_META[section].title;
  $('#pageSub').textContent = PAGE_META[section].sub;

  if(section === 'roster') loadRoster();
  if(section === 'operations'){ $('#opsListView').style.display='block'; $('#opsDetailView').style.display='none'; loadOperations(); }
  if(section === 'equipment') loadEquipment();
  if(section === 'certs') loadCerts();
  if(section === 'training') loadTraining();
  if(section === 'callouts') loadCallouts();
  if(section === 'settings') loadSettings();
}));

async function loadCorePersonnel(){
  const [{ data: personnel }, { data: subteams }] = await Promise.all([
    supabaseClient.from('personnel').select('*').order('name'),
    supabaseClient.from('subteams').select('*'),
  ]);
  allPersonnel = personnel || [];
  allSubteams = subteams || [];
}

// ---------- Command Overview ----------
async function loadOverview(){
  $('#overviewStats').innerHTML = `<div class="loading-state">Loading...</div>`;
  $('#overviewStatusBoard').innerHTML = `<div class="loading-state">Loading...</div>`;
  $('#overviewOps').innerHTML = `<div class="loading-state">Loading...</div>`;
  $('#overviewCallouts').innerHTML = `<div class="loading-state">Loading...</div>`;

  await loadCorePersonnel();
  const [certsRes, opsRes, calloutsRes] = await Promise.all([
    supabaseClient.from('certifications').select('member_id, expires'),
    supabaseClient.from('operations').select('*').order('date', { ascending:false }),
    supabaseClient.from('callouts').select('*, callout_recipients(*)').order('created_at', { ascending:false }).limit(10),
  ]);
  const certs = certsRes.data || [];
  const ops = opsRes.data || [];
  const callouts = calloutsRes.data || [];

  renderOverviewStats(allPersonnel, certs, ops, callouts);
  renderOverviewStatusBoard(allPersonnel, certs);
  renderOverviewOps(ops);
  renderOverviewCallouts(callouts);
}

function renderOverviewStats(personnel, certs, ops, callouts){
  const ready = personnel.filter(p => p.status === 'ready').length;
  const certsDue = certs.filter(c => { const d = daysUntil(c.expires); return d !== null && d <= 30; }).length;
  const activeOps = ops.filter(o => o.status === 'planning').length;
  const pendingCallouts = callouts.filter(c => c.active && (c.callout_recipients||[]).some(r => r.ack !== 'acknowledged')).length;

  $('#overviewStats').innerHTML = `
    <div class="stat-card good"><div class="stat-num">${ready}/${personnel.length}</div><div class="stat-label">Ready</div></div>
    <div class="stat-card ${certsDue>0?'warn':''}"><div class="stat-num">${certsDue}</div><div class="stat-label">Certs Due</div></div>
    <div class="stat-card ${activeOps>0?'warn':''}"><div class="stat-num">${activeOps}</div><div class="stat-label">Active Operations</div></div>
    <div class="stat-card ${pendingCallouts>0?'warn':''}"><div class="stat-num">${pendingCallouts}</div><div class="stat-label">Pending Callouts</div></div>
  `;
}
function renderOverviewStatusBoard(personnel, certs){
  if(personnel.length === 0){ $('#overviewStatusBoard').innerHTML = `<div class="panel-empty">No personnel on the roster yet.</div>`; return; }
  $('#overviewStatusBoard').innerHTML = `<div class="status-board">${personnel.map(p => {
    const dotClass = p.status === 'ready' ? 'dot-good' : p.status === 'attention' ? 'dot-warn' : 'dot-bad';
    const tileClass = p.status === 'unavailable' ? 'alert' : (p.on_call ? 'on-call' : '');
    const hasUrgentCert = certs.some(c => c.member_id === p.id && daysUntil(c.expires) !== null && daysUntil(c.expires) <= 30);
    return `
      <div class="member-tile ${tileClass}">
        <span class="tile-dot ${dotClass}"></span>
        <div class="tile-name">${p.name}</div>
        <div class="tile-rank">${p.rank || ''} ${p.on_call ? '· On-call' : ''}${hasUrgentCert ? ' · Cert due' : ''}</div>
      </div>`;
  }).join('')}</div>`;
}
function renderOverviewOps(ops){
  const active = ops.filter(o => o.status === 'planning');
  if(active.length === 0){ $('#overviewOps').innerHTML = `<div class="panel-empty">No active operations.</div>`; return; }
  $('#overviewOps').innerHTML = active.slice(0,6).map(o => `
    <div class="list-row" data-op-id="${o.id}">
      <span class="pill warn"><span class="pill-dot"></span>Planning</span>
      <div class="list-row-title">${o.name}</div>
      <div class="list-row-meta">${o.type || ''} ${o.date ? '· ' + o.date : ''}</div>
    </div>`).join('');
  $$('#overviewOps .list-row').forEach(row => row.addEventListener('click', () => {
    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.section === 'operations'));
    $$('.section').forEach(s => s.classList.toggle('active', s.id === 'sec-operations'));
    $('#pageTitle').textContent = PAGE_META.operations.title;
    $('#pageSub').textContent = PAGE_META.operations.sub;
    openOpDetail(row.dataset.opId);
  }));
}
function renderOverviewCallouts(callouts){
  const pending = callouts.filter(c => c.active && (c.callout_recipients||[]).some(r => r.ack !== 'acknowledged'));
  if(pending.length === 0){ $('#overviewCallouts').innerHTML = `<div class="panel-empty">No pending acknowledgments.</div>`; return; }
  $('#overviewCallouts').innerHTML = pending.slice(0,6).map(c => {
    const total = (c.callout_recipients||[]).length;
    const acked = (c.callout_recipients||[]).filter(r => r.ack === 'acknowledged').length;
    return `
      <div class="list-row">
        <span class="pill bad"><span class="pill-dot"></span>${acked}/${total} Ack'd</span>
        <div class="list-row-title">${c.type || 'Callout'}</div>
        <div class="list-row-meta">${c.date || ''} ${c.location ? '· ' + c.location : ''}${mapsLinkHtml(c.location)}</div>
      </div>`;
  }).join('');
}

// ---------- Roster ----------
async function loadRoster(){
  $('#newMemberBtn').style.display = canManageRecords() ? 'inline-block' : 'none';
  $('#newSubteamBtn').style.display = canManageRecords() ? 'inline-block' : 'none';
  $('#linkExistingBtn').style.display = currentProfile.role === 'commander' ? 'inline-block' : 'none';
  loadPendingJoinRequests();
  $('#rosterTableWrap').innerHTML = `<div class="loading-state">Loading...</div>`;
  await loadCorePersonnel();
  const { data: certs } = await supabaseClient.from('certifications').select('member_id');

  if(allPersonnel.length === 0){ $('#rosterTableWrap').innerHTML = `<div class="panel-empty">No personnel on the roster yet.</div>`; return; }

  const groups = [{ id:null, label:'Command' }, ...allSubteams.map(t => ({ id:t.id, label:`${t.name}${t.focus?' — '+t.focus:''}`, subteam:t }))];
  let html = '';
  groups.forEach(group => {
    const members = allPersonnel.filter(p => p.subteam_id === group.id);
    if(members.length === 0 && group.id === null) return; // hide empty "Command" pseudo-group only
    const editableHeader = group.subteam && canManageRecords();
    html += `<div class="group-header" ${editableHeader ? `data-edit-subteam="${group.id}" style="cursor:pointer;"` : ''}>${group.label}${editableHeader ? ' <span style="opacity:0.5; font-size:10px;">(edit)</span>' : ''}</div>`;
    if(members.length === 0){
      html += `<div class="panel-empty" style="padding:14px 18px; font-size:12px;">No one assigned yet.</div>`;
      return;
    }
    html += `<table><tbody>`;
    members.forEach(p => {
      const dotClass = p.status === 'ready' ? 'good' : p.status === 'attention' ? 'warn' : 'bad';
      const statusLabel = p.status === 'ready' ? 'Ready' : p.status === 'attention' ? 'Attention' : 'Unavailable';
      const certCount = (certs||[]).filter(c => c.member_id === p.id).length;
      const loginBadge = p.profile_id
        ? `<span class="pill good" style="margin-left:6px;"><span class="pill-dot"></span>Has Login</span>`
        : `<span class="pill neutral" style="margin-left:6px;">No Login</span>`;
      const rowCursor = canManageRecords() ? 'cursor:pointer;' : '';
      html += `
        <tr class="row-hover" data-personnel-id="${p.id}" style="${rowCursor}">
          <td style="width:24%;"><strong>${p.name}</strong>${loginBadge}</td>
          <td style="width:20%; color:var(--text-dim);">${p.rank || ''} · ${p.team_role || ''}</td>
          <td style="width:14%;"><span class="pill ${dotClass}"><span class="pill-dot"></span>${statusLabel}</span></td>
          <td style="width:14%; color:var(--text-dim);">${certCount} certs on file</td>
          <td class="mono" style="color:var(--text-dim);">${p.phone || ''}</td>
        </tr>`;
    });
    html += `</tbody></table>`;
  });
  $('#rosterTableWrap').innerHTML = `<div class="panel">${html}</div>`;

  $$('[data-edit-subteam]').forEach(header => header.addEventListener('click', () => {
    const subteam = allSubteams.find(t => t.id === header.dataset.editSubteam);
    if(subteam) openSubteamEditModal(subteam);
  }));

  if(canManageRecords()){
    $$('#rosterTableWrap tr[data-personnel-id]').forEach(row => row.addEventListener('click', () => {
      openMemberModal(memberById(row.dataset.personnelId));
    }));
  }
}

async function loadPendingJoinRequests(){
  const wrap = $('#pendingRequestsWrap');
  const badge = $('#pendingRequestsBadge');
  if(currentProfile.role !== 'commander'){ if(wrap) wrap.innerHTML = ''; if(badge) badge.style.display = 'none'; return; }
  const { data: requests } = await supabaseClient.from('join_requests').select('*').eq('status', 'pending').order('requested_at');

  if(badge){
    if(requests && requests.length > 0){ badge.textContent = requests.length; badge.style.display = 'inline-block'; }
    else { badge.style.display = 'none'; }
  }
  if(!wrap) return;
  if(!requests || requests.length === 0){ wrap.innerHTML = ''; return; }

  const subteamOptions = `<option value="">Command (no sub-team)</option>` + allSubteams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');

  wrap.innerHTML = `
    <div class="panel" style="border-color:var(--olive); padding:16px 18px;">
      <div style="font-weight:700; margin-bottom:12px;">Pending Join Requests (${requests.length})</div>
      ${requests.map(r => `
        <div data-request-id="${r.id}" style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 0; border-top:1px solid var(--line);">
          <div style="flex:1; min-width:160px;"><strong>${r.name}</strong><div style="font-size:11.5px; color:var(--text-dim);">${r.email}${r.phone?' · '+r.phone:''}</div></div>
          <select class="request-role" style="width:auto;"><option value="member">Member</option><option value="team-leader">Team Leader</option></select>
          <select class="request-subteam" style="width:auto;">${subteamOptions}</select>
          <button class="btn btn-primary request-approve" style="padding:6px 14px; font-size:12px;">Approve</button>
          <button class="btn btn-danger-outline request-deny" style="padding:6px 14px; font-size:12px;">Deny</button>
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

function openMemberModal(existing){
  const isEdit = !!existing;
  const subteamOptions = `<option value="">Command (no sub-team)</option>` +
    allSubteams.map(t => `<option value="${t.id}" ${existing && existing.subteam_id===t.id ? 'selected':''}>${t.name}</option>`).join('');

  openModal(isEdit ? 'Edit Operator' : 'Add Operator', `
    <div class="field-group"><label class="field-label">Name</label><input type="text" id="mMemberName" value="${existing?existing.name:''}" placeholder="e.g. Marcus Reyes"></div>
    <div class="row2">
      <div class="field-group"><label class="field-label">Rank</label><input type="text" id="mMemberRank" value="${existing?existing.rank||'':''}" placeholder="e.g. Deputy"></div>
      <div class="field-group"><label class="field-label">Team Role</label><input type="text" id="mMemberRole" value="${existing?existing.team_role||'':''}" placeholder="e.g. Breacher"></div>
      <div class="field-group"><label class="field-label">Callsign / Unit #</label><input type="text" id="mMemberCallsign" value="${existing?(existing.callsign||existing.unit_number||''):''}" placeholder="214 or Eagle 1" autocomplete="off"></div>
    </div>
    <div class="field-group"><label class="field-label">Sub-Team</label><select id="mMemberSubteam">${subteamOptions}</select></div>
    <div class="row2">
      <div class="field-group"><label class="field-label">Phone</label><input type="tel" id="mMemberPhone" value="${existing?existing.phone||'':''}"></div>
      <div class="field-group"><label class="field-label">Status</label>
        <select id="mMemberStatus">
          <option value="ready" ${existing&&existing.status==='ready'?'selected':''}>Ready</option>
          <option value="attention" ${existing&&existing.status==='attention'?'selected':''}>Attention</option>
          <option value="unavailable" ${existing&&existing.status==='unavailable'?'selected':''}>Unavailable</option>
        </select>
      </div>
    </div>
    <div class="field-group"><label class="field-label">If they later get app access, their role would be</label>
      <select id="mMemberPermission">
        <option value="member" ${existing&&existing.permission==='member'?'selected':''}>Member</option>
        <option value="team-leader" ${existing&&existing.permission==='team-leader'?'selected':''}>Team Leader</option>
      </select>
    </div>
    ${!isEdit && currentProfile.role==='commander' ? `
      <div class="field-group">
        <label class="field-label">Email (optional — invite them to create a login)</label>
        <input type="email" id="mMemberInviteEmail" placeholder="name@example.com">
      </div>
      <div class="error-box" id="mAddInviteError" style="display:none;"></div>
    ` : ''}
    <div class="settings-row" style="padding:10px 0;">
      <div class="settings-label">Available for callout</div>
      <div class="toggle-switch ${existing&&existing.on_call?'on':''}" id="mMemberOnCall"></div>
    </div>
    ${isEdit && !existing.profile_id && currentProfile.role==='commander' ? `
      <div class="settings-row" style="border-top:1px solid var(--line); padding-top:16px;">
        <div>
          <div class="settings-label">App Login</div>
          <div class="settings-sub">Send them an email invite to create their own account</div>
        </div>
        <button class="btn btn-outline" id="mInviteBtn" type="button">Invite to App</button>
      </div>
      <div class="error-box" id="mInviteError"></div>
    ` : ''}
    ${isEdit && currentProfile.role==='commander' ? `
      <div class="settings-row" style="border-top:1px solid var(--line); padding-top:16px;">
        <div>
          <div class="settings-label">Remove from Roster</div>
          <div class="settings-sub">${existing.profile_id ? 'This also revokes their app login.' : 'They have no login, so this only removes the roster entry.'}</div>
        </div>
        <button class="btn btn-danger-outline" id="mRemoveBtn" type="button">Remove</button>
      </div>
      <div class="error-box" id="mRemoveError"></div>
    ` : ''}
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">${isEdit?'Save Changes':'Add to Roster'}</button></div>
  `);

  let onCallVal = existing ? !!existing.on_call : false;
  $('#mMemberOnCall').addEventListener('click', () => {
    onCallVal = !onCallVal;
    $('#mMemberOnCall').classList.toggle('on', onCallVal);
  });

  $('#mCancel').addEventListener('click', closeModal);

  const inviteBtn = $('#mInviteBtn');
  if(inviteBtn){
    inviteBtn.addEventListener('click', async () => {
      const email = prompt(`Email address for ${existing.name}:`);
      if(!email || !email.trim()) return;
      inviteBtn.disabled = true;
      inviteBtn.textContent = 'Sending...';
      const errorBox = $('#mInviteError');
      errorBox.style.display = 'none';

      const { data: { session } } = await supabaseClient.auth.getSession();
      try {
        const res = await fetch('/.netlify/functions/invite-member', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: session.access_token,
            personnelId: existing.id,
            email: email.trim(),
            role: $('#mMemberPermission').value,
          }),
        });
        const data = await res.json();
        if(!res.ok){
          errorBox.textContent = data.error || 'Could not send invite.';
          errorBox.style.display = 'block';
          inviteBtn.disabled = false;
          inviteBtn.textContent = 'Invite to App';
          return;
        }
        inviteBtn.textContent = 'Invite Sent';
        closeModal();
        loadRoster();
      } catch(err){
        errorBox.textContent = 'Network error — please try again.';
        errorBox.style.display = 'block';
        inviteBtn.disabled = false;
        inviteBtn.textContent = 'Invite to App';
      }
    });
  }

  const removeBtn = $('#mRemoveBtn');
  if(removeBtn){
    removeBtn.addEventListener('click', async () => {
      const warning = existing.profile_id
        ? `Remove ${existing.name} from the roster and revoke their app login? This can't be undone.`
        : `Remove ${existing.name} from the roster? This can't be undone.`;
      if(!confirm(warning)) return;

      removeBtn.disabled = true;
      removeBtn.textContent = 'Removing...';
      const errorBox = $('#mRemoveError');
      errorBox.style.display = 'none';

      const { data: { session } } = await supabaseClient.auth.getSession();
      try {
        const res = await fetch('/.netlify/functions/remove-member', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken: session.access_token, personnelId: existing.id }),
        });
        const data = await res.json();
        if(!res.ok){
          errorBox.textContent = data.error || 'Could not remove them.';
          errorBox.style.display = 'block';
          removeBtn.disabled = false;
          removeBtn.textContent = 'Remove';
          return;
        }
        closeModal();
        loadRoster();
      } catch(err){
        errorBox.textContent = 'Network error — please try again.';
        errorBox.style.display = 'block';
        removeBtn.disabled = false;
        removeBtn.textContent = 'Remove';
      }
    });
  }

  $('#mSave').addEventListener('click', async () => {
    const name = $('#mMemberName').value.trim();
    if(!name) return;
    const payload = {
      name,
      rank: $('#mMemberRank').value.trim() || null,
      callsign: ($('#mMemberCallsign') && $('#mMemberCallsign').value.trim()) || null,
      unit_number: ($('#mMemberCallsign') && $('#mMemberCallsign').value.trim()) || null,
      team_role: $('#mMemberRole').value.trim() || null,
      subteam_id: $('#mMemberSubteam').value || null,
      phone: $('#mMemberPhone').value.trim() || null,
      status: $('#mMemberStatus').value,
      permission: $('#mMemberPermission').value,
      on_call: onCallVal,
    };
    if(isEdit){
      await supabaseClient.from('personnel').update(payload).eq('id', existing.id);
      closeModal();
      loadRoster();
      return;
    }

    const { data: created } = await supabaseClient.from('personnel')
      .insert({ agency_id: currentProfile.agency_id, ...payload }).select().single();

    const inviteEmailInput = $('#mMemberInviteEmail');
    const inviteEmail = inviteEmailInput ? inviteEmailInput.value.trim() : '';
    if(!inviteEmail || !created){
      closeModal();
      loadRoster();
      return;
    }

    const btn = $('#mSave');
    btn.disabled = true; btn.textContent = 'Adding & Inviting...';
    const { data: { session } } = await supabaseClient.auth.getSession();
    try {
      const res = await fetch('/.netlify/functions/invite-member', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: session.access_token, personnelId: created.id, email: inviteEmail, role: payload.permission }),
      });
      const data = await res.json();
      if(!res.ok){
        const errorBox = $('#mAddInviteError');
        errorBox.textContent = `Operator was added, but the invite failed: ${data.error || 'unknown error'}. You can retry from their roster entry.`;
        errorBox.style.display = 'block';
        btn.disabled = false; btn.textContent = 'Add to Roster';
        return;
      }
    } catch(err){
      const errorBox = $('#mAddInviteError');
      errorBox.textContent = 'Operator was added, but the invite could not be sent — network error. You can retry from their roster entry.';
      errorBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Add to Roster';
      return;
    }
    closeModal();
    loadRoster();
  });
}

$('#newMemberBtn').addEventListener('click', async () => {
  await loadCorePersonnel();
  openMemberModal(null);
});

$('#newSubteamBtn').addEventListener('click', () => {
  openModal('Add Sub-Team', `
    <div class="field-group"><label class="field-label">Team Name</label><input type="text" id="mSubteamName" placeholder="e.g. Charlie Team"></div>
    <div class="field-group"><label class="field-label">Focus</label><input type="text" id="mSubteamFocus" placeholder="e.g. Sniper / Observation"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Create</button></div>
  `);
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', async () => {
    const name = $('#mSubteamName').value.trim();
    if(!name) return;
    await supabaseClient.from('subteams').insert({
      agency_id: currentProfile.agency_id, name,
      focus: $('#mSubteamFocus').value.trim() || null,
    });
    closeModal();
    loadRoster();
  });
});

function openSubteamEditModal(subteam){
  const members = allPersonnel.filter(p => p.subteam_id === subteam.id);
  const leaderOptions = `<option value="">No leader assigned</option>` +
    members.map(p => `<option value="${p.id}" ${subteam.leader_personnel_id===p.id?'selected':''}>${p.name}</option>`).join('');

  openModal('Edit Sub-Team', `
    <div class="field-group"><label class="field-label">Team Name</label><input type="text" id="eSubteamName" value="${subteam.name}"></div>
    <div class="field-group"><label class="field-label">Focus</label><input type="text" id="eSubteamFocus" value="${subteam.focus||''}"></div>
    <div class="field-group"><label class="field-label">Team Leader</label><select id="eSubteamLeader">${leaderOptions}</select>
      ${members.length===0 ? `<div class="signal-hint" style="margin-top:6px;">No one's assigned to this team yet.</div>` : ''}
    </div>
    <div class="settings-row" style="border-top:1px solid var(--line); padding-top:16px;">
      <div><div class="settings-label">Delete Sub-Team</div><div class="settings-sub">Members move back to Command — nothing else is deleted.</div></div>
      <button class="btn btn-danger-outline" id="eSubteamDelete" type="button">Delete</button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="eSubteamSave">Save Changes</button></div>
  `);
  $('#mCancel').addEventListener('click', closeModal);
  $('#eSubteamSave').addEventListener('click', async () => {
    const name = $('#eSubteamName').value.trim();
    if(!name) return;
    await supabaseClient.from('subteams').update({
      name, focus: $('#eSubteamFocus').value.trim() || null,
      leader_personnel_id: $('#eSubteamLeader').value || null,
    }).eq('id', subteam.id);
    closeModal();
    loadRoster();
  });
  $('#eSubteamDelete').addEventListener('click', async () => {
    if(!confirm(`Delete ${subteam.name}? Anyone assigned to it moves back to Command.`)) return;
    await supabaseClient.from('subteams').delete().eq('id', subteam.id);
    closeModal();
    loadRoster();
  });
}

$('#linkExistingBtn').addEventListener('click', () => {
  const subteamOptions = `<option value="">Command (no sub-team)</option>` + allSubteams.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  openModal('Add Existing Account', `
    <p style="font-size:12.5px; color:var(--text-dim); margin-bottom:16px; line-height:1.5;">Use this only if the person already has an OpsTac login. If they don't yet, use "Add Operator" then "Invite to App" instead.</p>
    <div class="field-group"><label class="field-label">Their Email</label><input type="email" id="lExEmail" placeholder="name@example.com"></div>
    <div class="field-group"><label class="field-label">Name</label><input type="text" id="lExName"></div>
    <div class="row2">
      <div class="field-group"><label class="field-label">Rank</label><input type="text" id="lExRank"></div>
      <div class="field-group"><label class="field-label">Team Role</label><input type="text" id="lExRole"></div>
    </div>
    <div class="field-group"><label class="field-label">Sub-Team</label><select id="lExSubteam">${subteamOptions}</select></div>
    <div class="row2">
      <div class="field-group"><label class="field-label">Phone</label><input type="tel" id="lExPhone"></div>
      <div class="field-group"><label class="field-label">Access Level</label>
        <select id="lExPermission"><option value="member">Member</option><option value="team-leader">Team Leader</option></select>
      </div>
    </div>
    <div class="error-box" id="lExError" style="display:none;"></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="lExSave">Add to Roster</button></div>
  `);
  $('#mCancel').addEventListener('click', closeModal);
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
      closeModal();
      loadRoster();
    } catch(err){
      errorBox.textContent = 'Network error — please try again.';
      errorBox.style.display = 'block';
      btn.disabled = false; btn.textContent = 'Add to Roster';
    }
  });
});

// ---------- Equipment ----------
async function loadEquipment(){
  $('#newEquipBtn').style.display = canManageRecords() ? 'inline-block' : 'none';
  $('#equipTableBody').innerHTML = `<tr><td colspan="5" class="loading-state">Loading...</td></tr>`;
  await loadCorePersonnel();
  const { data: equipment } = await supabaseClient.from('equipment').select('*').order('item');

  if(!equipment || equipment.length === 0){
    $('#equipTableBody').innerHTML = `<tr><td colspan="5" class="panel-empty">No equipment logged yet.</td></tr>`;
    return;
  }
  const condLabel = { good:['Good','good'], 'needs-service':['Needs Service','bad'], 'inspect-due':['Inspection Due','warn'] };
  const statusLabel = { 'checked-out':['Checked Out','warn'], 'in-storage':['In Storage','good'] };
  $('#equipTableBody').innerHTML = equipment.map(e => {
    const assignee = e.assigned_to ? (memberById(e.assigned_to)?.name || '—') : 'Unassigned';
    const [cLabel,cClass] = condLabel[e.condition] || ['—',''];
    const [sLabel,sClass] = statusLabel[e.status] || ['—',''];
    return `<tr class="row-hover">
      <td><strong>${e.item}</strong></td>
      <td class="mono" style="color:var(--text-dim);">${e.asset_no||''}</td>
      <td>${assignee}</td>
      <td><span class="pill ${cClass}"><span class="pill-dot"></span>${cLabel}</span></td>
      <td><span class="pill ${sClass}"><span class="pill-dot"></span>${sLabel}</span></td>
    </tr>`;
  }).join('');
}

$('#newEquipBtn').addEventListener('click', async () => {
  await loadCorePersonnel();
  openModal('Log Equipment', `
    <div class="field-group"><label class="field-label">Item</label><input type="text" id="mEquipItem" placeholder="e.g. M4 Carbine"></div>
    <div class="row2">
      <div class="field-group"><label class="field-label">Asset #</label><input type="text" id="mEquipAsset"></div>
      <div class="field-group"><label class="field-label">Assigned To</label>
        <select id="mEquipAssignee"><option value="">Unassigned</option>${allPersonnel.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>
      </div>
    </div>
    <div class="row2">
      <div class="field-group"><label class="field-label">Condition</label>
        <select id="mEquipCondition"><option value="good">Good</option><option value="needs-service">Needs Service</option><option value="inspect-due">Inspection Due</option></select>
      </div>
      <div class="field-group"><label class="field-label">Status</label>
        <select id="mEquipStatus"><option value="in-storage">In Storage</option><option value="checked-out">Checked Out</option></select>
      </div>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Save</button></div>
  `);
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', async () => {
    const item = $('#mEquipItem').value.trim();
    if(!item) return;
    await supabaseClient.from('equipment').insert({
      agency_id: currentProfile.agency_id,
      item,
      asset_no: $('#mEquipAsset').value.trim() || null,
      assigned_to: $('#mEquipAssignee').value || null,
      condition: $('#mEquipCondition').value,
      status: $('#mEquipStatus').value,
    });
    closeModal();
    loadEquipment();
  });
});

// ---------- Certifications ----------
async function loadCerts(){
  $('#newCertBtn').style.display = canManageRecords() ? 'inline-block' : 'none';
  $('#certsTableBody').innerHTML = `<tr><td colspan="5" class="loading-state">Loading...</td></tr>`;
  await loadCorePersonnel();
  const { data: certs } = await supabaseClient.from('certifications').select('*');

  if(!certs || certs.length === 0){
    $('#certsTableBody').innerHTML = `<tr><td colspan="5" class="panel-empty">No certifications logged yet.</td></tr>`;
    return;
  }
  const sorted = [...certs].sort((a,b) => daysUntil(a.expires) - daysUntil(b.expires));
  $('#certsTableBody').innerHTML = sorted.map(c => {
    const m = memberById(c.member_id);
    const d = daysUntil(c.expires);
    let label, cls;
    if(d < 0){ label = `Expired ${Math.abs(d)}d ago`; cls='bad'; }
    else if(d <= 30){ label = `Expires in ${d}d`; cls='warn'; }
    else { label = 'Current'; cls='good'; }
    return `<tr class="row-hover">
      <td><strong>${m ? m.name : '—'}</strong></td>
      <td>${c.name}</td>
      <td class="mono" style="color:var(--text-dim);">${c.issued||''}</td>
      <td class="mono" style="color:var(--text-dim);">${c.expires}</td>
      <td><span class="pill ${cls}"><span class="pill-dot"></span>${label}</span></td>
    </tr>`;
  }).join('');
}

$('#newCertBtn').addEventListener('click', async () => {
  await loadCorePersonnel();
  openModal('Log Certification', `
    <div class="field-group"><label class="field-label">Member</label>
      <select id="mCertMember">${allPersonnel.map(p=>`<option value="${p.id}">${p.name}</option>`).join('')}</select>
    </div>
    <div class="field-group"><label class="field-label">Certification Name</label><input type="text" id="mCertName" placeholder="e.g. Tactical Breaching"></div>
    <div class="row2">
      <div class="field-group"><label class="field-label">Issued</label><input type="date" id="mCertIssued"></div>
      <div class="field-group"><label class="field-label">Expires</label><input type="date" id="mCertExpires"></div>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Save</button></div>
  `);
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', async () => {
    const name = $('#mCertName').value.trim();
    const expires = $('#mCertExpires').value;
    if(!name || !expires) return;
    await supabaseClient.from('certifications').insert({
      agency_id: currentProfile.agency_id,
      member_id: $('#mCertMember').value,
      name,
      issued: $('#mCertIssued').value || null,
      expires,
    });
    closeModal();
    loadCerts();
  });
});

// ---------- Training ----------
async function loadTraining(){
  $('#newTrainingBtn').style.display = canManageRecords() ? 'inline-block' : 'none';
  $('#trainingTableBody').innerHTML = `<tr><td colspan="5" class="loading-state">Loading...</td></tr>`;
  await loadCorePersonnel();
  const { data: sessions } = await supabaseClient.from('training_sessions').select('*').order('date', {ascending:false});
  const { data: attendees } = await supabaseClient.from('training_attendees').select('*');

  const sessionList = sessions || [];
  const totalHours = sessionList.reduce((s,t) => s + Number(t.hours||0), 0);
  const avgAttendance = sessionList.length ? Math.round((attendees||[]).length / sessionList.length) : 0;
  $('#trainingStats').innerHTML = `
    <div class="stat-card"><div class="stat-num">${totalHours}</div><div class="stat-label">Total Hours</div></div>
    <div class="stat-card"><div class="stat-num">${sessionList.length}</div><div class="stat-label">Sessions</div></div>
    <div class="stat-card"><div class="stat-num">${avgAttendance}</div><div class="stat-label">Avg Attendance</div></div>
    <div class="stat-card"></div>
  `;

  if(sessionList.length === 0){
    $('#trainingTableBody').innerHTML = `<tr><td colspan="5" class="panel-empty">No training sessions logged yet.</td></tr>`;
    return;
  }
  $('#trainingTableBody').innerHTML = sessionList.map(t => {
    const count = (attendees||[]).filter(a => a.session_id === t.id).length;
    return `<tr class="row-hover">
      <td class="mono" style="color:var(--text-dim);">${t.date}</td>
      <td><strong>${t.title}</strong></td>
      <td>${t.type||''}</td>
      <td>${count}</td>
      <td class="mono">${t.hours}h</td>
    </tr>`;
  }).join('');
}

$('#newTrainingBtn').addEventListener('click', async () => {
  await loadCorePersonnel();
  openModal('Log Training Session', `
    <div class="row2">
      <div class="field-group"><label class="field-label">Date</label><input type="date" id="mTrainDate"></div>
      <div class="field-group"><label class="field-label">Hours</label><input type="number" step="0.5" id="mTrainHours" placeholder="4"></div>
    </div>
    <div class="field-group"><label class="field-label">Session Title</label><input type="text" id="mTrainTitle" placeholder="e.g. CQB Room Clearing"></div>
    <div class="field-group"><label class="field-label">Type</label><input type="text" id="mTrainType" placeholder="e.g. Live Fire, Tactical, Qualification"></div>
    <div class="field-group"><label class="field-label">Attendees</label><div id="mTrainAttendees"></div></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Save</button></div>
  `);
  const selected = new Set();
  $('#mTrainAttendees').innerHTML = allPersonnel.map(p => `
    <div class="checklist-row" data-id="${p.id}"><div class="checkbox"></div><span>${p.name}</span></div>
  `).join('');
  $$('#mTrainAttendees .checklist-row').forEach(row => row.addEventListener('click', () => {
    const id = row.dataset.id;
    if(selected.has(id)){ selected.delete(id); row.querySelector('.checkbox').classList.remove('checked'); row.querySelector('.checkbox').textContent=''; }
    else { selected.add(id); row.querySelector('.checkbox').classList.add('checked'); row.querySelector('.checkbox').textContent='✓'; }
  }));
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', async () => {
    const title = $('#mTrainTitle').value.trim();
    const date = $('#mTrainDate').value;
    if(!title || !date) return;
    const { data: session } = await supabaseClient.from('training_sessions').insert({
      agency_id: currentProfile.agency_id, date, title,
      type: $('#mTrainType').value.trim() || null,
      hours: Number($('#mTrainHours').value) || 0,
    }).select().single();
    if(session && selected.size > 0){
      await supabaseClient.from('training_attendees').insert([...selected].map(memberId => ({ session_id: session.id, member_id: memberId })));
    }
    closeModal();
    loadTraining();
  });
});

// ---------- Operations ----------
async function loadOperations(){
  $('#newOpBtn').style.display = canEditOps() ? 'inline-block' : 'none';
  $('#opsListWrap').innerHTML = `<div class="loading-state">Loading...</div>`;
  const { data: ops } = await supabaseClient.from('operations').select('*').order('date', { ascending:false });
  if(!ops || ops.length === 0){ $('#opsListWrap').innerHTML = `<div class="panel-empty">No operations logged yet.</div>`; return; }
  $('#opsListWrap').innerHTML = ops.map(o => {
    const statusCls = o.status === 'complete' ? 'good' : 'warn';
    const statusLabel = o.status === 'complete' ? 'Complete' : 'Planning';
    return `<div class="list-row" data-op-id="${o.id}">
      <span class="pill ${statusCls}"><span class="pill-dot"></span>${statusLabel}</span>
      <div class="list-row-title">${o.name}</div>
      <div class="list-row-meta">${o.type||''} ${o.date?'· '+o.date:''} ${o.location?'· '+o.location:''}${mapsLinkHtml(o.location)}</div>
    </div>`;
  }).join('');
  $$('#opsListWrap .list-row').forEach(row => row.addEventListener('click', () => openOpDetail(row.dataset.opId)));
}

$('#newOpBtn').addEventListener('click', () => {
  openModal('New Operation', `
    <div class="field-group"><label class="field-label">Operation Name</label><input type="text" id="mOpName"></div>
    <div class="field-group"><label class="field-label">Type</label><input type="text" id="mOpType"></div>
    <div class="row2">
      <div class="field-group"><label class="field-label">Date</label><input type="date" id="mOpDate"></div>
      <div class="field-group"><label class="field-label">Location</label><input type="text" id="mOpLocation"></div>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Create</button></div>
  `);
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', async () => {
    const name = $('#mOpName').value.trim();
    if(!name) return;
    const { data: op } = await supabaseClient.from('operations').insert({
      agency_id: currentProfile.agency_id, name,
      type: $('#mOpType').value.trim() || null,
      date: $('#mOpDate').value || null,
      location: $('#mOpLocation').value.trim() || null,
      status: 'planning', plan: {},
    }).select().single();
    closeModal();
    loadOperations();
    if(op) openOpDetail(op.id);
  });
});

let currentOpId = null;
let currentOpCache = null;
let currentOperatorsCache = [];
let dashPlaceMode = null;
let dashSelected = null;
let pendingStack = null;
let armedOperatorId = null;

async function openOpDetail(opId){
  currentOpId = opId;
  armedOperatorId = null;
  dashPlaceMode = null;
  currentOpCache = null;
  $('#opsListView').style.display = 'none';
  $('#opsDetailView').style.display = 'block';
  $('#opsDetailView').innerHTML = `<div class="loading-state">Loading...</div>`;

  await loadCorePersonnel();
  const { data: op } = await supabaseClient.from('operations').select('*').eq('id', opId).single();
  const { data: operators } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', opId);

  renderOpDetail(op, operators || []);
}

function renderOpDetail(op, operators){
  const editable = canEditOps();
  $('#opsDetailView').innerHTML = `
    <div class="op-detail-header">
      <div>
        <button class="btn btn-ghost" id="opBackBtn" style="margin-bottom:10px;">← Back to Operations</button>
        <div class="op-detail-title">${op.name}</div>
        <div class="op-detail-sub">${op.type||''} · ${op.date||''} · ${op.location||''}${mapsLinkHtml(op.location)}</div>
      </div>
      <div style="display:flex; gap:8px;">
        ${canManageCallouts() ? `<button class="btn btn-outline" id="opCalloutBtn">Callout Team</button>` : ''}
        <button class="btn btn-outline" id="opPrintBtn">Print Report</button>
        <button class="btn btn-outline" id="opPresentBtn">Export Presentation</button>
        ${editable ? `<button class="btn btn-danger-outline" id="opDeleteBtn">Delete Operation</button>` : ''}
      </div>
    </div>
    <div class="subtab-row">
      <div class="subtab active" data-subtab="map">Map</div>
      <div class="subtab" data-subtab="plan">Pre-Ops Plan</div>
      <div class="subtab" data-subtab="log">Notes / Log</div>
      <div class="subtab" data-subtab="chat">Op Chat</div>
      <div class="subtab" data-subtab="debrief">Debrief</div>
      <div class="subtab" data-subtab="callouts">Callouts</div>
    </div>
    <div class="subpanel active" id="opPanel-map">
      <div class="dash-map-tools">
        <input type="text" class="field-input" id="dashMapAddress" placeholder="Jump to address" style="flex:1; min-width:220px;" value="${(op.location||'').replace(/"/g,'&quot;')}">
        <button type="button" class="btn btn-outline" id="dashMapGo">Go</button>
        <label class="list-row-meta" style="display:flex; align-items:center; gap:8px;">Rotate
          <input type="range" id="dashRotate" min="0" max="360" value="0" style="width:140px;">
          <span id="dashRotateDeg">0°</span>
        </label>
        <button type="button" class="btn btn-danger-outline" id="dashRemovePin" style="font-size:12px;">Remove selected</button>
      </div>
      <div id="dashLiveMap" style="height:70vh; min-height:520px; width:100%; background:#0b100d; border:1px solid var(--line); border-radius:8px;"></div>
      <div class="op-palette" id="opPalette"></div>
      <div id="dashStackEditor" style="margin-top:16px;"></div>
      
      
    </div>
    <div class="subpanel" id="opPanel-plan">
      <div id="planFields"></div>
    </div>
    <div class="subpanel" id="opPanel-log">
      <div id="dashOpsLog"></div>
    </div>
    <div class="subpanel" id="opPanel-chat">
      <div id="dashOpChat"></div>
    </div>
    <div class="subpanel" id="opPanel-debrief">
      <div id="debriefContent"></div>
    </div>
    <div class="subpanel" id="opPanel-callouts">
      <div id="opCalloutsContent"></div>
    </div>
  `;

  $('#opBackBtn').addEventListener('click', () => {
    $('#opsDetailView').style.display = 'none';
    $('#opsListView').style.display = 'block';
    loadOperations();
  });
  $('#opPrintBtn').addEventListener('click', () => printOpReport(op, operators));
  $('#opPresentBtn').addEventListener('click', () => exportOpPresentation(op, operators));

  const deleteBtn = $('#opDeleteBtn');
  if(deleteBtn){
    deleteBtn.addEventListener('click', async () => {
      if(!confirm(`Delete "${op.name}"? This removes its map, plan, and debrief permanently. Any callouts logged against it stay in your Callouts history, just unlinked.`)) return;
      await supabaseClient.from('operations').delete().eq('id', op.id);
      $('#opsDetailView').style.display = 'none';
      $('#opsListView').style.display = 'block';
      loadOperations();
    });
  }
  const calloutBtn = $('#opCalloutBtn');
  if(calloutBtn) calloutBtn.addEventListener('click', () => openNewCalloutModal({ id: op.id, name: op.name }));

  $$('.subtab').forEach(tab => tab.addEventListener('click', () => {
    $$('.subtab').forEach(t => t.classList.toggle('active', t===tab));
    $$('.subpanel').forEach(p => p.classList.toggle('active', p.id === `opPanel-${tab.dataset.subtab}`));
    if(tab.dataset.subtab === 'callouts') renderOpCallouts(op.id);
    if(tab.dataset.subtab === 'log') renderDashOpsLog(currentOpCache || op);
    if(tab.dataset.subtab === 'chat') loadDashChat();
    if(tab.dataset.subtab === 'map' && dashLiveMap) setTimeout(() => dashLiveMap.invalidateSize(), 80);
  }));

  try { renderPlan(op, editable); } catch(e){ console.error('plan', e); }
  try { renderDebrief(op, editable); } catch(e){ console.error('debrief', e); }
  try { renderMapPalette(op, operators, editable); } catch(e){ console.error('palette', e); }
  setTimeout(() => { try { initDashLiveMap(op); renderDashStacks(op); } catch(e){ console.error('map', e); } }, 80);

}

async function renderExistingMapImage(op){
  if(!op.map_image_url) return;
  const { data, error } = await supabaseClient.storage.from('operation-maps').createSignedUrl(op.map_image_url, 3600);
  if(error){
    console.error('renderExistingMapImage: could not get signed URL', { path: op.map_image_url, error });
    return;
  }
  $('#mapCanvas').classList.add('has-image');
  if(op.map_image_ratio) $('#mapCanvas').style.aspectRatio = op.map_image_ratio;
  $('#mapBgImage').src = data.signedUrl;
  $('#mapBgImage').style.display = 'block';
  $('#mapUploadPrompt').style.display = 'none';
}

async function renderOpCallouts(opId){
  $('#opCalloutsContent').innerHTML = `<div class="loading-state">Loading...</div>`;
  const { data: callouts } = await supabaseClient.from('callouts').select('*, callout_recipients(*)').eq('operation_id', opId).order('created_at', { ascending:false });
  if(!callouts || callouts.length === 0){
    $('#opCalloutsContent').innerHTML = `<div class="panel-empty">No callouts linked to this operation yet. Use "Callout Team" above to send one.</div>`;
    return;
  }
  const methodLabel = { text:'Sent via Text', share:'Shared', logged:'Logged Verbally', 'signal-group':'Sent to Signal Group' };
  $('#opCalloutsContent').innerHTML = callouts.map(co => {
    const total = (co.callout_recipients||[]).length;
    const acked = (co.callout_recipients||[]).filter(r => r.ack === 'acknowledged').length;
    const modeCls = co.mode === 'deploy' ? 'bad' : 'warn';
    const recipRows = (co.callout_recipients||[]).map(r => {
      const m = memberById(r.member_id);
      return `<div class="checklist-row" data-callout-id="${co.id}" data-member-id="${r.member_id}" style="cursor:${canManageCallouts()?'pointer':'default'};">
        <span>${m ? m.name : '—'}</span>
        <span class="pill ${r.ack==='acknowledged'?'good':'warn'}" style="margin-left:auto;"><span class="pill-dot"></span>${r.ack==='acknowledged'?'Acknowledged':'Pending'}</span>
      </div>`;
    }).join('');
    return `<div class="list-row" style="cursor:default;">
      <span class="pill ${modeCls}"><span class="pill-dot"></span>${co.mode==='deploy'?'Deploy':'Standby'}</span>
      <div class="list-row-title">${co.type||'Callout'}</div>
      <div class="list-row-meta">${co.date||''} ${co.location?'· '+co.location:''}${mapsLinkHtml(co.location)} · ${acked}/${total} acknowledged · ${methodLabel[co.method]||co.method}</div>
      <div style="margin-top:10px;">${recipRows}</div>
    </div>`;
  }).join('');

  if(canManageCallouts()){
    $$('#opCalloutsContent .checklist-row[data-callout-id]').forEach(row => row.addEventListener('click', async () => {
      const calloutId = row.dataset.calloutId, memberId = row.dataset.memberId;
      const { data: current } = await supabaseClient.from('callout_recipients').select('ack').eq('callout_id', calloutId).eq('member_id', memberId).single();
      const newAck = current && current.ack === 'acknowledged' ? 'pending' : 'acknowledged';
      await supabaseClient.from('callout_recipients').update({ ack: newAck }).eq('callout_id', calloutId).eq('member_id', memberId);
      renderOpCallouts(opId);
    }));
  }
}

const DASH_LOCS = [
  { type:'command', label:'Command' },
  { type:'ems', label:'EMS' },
  { type:'lz', label:'LZ' },
  { type:'vehicle', label:'Vehicle' },
  { type:'rally', label:'Rally' },
  { type:'staging', label:'Staging' },
];
function operatorUnitLabel(person){
  if(!person) return '?';
  const raw = String(person.callsign || person.unit_number || '').trim();
  if(raw) return raw.slice(0,6);
  return String(person.name||'?').split(' ').map(w=>w[0]).join('').slice(0,3).toUpperCase();
}
function renderMapPalette(op, operators, editable){
  const loc = DASH_LOCS.map(l => `<button type="button" class="btn btn-outline dash-loc ${dashPlaceMode===l.type?'btn-primary':''}" data-loc="${l.type}" style="font-size:11px; padding:6px 8px;">${l.label}</button>`).join('');
  const people = allPersonnel.map(p => {
    const placed = (operators||[]).some(o => o.member_id === p.id);
    const mark = operatorUnitLabel(p);
    return `<button type="button" class="btn btn-outline ${armedOperatorId===p.id?'btn-primary':''}" data-member-id="${p.id}" style="font-size:11px; padding:6px 8px;${placed?'box-shadow:0 0 0 2px var(--olive) inset;':''}">${mark} · ${p.name}</button>`;
  }).join('');
  $('#opPalette').innerHTML = `<div style="display:flex; flex-wrap:wrap; gap:6px; margin:12px 0 8px;">${loc}</div>
    <div style="display:flex; flex-wrap:wrap; gap:6px;">${people}</div>
    <div class="list-row-meta" id="dashMapHint" style="margin-top:8px;">Select a type or person, click the map to place. Drag to move. Click a pin, then Remove selected.</div>`;
  if(!editable) return;
  $$('#opPalette [data-loc]').forEach(btn => btn.addEventListener('click', () => {
    dashPlaceMode = dashPlaceMode === btn.dataset.loc ? null : btn.dataset.loc;
    armedOperatorId = null;
    renderMapPalette(op, operators, editable);
  }));
  $$('#opPalette [data-member-id]').forEach(btn => btn.addEventListener('click', () => {
    armedOperatorId = armedOperatorId === btn.dataset.memberId ? null : btn.dataset.memberId;
    dashPlaceMode = null;
    renderMapPalette(op, operators, editable);
  }));
}

function renderMapPins(operators){
  const canvas = $('#mapCanvas');
  if(!canvas) return;
  $$('.map-pin').forEach(p => p.remove());
  operators.forEach(o => {
    const m = memberById(o.member_id);
    if(!m) return;
    const pin = document.createElement('div');
    pin.className = 'map-pin';
    pin.style.left = o.x + '%';
    pin.style.top = o.y + '%';
    pin.textContent = m.name.split(' ').map(w=>w[0]).slice(-2).join('');
    pin.title = m.name;
    pin.addEventListener('click', async (e) => {
      e.stopPropagation();
      if(!canEditOps()) return;
      await supabaseClient.from('operation_operators').delete().eq('operation_id', currentOpId).eq('member_id', o.member_id);
      const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
      renderMapPins(refreshed || []);
      renderMapPalette({}, refreshed || [], canEditOps());
    });
    canvas.appendChild(pin);
  });
}

document.addEventListener('click', async (e) => {
  if(e.target.id === 'mapCanvas' && canEditOps() && armedOperatorId){
    const rect = e.target.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    await supabaseClient.from('operation_operators').upsert({
      operation_id: currentOpId, member_id: armedOperatorId,
      x: Math.max(3,Math.min(97,x)), y: Math.max(3,Math.min(97,y)),
    }, { onConflict: 'operation_id,member_id' });
    const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
    renderMapPins(refreshed || []);
  }
});

function wireMapUpload(op, editable){
  if(!editable) return;
  $('#mapUploadPrompt').addEventListener('click', () => $('#mapImageInput').click());
  $('#mapImageInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const path = `${currentProfile.agency_id}/${currentOpId}/${Date.now()}-${file.name}`;
    const { error } = await supabaseClient.storage.from('operation-maps').upload(path, file, { upsert:true });
    if(error){ alert('Upload failed: ' + error.message); return; }

    const img = new Image();
    const reader = new FileReader();
    reader.onload = async (ev) => {
      img.onload = async () => {
        await supabaseClient.from('operations').update({
          map_image_url: path, map_image_ratio: `${img.naturalWidth} / ${img.naturalHeight}`,
        }).eq('id', currentOpId);
        const { data: signed } = await supabaseClient.storage.from('operation-maps').createSignedUrl(path, 3600);
        $('#mapCanvas').classList.add('has-image');
        $('#mapCanvas').style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        $('#mapBgImage').src = signed ? signed.signedUrl : '';
        $('#mapBgImage').style.display = 'block';
        $('#mapUploadPrompt').style.display = 'none';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const PLAN_FIELDS = [
  { key:'objective', label:'Objective' }, { key:'approach', label:'Approach / Entry Plan' },
  { key:'rallyPoint', label:'Rally Point' }, { key:'comms', label:'Communications Plan' },
  { key:'contingencies', label:'Contingencies' }, { key:'equipment', label:'Equipment Needed' },
];
function renderPlan(op, editable){
  const plan = op.plan || {};
  const commanderOptions = `<option value="">Not yet designated</option>` +
    allPersonnel.map(p => `<option value="${p.id}" ${op.incident_commander_personnel_id===p.id?'selected':''}>${p.name}</option>`).join('');

  $('#planFields').innerHTML = `
    <div class="field-group">
      <label class="field-label">Target Location Photos</label>
      <div id="targetPhotosGrid" style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:10px;"></div>
      ${editable ? `
        <input type="file" id="targetPhotoInput" accept="image/*" style="display:none;">
        <button class="btn btn-outline" id="uploadTargetPhotoBtn" type="button">+ Upload Photo</button>
      ` : ''}
    </div>
    <div class="field-group">
      <label class="field-label">Overall Command</label>
      <select id="opCommanderSelect" ${!editable?'disabled':''}>${commanderOptions}</select>
    </div>
    <div class="field-group">
      <label class="field-label">Attached teams</label>
      <div id="planUnitsBox"></div>
    </div>
    <div class="field-group">
      <label class="field-label">Assets Utilized</label>
      <div id="opAssetsChecklist" style="font-size:12.5px; color:var(--text-dim);">Loading...</div>
    </div>
  ` + PLAN_FIELDS.map(f => `
    <div class="field-group"><label class="field-label">${f.label}</label>
      ${editable
        ? `<textarea class="field-textarea" data-plan-field="${f.key}" placeholder="Not yet filled in...">${plan[f.key]||''}</textarea>`
        : `<div class="field-textarea" style="color:var(--text-dim);">${plan[f.key] || 'Not yet filled in'}</div>`}
    </div>`).join('') + (op.status==='planning' && editable ? `<button class="btn btn-primary" id="completeOpBtn">Mark Operation Complete</button>` : '');

  loadTargetPhotos(op.id, editable);
  loadOpAssets(op.id, editable);
  renderDashAttachedUnits(op, editable);

  if(editable){
    $('#opCommanderSelect').addEventListener('change', async () => {
      const val = $('#opCommanderSelect').value || null;
      await supabaseClient.from('operations').update({ incident_commander_personnel_id: val }).eq('id', currentOpId);
      op.incident_commander_personnel_id = val;
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
      const newPlan = { ...op.plan, [ta.dataset.planField]: ta.value };
      await supabaseClient.from('operations').update({ plan: newPlan }).eq('id', currentOpId);
      op.plan = newPlan;
    }));
    const completeBtn = $('#completeOpBtn');
    if(completeBtn) completeBtn.addEventListener('click', async () => {
      await supabaseClient.from('operations').update({ status:'complete', debrief:{} }).eq('id', currentOpId);
      op.status = 'complete'; op.debrief = {};
      renderDebrief(op, editable);
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
        ? `<div style="width:90px; height:90px; border-radius:6px; border:1px solid var(--bad); display:flex; align-items:center; justify-content:center; font-size:10px; color:var(--bad); text-align:center; padding:4px;">Failed to load</div>`
        : `<img src="${p.url}" data-expand-photo="${p.url}" style="width:90px; height:90px; object-fit:cover; border-radius:6px; border:1px solid var(--line); cursor:pointer;">`}
      ${editable ? `<button data-delete-photo="${p.id}" data-photo-path="${p.storage_path}" style="position:absolute; top:-6px; right:-6px; width:20px; height:20px; border-radius:50%; background:var(--bad); color:#fff; border:none; cursor:pointer; font-size:12px; line-height:1;">×</button>` : ''}
    </div>
  `).join('');
  $$('[data-expand-photo]').forEach(img => img.addEventListener('click', () => {
    openModal('Target Location Photo', `<img src="${img.dataset.expandPhoto}" style="width:100%; border-radius:6px;">`);
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
    <div class="checklist-row" data-equip-id="${e.id}" style="${editable?'cursor:pointer;':'cursor:default;'}">
      <div class="checkbox ${linkedIds.has(e.id)?'checked':''}">${linkedIds.has(e.id)?'✓':''}</div>
      <span>${e.item}</span>
    </div>`).join('');

  if(editable){
    $$('#opAssetsChecklist .checklist-row').forEach(row => row.addEventListener('click', async () => {
      const equipId = row.dataset.equipId;
      const box = row.querySelector('.checkbox');
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

const DEBRIEF_FIELDS = [
  { key:'outcome', label:'Outcome' }, { key:'timeline', label:'Timeline' }, { key:'injuries', label:'Injuries' },
  { key:'equipmentIssues', label:'Equipment Issues' }, { key:'lessonsLearned', label:'Lessons Learned' }, { key:'narrative', label:'Narrative Summary' },
];
function renderDebrief(op, editable){
  if(op.status !== 'complete'){
    $('#debriefContent').innerHTML = `<div class="field-textarea" style="color:var(--text-dim);">Debrief unlocks once the operation is marked complete from the Pre-Ops Plan tab.</div>`;
    return;
  }
  const debrief = op.debrief || {};
  const fieldsHtml = DEBRIEF_FIELDS.map(f => `
    <div class="field-group"><label class="field-label">${f.label}</label>
      ${editable
        ? `<textarea class="field-textarea" data-debrief-field="${f.key}" placeholder="Not yet filled in...">${debrief[f.key]||''}</textarea>`
        : `<div class="field-textarea" style="color:var(--text-dim);">${debrief[f.key] || 'Not yet filled in'}</div>`}
    </div>`).join('');
  const analyzerBtn = editable ? `<button class="btn btn-outline" id="runAnalyzerBtn">Run Debrief Analyzer</button>` : '';
  const analysisHtml = op.analysis ? renderAnalysisCard(op.analysis) : '';
  $('#debriefContent').innerHTML = fieldsHtml + analyzerBtn + `<div id="analysisSlot">${analysisHtml}</div>`;

  if(editable){
    $$('[data-debrief-field]').forEach(ta => ta.addEventListener('blur', async () => {
      const newDebrief = { ...op.debrief, [ta.dataset.debriefField]: ta.value };
      await supabaseClient.from('operations').update({ debrief: newDebrief }).eq('id', currentOpId);
      op.debrief = newDebrief;
    }));
    const btn = $('#runAnalyzerBtn');
    if(btn) btn.addEventListener('click', async () => {
      const analysis = analyzeDebrief(op);
      await supabaseClient.from('operations').update({ analysis }).eq('id', currentOpId);
      op.analysis = analysis;
      $('#analysisSlot').innerHTML = renderAnalysisCard(analysis);
    });
  }
}
function renderAnalysisCard(analysis){
  return `<div class="analysis-card">
    <div style="font-weight:700; margin-bottom:10px; color:var(--olive-bright);">Debrief Analysis</div>
    <div class="analysis-flags">${analysis.flags.map(f=>`<div class="analysis-flag"><span class="pill ${f.level}"><span class="pill-dot"></span></span>${f.text}</div>`).join('')}</div>
    <div class="analysis-summary">${analysis.summary}</div>
  </div>`;
}
function analyzeDebrief(op){
  const d = op.debrief || {};
  const flags = [];
  const injuryText = (d.injuries||'').toLowerCase().trim();
  if(!injuryText || /^(none|n\/a|no injuries?)\.?$/.test(injuryText)) flags.push({ level:'good', text:'No injuries reported.' });
  else flags.push({ level:'bad', text:'Injury reported — flagged for command review.' });
  const equipText = (d.equipmentIssues||'').toLowerCase();
  if(/fail|malfunction|broken|jam|stiff|inoperable/.test(equipText)) flags.push({ level:'warn', text:'Equipment issue noted — recommend maintenance follow-up.' });
  else flags.push({ level:'good', text:'No equipment issues reported.' });
  if(op.response_minutes != null){
    if(op.response_minutes > 25) flags.push({ level:'warn', text:`Response time (${op.response_minutes} min) above the 25-min target.` });
    else flags.push({ level:'good', text:`Response time (${op.response_minutes} min) within target.` });
  }
  if((d.lessonsLearned||'').trim()) flags.push({ level:'warn', text:'Lessons-learned item logged — review for SOP update.' });
  const summary = [d.outcome || 'Outcome not yet documented.', (d.lessonsLearned||'').trim() ? `Key takeaway: ${d.lessonsLearned}` : ''].filter(Boolean).join(' ');
  return { flags, summary };
}
async function printOpReport(op, operators){
  const w = window.open('', '_blank'); // open synchronously first — avoids the same popup-blocker issue fixed earlier for Signal group sends
  const { data: photos } = await supabaseClient.from('operation_photos').select('*').eq('operation_id', op.id).order('created_at');
  const photosWithUrls = await Promise.all((photos||[]).map(async p => {
    const { data, error } = await supabaseClient.storage.from('operation-maps').createSignedUrl(p.storage_path, 3600);
    if(error){ console.error('Print report: could not get signed URL for photo', { path: p.storage_path, error }); return { ...p, url: '' }; }
    return { ...p, url: data.signedUrl };
  })).then(list => list.filter(p => p.url));
  const photosHtml = photosWithUrls.length > 0
    ? `<h3>Target Location Photos</h3><div style="display:flex; gap:10px; flex-wrap:wrap;">${photosWithUrls.map(p => `<a href="${p.url}" target="_blank"><img src="${p.url}" style="width:160px; height:160px; object-fit:cover; border-radius:4px; cursor:pointer;"></a>`).join('')}</div>`
    : '';

  const rosterLines = operators.map(o => { const m = memberById(o.member_id); return m ? `<div>${m.name} — ${m.team_role||''}</div>` : ''; }).join('');
  const commander = op.incident_commander_personnel_id ? memberById(op.incident_commander_personnel_id) : null;
  w.document.write(`
    <html><head><title>${op.name}</title><style>@media print{.no-print{display:none!important;}}</style></head>
    <body style="font-family:sans-serif; padding:40px; color:#111;">
      <button class="no-print" onclick="window.close()" style="position:fixed; top:16px; right:16px; padding:10px 18px; background:#0c0e0c; color:#e8e6df; border:none; border-radius:6px; font-size:14px; font-weight:600; cursor:pointer; z-index:10;">✕ Close & Return to OpsTac</button>
      ${window._agencyPatchUrl ? `<img src="${window._agencyPatchUrl}" style="height:64px; margin-bottom:12px;">` : ''}
      <h1>${op.name}</h1>
      <p>${op.type||''} · ${op.status} · ${op.date||''} · ${op.location||''}</p>
      ${currentAgency && currentAgency.name ? `<p><strong>${currentAgency.name}</strong></p>` : ''}
      ${commander ? `<p><strong>Overall Command:</strong> ${commander.name}</p>` : ''}
      <h3>Operators</h3>${rosterLines || '<p>None assigned.</p>'}
      ${photosHtml}
      <h3>Pre-Ops Plan</h3>
      ${PLAN_FIELDS.map(f => `<p><strong>${f.label}:</strong> ${(op.plan||{})[f.key] || '—'}</p>`).join('')}
      ${op.status==='complete' ? `<h3>Debrief</h3>${DEBRIEF_FIELDS.map(f => `<p><strong>${f.label}:</strong> ${(op.debrief||{})[f.key] || '—'}</p>`).join('')}` : ''}
    </body></html>
  `);
  w.document.close();
  // Printing immediately after document.write() is a long-documented browser
  // bug (calling print() before the new content has actually finished
  // rendering captures a blank page instead). Waiting for the window's own
  // load event — which also correctly waits for any photos to finish
  // loading — is the standard fix.
  w.onload = () => { w.focus(); w.print(); };
}

async function exportOpPresentation(op, operators){
  const btn = $('#opPresentBtn');
  btn.disabled = true; btn.textContent = 'Generating...';

  try {
    const pres = new window.PptxGenJS();
    pres.layout = 'LAYOUT_16x9';
    const W = 10, MARGIN = 0.5;

    let slide = pres.addSlide();
    slide.background = { color: '0c0e0c' };
    if(window._agencyPatchUrl){
      try {
        const resp = await fetch(window._agencyPatchUrl);
        const blob = await resp.blob();
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        slide.addImage({ data: dataUrl, x: 4.25, y: 0.7, w: 1.5, h: 1.5 });
      } catch(e){}
    }
    slide.addText(op.name, { x: MARGIN, y: 2.4, w: W-MARGIN*2, h: 1, fontSize: 32, bold: true, color: 'e8e6df', align: 'center' });
    slide.addText(`${op.type||''}  ·  ${op.date||''}  ·  ${op.location||''}`, { x: MARGIN, y: 3.4, w: W-MARGIN*2, h: 0.5, fontSize: 14, color: 'a89968', align: 'center' });

    const mapShot = await snapshotDashMap(op);
    if(mapShot){
      const ms = pres.addSlide();
      ms.background = { color: '0c0e0c' };
      ms.addText('Map', { x: MARGIN, y: 0.2, fontSize: 22, bold: true, color: 'c7b482' });
      ms.addText(op.location || '', { x: MARGIN, y: 0.52, fontSize: 12, color: 'a89968' });
      ms.addImage({ data: mapShot, x: 0.4, y: 0.78, w: 9.2, h: 4.4 });
    }

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
    operators.forEach(o => {
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
    btn.disabled = false; btn.textContent = 'Export Presentation';
  }
}

// ---------- Callouts ----------
async function loadCallouts(){
  $('#newCalloutBtn').style.display = canManageCallouts() ? 'inline-block' : 'none';
  $('#calloutsListWrap').innerHTML = `<div class="loading-state">Loading...</div>`;
  await loadCorePersonnel();
  const { data: callouts } = await supabaseClient.from('callouts').select('*, callout_recipients(*), operations(id, name)').order('created_at', { ascending:false });
  if(!callouts || callouts.length === 0){ $('#calloutsListWrap').innerHTML = `<div class="panel-empty">No callouts logged yet.</div>`; return; }

  $('#calloutsListWrap').innerHTML = callouts.map(c => {
    const total = (c.callout_recipients||[]).length;
    const acked = (c.callout_recipients||[]).filter(r => r.ack === 'acknowledged').length;
    const modeCls = c.mode === 'deploy' ? 'bad' : 'warn';
    const linkedOpTag = c.operations
      ? `<span class="pill neutral" data-jump-op="${c.operations.id}" style="cursor:pointer; margin-top:6px; display:inline-block;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px; margin-right:3px;"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3v2a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V3M8 11h8M8 15h5"/></svg>${c.operations.name}</span>`
      : '';
    const recipRows = (c.callout_recipients||[]).map(r => {
      const m = memberById(r.member_id);
      return `<div class="checklist-row" data-callout-id="${c.id}" data-member-id="${r.member_id}" style="cursor:${canManageCallouts()?'pointer':'default'};">
        <span>${m ? m.name : '—'}</span>
        <span class="pill ${r.ack==='acknowledged'?'good':'warn'}" style="margin-left:auto;"><span class="pill-dot"></span>${r.ack==='acknowledged'?'Acknowledged':'Pending'}</span>
      </div>`;
    }).join('');
    const editBtn = canManageCallouts() ? `<button class="btn btn-ghost" data-edit-callout="${c.id}" style="position:absolute; top:14px; right:18px; padding:5px 12px; font-size:11.5px;">Edit</button>` : '';
    const standBtn = canManageCallouts() && c.mode !== 'standdown' ? `<button class="btn btn-ghost" data-standdown="${c.id}" style="position:absolute; top:14px; right:78px; padding:5px 12px; font-size:11.5px;">Stand Down</button>` : '';
    return `<div class="list-row" style="cursor:default; position:relative;">
      <span class="pill ${modeCls}"><span class="pill-dot"></span>${c.mode==='deploy'?'Deploy':'Standby'}</span>
      ${standBtn}${editBtn}
      <div class="list-row-title">${c.type||'Callout'}</div>
      <div class="list-row-meta">${c.date||''} ${c.location?'· '+c.location:''}${mapsLinkHtml(c.location)} · ${acked}/${total} acknowledged</div>
      ${c.rally_location ? `<div class="list-row-meta" style="margin-top:2px;">Rally: ${c.rally_location}${mapsLinkHtml(c.rally_location)}</div>` : ''}
      ${!c.active ? `<span class="pill good" style="margin-top:6px; display:inline-block;">Resolved</span>` : ''}
      ${c.outcome ? `<div class="list-row-meta" style="margin-top:4px;">${c.outcome}</div>` : ''}
      ${linkedOpTag}
      <div style="margin-top:10px;">${recipRows}</div>
    </div>`;
  }).join('');

  $$('[data-standdown]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    if(!confirm('Stand down this callout and notify the team?')) return;
    await supabaseClient.from('callouts').update({ mode:'standdown', active:false, message:'SRT STAND DOWN. Return to normal status. Do not respond.' }).eq('id', btn.dataset.standdown);
    loadCallouts();
  }));
  $$('[data-edit-callout]').forEach(btn => btn.addEventListener('click', (e) => {
    e.stopPropagation();
    openEditCalloutModal(callouts.find(c => c.id === btn.dataset.editCallout));
  }));

  $$('[data-jump-op]').forEach(tag => tag.addEventListener('click', (e) => {
    e.stopPropagation();
    const opsNav = [...document.querySelectorAll('.nav-item')].find(n=>n.dataset.section==='operations');
    opsNav.dispatchEvent(new Event('click', {bubbles:true}));
    openOpDetail(tag.dataset.jumpOp);
  }));

  if(canManageCallouts()){
    $$('.checklist-row[data-callout-id]').forEach(row => row.addEventListener('click', async () => {
      const calloutId = row.dataset.calloutId, memberId = row.dataset.memberId;
      const { data: current } = await supabaseClient.from('callout_recipients').select('ack').eq('callout_id', calloutId).eq('member_id', memberId).single();
      const newAck = current && current.ack === 'acknowledged' ? 'pending' : 'acknowledged';
      await supabaseClient.from('callout_recipients').update({ ack: newAck }).eq('callout_id', calloutId).eq('member_id', memberId);
      loadCallouts();
    }));
  }
}

function openEditCalloutModal(callout){
  openModal('Edit Callout', `
    <div class="field-group"><label class="field-label">Type / Reason</label><input type="text" id="eCoType" value="${callout.type||''}"></div>
    <div class="field-group"><label class="field-label">Mode</label>
      <div class="choice-row" id="eCoModeRow">
        <div class="choice-btn ${callout.mode==='standby'?'selected':''}" data-mode="standby">Standby Only</div>
        <div class="choice-btn ${callout.mode==='deploy'?'selected':''}" data-mode="deploy">Deploy</div>
      </div>
    </div>
    <div class="field-group"><label class="field-label">Location</label><input type="text" id="eCoLocation" value="${callout.location||''}"></div>
    <div class="field-group"><label class="field-label">Rally Location</label><input type="text" id="eCoRally" value="${callout.rally_location||''}"></div>
    <div class="field-group">
      <label class="field-label">Rally Point Map (optional)</label>
      <input type="file" accept="image/*" id="eCoRallyMapInput" style="display:none;">
      <div class="map-canvas ${callout.rally_map_image_url?'has-image':''}" id="eCoRallyMapCanvas" style="${callout.rally_map_image_url && callout.rally_map_ratio ? `aspect-ratio:${callout.rally_map_ratio};`:''}">
        <div class="map-upload-prompt" id="eCoRallyMapPrompt" style="${callout.rally_map_image_url?'display:none;':''}">Tap to upload a map or photo, then tap it again to mark the rally point.</div>
        <img id="eCoRallyMapImg" style="${callout.rally_map_image_url?'display:block;':'display:none;'}">
      </div>
    </div>
    <div class="field-group"><label class="field-label">Message</label><textarea class="field-textarea" id="eCoMessage">${callout.message||''}</textarea></div>
    <div class="settings-row" style="padding:10px 0;">
      <div><div class="settings-label">Active</div><div class="settings-sub">Turn off once this callout is resolved</div></div>
      <div class="toggle-switch ${callout.active?'on':''}" id="eCoActive"></div>
    </div>
    <div class="field-group"><label class="field-label">Outcome</label><textarea class="field-textarea" id="eCoOutcome" placeholder="What happened / how it was resolved...">${callout.outcome||''}</textarea></div>
    <div class="settings-row" style="border-top:1px solid var(--line); padding-top:16px;">
      <div><div class="settings-label">Delete Callout</div><div class="settings-sub">Removes it and its acknowledgment history permanently.</div></div>
      <button class="btn btn-danger-outline" id="eCoDelete" type="button">Delete</button>
    </div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Save Changes</button></div>
  `);
  let eCoMode = callout.mode;
  let eCoActiveVal = !!callout.active;
  let rallyMapPath = callout.rally_map_image_url || null;
  let rallyMapRatio = callout.rally_map_ratio || null;
  let rallyPinX = callout.rally_pin_x != null ? callout.rally_pin_x : null;
  let rallyPinY = callout.rally_pin_y != null ? callout.rally_pin_y : null;

  if(rallyMapPath){
    supabaseClient.storage.from('operation-maps').createSignedUrl(rallyMapPath, 3600).then(({data, error}) => {
      if(error){ console.error('Edit callout rally map: could not get signed URL', { path: rallyMapPath, error }); return; }
      $('#eCoRallyMapImg').src = data.signedUrl;
    });
    if(rallyPinX != null && rallyPinY != null){
      const pin = document.createElement('div');
      pin.className = 'map-pin rally-pin-marker';
      pin.style.left = rallyPinX + '%'; pin.style.top = rallyPinY + '%';
      pin.textContent = 'R';
      $('#eCoRallyMapCanvas').appendChild(pin);
    }
  }
  $('#eCoRallyMapPrompt').addEventListener('click', () => $('#eCoRallyMapInput').click());
  $('#eCoRallyMapInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const path = `${currentProfile.agency_id}/callouts/${callout.id}/${Date.now()}-${file.name}`;
    const { error } = await supabaseClient.storage.from('operation-maps').upload(path, file, { upsert:true });
    if(error){ alert('Upload failed: ' + error.message); return; }
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (ev) => {
      img.onload = () => {
        rallyMapPath = path;
        rallyMapRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        $('#eCoRallyMapCanvas').classList.add('has-image');
        $('#eCoRallyMapCanvas').style.aspectRatio = rallyMapRatio;
        $('#eCoRallyMapImg').src = ev.target.result;
        $('#eCoRallyMapImg').style.display = 'block';
        $('#eCoRallyMapPrompt').style.display = 'none';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  $('#eCoRallyMapCanvas').addEventListener('click', (e) => {
    if(!rallyMapPath || e.target.closest('#eCoRallyMapPrompt')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    rallyPinX = Math.max(3, Math.min(97, x));
    rallyPinY = Math.max(3, Math.min(97, y));
    $$('#eCoRallyMapCanvas .rally-pin-marker').forEach(p => p.remove());
    const pin = document.createElement('div');
    pin.className = 'map-pin rally-pin-marker';
    pin.style.left = rallyPinX + '%'; pin.style.top = rallyPinY + '%';
    pin.textContent = 'R';
    $('#eCoRallyMapCanvas').appendChild(pin);
  });

  $$('#eCoModeRow .choice-btn').forEach(btn => btn.addEventListener('click', () => {
    eCoMode = btn.dataset.mode;
    $$('#eCoModeRow .choice-btn').forEach(b => b.classList.toggle('selected', b===btn));
  }));
  $('#eCoActive').addEventListener('click', () => {
    eCoActiveVal = !eCoActiveVal;
    $('#eCoActive').classList.toggle('on', eCoActiveVal);
  });
  $('#eCoDelete').addEventListener('click', async () => {
    if(!confirm(`Delete this ${callout.type||'callout'}? This can't be undone.`)) return;
    await supabaseClient.from('callouts').delete().eq('id', callout.id);
    closeModal();
    loadCallouts();
  });
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', async () => {
    await supabaseClient.from('callouts').update({
      type: $('#eCoType').value.trim() || null,
      mode: eCoMode,
      location: $('#eCoLocation').value.trim() || null,
      rally_location: $('#eCoRally').value.trim() || null,
      message: $('#eCoMessage').value.trim(),
      active: eCoActiveVal,
      outcome: $('#eCoOutcome').value.trim() || null,
      rally_map_image_url: rallyMapPath, rally_map_ratio: rallyMapRatio,
      rally_pin_x: rallyPinX, rally_pin_y: rallyPinY,
    }).eq('id', callout.id);
    closeModal();
    loadCallouts();
  });
}

$('#newCalloutBtn').addEventListener('click', () => openNewCalloutModal(null));

async function openNewCalloutModal(lockedOp){
  await loadCorePersonnel();
  let mode = null;
  let linkedOperationId = lockedOp ? lockedOp.id : '';
  const selected = new Set(allPersonnel.filter(p => p.on_call).map(p => p.id));
  let rallyMapPath = null, rallyMapRatio = null, rallyPinX = null, rallyPinY = null;
  const rallyMapId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2);

  let opLinkHtml;
  if(lockedOp){
    opLinkHtml = `<div class="field-group"><label class="field-label">Linked Operation</label>
      <div class="field-static" style="color:var(--olive-bright);">${lockedOp.name}</div></div>`;
  } else {
    const { data: ops } = await supabaseClient.from('operations').select('id, name, status').order('date', { ascending:false });
    const opOptions = (ops||[]).map(o => `<option value="${o.id}">${o.name} (${o.status==='complete'?'Complete':'Planning'})</option>`).join('');
    opLinkHtml = `<div class="field-group"><label class="field-label">Link to Operation (optional)</label>
      <select id="mCoOperation">
        <option value="">— None —</option>
        ${opOptions}
        <option value="__new__">+ Create New Operation</option>
      </select>
    </div>
    <div class="field-group" id="mCoNewOpNameGroup" style="display:none;">
      <label class="field-label">New Operation Name</label>
      <input type="text" id="mCoNewOpName" placeholder="e.g. Warrant Service — Maple St.">
    </div>`;
  }

  openModal('New Callout', `
    <div class="field-group"><label class="field-label">Type / Reason</label><input type="text" id="mCoType"></div>
    ${opLinkHtml}
    <div class="field-group"><label class="field-label">Mode</label>
      <div class="choice-row" id="mCoModeRow">
        <div class="choice-btn" data-mode="standby">Standby Only</div>
        <div class="choice-btn" data-mode="deploy">Deploy</div>
      </div>
    </div>
    <div class="field-group"><label class="field-label">Location</label><input type="text" id="mCoLocation"></div>
    <div class="field-group"><label class="field-label">Rally Location</label><input type="text" id="mCoRally"></div>
    <div class="field-group">
      <label class="field-label">Rally Point Map (optional)</label>
      <input type="file" accept="image/*" id="mCoRallyMapInput" style="display:none;">
      <div class="map-canvas" id="mCoRallyMapCanvas">
        <div class="map-upload-prompt" id="mCoRallyMapPrompt">Tap to upload a map or photo, then tap it again to mark the rally point.</div>
        <img id="mCoRallyMapImg" style="display:none;">
      </div>
    </div>
    <div class="field-group"><label class="field-label">Message</label><textarea class="field-textarea" id="mCoMessage">SRT ACTIVATION. Report to staging ASAP. Await further instructions.</textarea></div>
    <div class="field-group"><label class="field-label">Select Team</label><div id="mCoRoster"></div></div>
    <div class="modal-actions"><button class="btn btn-ghost" id="mCancel">Cancel</button><button class="btn btn-primary" id="mSave">Log Callout</button></div>
  `);

  if(!lockedOp){
    $('#mCoOperation').addEventListener('change', () => {
      $('#mCoNewOpNameGroup').style.display = $('#mCoOperation').value === '__new__' ? 'block' : 'none';
    });
  }

  $('#mCoRoster').innerHTML = allPersonnel.map(p => `
    <div class="checklist-row" data-id="${p.id}"><div class="checkbox ${selected.has(p.id)?'checked':''}">${selected.has(p.id)?'✓':''}</div><span>${p.name}</span></div>
  `).join('');
  $$('#mCoRoster .checklist-row').forEach(row => row.addEventListener('click', () => {
    const id = row.dataset.id;
    if(selected.has(id)){ selected.delete(id); row.querySelector('.checkbox').classList.remove('checked'); row.querySelector('.checkbox').textContent=''; }
    else { selected.add(id); row.querySelector('.checkbox').classList.add('checked'); row.querySelector('.checkbox').textContent='✓'; }
  }));
  $$('#mCoModeRow .choice-btn').forEach(btn => btn.addEventListener('click', () => {
    mode = btn.dataset.mode;
    $$('#mCoModeRow .choice-btn').forEach(b => b.classList.toggle('selected', b===btn));
  }));

  $('#mCoRallyMapPrompt').addEventListener('click', () => $('#mCoRallyMapInput').click());
  $('#mCoRallyMapInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if(!file) return;
    const path = `${currentProfile.agency_id}/callouts/${rallyMapId}/${Date.now()}-${file.name}`;
    const { error } = await supabaseClient.storage.from('operation-maps').upload(path, file, { upsert:true });
    if(error){ alert('Upload failed: ' + error.message); return; }
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (ev) => {
      img.onload = () => {
        rallyMapPath = path;
        rallyMapRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        $('#mCoRallyMapCanvas').classList.add('has-image');
        $('#mCoRallyMapCanvas').style.aspectRatio = rallyMapRatio;
        $('#mCoRallyMapImg').src = ev.target.result;
        $('#mCoRallyMapImg').style.display = 'block';
        $('#mCoRallyMapPrompt').style.display = 'none';
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
  $('#mCoRallyMapCanvas').addEventListener('click', (e) => {
    if(!rallyMapPath || e.target.closest('#mCoRallyMapPrompt')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
    rallyPinX = Math.max(3, Math.min(97, x));
    rallyPinY = Math.max(3, Math.min(97, y));
    $$('.rally-pin-marker').forEach(p => p.remove());
    const pin = document.createElement('div');
    pin.className = 'map-pin rally-pin-marker';
    pin.style.left = rallyPinX + '%'; pin.style.top = rallyPinY + '%';
    pin.textContent = 'R';
    $('#mCoRallyMapCanvas').appendChild(pin);
  });
  $('#mCancel').addEventListener('click', closeModal);
  $('#mSave').addEventListener('click', async () => {
    if(selected.size === 0){ alert('Select at least one team member.'); return; }
    if(!mode){ alert('Select Standby Only or Deploy.'); return; }

    let opId = linkedOperationId;
    if(!lockedOp){
      const picked = $('#mCoOperation').value;
      if(picked === '__new__'){
        const newName = $('#mCoNewOpName').value.trim();
        if(!newName){ alert('Enter a name for the new operation.'); return; }
        const { data: newOp } = await supabaseClient.from('operations').insert({
          agency_id: currentProfile.agency_id, name: newName, status:'planning', plan:{},
          location: $('#mCoLocation').value.trim() || null,
        }).select().single();
        opId = newOp ? newOp.id : null;
      } else {
        opId = picked || null;
      }
    }

    const { data: callout } = await supabaseClient.from('callouts').insert({
      agency_id: currentProfile.agency_id,
      type: $('#mCoType').value.trim() || 'SRT Activation',
      location: $('#mCoLocation').value.trim() || null,
      rally_location: $('#mCoRally').value.trim() || null,
      mode, method: 'logged', message: $('#mCoMessage').value.trim(), active: true,
      operation_id: opId || null,
      rally_map_image_url: rallyMapPath, rally_map_ratio: rallyMapRatio,
      rally_pin_x: rallyPinX, rally_pin_y: rallyPinY,
    }).select().single();
    if(callout){
      await supabaseClient.from('callout_recipients').insert([...selected].map(memberId => ({ callout_id: callout.id, member_id: memberId, ack:'pending' })));
    }
    closeModal();
    loadCallouts();
  });
}

// ---------- Settings ----------
async function loadSettings(){
  const [{ data: settings }, { data: agency }, { data: mfaData }] = await Promise.all([
    supabaseClient.from('agency_settings').select('*').eq('agency_id', currentProfile.agency_id).single(),
    supabaseClient.from('agencies').select('name, agency_code').eq('id', currentProfile.agency_id).single(),
    supabaseClient.auth.mfa.listFactors(),
  ]);
  currentSettings = settings;
  const isCommander = currentProfile.role === 'commander';
  const totpFactor = mfaData ? (mfaData.totp || []).find(f => f.status === 'verified') : null;

  $('#settingsWrap').innerHTML = `
    <div class="settings-group">
      <div class="settings-group-title">Agency Code</div>
      <div style="font-size:12.5px; color:var(--text-dim); line-height:1.6; margin-bottom:12px;">
        Agency names aren't unique — share this code with anyone you're about to add, so there's never
        doubt about which agency they're joining.
      </div>
      <div class="mono" style="font-size:22px; font-weight:700; letter-spacing:3px; color:var(--olive-bright); background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:14px 18px; display:inline-block;">${agency ? agency.agency_code : '—'}</div>
    </div>
    <div class="settings-group">
      <div class="settings-group-title">Change Password</div>
      <div class="error-box" id="changePasswordError" style="display:none;"></div>
      <div class="error-box" id="changePasswordSuccess" style="display:none; background:rgba(122,168,116,0.12); border-color:var(--good); color:var(--good);"></div>
      <div class="field-group"><label class="field-label">New Password</label><input type="password" id="newPasswordField"></div>
      <div class="field-group"><label class="field-label">Confirm New Password</label><input type="password" id="confirmPasswordField"></div>
      <button class="btn btn-primary" id="changePasswordBtn">Update Password</button>
    </div>
    <div class="settings-group">
      <div class="settings-group-title">Two-Factor Authentication</div>
      <div id="twoFactorStatus">
        ${totpFactor ? `
          <div style="font-size:12.5px; color:var(--good); margin-bottom:12px;">✓ Two-factor authentication is enabled.</div>
          <button class="btn btn-danger-outline" id="disable2faBtn">Disable Two-Factor Authentication</button>
        ` : `
          <div style="font-size:12.5px; color:var(--text-dim); line-height:1.6; margin-bottom:12px;">
            Add an extra layer of security — after your password, you'll also need a code from an authenticator app (like Google Authenticator or Authy) to sign in.
          </div>
          <button class="btn btn-primary" id="enable2faBtn">Enable Two-Factor Authentication</button>
        `}
      </div>
      <div id="twoFactorEnrollFlow" style="display:none; margin-top:16px;">
        <div style="font-size:12.5px; color:var(--text-dim); margin-bottom:12px;">Scan this QR code with your authenticator app, then enter the 6-digit code it generates.</div>
        <div id="totpQrCode" style="text-align:center; margin-bottom:14px;"></div>
        <div style="font-size:11px; color:var(--text-dim); text-align:center; margin-bottom:14px; word-break:break-all;" id="totpManualSecret"></div>
        <div class="error-box" id="totpVerifyError" style="display:none;"></div>
        <div class="field-group"><label class="field-label">6-Digit Code</label><input type="text" id="totpVerifyCode" maxlength="6" inputmode="numeric" style="text-align:center; font-size:20px; letter-spacing:4px;"></div>
        <button class="btn btn-primary" id="totpVerifyBtn" style="width:100%;">Verify & Enable</button>
        <button class="btn btn-ghost" id="totpCancelBtn" style="width:100%; margin-top:8px;">Cancel</button>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-group-title">Team Leader Permissions</div>
      <div class="settings-row"><div><div class="settings-label">Edit Operations</div><div class="settings-sub">Map placement, pre-ops plan, debrief</div></div><div class="toggle-switch ${settings.team_leader_edit_ops?'on':''}" data-perm="team_leader_edit_ops"></div></div>
      <div class="settings-row"><div><div class="settings-label">Initiate Callouts</div><div class="settings-sub">Send activations, track acknowledgments</div></div><div class="toggle-switch ${settings.team_leader_callouts?'on':''}" data-perm="team_leader_callouts"></div></div>
      <div class="settings-row"><div><div class="settings-label">Manage Records</div><div class="settings-sub">Log equipment, certs, training, roster</div></div><div class="toggle-switch ${settings.team_leader_manage_records?'on':''}" data-perm="team_leader_manage_records"></div></div>
    </div>
    <div class="settings-group">
      <div class="settings-group-title">Integrations</div>
      <div class="field-group"><label class="field-label">Signal Group Link</label><input type="text" id="settingsSignalLink" value="${settings.signal_group_link||''}" placeholder="https://signal.group/#..."></div>
      <button class="btn btn-primary" id="saveSignalBtn">Save</button>
    </div>
    <div class="settings-group">
      <div class="settings-group-title">Get the Mobile App</div>
      <div style="display:flex; gap:20px; align-items:center; flex-wrap:wrap;">
        <img src="app-qr.png" alt="QR code to install the OpsTac mobile app" style="width:120px; height:120px; border-radius:8px; flex-shrink:0;">
        <div style="flex:1; min-width:200px;">
          <div style="font-size:13px; color:var(--text-dim); line-height:1.6; margin-bottom:10px;">
            Scan with your phone's camera, then tap <strong style="color:var(--text);">Share → Add to Home Screen</strong> (iPhone) or <strong style="color:var(--text);">Install</strong> (Android) to add OpsTac to your home screen.
          </div>
          <div class="mono" style="font-size:12px; color:var(--olive-bright); background:var(--bg); border:1px solid var(--line); border-radius:6px; padding:8px 12px; display:inline-block;">opstac.net/app.html</div>
        </div>
      </div>
    </div>
    <div class="settings-group">
      <div class="settings-group-title">Appearance</div>
      <div class="swatch-row">
        <div class="swatch ${settings.accent_color==='#a89968'?'selected':''}" data-accent="#a89968" data-bright="#c7b482" style="background:#a89968;"></div>
        <div class="swatch ${settings.accent_color==='#b8564a'?'selected':''}" data-accent="#b8564a" data-bright="#d97a6c" style="background:#b8564a;"></div>
        <div class="swatch ${settings.accent_color==='#5a7fa6'?'selected':''}" data-accent="#5a7fa6" data-bright="#7ea3c9" style="background:#5a7fa6;"></div>
        <div class="swatch ${settings.accent_color==='#6b9a5f'?'selected':''}" data-accent="#6b9a5f" data-bright="#8fbf82" style="background:#6b9a5f;"></div>
      </div>
    </div>
  `;

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

  const enable2faBtn = $('#enable2faBtn');
  if(enable2faBtn) enable2faBtn.addEventListener('click', async () => {
    enable2faBtn.disabled = true; enable2faBtn.textContent = 'Preparing...';
    const { data, error } = await supabaseClient.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'OpsTac' });
    enable2faBtn.disabled = false; enable2faBtn.textContent = 'Enable Two-Factor Authentication';
    if(error){ alert('Could not start 2FA setup: ' + error.message); return; }
    pendingFactorId = data.id;
    $('#totpQrCode').innerHTML = `<img src="${data.totp.qr_code}" style="width:200px; height:200px; background:#fff; border-radius:6px; padding:8px;">`;
    $('#totpManualSecret').textContent = `Can't scan? Enter this code manually: ${data.totp.secret}`;
    $('#totpVerifyCode').value = '';
    $('#totpVerifyError').style.display = 'none';
    $('#twoFactorStatus').style.display = 'none';
    $('#twoFactorEnrollFlow').style.display = 'block';
  });

  $('#totpCancelBtn') && $('#totpCancelBtn').addEventListener('click', async () => {
    if(pendingFactorId){ await supabaseClient.auth.mfa.unenroll({ factorId: pendingFactorId }); }
    pendingFactorId = null;
    loadSettings();
  });

  $('#totpVerifyBtn') && $('#totpVerifyBtn').addEventListener('click', async () => {
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
    loadSettings();
  });

  $('#disable2faBtn') && $('#disable2faBtn').addEventListener('click', async () => {
    if(!confirm('Disable two-factor authentication? Your account will only require a password to sign in.')) return;
    const { data: factorsData } = await supabaseClient.auth.mfa.listFactors();
    const factor = (factorsData.totp || []).find(f => f.status === 'verified');
    if(factor){ await supabaseClient.auth.mfa.unenroll({ factorId: factor.id }); }
    loadSettings();
  });

  if(!isCommander){
    $$('.toggle-switch').forEach(t => { t.style.opacity = '0.5'; t.style.pointerEvents = 'none'; });
  } else {
    $$('.toggle-switch[data-perm]').forEach(t => t.addEventListener('click', async () => {
      const key = t.dataset.perm;
      const newVal = !t.classList.contains('on');
      t.classList.toggle('on', newVal);
      await supabaseClient.from('agency_settings').update({ [key]: newVal }).eq('agency_id', currentProfile.agency_id);
      currentSettings[key] = newVal;
    }));
  }
  $('#saveSignalBtn').addEventListener('click', async () => {
    const link = $('#settingsSignalLink').value.trim();
    await supabaseClient.from('agency_settings').update({ signal_group_link: link }).eq('agency_id', currentProfile.agency_id);
    currentSettings.signal_group_link = link;
  });
  $$('.swatch').forEach(sw => sw.addEventListener('click', async () => {
    $$('.swatch').forEach(s => s.classList.remove('selected'));
    sw.classList.add('selected');
    const accent = sw.dataset.accent, bright = sw.dataset.bright;
    applyTheme(accent, bright);
    await supabaseClient.from('agency_settings').update({ accent_color: accent, accent_bright: bright }).eq('agency_id', currentProfile.agency_id);
    currentSettings.accent_color = accent; currentSettings.accent_bright = bright;
  }));
}

// ---------- Invite acceptance (first login after being invited) ----------
// Supabase only fires PASSWORD_RECOVERY for genuine password-reset links —
// an invite link just fires a plain SIGNED_IN event, so without this check
// an invited user would land straight in the app having never set a
// password at all, with no way to log back in later. Capture the URL hash
// immediately at page load, before Supabase's client can clear it, so we
// can still tell "this was an invite" even after the async auth event fires.
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

checkExistingSession();



let dashLiveMap = null, dashLiveLayer = null;

async function geocodeAddress(q){
  if(!q) return null;
  try {
    const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(q), { headers: { 'Accept': 'application/json' } });
    const rows = await r.json();
    if(rows && rows[0]) return { lat: Number(rows[0].lat), lng: Number(rows[0].lon) };
  } catch(e){}
  return null;
}

function liveGlyph(shape, label){
  const s = '#e8e6df', a = '#b59a4d', r = '#c45c5c', b = '#7ec8e3', g = '#6b9a5f', y = '#e4c35a';
  if(shape === 'ems' || shape === 'medic'){
    return `<svg viewBox="0 0 32 32" width="28" height="28"><rect x="2" y="2" width="28" height="28" rx="3" fill="#1a1212" stroke="${r}" stroke-width="2"/><rect x="14" y="8" width="4" height="16" fill="${r}"/><rect x="8" y="14" width="16" height="4" fill="${r}"/></svg>`;
  }
  if(shape === 'vehicle'){
    return `<svg viewBox="0 0 32 32" width="28" height="28"><rect x="2" y="2" width="28" height="28" rx="3" fill="#141814" stroke="${a}" stroke-width="2"/><path d="M8 20 h16 l-3-8 h-10 z" fill="none" stroke="${a}" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="21" r="1.6" fill="${a}"/><circle cx="20" cy="21" r="1.6" fill="${a}"/></svg>`;
  }
  if(shape === 'lz'){
    return `<svg viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="13" fill="#0c1a1e" stroke="${b}" stroke-width="2"/><path d="M11 9 v14 M21 9 v14 M11 16 h10" stroke="${b}" stroke-width="2.4" fill="none" stroke-linecap="square"/></svg>`;
  }
  if(shape === 'command'){
    return `<svg viewBox="0 0 32 32" width="28" height="28"><rect x="2" y="2" width="28" height="28" rx="3" fill="#141814" stroke="${a}" stroke-width="2"/><path d="M16 7 v18 M16 7 l10 6 v5" fill="none" stroke="${a}" stroke-width="2"/><circle cx="16" cy="7" r="2" fill="${a}"/></svg>`;
  }
  if(shape === 'rally'){
    return `<svg viewBox="0 0 32 32" width="28" height="28"><rect x="2" y="2" width="28" height="28" rx="3" fill="#141814" stroke="${a}" stroke-width="2"/><path d="M16 24 V10 M16 10 l7 4 v4" fill="none" stroke="${a}" stroke-width="2"/><circle cx="16" cy="10" r="2" fill="${a}"/></svg>`;
  }
  if(shape === 'staging'){
    return `<svg viewBox="0 0 32 32" width="28" height="28"><rect x="2" y="2" width="28" height="28" rx="3" fill="#141814" stroke="${a}" stroke-width="2"/><rect x="8" y="8" width="16" height="16" fill="none" stroke="${a}" stroke-width="2" stroke-dasharray="3 2"/></svg>`;
  }
  if(shape === 'stack' || shape === 'entry'){
    return `<svg viewBox="0 0 32 32" width="28" height="28"><rect x="2" y="2" width="28" height="28" rx="3" fill="#141814" stroke="${y}" stroke-width="2"/><circle cx="16" cy="9" r="2.4" fill="${y}"/><circle cx="16" cy="16" r="2.4" fill="${y}"/><circle cx="16" cy="23" r="2.4" fill="${y}"/></svg>`;
  }
  if(shape === 'person'){
    const t = String(label||'?').slice(0,6);
    const size = t.length > 4 ? 7 : t.length > 2 ? 9 : 11;
    return `<svg viewBox="0 0 32 32" width="28" height="28"><circle cx="16" cy="16" r="13" fill="#141814" stroke="${y}" stroke-width="2"/><text x="16" y="20" text-anchor="middle" font-size="${size}" font-weight="800" fill="${y}" font-family="Inter,Rajdhani,sans-serif">${t}</text></svg>`;
  }
  return `<svg viewBox="0 0 32 32" width="24" height="24"><rect x="2" y="2" width="28" height="28" rx="3" fill="#141814" stroke="${a}" stroke-width="2"/></svg>`;
}
function liveIcon(label, color, rot, shape){
  const deg = Number(rot||0);
  return L.divIcon({
    className: 'live-map-icon',
    html: `<div style="transform:translate(-50%,-50%) rotate(${deg}deg);filter:drop-shadow(0 1px 2px rgba(0,0,0,.7));">${liveGlyph(shape, label)}</div>`,
    iconSize:[0,0], iconAnchor:[0,0]
  });
}

function dashIcon(label, color){
  const t = String(label||'').slice(0,10);
  return L.divIcon({
    className: 'dash-pin',
    html: `<div style="transform:translate(-50%,-50%);background:${color};color:#0c0e0c;font:700 11px Inter,sans-serif;padding:4px 7px;border-radius:4px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.5)">${t}</div>`,
    iconSize:[0,0], iconAnchor:[0,0]
  });
}
function colorFor(type){
  if(type==='ems'||type==='medic') return '#c45c5c';
  if(type==='lz') return '#7ec8e3';
  if(type==='vehicle') return '#8fbf88';
  if(type==='person') return '#e4c35a';
  return '#d4b86a';
}
async function saveDashMarkers(markers){
  currentOpCache.map_markers = markers;
  await supabaseClient.from('operations').update({ map_markers: markers }).eq('id', currentOpId);
}
async function saveDashStacks(stacks){
  currentOpCache.map_stacks = stacks;
  await supabaseClient.from('operations').update({ map_stacks: stacks }).eq('id', currentOpId);
}
function initDashLiveMap(op){
  currentOpCache = op;
  const el = document.getElementById('dashLiveMap');
  if(!el || !window.L) return;
  if(dashLiveMap){ try { dashLiveMap.remove(); } catch(e){} dashLiveMap = null; }
  dashLiveMap = L.map(el, { zoomControl:true, attributionControl:false });
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:19 }).addTo(dashLiveMap);
  dashLiveLayer = L.layerGroup().addTo(dashLiveMap);
  dashLiveMap.setView([36.208,-86.291], 17);
  rebuildDashMarkers(op);
  focusDashOp(op);
  dashLiveMap.on('click', onDashMapClick);
  const go = document.getElementById('dashMapGo');
  const inp = document.getElementById('dashMapAddress');
  if(go) go.onclick = () => focusDashOp({ ...currentOpCache, location: inp && inp.value });
  if(inp) inp.addEventListener('keydown', (e) => { if(e.key==='Enter') focusDashOp({ ...currentOpCache, location: inp.value }); });
  setTimeout(() => dashLiveMap.invalidateSize(), 200);
  const rot = document.getElementById('dashRotate');
  const deg = document.getElementById('dashRotateDeg');
  const rm = document.getElementById('dashRemovePin');
  if(rot) rot.oninput = async () => {
    if(deg) deg.textContent = rot.value + '°';
    if(!dashSelected || !currentOpCache) return;
    const val = Number(rot.value)||0;
    if(dashSelected.kind==='marker'){
      await saveDashMarkers((currentOpCache.map_markers||[]).map(m => String(m.id)===String(dashSelected.id) ? { ...m, rot:val } : m));
    } else if(dashSelected.kind==='stack'){
      await saveDashStacks((currentOpCache.map_stacks||[]).map(s => String(s.id)===String(dashSelected.id) ? { ...s, rot:val } : s));
    }
    rebuildDashMarkers(currentOpCache);
  };
  if(rm) rm.onclick = async () => {
    if(!dashSelected) return;
    if(dashSelected.kind==='marker') await saveDashMarkers((currentOpCache.map_markers||[]).filter(m => String(m.id)!==String(dashSelected.id)));
    if(dashSelected.kind==='stack') await saveDashStacks((currentOpCache.map_stacks||[]).filter(s => String(s.id)!==String(dashSelected.id)));
    if(dashSelected.kind==='pin'){
      await supabaseClient.from('operation_operators').delete().eq('operation_id', currentOpId).eq('member_id', dashSelected.id);
      const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
      currentOperatorsCache = refreshed || [];
    }
    dashSelected = null;
    rebuildDashMarkers(currentOpCache);
    renderMapPalette(currentOpCache, currentOperatorsCache, true);
  };

}
async function onDashMapClick(e){
  if(!canEditOps() || !currentOpCache) return;
  const { lat, lng } = e.latlng;
  if(pendingStack){
    const st = { ...pendingStack, lat, lng, id: pendingStack.id || Date.now().toString(36) };
    const rest = (currentOpCache.map_stacks||[]).filter(s => String(s.id)!==String(st.id));
    await saveDashStacks([...rest, st]);
    pendingStack = null;
    rebuildDashMarkers(currentOpCache);
    renderDashStacks(currentOpCache);
    renderMapPalette(currentOpCache, currentOperatorsCache, true);
    return;
  }
  if(dashPlaceMode){
    const markers = currentOpCache.map_markers || [];
    const meta = DASH_LOCS.find(l => l.type === dashPlaceMode) || { type: dashPlaceMode, label: dashPlaceMode };
    markers.push({ id: Date.now().toString(36), type: meta.type, label: meta.label, lat, lng });
    await saveDashMarkers(markers);
    dashPlaceMode = null;
    rebuildDashMarkers(currentOpCache);
    renderMapPalette(currentOpCache, currentOperatorsCache, true);


    return;
  }
  if(armedOperatorId){
    await supabaseClient.from('operation_operators').upsert({
      operation_id: currentOpId, member_id: armedOperatorId, lat, lng
    }, { onConflict: 'operation_id,member_id' });
    const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
    currentOperatorsCache = refreshed || [];
    armedOperatorId = null;
    rebuildDashMarkers(currentOpCache);
    renderMapPalette(currentOpCache, currentOperatorsCache, true);


  }
}
async function focusDashOp(op){
  if(!dashLiveMap) return;
  const pts = [].concat(op.map_markers||[], op.map_stacks||[], currentOperatorsCache||[]).filter(x => x && x.lat != null);
  if(pts.length){ dashLiveMap.setView([pts[0].lat, pts[0].lng], 18); return; }
  const hit = await geocodeAddress(op.location || (document.getElementById('dashMapAddress')||{}).value || '');
  if(hit) dashLiveMap.setView([hit.lat, hit.lng], 18);
}
function rebuildDashMarkers(op){
  if(!dashLiveLayer) return;
  dashLiveLayer.clearLayers();
  const editable = canEditOps();
  (op.map_markers||[]).forEach(mk => {
    if(mk.lat == null) return;
    const m = L.marker([mk.lat, mk.lng], { icon: liveIcon(mk.label||mk.type, colorFor(mk.type), mk.rot, mk.type==='medic'?'ems':mk.type), draggable: editable });
    m.on('click', () => { dashSelected = { kind:'marker', id: mk.id }; const r=document.getElementById('dashRotate'); if(r){ r.value=String(mk.rot||0); document.getElementById('dashRotateDeg').textContent=(mk.rot||0)+'°'; } });
    m.bindPopup(`${mk.label||mk.type}<br><button type="button" class="btn btn-danger-outline" data-rm-marker="${mk.id}" style="margin-top:6px; font-size:11px;">Remove</button>`);
    m.on('popupopen', () => {
      const btn = document.querySelector('[data-rm-marker="'+mk.id+'"]');
      if(btn) btn.onclick = async () => {
        await saveDashMarkers((currentOpCache.map_markers||[]).filter(x => String(x.id)!==String(mk.id)));
        rebuildDashMarkers(currentOpCache);
      };
    });
    if(editable) m.on('dragend', async () => {
      const p = m.getLatLng();
      await saveDashMarkers((currentOpCache.map_markers||[]).map(x => String(x.id)===String(mk.id) ? { ...x, lat:p.lat, lng:p.lng } : x));
    });
    m.addTo(dashLiveLayer);
  });
  (op.map_stacks||[]).forEach(st => {
    if(st.lat == null) return;
    const m = L.marker([st.lat, st.lng], { icon: liveIcon(st.name||'Entry', '#e4c35a', st.rot, 'stack'), draggable: editable });
    m.bindPopup(`${st.name||'Stack'}<br><button type="button" class="btn btn-danger-outline" data-rm-stack="${st.id}" style="margin-top:6px; font-size:11px;">Remove</button>`);
    m.on('popupopen', () => {
      const btn = document.querySelector('[data-rm-stack="'+st.id+'"]');
      if(btn) btn.onclick = async () => {
        await saveDashStacks((currentOpCache.map_stacks||[]).filter(x => String(x.id)!==String(st.id)));
        rebuildDashMarkers(currentOpCache);
      };
    });
    if(editable) m.on('dragend', async () => {
      const p = m.getLatLng();
      await saveDashStacks((currentOpCache.map_stacks||[]).map(x => String(x.id)===String(st.id) ? { ...x, lat:p.lat, lng:p.lng } : x));
    });
    m.addTo(dashLiveLayer);
  });
  (currentOperatorsCache||[]).forEach(o => {
    if(o.lat == null) return;
    const person = memberById(o.member_id);
    const m = L.marker([o.lat, o.lng], { icon: liveIcon(operatorUnitLabel(person), '#e4c35a', o.rot, 'person'), draggable: editable });
    const name = person ? person.name : 'Operator';
    m.bindPopup(`${name}<br><button type="button" class="btn btn-danger-outline" data-rm-pin="${o.member_id}" style="margin-top:6px; font-size:11px;">Remove</button>`);
    m.on('popupopen', () => {
      const btn = document.querySelector('[data-rm-pin="'+o.member_id+'"]');
      if(btn) btn.onclick = async () => {
        await supabaseClient.from('operation_operators').delete().eq('operation_id', currentOpId).eq('member_id', o.member_id);
        const { data: refreshed } = await supabaseClient.from('operation_operators').select('*').eq('operation_id', currentOpId);
        currentOperatorsCache = refreshed || [];
        rebuildDashMarkers(currentOpCache);
        renderMapPalette(currentOpCache, currentOperatorsCache, editable);
      };
    });
    if(editable) m.on('dragend', async () => {
      const p = m.getLatLng();
      await supabaseClient.from('operation_operators').update({ lat:p.lat, lng:p.lng }).eq('operation_id', currentOpId).eq('member_id', o.member_id);
    });
    m.addTo(dashLiveLayer);
  });
}

function renderDashOpsLog(op){
  const el = document.getElementById('dashOpsLog');
  if(!el) return;
  const log = op.ops_log || [];
  el.innerHTML = `
    <div style="display:flex; gap:8px; margin-bottom:12px;">
      <input type="text" class="field-input" id="dashLogInput" placeholder="Add a log note...">
      <button type="button" class="btn btn-primary" id="dashLogAdd">Add</button>
    </div>
    ${log.length ? log.slice().reverse().map(e => `<div class="list-row"><div class="list-row-title">${e.tag||'Note'}</div><div class="list-row-meta">${e.text||''}</div></div>`).join('') : '<div class="empty-state">No log entries yet.</div>'}
  `;
  const add = async () => {
    const input = document.getElementById('dashLogInput');
    const text = (input && input.value || '').trim();
    if(!text) return;
    const entry = { id: Date.now().toString(36), tag:'Note', text, ts: new Date().toISOString() };
    const next = [...(currentOpCache.ops_log||[]), entry];
    currentOpCache.ops_log = next;
    await supabaseClient.from('operations').update({ ops_log: next }).eq('id', currentOpId);
    renderDashOpsLog(currentOpCache);
  };
  document.getElementById('dashLogAdd').onclick = add;
}


async function snapshotDashMap(op){
  const pts = [].concat(op.map_markers||[], op.map_stacks||[], currentOperatorsCache||[]).filter(x => x && x.lat != null);
  let lat, lng;
  if(pts.length){ lat = Number(pts[0].lat); lng = Number(pts[0].lng); }
  else {
    const hit = await geocodeAddress(op.location || '');
    if(hit){ lat = hit.lat; lng = hit.lng; }
  }
  if(lat == null) return '';
  const d = 0.0035;
  const bbox = [lng-d, lat-d, lng+d, lat+d].join(',');
  const url = 'https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export?bbox=' + encodeURIComponent(bbox) + '&bboxSR=4326&imageSR=4326&size=1600,900&format=jpg&f=image';
  const canvas = document.createElement('canvas');
  canvas.width = 1600; canvas.height = 900;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0b100d'; ctx.fillRect(0,0,1600,900);
  try {
    const resp = await fetch(url);
    if(resp.ok){
      const blob = await resp.blob();
      const src = URL.createObjectURL(blob);
      await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { ctx.drawImage(img,0,0,1600,900); URL.revokeObjectURL(src); resolve(); };
        img.onerror = reject; img.src = src;
      });
    }
  } catch(e){}
  function xy(p){
    return { x: ((p.lng-(lng-d))/(2*d))*1600, y: (((lat+d)-p.lat)/(2*d))*900 };
  }
  function stamp(p, label, color){
    const t = String(label||'').slice(0,12);
    ctx.font = 'bold 18px Inter,sans-serif';
    const w = Math.max(50, ctx.measureText(t).width + 18);
    ctx.fillStyle = color;
    ctx.fillRect(p.x-w/2, p.y-14, w, 28);
    ctx.fillStyle = '#0c0e0c';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t, p.x, p.y);
  }
  (op.map_markers||[]).forEach(mk => { if(mk.lat!=null) stamp(xy(mk), mk.label||mk.type, colorFor(mk.type)); });
  (op.map_stacks||[]).forEach(st => { if(st.lat!=null) stamp(xy(st), st.name||'Entry', '#e4c35a'); });
  (currentOperatorsCache||[]).forEach(o => {
    if(o.lat==null) return;
    stamp(xy(o), operatorUnitLabel(memberById(o.member_id)), '#e4c35a');
  });
  return canvas.toDataURL('image/jpeg', 0.88);
}

function renderDashStacks(op){
  const el = document.getElementById('dashStackEditor');
  if(!el) return;
  const stacks = op.map_stacks || [];
  const peopleOpts = allPersonnel.map(p => `<option value="${p.id}">${operatorUnitLabel(p)} · ${p.name}</option>`).join('');
  const cards = stacks.map(st => {
    const members = st.members || [];
    const rows = members.map((m,i) => {
      const person = memberById(m.member_id);
      return `<div style="display:flex; gap:8px; align-items:center; padding:4px 0;">
        <span class="list-row-meta" style="width:18px;">${i+1}</span>
        <span>${person ? person.name : 'Unknown'}</span>
        <button type="button" class="btn btn-ghost" data-st="${st.id}" data-rm="${i}" style="margin-left:auto; font-size:11px;">×</button>
      </div>`;
    }).join('') || '<div class="list-row-meta">No one assigned yet.</div>';
    const placed = st.lat != null;
    return `<div class="list-row" style="cursor:default;">
      <div style="display:flex; gap:8px; align-items:center;">
        <input class="field-input" data-st-name="${st.id}" value="${String(st.name||'Stack').replace(/"/g,'&quot;')}" style="max-width:220px; font-weight:600;">
        <span class="pill ${placed?'good':'warn'}"><span class="pill-dot"></span>${placed?'On map':'Not placed'}</span>
        <button type="button" class="btn btn-outline" data-st-place="${st.id}" style="font-size:12px;">${placed?'Move on map':'Place on map'}</button>
        <button type="button" class="btn btn-danger-outline" data-st-del="${st.id}" style="font-size:12px;">Delete</button>
      </div>
      ${rows}
      <div style="display:flex; gap:8px; margin-top:8px;">
        <select class="field-input" data-st-addsel="${st.id}" style="max-width:260px;"><option value="">Add operator in order…</option>${peopleOpts}</select>
        <button type="button" class="btn btn-primary" data-st-add="${st.id}" style="font-size:12px;">Add</button>
      </div>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="page-title" style="font-size:16px; margin:8px 0;">Entry stacks</div>
    <div class="list-row-meta" style="margin-bottom:8px;">Build the lineup here, then Place on map. Same stack mark as the phone.</div>
    ${cards}
    <div style="display:flex; gap:8px; margin-top:10px;">
      <input class="field-input" id="newStackName" placeholder="Stack name (Entry 1, Bravo…)" style="max-width:240px;">
      <button type="button" class="btn btn-primary" id="newStackBtn">New stack</button>
    </div>`;
  const mk = document.getElementById('newStackBtn');
  if(mk) mk.onclick = async () => {
    const name = (document.getElementById('newStackName').value || '').trim() || ('Entry ' + (stacks.length+1));
    await saveDashStacks([...stacks, { id: Date.now().toString(36), name, members: [] }]);
    renderDashStacks(currentOpCache);
  };
  el.querySelectorAll('[data-st-name]').forEach(inp => inp.addEventListener('blur', async () => {
    const id = inp.dataset.stName;
    await saveDashStacks((currentOpCache.map_stacks||[]).map(s => String(s.id)===String(id) ? { ...s, name: inp.value.trim() || s.name } : s));
  }));
  el.querySelectorAll('[data-st-add]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.stAdd;
    const sel = el.querySelector('[data-st-addsel="'+id+'"]');
    if(!sel || !sel.value) return;
    await saveDashStacks((currentOpCache.map_stacks||[]).map(s => String(s.id)===String(id) ? { ...s, members: [...(s.members||[]), { member_id: sel.value }] } : s));
    renderDashStacks(currentOpCache);
  }));
  el.querySelectorAll('[data-rm]').forEach(btn => btn.addEventListener('click', async () => {
    const id = btn.dataset.st;
    const idx = Number(btn.dataset.rm);
    await saveDashStacks((currentOpCache.map_stacks||[]).map(s => String(s.id)===String(id) ? { ...s, members: (s.members||[]).filter((_,i)=>i!==idx) } : s));
    renderDashStacks(currentOpCache);
  }));
  el.querySelectorAll('[data-st-place]').forEach(btn => btn.addEventListener('click', () => {
    const st = (currentOpCache.map_stacks||[]).find(s => String(s.id)===String(btn.dataset.stPlace));
    if(!st) return;
    pendingStack = { ...st };
    const hint = document.getElementById('dashMapHint');
    if(hint) hint.textContent = 'Click the map to place ' + (st.name||'stack');
  }));
  el.querySelectorAll('[data-st-del]').forEach(btn => btn.addEventListener('click', async () => {
    if(!confirm('Delete this stack?')) return;
    await saveDashStacks((currentOpCache.map_stacks||[]).filter(s => String(s.id)!==String(btn.dataset.stDel)));
    rebuildDashMarkers(currentOpCache);
    renderDashStacks(currentOpCache);
  }));
}


function renderDashCheckins(op){
  const el = document.getElementById('dashCheckins');
  if(!el) return;
  const list = op.checkins || [];
  if(!list.length){ el.innerHTML = ''; return; }
  el.innerHTML = '<div class="page-title" style="font-size:16px; margin-bottom:8px;">Check-ins</div>' + list.map(c => {
    const gps = (c.lat!=null) ? `${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}` : 'no GPS';
    const link = (c.lat!=null) ? mapsLinkHtml(`${c.lat},${c.lng}`, 'Map') : '';
    return `<div class="list-row" style="cursor:default;"><div class="list-row-title">${c.name||'Operator'}</div><div class="list-row-meta">${gps}${link}</div></div>`;
  }).join('');
}


function subTeamById(id){ return allSubteams.find(t => t.id === id); }
async function saveAttachedUnits(units){
  currentOpCache.attached_units = units;
  const { error } = await supabaseClient.from('operations').update({ attached_units: units }).eq('id', currentOpId);
  if(error){
    const debrief = { ...(currentOpCache.debrief || {}), _attached_units: units };
    await supabaseClient.from('operations').update({ debrief }).eq('id', currentOpId);
    currentOpCache.debrief = debrief;
  }
}
function renderDashAttachedUnits(op, editable){
  const el = document.getElementById('planUnitsBox');
  if(!el) return;
  const units = Array.isArray(op.attached_units) ? op.attached_units : [];
  const used = new Set(units.map(u => u.subteam_id).filter(Boolean));
  const rows = units.map((u, idx) => {
    const name = u.name || 'Team';
    return `<div class="list-row" style="cursor:default; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
      ${editable ? `<input class="field-input" data-unit-name="${idx}" value="${String(name).replace(/"/g,'&quot;')}" style="max-width:200px;">` : `<strong>${name}</strong>`}
      ${editable ? `<select class="field-input" data-unit-cmd="${idx}" style="max-width:200px;"><option value="">Commander…</option>${allPersonnel.map(p => `<option value="${p.id}" ${u.commander_personnel_id===p.id?'selected':''}>${p.name}</option>`).join('')}</select>` : ''}
      ${editable ? `<button type="button" class="btn btn-ghost" data-unit-del="${idx}">Remove</button>` : ''}
    </div>`;
  }).join('') || '<div class="list-row-meta">No specialty teams attached.</div>';
  const unused = allSubteams.filter(t => !used.has(t.id));
  el.innerHTML = rows + (editable ? `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:8px;">
    <select class="field-input" id="attachExistingUnit" style="max-width:220px;"><option value="">Attach existing team…</option>${unused.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}</select>
    <button type="button" class="btn btn-outline" id="attachUnitBtn">Attach</button>
    <input class="field-input" id="newUnitName" placeholder="Or name a team" style="max-width:180px;">
    <button type="button" class="btn btn-primary" id="createUnitBtn">Add team</button>
  </div>` : '');
  if(!editable) return;
  $$('[data-unit-name]').forEach(inp => inp.addEventListener('blur', async () => {
    const idx = Number(inp.dataset.unitName);
    const next = units.map((u,i) => i===idx ? { ...u, name: inp.value.trim() || u.name } : u);
    await saveAttachedUnits(next);
  }));
  $$('[data-unit-cmd]').forEach(sel => sel.addEventListener('change', async () => {
    const idx = Number(sel.dataset.unitCmd);
    const next = units.map((u,i) => i===idx ? { ...u, commander_personnel_id: sel.value || null } : u);
    await saveAttachedUnits(next);
  }));
  $$('[data-unit-del]').forEach(btn => btn.addEventListener('click', async () => {
    const idx = Number(btn.dataset.unitDel);
    await saveAttachedUnits(units.filter((_,i) => i!==idx));
    renderDashAttachedUnits(currentOpCache, true);
  }));
  const attachBtn = document.getElementById('attachUnitBtn');
  if(attachBtn) attachBtn.onclick = async () => {
    const id = document.getElementById('attachExistingUnit').value;
    const team = subTeamById(id);
    if(!team) return;
    await saveAttachedUnits([...units, { subteam_id: team.id, name: team.name, commander_personnel_id: team.leader_personnel_id || null }]);
    renderDashAttachedUnits(currentOpCache, true);
  };
  const createBtn = document.getElementById('createUnitBtn');
  if(createBtn) createBtn.onclick = async () => {
    const name = (document.getElementById('newUnitName').value || '').trim();
    if(!name) return;
    await saveAttachedUnits([...units, { name }]);
    renderDashAttachedUnits(currentOpCache, true);
  };
}

let dashChatRows = [];
function renderDashChat(){
  const el = document.getElementById('dashOpChat');
  if(!el) return;
  const list = dashChatRows.map(m => {
    const t = new Date(m.created_at);
    const time = isNaN(t) ? '' : t.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
    return `<div class="list-row" style="cursor:default;"><div class="list-row-title">${m.author_name||'Operator'} · ${time}</div><div class="list-row-meta">${(m.body||'').replace(/</g,'&lt;')}</div></div>`;
  }).join('') || '<div class="empty-state">No messages on this operation yet.</div>';
  el.innerHTML = list + `<div style="display:flex; gap:8px; margin-top:12px;"><input class="field-input" id="dashChatInput" placeholder="Message this operation..."><button class="btn btn-primary" id="dashChatSend">Send</button></div>`;
  const send = async () => {
    const input = document.getElementById('dashChatInput');
    const body = (input && input.value || '').trim();
    if(!body) return;
    const { data, error } = await supabaseClient.from('operation_messages').insert({
      agency_id: currentProfile.agency_id, operation_id: currentOpId,
      author_name: currentProfile.full_name, author_user_id: currentProfile.id, body
    }).select().single();
    if(error){ alert('Chat table missing. Same SQL as the field app operation_messages table.'); return; }
    if(data) dashChatRows.push(data);
    renderDashChat();
  };
  document.getElementById('dashChatSend').onclick = send;
}
async function loadDashChat(){
  const { data } = await supabaseClient.from('operation_messages').select('*').eq('operation_id', currentOpId).order('created_at').limit(200);
  dashChatRows = data || [];
  renderDashChat();
}

