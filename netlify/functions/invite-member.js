// netlify/functions/invite-member.js
//
// Invites an existing roster (personnel) entry to get their own login.
// Only the founding Commander can invite — this creates real account
// access, a bigger trust boundary than editing a roster entry, so it's
// deliberately not delegated to Team Leaders even if they can otherwise
// manage records.
//
// Flow: verify the caller is actually the agency's commander (never trust
// a client-supplied role) -> confirm the target personnel row belongs to
// the same agency and doesn't already have a login -> send a real Supabase
// invite email -> create their profile -> link personnel.profile_id.
// Any failure after the invite email sends rolls back the auth user so
// the same email can be retried cleanly.

const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { accessToken, personnelId, email, role } = body;
  if (!accessToken || !personnelId || !email || !role) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields.' }) };
  }
  if (!['member', 'team-leader'].includes(role)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid role.' }) };
  }

  // Verify the caller's identity from their own session token — never trust
  // a client-supplied agency_id or role.
  const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerError || !caller) {
    console.error('invite-member: getUser failed', { error: callerError });
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired. Please sign in again.' }) };
  }

  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from('profiles').select('agency_id, role, full_name').eq('id', caller.id).single();
  if (callerProfileError || !callerProfile) {
    console.error('invite-member: caller profile lookup failed', { callerId: caller.id, error: callerProfileError });
    return { statusCode: 403, body: JSON.stringify({ error: 'Could not verify your account.' }) };
  }
  if (callerProfile.role !== 'commander') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the Commander can invite members.' }) };
  }

  // Confirm the target roster entry belongs to the caller's agency and isn't already linked.
  const { data: personnel, error: personnelError } = await supabaseAdmin
    .from('personnel').select('id, agency_id, name, profile_id').eq('id', personnelId).single();
  if (personnelError || !personnel) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Roster entry not found.' }) };
  }
  if (personnel.agency_id !== callerProfile.agency_id) {
    return { statusCode: 403, body: JSON.stringify({ error: 'That roster entry does not belong to your agency.' }) };
  }
  if (personnel.profile_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'This person already has a login.' }) };
  }

  const { data: agency } = await supabaseAdmin.from('agencies').select('name').eq('id', callerProfile.agency_id).single();

  // Send the real invite — Supabase emails them a link to set their own password.
  const { data: inviteData, error: inviteError } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
    redirectTo: process.env.INVITE_REDIRECT_URL || undefined,
    data: {
      agency_name: agency ? agency.name : 'your agency',
      inviter_name: callerProfile.full_name,
      invitee_name: personnel.name,
      invitee_role: role === 'team-leader' ? 'Team Leader' : 'Member',
    },
  });
  if (inviteError) {
    const message = inviteError.message.includes('already registered')
      ? 'An account with this email already exists.'
      : 'Could not send invite: ' + inviteError.message;
    return { statusCode: 400, body: JSON.stringify({ error: message }) };
  }

  const newUserId = inviteData.user.id;

  const { error: profileError } = await supabaseAdmin.from('profiles').insert({
    id: newUserId, agency_id: callerProfile.agency_id, full_name: personnel.name, role,
  });
  if (profileError) {
    await supabaseAdmin.auth.admin.deleteUser(newUserId).catch(() => {});
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not finish setting up their account: ' + profileError.message }) };
  }

  const { error: linkError } = await supabaseAdmin.from('personnel')
    .update({ profile_id: newUserId, permission: role }).eq('id', personnelId);
  if (linkError) {
    await supabaseAdmin.auth.admin.deleteUser(newUserId).catch(() => {});
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not link the invite to their roster entry: ' + linkError.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, userId: newUserId }) };
};
