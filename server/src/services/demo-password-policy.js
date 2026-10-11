// Emulator-only repair using seed provenance and Auth change timestamps, never passwords.
export async function repairDemoPasswordFlags(database, authUsers, savedUids = new Set()) {
  const frequencies = new Map();
  for (const u of authUsers) { const at = Number(u.passwordUpdatedAt); if (savedUids.has(u.localId) && at) frequencies.set(at, (frequencies.get(at) || 0) + 1); }
  // Emulator import rewrites passwordUpdatedAt for the imported batch. An account
  // changed after import has its own newer timestamp and is deliberately skipped.
  const importTimes = new Set([...frequencies].filter(([, n]) => n >= 2).map(([at]) => at));
  const result = {flagged: [], rebased: [], skippedChanged: [], skippedUnknown: []};
  for (const u of authUsers) {
    const profile = await database.collection('users').findOne({_id: u.localId});
    if (!profile || profile.email?.toLowerCase() !== u.email?.toLowerCase()) continue;
    if (profile.mustChangePassword === false || profile.passwordChangedAt) { result.skippedChanged.push(u.localId); continue; }
    const at = Number(u.passwordUpdatedAt), imported = savedUids.has(u.localId) && importTimes.has(at);
    if (profile.mustChangePassword === true) {
      if (imported && at > new Date(profile.temporaryPasswordIssuedAt || 0).getTime()) {
        await database.collection('users').updateOne({_id:u.localId,mustChangePassword:true},{$set:{temporaryPasswordIssuedAt:new Date(at)}}); result.rebased.push(u.localId);
      }
      continue;
    }
    const job = await database.collection('provisioningJobs').findOne({_id:u.localId});
    const seeded = Boolean(profile.demoSeed || job?.activation === 'emulator-password' || job?.result?.activation === 'emulator-password');
    if (!seeded || !at) { result.skippedUnknown.push(u.localId); continue; }
    if (!imported && at !== Number(u.createdAt)) { result.skippedChanged.push(u.localId); continue; }
    const updated = await database.collection('users').updateOne({_id:u.localId,mustChangePassword:{$exists:false},passwordChangedAt:{$exists:false}},{$set:{mustChangePassword:true,temporaryPasswordIssuedAt:new Date(at),passwordPolicySource:'local-seed-provenance-v1'}});
    if (updated.modifiedCount) result.flagged.push(u.localId);
  }
  return result;
}

export async function readEmulatorAuthMetadata(project, host) {
  if (!project.startsWith('demo-') || !/^127\.0\.0\.1:\d+$/.test(host)) throw new Error('Password flag repair requires a local demo Auth emulator.');
  const users = []; let nextPageToken;
  do {
    const url = new URL(`http://${host}/identitytoolkit.googleapis.com/v1/projects/${project}/accounts:batchGet`);
    url.searchParams.set('maxResults','1000'); if (nextPageToken) url.searchParams.set('nextPageToken',nextPageToken);
    const response = await fetch(url,{headers:{Authorization:'Bearer owner'}}), data = await response.json();
    if (!response.ok) throw new Error('Cannot read local Auth metadata.');
    for (const u of data.users || []) users.push({localId:u.localId,email:u.email,createdAt:u.createdAt,passwordUpdatedAt:u.passwordUpdatedAt});
    nextPageToken = data.nextPageToken;
  } while (nextPageToken);
  return users;
}
