// netlify/functions/link-existing-account.js
//
// Adds someone to the roster who ALREADY has a Supabase Auth account
// (as opposed to invite-member.js, which creates a brand-new account
// for someone who doesn't have one yet).
//
// Three real-world cases this covers:
//  A. The account exists but was never linked to any agency at all
//     (e.g. an edge case during a prior signup/removal) — safe to link.
//  B. The account is already correctly in the caller's own agency but
//     somehow has no roster entry — safe to just add the roster entry.
//  C. The account belongs to a DIFFERENT agency — the common real case
//     being someone who found the app, signed up out of curiosity, and
//     ended up as the founding "commander" of their own throwaway
//     agency. If — and only if — that other agency is provably empty
//     (just them, nothing else in it), this migrates them over. If that
//     agency has any other people or real data in it, this refuses and
//     says so — moving an agency with real data is a much bigger, riskier
//     operation than this button is meant for.

const { createClient } = require('@supabase/supabase-js');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

async function findAuthUserByEmail(email) {
  // No direct getUserByEmail in supabase-js — official workaround is
  // paginating listUsers() and filtering client-side. Fine at OpsTac's
  // scale; a single high-perPage call covers realistic usage.
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return { user: null, error };
  const match = (data.users || []).find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
  return { user: match || null, error: null };
}

async function countInAgency(table, agencyId) {
  const { count, error } = await supabaseAdmin.from(table).select('id', { count: 'exact', head: true }).eq('agency_id', agencyId);
  if (error) throw error;
  return count || 0;
}

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

  const { accessToken, email, name, rank, teamRole, subteamId, phone, role } = body;
  if (!accessToken || !email || !name) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Email and name are required.' }) };
  }
  if (!['member', 'team-leader'].includes(role)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid role.' }) };
  }

  const { data: { user: caller }, error: callerError } = await supabaseAdmin.auth.getUser(accessToken);
  if (callerError || !caller) {
    console.error('link-existing-account: getUser failed', { error: callerError });
    return { statusCode: 401, body: JSON.stringify({ error: 'Your session has expired. Please sign in again.' }) };
  }

  const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
    .from('profiles').select('agency_id, role').eq('id', caller.id).single();
  if (callerProfileError || !callerProfile) {
    console.error('link-existing-account: caller profile lookup failed', { callerId: caller.id, error: callerProfileError });
    return { statusCode: 403, body: JSON.stringify({ error: 'Could not verify your account.' }) };
  }
  if (callerProfile.role !== 'commander') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Only the Commander can add existing accounts.' }) };
  }

  const { user: foundUser, error: findError } = await findAuthUserByEmail(email);
  if (findError) {
    console.error('link-existing-account: listUsers failed', { error: findError });
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not search for that account. Please try again.' }) };
  }
  if (!foundUser) {
    return { statusCode: 404, body: JSON.stringify({ error: 'No account found with that email. Use "Invite to App" instead to create one.' }) };
  }

  const { data: existingProfile } = await supabaseAdmin
    .from('profiles').select('agency_id').eq('id', foundUser.id).maybeSingle();

  const personnelPayload = {
    agency_id: callerProfile.agency_id, profile_id: foundUser.id, name,
    rank: rank || null, team_role: teamRole || null, subteam_id: subteamId || null,
    phone: phone || null, permission: role, status: 'ready', on_call: false,
  };

  // CASE A: no profile at all yet — a genuinely unlinked account.
  if (!existingProfile) {
    const { error: profileInsertError } = await supabaseAdmin.from('profiles').insert({
      id: foundUser.id, agency_id: callerProfile.agency_id, full_name: name, role,
    });
    if (profileInsertError) {
      console.error('link-existing-account: profile insert failed', { error: profileInsertError });
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not link the account: ' + profileInsertError.message }) };
    }
    const { error: personnelInsertError } = await supabaseAdmin.from('personnel').insert(personnelPayload);
    if (personnelInsertError) {
      console.error('link-existing-account: personnel insert failed', { error: personnelInsertError });
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not add them to the roster: ' + personnelInsertError.message }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, userId: foundUser.id }) };
  }

  // CASE B: already correctly in the caller's own agency.
  if (existingProfile.agency_id === callerProfile.agency_id) {
    const { data: existingPersonnel } = await supabaseAdmin
      .from('personnel').select('id').eq('profile_id', foundUser.id).eq('agency_id', callerProfile.agency_id).maybeSingle();
    if (existingPersonnel) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This account is already on your roster.' }) };
    }
    const { error: personnelInsertError } = await supabaseAdmin.from('personnel').insert(personnelPayload);
    if (personnelInsertError) {
      console.error('link-existing-account: personnel insert failed', { error: personnelInsertError });
      return { statusCode: 400, body: JSON.stringify({ error: 'Could not add them to the roster: ' + personnelInsertError.message }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true, userId: foundUser.id }) };
  }

  // CASE C: belongs to a different agency — only proceed if that agency is provably empty.
  const oldAgencyId = existingProfile.agency_id;
  try {
    const [personnelCount, opsCount, calloutsCount, equipCount, certsCount, trainingCount] = await Promise.all([
      countInAgency('personnel', oldAgencyId),
      countInAgency('operations', oldAgencyId),
      countInAgency('callouts', oldAgencyId),
      countInAgency('equipment', oldAgencyId),
      countInAgency('certifications', oldAgencyId),
      countInAgency('training_sessions', oldAgencyId),
    ]);
    const hasOtherData = opsCount > 0 || calloutsCount > 0 || equipCount > 0 || certsCount > 0 || trainingCount > 0;
    if (personnelCount > 1 || hasOtherData) {
      return { statusCode: 409, body: JSON.stringify({ error: 'This email belongs to a different agency that already has real data in it. This needs to be resolved manually.' }) };
    }
  } catch (countError) {
    console.error('link-existing-account: safety check failed', { error: countError });
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not verify it was safe to move this account. Please try again.' }) };
  }

  // Safe — the old agency has nothing but this one person in it. Migrate them.
  await supabaseAdmin.from('personnel').delete().eq('agency_id', oldAgencyId).eq('profile_id', foundUser.id);

  const { error: reassignError } = await supabaseAdmin.from('profiles')
    .update({ agency_id: callerProfile.agency_id, role, full_name: name }).eq('id', foundUser.id);
  if (reassignError) {
    console.error('link-existing-account: profile reassign failed', { error: reassignError });
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not move their account: ' + reassignError.message }) };
  }

  const { error: personnelInsertError } = await supabaseAdmin.from('personnel').insert(personnelPayload);
  if (personnelInsertError) {
    console.error('link-existing-account: personnel insert failed', { error: personnelInsertError });
    return { statusCode: 400, body: JSON.stringify({ error: 'Could not add them to the roster: ' + personnelInsertError.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ success: true, userId: foundUser.id, migrated: true }) };
};
