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
    redirectTo: window.location.origin + '/dashboard.html',
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
    supabaseClient.from('agencies').select('name').eq('id', profile.agency_id).single(),
    supabaseClient.from('agency_settings').select('*').eq('agency_id', profile.agency_id).single(),
  ]);
  currentAgency = agency;
  currentSettings = settings;

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
let armedOperatorId = null;

async function openOpDetail(opId){
  currentOpId = opId;
  armedOperatorId = null;
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
      <div class="subtab" data-subtab="debrief">Debrief</div>
      <div class="subtab" data-subtab="callouts">Callouts</div>
    </div>
    <div class="subpanel active" id="opPanel-map">
      <div class="op-palette" id="opPalette"></div>
      <input type="file" accept="image/*" id="mapImageInput" style="display:none;">
      <div class="map-canvas" id="mapCanvas">
        <div class="map-upload-prompt" id="mapUploadPrompt" style="${op.map_image_url ? 'display:none;' : ''}">
          <span>Upload a scene photo or satellite screenshot</span>
        </div>
        <img id="mapBgImage" style="${op.map_image_url ? 'display:block;' : ''}">
      </div>
    </div>
    <div class="subpanel" id="opPanel-plan">
      <div id="planFields"></div>
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
  }));

  renderMapPalette(op, operators, editable);
  renderMapPins(operators);
  renderExistingMapImage(op);
  wireMapUpload(op, editable);
  renderPlan(op, editable);
  renderDebrief(op, editable);
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

function renderMapPalette(op, operators, editable){
  $('#opPalette').innerHTML = allPersonnel.map(p => {
    const placed = operators.some(o => o.member_id === p.id);
    return `<div class="op-chip ${armedOperatorId===p.id?'armed':''}" data-member-id="${p.id}" style="${placed?'box-shadow:0 0 0 2px var(--olive) inset;':''}">${p.name}</div>`;
  }).join('');
  if(!editable) return;
  $$('.op-chip').forEach(chip => chip.addEventListener('click', () => {
    armedOperatorId = armedOperatorId === chip.dataset.memberId ? null : chip.dataset.memberId;
    renderMapPalette(op, operators, editable);
  }));
}

function renderMapPins(operators){
  $$('.map-pin').forEach(p => p.remove());
  const canvas = $('#mapCanvas');
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
    <html><head><title>${op.name}</title></head>
    <body style="font-family:sans-serif; padding:40px; color:#111;">
      <h1>${op.name}</h1>
      <p>${op.type||''} · ${op.status} · ${op.date||''} · ${op.location||''}</p>
      ${commander ? `<p><strong>Overall Command:</strong> ${commander.name}</p>` : ''}
      <h3>Operators</h3>${rosterLines || '<p>None assigned.</p>'}
      ${photosHtml}
      <h3>Pre-Ops Plan</h3>
      ${PLAN_FIELDS.map(f => `<p><strong>${f.label}:</strong> ${(op.plan||{})[f.key] || '—'}</p>`).join('')}
      ${op.status==='complete' ? `<h3>Debrief</h3>${DEBRIEF_FIELDS.map(f => `<p><strong>${f.label}:</strong> ${(op.debrief||{})[f.key] || '—'}</p>`).join('')}` : ''}
    </body></html>
  `);
  w.document.close();
  w.print();
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
    return `<div class="list-row" style="cursor:default; position:relative;">
      <span class="pill ${modeCls}"><span class="pill-dot"></span>${c.mode==='deploy'?'Deploy':'Standby'}</span>
      ${editBtn}
      <div class="list-row-title">${c.type||'Callout'}</div>
      <div class="list-row-meta">${c.date||''} ${c.location?'· '+c.location:''}${mapsLinkHtml(c.location)} · ${acked}/${total} acknowledged</div>
      ${c.rally_location ? `<div class="list-row-meta" style="margin-top:2px;">Rally: ${c.rally_location}${mapsLinkHtml(c.rally_location)}</div>` : ''}
      ${!c.active ? `<span class="pill good" style="margin-top:6px; display:inline-block;">Resolved</span>` : ''}
      ${c.outcome ? `<div class="list-row-meta" style="margin-top:4px;">${c.outcome}</div>` : ''}
      ${linkedOpTag}
      <div style="margin-top:10px;">${recipRows}</div>
    </div>`;
  }).join('');

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
  const [{ data: settings }, { data: agency }] = await Promise.all([
    supabaseClient.from('agency_settings').select('*').eq('agency_id', currentProfile.agency_id).single(),
    supabaseClient.from('agencies').select('name, agency_code').eq('id', currentProfile.agency_id).single(),
  ]);
  currentSettings = settings;
  const isCommander = currentProfile.role === 'commander';

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
