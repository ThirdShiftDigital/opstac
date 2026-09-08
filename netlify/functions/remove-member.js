// netlify/functions/remove-member.js
//
// Removes a personnel record from the roster. If that person also has
// app login access (personnel.profile_id is set), this revokes their
// login too — otherwise deleting the roster entry alone would leave an
// orphaned account that can still authenticate and see agency data via
// RLS, even though they no longer show up anywhere in the app.
//
// Commander-only, same trust boundary as inviting — matches the
// database's own RLS policy (personnel delete is restricted to
// commander), this function just adds the login-revocation step RLS
// alone can't do (deleting an auth.users row requires the admin API).

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

  const { accessToken, personnelId } = body;
  if (!accessToken || !personnelId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields.' }) };
  }

  const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerError || !caller) {
    console.error('remove-member: getUser failed', { error: callerError });
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired. Please sign in again.' }) };
  }

  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from('profiles').select('agency_id, role').eq('id', caller.id).single();
  if (callerProfileError || !callerProfile) {
    console.error('remove-member: caller profile lookup failed', { callerId: caller.id, error: callerProfileError });
    return { statusCode: 403, body: JSON.stringify({ error: 'Could not verify your account.' }) };
  }
  if (callerProfile.role !== 'commander') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the Commander can remove roster members.' }) };
  }

  const { data: personnel, error: personnelError } = await supabaseAdmin
    .from('personnel').select('id, agency_id, profile_id').eq('id', personnelId).single();
  if (personnelError || !personnel) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Roster entry not found.' }) };
  }
  if (personnel.agency_id !== callerProfile.agency_id) {
    return { statusCode: 403, body: JSON.stringify({ error: 'That roster entry does not belong to your agency.' }) };
  }
  if (personnel.profile_id === caller.id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'You can\'t remove your own account this way.' }) };
  }

  // Revoke login access first, if they have one. Deleting the auth user
  // cascades to remove their profiles row automatically.
  if (personnel.profile_id) {
    const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(personnel.profile_id);
    if (deleteUserError) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not revoke their login: ' + deleteUserError.message }) };
    }
  }

  const { error: deletePersonnelError } = await supabaseAdmin.from('personnel').delete().eq('id', personnelId);
  if (deletePersonnelError) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not remove them from the roster: ' + deletePersonnelError.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
