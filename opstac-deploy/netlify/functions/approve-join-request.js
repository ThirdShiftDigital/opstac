// netlify/functions/approve-join-request.js
//
// Commander-only. Approves or denies a pending join request.
// Approving is the moment this person actually gets real access —
// it's what creates their profiles row (linking them to the agency)
// and their personnel row (adding them to the roster). Denying just
// marks the request denied; their auth account is left alone.

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

  const { accessToken, requestId, decision, role, subteamId } = body;
  if (!accessToken || !requestId || !['approve', 'deny'].includes(decision)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request.' }) };
  }

  const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerError || !caller) {
    console.error('approve-join-request: getUser failed', { error: callerError });
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired. Please sign in again.' }) };
  }

  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from('profiles').select('agency_id, role').eq('id', caller.id).single();
  if (callerProfileError || !callerProfile) {
    console.error('approve-join-request: caller profile lookup failed', { callerId: caller.id, error: callerProfileError });
    return { statusCode: 403, body: JSON.stringify({ error: 'Could not verify your account.' }) };
  }
  if (callerProfile.role !== 'commander') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the Commander can review join requests.' }) };
  }

  const { data: request, error: requestError } = await supabaseAdmin
    .from('join_requests').select('*').eq('id', requestId).single();
  if (requestError || !request) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Request not found.' }) };
  }
  if (request.agency_id !== callerProfile.agency_id) {
    return { statusCode: 403, body: JSON.stringify({ error: 'This request does not belong to your agency.' }) };
  }
  if (request.status !== 'pending') {
    return { statusCode: 409, body: JSON.stringify({ error: 'This request has already been reviewed.' }) };
  }

  // Find the commander's own personnel record for reviewed_by (may be null if somehow missing).
  const { data: callerPersonnel } = await supabaseAdmin
    .from('personnel').select('id').eq('profile_id', caller.id).eq('agency_id', callerProfile.agency_id).maybeSingle();

  if (decision === 'deny') {
    const { error: updateError } = await supabaseAdmin.from('join_requests')
      .update({ status: 'denied', reviewed_at: new Date().toISOString(), reviewed_by: callerPersonnel ? callerPersonnel.id : null })
      .eq('id', requestId);
    if (updateError) {
      console.error('approve-join-request: deny update failed', { error: updateError });
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not deny the request: ' + updateError.message }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, decision: 'denied' }) };
  }

  // decision === 'approve'
  const finalRole = ['member', 'team-leader'].includes(role) ? role : 'member';

  const { error: profileInsertError } = await supabaseAdmin.from('profiles').insert({
    id: request.profile_id, agency_id: callerProfile.agency_id, full_name: request.name, role: finalRole,
  });
  if (profileInsertError) {
    console.error('approve-join-request: profile insert failed', { error: profileInsertError });
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not approve: ' + profileInsertError.message }) };
  }

  const { error: personnelInsertError } = await supabaseAdmin.from('personnel').insert({
    agency_id: callerProfile.agency_id, profile_id: request.profile_id, name: request.name,
    phone: request.phone, permission: finalRole, subteam_id: subteamId || null, status: 'ready', on_call: false,
  });
  if (personnelInsertError) {
    console.error('approve-join-request: personnel insert failed', { error: personnelInsertError });
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not add them to the roster: ' + personnelInsertError.message }) };
  }

  const { error: updateError } = await supabaseAdmin.from('join_requests')
    .update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: callerPersonnel ? callerPersonnel.id : null })
    .eq('id', requestId);
  if (updateError) {
    console.error('approve-join-request: approve status update failed', { error: updateError });
    // Not fatal — they're already fully onboarded at this point, just log it.
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, decision: 'approved' }) };
};
