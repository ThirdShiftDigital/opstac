// netlify/functions/submit-join-request.js
//
// Called right after someone completes ordinary Supabase signup on the
// "I'm Joining an Existing Team" path. Takes their fresh session token
// plus the agency code they entered, and creates a pending join_requests
// row for a Commander to approve or deny.
//
// Deliberately does NOT create a profiles or personnel row here — that
// only happens on approval (see approve-join-request.js). Until then,
// this person has a real auth account but no agency_id anywhere, so
// every other RLS policy in the schema keeps them locked out.

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

  const { accessToken, agencyCode, name, phone } = body;
  if (!accessToken || !agencyCode || !name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Agency code and name are required.' }) };
  }

  const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerError || !caller) {
    console.error('submit-join-request: getUser failed', { error: callerError });
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired. Please sign up again.' }) };
  }

  // If this person already has a profile somewhere, they don't need to
  // request access — either they're already in an agency, or they should
  // use "Add Existing Account" instead of the signup flow.
  const { data: existingProfile } = await supabaseAdmin.from('profiles').select('agency_id').eq('id', caller.id).maybeSingle();
  if (existingProfile) {
    return { statusCode: 409, body: JSON.stringify({ error: 'This account is already linked to an agency.' }) };
  }

  const { data: agency, error: agencyError } = await supabaseAdmin
    .from('agencies').select('id, name').eq('agency_code', agencyCode.trim().toUpperCase()).maybeSingle();
  if (agencyError) {
    console.error('submit-join-request: agency lookup failed', { error: agencyError });
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not look up that agency code. Please try again.' }) };
  }
  if (!agency) {
    return { statusCode: 404, body: JSON.stringify({ error: 'No agency found with that code. Double-check it with your Commander.' }) };
  }

  const { error: insertError } = await supabaseAdmin.from('join_requests').insert({
    agency_id: agency.id, profile_id: caller.id, name, email: caller.email, phone: phone || null,
  });
  if (insertError) {
    if (insertError.code === '23505') { // unique violation — already has a pending request
      return { statusCode: 409, body: JSON.stringify({ error: 'You already have a pending request. Ask your Commander to check for it.' }) };
    }
    console.error('submit-join-request: insert failed', { error: insertError });
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not submit your request: ' + insertError.message }) };
  }

  // Best-effort notification to the Commander — a failure here should never
  // block the request itself, since it was already created successfully.
  try {
    const { data: commanderProfile } = await supabaseAdmin
      .from('profiles').select('id').eq('agency_id', agency.id).eq('role', 'commander').maybeSingle();
    if (commanderProfile && process.env.RESEND_API_KEY) {
      const { data: commanderUser } = await supabaseAdmin.auth.admin.getUserById(commanderProfile.id);
      if (commanderUser && commanderUser.user && commanderUser.user.email) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: 'OpsTac <notifications@opstac.net>',
            to: [commanderUser.user.email],
            subject: `New join request — ${name}`,
            html: `<p><strong>${name}</strong> (${caller.email}) wants to join <strong>${agency.name}</strong> on OpsTac.</p>
                   <p>Review and approve or deny in the app: Roster → Pending Join Requests.</p>`,
          }),
        });
      }
    }
  } catch (notifyError) {
    console.error('submit-join-request: commander notification failed (non-fatal)', { error: notifyError });
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, agencyName: agency.name }) };
};
