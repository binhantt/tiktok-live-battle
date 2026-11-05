const API_URL = process.env.API_URL || 'http://localhost:3000/api/v1/admin/test-event';

const DEMO_VIEWERS = [
  { tiktokUserId: 'viewer_101', username: 'CanhSat_Nam', choice: '1', faction: 'police' },
  { tiktokUserId: 'viewer_102', username: 'BuonLau_Kiet', choice: '2', faction: 'smuggler' },
  { tiktokUserId: 'viewer_103', username: 'DoiTruong_SWAT', choice: '1', faction: 'police' },
  { tiktokUserId: 'viewer_104', username: 'TrumMafia_X', choice: '2', faction: 'smuggler' },
  { tiktokUserId: 'viewer_105', username: 'BaoVeConTin', choice: '1', faction: 'police' },
  { tiktokUserId: 'viewer_106', username: 'SatThuBongDem', choice: '2', faction: 'smuggler' },
];

async function sendTestEvent(payload: Record<string, any>) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

async function runSimulation() {
  console.log(`Starting 2-Faction (1: Công An vs 2: Buôn Lậu) simulation -> ${API_URL}`);

  for (const v of DEMO_VIEWERS) {
    console.log(`[Chat] ${v.username} comments "${v.choice}" to join ${v.faction.toUpperCase()}`);
    await sendTestEvent({
      type: 'chat',
      tiktokUserId: v.tiktokUserId,
      username: v.username,
      comment: v.choice,
    });
    await new Promise((r) => setTimeout(r, 250));

    console.log(`[Tap Like] ${v.username} taps +12 likes for ${v.faction.toUpperCase()}!`);
    await sendTestEvent({
      type: 'like',
      tiktokUserId: v.tiktokUserId,
      username: v.username,
      likeCount: 12,
      faction: v.faction,
    });
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('Simulation complete! Watch Police vs Smugglers fight for the Hostage at http://localhost:5173/overlay');
}

runSimulation().catch((err) => {
  console.error('Simulation failed:', err.message);
  process.exit(1);
});
