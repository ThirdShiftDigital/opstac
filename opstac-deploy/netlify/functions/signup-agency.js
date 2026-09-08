// netlify/functions/signup-agency.js
//
// Creates a new OpsTac agency + founding commander account.
// Two-step process: (1) create the Supabase Auth user, (2) call the
// bootstrap_agency() Postgres function to atomically create the agency,
// profile, roster entry, and default settings.
//
// If step 2 fails after step 1 succeeded, this deletes the orphaned
// auth user so a failed signup never leaves a half-created account
// the person can't sign up again with.

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

  const { agencyName, fullName, email, password, rank, phone, teamLabel, subteams } = body;

  if (!agencyName || !fullName || !email || !password) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Agency name, full name, email, and password are all required.' }),
    };
  }
  if (password.length < 8) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Password must be at least 8 characters.' }) };
  }

  // Step 1: create the auth user
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // founding commander — no need to wait on email verification
  });

  if (authError) {
    const message = authError.message.includes('already registered')
      ? 'An account with this email already exists.'
      : 'Could not create account: ' + authError.message;
    return { statusCode: 400, body: JSON.stringify({ error: message }) };
  }

  const authUserId = authData.user.id;

  // Step 2: atomically create agency + profile + roster entry + settings
  const { data: agencyId, error: bootstrapError } = await supabaseAdmin.rpc('bootstrap_agency', {
    p_auth_user_id: authUserId,
    p_agency_name: agencyName,
    p_full_name: fullName,
    p_rank: rank || null,
    p_phone: phone || null,
    p_team_label: teamLabel || 'SRT',
    p_subteams: Array.isArray(subteams) ? subteams : [],
  });

  if (bootstrapError) {
    // Roll back the orphaned auth user so this email can be retried
    await supabaseAdmin.auth.admin.deleteUser(authUserId).catch(() => {});
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Could not set up your agency: ' + bootstrapError.message }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, agencyId, userId: authUserId }),
  };
};
